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

const IDLE_START_DELAY_SECONDS = 1.4;
const STRIKE_DURATION_SECONDS = 0.15;
const DAMAGE_POPUP_DURATION_SECONDS = 0.7;
let previousActivitySignature: string | null = null;
let lastActivityAt = 0;

export interface CombatStrikeAnimationEvent {
  attackerId: string;
  defenderId: string;
  attackerCell: number;
  defenderCell: number;
  hit: boolean;
  damage: number;
}

interface CombatStrikeAnimation extends CombatStrikeAnimationEvent {
  startedAt: number | null;
}

interface DamagePopup {
  cell: number;
  hit: boolean;
  damage: number;
  startedAt: number | null;
}

const activeStrikes: CombatStrikeAnimation[] = [];
const activeDamagePopups: DamagePopup[] = [];

export function queueCombatStrikeAnimation(event: CombatStrikeAnimationEvent): void {
  activeStrikes.push({ ...event, startedAt: null });
  activeDamagePopups.push({
    cell: event.defenderCell,
    hit: event.hit,
    damage: event.damage,
    startedAt: null,
  });
}

export function clearCombatAnimations(): void {
  activeStrikes.length = 0;
  activeDamagePopups.length = 0;
}

export interface MapView {
  grid: Grid;
  seed: string;
  depth: number;
  roomCount: number;
  entrance: number;
  exit: number;
  heroPos: number;
  enemies: ReadonlyArray<{
    id: string;
    pos: number;
    state: EnemyState;
    name: string;
    hp: number;
    maxHealth: number;
  }>;
  groundItems: ReadonlyArray<{
    cell: number;
    itemId: string;
  }>;
  openDoors: ReadonlySet<number>;
  floorVariants: ReadonlyMap<number, number>;
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
    sprite: SpriteKey;
    alive: boolean;
  };
  log: readonly string[];
}

export function drawMapScene(
  ctx: CanvasRenderingContext2D,
  frame: FrameInfo,
  view: MapView,
  assets?: SpriteSheetAssets,
  zoomMultiplier = 1,
): void {
  const { grid } = view;
  const vp = computeCameraViewport(
    frame.width,
    frame.height,
    grid,
    view.heroPos,
    zoomMultiplier,
  );
  const ts = vp.tileSize;
  const idleElapsed = idleElapsedAfterStillness(frame.elapsed, view);
  updateCombatAnimations(frame.elapsed);
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
        let spriteKey = assets.spriteForTerrain(terrain, view.depth);
        if (terrain === Terrain.WALL) {
          const southCell = grid.cell(x, y + 1);
          if (grid.inBounds(x, y + 1)) {
            const southTerrain = grid.get(southCell);
            if (southTerrain === Terrain.WALL) spriteKey = "wallTop";
            else spriteKey = "wallFront";
          } else {
            spriteKey = "wallFront";
          }
        } else if (terrain === Terrain.DOOR) {
          const wTerrain = grid.inBounds(x - 1, y) ? grid.get(grid.cell(x - 1, y)) : null;
          const eTerrain = grid.inBounds(x + 1, y) ? grid.get(grid.cell(x + 1, y)) : null;
          const isHorizontalWall = 
            (wTerrain === Terrain.WALL || wTerrain === Terrain.DOOR) &&
            (eTerrain === Terrain.WALL || eTerrain === Terrain.DOOR);
          
          const isOpen = view.openDoors.has(cell);
          const flatKey = isOpen ? "doorFlatOpen" : "doorFlat";

          // Draw the flat floor/frame base layer first
          const flatRect = assets.sourceRect(flatKey, view.depth);
          const img = assets.imageFor(flatKey, view.depth);
          if (img && flatRect) {
            ctx.drawImage(img, flatRect.x, flatRect.y, flatRect.w, flatRect.h, vp.offsetX + x * ts, vp.offsetY + y * ts, ts, ts);
          }
          
          // Now set the raised perspective sprite to be drawn on top
          if (isHorizontalWall) {
            spriteKey = isOpen ? "doorFrontOpen" : "doorFront";
          } else {
            spriteKey = "doorSide"; // Sideways door doesn't have a distinct "open" raised sprite
          }
        } else if (terrain === Terrain.FLOOR) {
          const variant = view.floorVariants.get(cell);
          if (variant === 1) spriteKey = "floor1";
          else if (variant === 2) spriteKey = "floor2";
        }

        drawSprite(
          ctx,
          assets,
          spriteKey,
          vp.offsetX + x * ts,
          vp.offsetY + y * ts,
          ts,
          1,
          undefined,
          view.depth,
        );

        if (!visible) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
          ctx.fillRect(vp.offsetX + x * ts, vp.offsetY + y * ts, ts, ts);
        }
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
    drawCell(ctx, assets, vp, grid, view.entrance, "entrance", COLORS.entrance, undefined, undefined, view.depth);
  }
  if (view.explored.has(view.exit)) {
    drawCell(ctx, assets, vp, grid, view.exit, "exit", COLORS.exit, undefined, undefined, view.depth);
  }

  for (const item of view.groundItems) {
    if (!view.visible.has(item.cell)) continue;
    drawGroundItem(ctx, assets, vp, grid, item);
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
      {
        elapsed: idleElapsed,
        key: `${enemy.id}:${enemy.pos}`,
        actorId: enemy.id,
        frameElapsed: frame.elapsed,
      },
    );
  }

  drawCell(ctx, assets, vp, grid, view.heroPos, view.hero.sprite, COLORS.hero, COLORS.heroEdge, {
    elapsed: idleElapsed,
    key: `hero:${view.heroPos}`,
    actorId: "hero",
    frameElapsed: frame.elapsed,
  });

  drawDamagePopups(ctx, vp, grid, frame.elapsed);

  if (view.selectedCell !== null) {
    const sx = grid.xOf(view.selectedCell);
    const sy = grid.yOf(view.selectedCell);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(vp.offsetX + sx * ts + 1, vp.offsetY + sy * ts + 1, ts - 2, ts - 2);
  }
}

