/**
 * MapScene renders only the dungeon world. Complex UI lives in DOM overlays.
 */
import type { FrameInfo } from "./Renderer";
import type { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import type { EnemyState } from "@/core/actors/Enemy";
import { computeCameraViewport } from "./viewport";
import type { SpriteKey, SpriteSheetAssets } from "./AssetLoader";

const VISIBLE = {
  [Terrain.FLOOR]: "#e9e1c8",
  [Terrain.DOOR]: "#c98a45",
  [Terrain.WALL]: "#3a3a45",
  [Terrain.EMPTY]: "#000000",
} as const;

const EXPLORED = {
  [Terrain.FLOOR]: "#5b574a",
  [Terrain.DOOR]: "#5e4524",
  [Terrain.WALL]: "#1c1c22",
  [Terrain.EMPTY]: "#000000",
} as const;

const COLORS = {
  hero: "#7fe3ff",
  heroEdge: "#0b0b0f",
  enemyWander: "#e0a23a",
  enemyHunt: "#e85a4a",
  enemyEdge: "#0b0b0f",
  entrance: "#5ad15a",
  exit: "#d15a5a",
  selection: "#5ad1c9",
  gridLine: "rgba(0, 0, 0, 0.18)",
  unseen: "#000000",
};

export interface MapView {
  grid: Grid;
  seed: string;
  depth: number;
  roomCount: number;
  entrance: number;
  exit: number;
  heroPos: number;
  enemies: ReadonlyArray<{
    pos: number;
    state: EnemyState;
    name: string;
    hp: number;
    maxHealth: number;
  }>;
  visible: ReadonlySet<number>;
  explored: ReadonlySet<number>;
  selectedCell: number | null;
  hero: {
    hp: number;
    maxHealth: number;
    accuracy: number;
    evasion: number;
    damageMin: number;
    damageMax: number;
    armor: number;
    weaponName: string;
    armorName: string;
    alive: boolean;
  };
  log: readonly string[];
}

export function drawMapScene(
  ctx: CanvasRenderingContext2D,
  frame: FrameInfo,
  view: MapView,
  assets?: SpriteSheetAssets,
): void {
  const { grid } = view;
  const vp = computeCameraViewport(frame.width, frame.height, grid, view.heroPos);
  const ts = vp.tileSize;
  const minX = Math.max(0, Math.floor(-vp.offsetX / ts) - 1);
  const minY = Math.max(0, Math.floor(-vp.offsetY / ts) - 1);
  const maxX = Math.min(grid.width - 1, Math.ceil((frame.width - vp.offsetX) / ts) + 1);
  const maxY = Math.min(grid.height - 1, Math.ceil((frame.height - vp.offsetY) / ts) + 1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = grid.cell(x, y);
      const terrain = grid.get(cell);
      const visible = view.visible.has(cell);
      const explored = view.explored.has(cell);
      ctx.fillStyle = visible
        ? VISIBLE[terrain]
        : explored
          ? EXPLORED[terrain]
          : COLORS.unseen;
      ctx.fillRect(vp.offsetX + x * ts, vp.offsetY + y * ts, ts, ts);

      if (assets && terrain !== Terrain.EMPTY && explored) {
        drawSprite(
          ctx,
          assets,
          assets.spriteForTerrain(terrain),
          vp.offsetX + x * ts,
          vp.offsetY + y * ts,
          ts,
          visible ? 1 : 0.35,
        );
      }
    }
  }

  if (ts >= 8) {
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = minX; x <= maxX + 1; x++) {
      const px = vp.offsetX + x * ts + 0.5;
      ctx.moveTo(px, vp.offsetY);
      ctx.lineTo(px, vp.offsetY + grid.height * ts);
    }
    for (let y = minY; y <= maxY + 1; y++) {
      const py = vp.offsetY + y * ts + 0.5;
      ctx.moveTo(vp.offsetX, py);
      ctx.lineTo(vp.offsetX + grid.width * ts, py);
    }
    ctx.stroke();
  }

  if (view.explored.has(view.entrance)) {
    drawCell(ctx, assets, vp, grid, view.entrance, "entrance", COLORS.entrance);
  }
  if (view.explored.has(view.exit)) {
    drawCell(ctx, assets, vp, grid, view.exit, "exit", COLORS.exit);
  }

  for (const enemy of view.enemies) {
    if (!view.visible.has(enemy.pos)) continue;
    drawCell(
      ctx,
      assets,
      vp,
      grid,
      enemy.pos,
      assets?.spriteForEnemy(enemy) ?? "rat",
      enemy.state === "hunt" ? COLORS.enemyHunt : COLORS.enemyWander,
      COLORS.enemyEdge,
    );
  }

  drawCell(ctx, assets, vp, grid, view.heroPos, "hero", COLORS.hero, COLORS.heroEdge);

  if (view.selectedCell !== null) {
    const sx = grid.xOf(view.selectedCell);
    const sy = grid.yOf(view.selectedCell);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(vp.offsetX + sx * ts + 1, vp.offsetY + sy * ts + 1, ts - 2, ts - 2);
  }
}

type VP = { tileSize: number; offsetX: number; offsetY: number };

function drawCell(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  cell: number,
  sprite: SpriteKey,
  fill: string,
  edge?: string,
): void {
  const ts = vp.tileSize;
  const x = vp.offsetX + grid.xOf(cell) * ts;
  const y = vp.offsetY + grid.yOf(cell) * ts;
  if (assets && drawSprite(ctx, assets, sprite, x, y, ts, 1)) {
    return;
  }

  if (edge) drawDisc(ctx, x + ts / 2, y + ts / 2, ts, fill, edge);
  else drawSquare(ctx, x, y, ts, fill);
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets,
  sprite: SpriteKey,
  x: number,
  y: number,
  size: number,
  alpha: number,
): boolean {
  const image = assets.imageFor(sprite);
  if (!image) return false;
  const src = assets.sourceRect(sprite);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, src.x, src.y, src.w, src.h, x, y, size, size);
  ctx.restore();
  return true;
}

function drawSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const inset = Math.max(1, Math.floor(size * 0.22));
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, size - 2 * inset, size - 2 * inset);
}

function drawDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  edge: string,
): void {
  const r = Math.max(2, size * 0.34);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = edge;
  ctx.stroke();
}