type VP = { tileSize: number; offsetX: number; offsetY: number };

function drawGroundItem(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  item: { cell: number; itemId: string },
): void {
  const ts = vp.tileSize;
  const size = Math.max(8, ts * 0.62);
  const x = vp.offsetX + grid.xOf(item.cell) * ts + (ts - size) / 2;
  const y = vp.offsetY + grid.yOf(item.cell) * ts + ts * 0.28;
  const sprite = assets?.spriteForItem(item.itemId) ?? null;
  if (assets && sprite && drawSprite(ctx, assets, sprite, x, y, size, 1)) {
    return;
  }

  const cx = vp.offsetX + grid.xOf(item.cell) * ts + ts / 2;
  const cy = vp.offsetY + grid.yOf(item.cell) * ts + ts * 0.62;
  ctx.save();
  ctx.fillStyle = "#f2d66b";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.lineWidth = Math.max(1, ts * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.28);
  ctx.lineTo(cx + size * 0.28, cy);
  ctx.lineTo(cx, cy + size * 0.28);
  ctx.lineTo(cx - size * 0.28, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  cell: number,
  sprite: SpriteKey,
  fill: string,
  edge?: string,
  motion?: ActorDrawMotion,
  depth = 1,
): void {
  const ts = vp.tileSize;
  const strike = motion?.actorId
    ? visualOffsetForActor(motion.actorId, grid, ts, motion.frameElapsed)
    : { pixelOffsetX: 0, pixelOffsetY: 0 };
  const x = vp.offsetX + grid.xOf(cell) * ts + strike.pixelOffsetX;
  const y = vp.offsetY + grid.yOf(cell) * ts + strike.pixelOffsetY;
  if (assets && drawSprite(ctx, assets, sprite, x, y, ts, 1, motion, depth)) {
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
  idle?: IdleState,
  depth = 1,
): boolean {
  const image = assets.imageFor(sprite, depth);
  if (!image) return false;
  const base = assets.sourceRect(sprite, depth);
  const motion = idleMotion(sprite, idle);
  const src = motion.useFrameOne ? { ...base, x: base.x + base.w } : base;
  const dx = x + motion.dx * Math.max(1, size / 48);
  const dy = y + motion.dy * Math.max(1, size / 48);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    src.x,
    src.y,
    src.w,
    src.h,
    dx,
    dy,
    size + motion.dw,
    size + motion.dh,
  );
  ctx.restore();
  return true;
}

interface IdleState {
  elapsed: number;
  key: string;
}

interface ActorDrawMotion extends IdleState {
  actorId?: string;
  frameElapsed: number;
}

function isIdleAnimated(sprite: SpriteKey): boolean {
  return sprite === "hero" || sprite === "mageHero" || sprite === "rat" || sprite === "zombie";
}

interface IdleMotion {
  useFrameOne: boolean;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function idleMotion(sprite: SpriteKey, idle?: IdleState): IdleMotion {
  const still: IdleMotion = { useFrameOne: false, dx: 0, dy: 0, dw: 0, dh: 0 };
  if (!idle || idle.elapsed <= 0 || !isIdleAnimated(sprite)) return still;

  const h = visualHash(`${sprite}:${idle.key}`);
  const offset = (h % 1700) / 1000;
  const cycle = 2.4 + ((h >>> 8) % 1800) / 1000;
  const phase = (idle.elapsed + offset) % cycle;
  const pulse = phase / cycle;

  if (pulse < 0.08) {
    return { useFrameOne: false, dx: 0, dy: -1, dw: 0, dh: 1 };
  }

  if (pulse >= 0.42 && pulse < 0.5) {
    return { useFrameOne: false, dx: 0, dy: 1, dw: 0, dh: -1 };
  }

  if (pulse >= 0.72 && pulse < 0.82) {
    const useFrameOne = ((h >>> 16) + Math.floor((idle.elapsed + offset) / cycle)) % 3 === 0;
    return useFrameOne
      ? { useFrameOne: true, dx: 0, dy: 0, dw: 0, dh: 0 }
      : { useFrameOne: false, dx: sprite === "rat" ? 1 : 0, dy: 0, dw: 0, dh: 0 };
  }

  return still;
}

function idleElapsedAfterStillness(elapsed: number, view: MapView): number {
  const signature = activitySignature(view);
  if (previousActivitySignature !== signature) {
    previousActivitySignature = signature;
    lastActivityAt = elapsed;
    return 0;
  }

  return Math.max(0, elapsed - lastActivityAt - IDLE_START_DELAY_SECONDS);
}

function updateCombatAnimations(elapsed: number): void {
  for (const strike of activeStrikes) {
    strike.startedAt ??= elapsed;
  }
  for (const popup of activeDamagePopups) {
    popup.startedAt ??= elapsed;
  }

  removeExpired(activeStrikes, elapsed, STRIKE_DURATION_SECONDS);
  removeExpired(activeDamagePopups, elapsed, DAMAGE_POPUP_DURATION_SECONDS);
}

function removeExpired<T extends { startedAt: number | null }>(
  list: T[],
  elapsed: number,
  duration: number,
): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const startedAt = list[i]!.startedAt;
    if (startedAt !== null && elapsed - startedAt >= duration) {
      list.splice(i, 1);
    }
  }
}

function visualOffsetForActor(
  actorId: string,
  grid: Grid,
  tileSize: number,
  elapsed: number,
): { pixelOffsetX: number; pixelOffsetY: number } {
  let pixelOffsetX = 0;
  let pixelOffsetY = 0;
  for (const strike of activeStrikes) {
    if (strike.attackerId !== actorId || strike.startedAt === null) continue;
    const progress = Math.max(
      0,
      Math.min(1, (elapsed - strike.startedAt) / STRIKE_DURATION_SECONDS),
    );
    const lunge = progress < 0.42
      ? easeOutCubic(progress / 0.42)
      : 1 - easeOutCubic((progress - 0.42) / 0.58);
    const dx = grid.xOf(strike.defenderCell) - grid.xOf(strike.attackerCell);
    const dy = grid.yOf(strike.defenderCell) - grid.yOf(strike.attackerCell);
    const len = Math.max(1, Math.hypot(dx, dy));
    const reach = tileSize * 0.34 * lunge;
    pixelOffsetX += (dx / len) * reach;
    pixelOffsetY += (dy / len) * reach;
  }
  return { pixelOffsetX, pixelOffsetY };
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function drawDamagePopups(
  ctx: CanvasRenderingContext2D,
  vp: VP,
  grid: Grid,
  elapsed: number,
): void {
  const ts = vp.tileSize;
  for (const popup of activeDamagePopups) {
    if (popup.startedAt === null) continue;
    const progress = Math.max(
      0,
      Math.min(1, (elapsed - popup.startedAt) / DAMAGE_POPUP_DURATION_SECONDS),
    );
    const x = vp.offsetX + grid.xOf(popup.cell) * ts + ts / 2;
    const y = vp.offsetY + grid.yOf(popup.cell) * ts + ts * 0.18 - progress * ts * 0.65;
    const text = popup.hit ? String(popup.damage) : "MISS";

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.font = `${Math.max(12, Math.floor(ts * 0.42))}px "SPD Pixel", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, ts * 0.05);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.fillStyle = popup.hit ? "#ffe36a" : "#e7eef8";
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

function activitySignature(view: MapView): string {
  return [
    view.seed,
    view.depth,
    view.heroPos,
    view.hero.hp,
    view.hero.alive ? 1 : 0,
    view.selectedCell ?? -1,
    view.log.length,
    ...view.enemies.map((e) => `${e.name}:${e.pos}:${e.state}:${e.hp}`),
  ].join("|");
}

function visualHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
