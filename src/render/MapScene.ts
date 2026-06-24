/**
 * MapScene renders only the dungeon world. Complex UI lives in DOM overlays.
 */
import type { FrameInfo } from "./Renderer";
import type { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import type { EnemyState } from "@/core/actors/Enemy";
import { computeCameraViewport, type CameraPan, type Viewport } from "./viewport";
import type { SpriteKey, SpriteSheetAssets } from "./AssetLoader";

const VISIBLE: Record<Terrain, string> = {
  [Terrain.EMPTY]: "#000000",
  [Terrain.FLOOR]: "#e9e1c8",
  [Terrain.WALL]: "#3a3a45",
  [Terrain.DOOR]: "#c98a45",
  [Terrain.GRASS]: "#6a8c4f",
  [Terrain.WATER]: "#4b85a3",
  [Terrain.EMPTY_SP]: "#b7b39c",
  [Terrain.WALL_DECO]: "#465156",
  [Terrain.REGION_DECO]: "#6c7f45",
  [Terrain.REGION_DECO_ALT]: "#52613e",
  [Terrain.SECRET_DOOR]: "#3a3a45",
  [Terrain.TRAP]: "#b85c42",
  [Terrain.SECRET_TRAP]: "#e9e1c8",
  [Terrain.LOCKED_EXIT]: "#c98a45",
  [Terrain.CHASM]: "#050505",
  [Terrain.INACTIVE_TRAP]: "#8d8872",
};

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

const FOG_ALPHA = {
  visible: 0,
  visited: 0x99 / 0xff,
  invisible: 1,
} as const;

const IDLE_START_DELAY_SECONDS = 1.4;
const STRIKE_ANIMATION_DURATION_SECONDS = 0.42;
const MOVE_TWEEN_DURATION_MS = 180;
const DAMAGE_POPUP_DURATION_SECONDS = 1;
const DEATH_ANIMATION_EXTRA_SECONDS = 0.12;
const PICKUP_ANIMATION_DURATION_SECONDS = 0.5;
export const HERO_DRAW_SCALE = 0.78;
// SPD CharSprite.worldToCamera raises actors by 6px on a 16px tile so their
// feet stand on the raised floor plane, not on the tile's lower wall edge.
export const ACTOR_PERSPECTIVE_RAISE = 6 / 16;
const WALL_CAST_SHADOW_ALPHA = 0.24;
const TILE_SHEET_COLUMNS = 16;
const RAISED_DOORS = sheetIndex(1, 8);
const RAISED_DOOR = RAISED_DOORS;
const RAISED_DOOR_OPEN = RAISED_DOORS + 1;
const RAISED_DOOR_SIDEWAYS = RAISED_DOORS + 4;
const WATER = sheetIndex(1, 3);
const RAISED_WALLS = sheetIndex(1, 6);
const RAISED_WALL_DOOR = RAISED_WALLS + 8;
const WALLS_INTERNAL = sheetIndex(1, 10);
const WALLS_OVERHANG = sheetIndex(1, 13);
const DOOR_SIDEWAYS_OVERHANG = WALLS_OVERHANG + 16;
const DOOR_SIDEWAYS_OVERHANG_CLOSED = WALLS_OVERHANG + 20;
const DOOR_OVERHANG = sheetIndex(1, 15);
const DOOR_OVERHANG_OPEN = DOOR_OVERHANG + 1;
const DOOR_SIDEWAYS = DOOR_OVERHANG + 3;
let previousActivitySignature: string | null = null;
let lastActivityAt = 0;
let isCameraDetached = false;
let detachedCameraPan: CameraPan = { x: 0, y: 0 };

export interface CombatStrikeAnimationEvent {
  attackerId: string;
  defenderId: string;
  attackerCell: number;
  defenderCell: number;
  hit: boolean;
  damage: number;
}

export interface ActorMoveAnimationEvent {
  actorId: string;
  fromCell: number;
  toCell: number;
}

export interface ActorDeathAnimationEvent {
  actorId: string;
  cell: number;
  name: string;
}

export interface ItemPickupAnimationEvent {
  itemId: string;
  cell: number;
}

interface CombatStrikeAnimation extends CombatStrikeAnimationEvent {
  startedAt: number | null;
}

interface ActorMoveAnimation extends ActorMoveAnimationEvent {
  startedAtMs: number;
}

interface ActorDeathAnimation extends ActorDeathAnimationEvent {
  startedAt: number | null;
}

interface DamagePopup {
  cell: number;
  hit: boolean;
  damage: number;
  startedAt: number | null;
}

interface ItemPickupAnimation extends ItemPickupAnimationEvent {
  startedAt: number | null;
}

interface WallOverlayDraw {
  tileIndex: number;
  drawX: number;
  drawY: number;
}

const activeStrikes: CombatStrikeAnimation[] = [];
const activeMoves = new Map<string, ActorMoveAnimation>();
const activeDeaths: ActorDeathAnimation[] = [];
const actorFacingX = new Map<string, -1 | 1>();
const activeDamagePopups: DamagePopup[] = [];
const activeItemPickups: ItemPickupAnimation[] = [];

export function queueCombatStrikeAnimation(event: CombatStrikeAnimationEvent): void {
  activeStrikes.push({ ...event, startedAt: null });
  activeDamagePopups.push({
    cell: event.defenderCell,
    hit: event.hit,
    damage: event.damage,
    startedAt: null,
  });
}

export function queueActorMoveAnimation(event: ActorMoveAnimationEvent): void {
  if (event.fromCell === event.toCell) return;
  activeMoves.set(event.actorId, {
    ...event,
    startedAtMs: nowMs(),
  });
}

export function queueActorDeathAnimation(event: ActorDeathAnimationEvent): void {
  activeMoves.delete(event.actorId);
  activeDeaths.push({ ...event, startedAt: null });
}

export function queueItemPickupAnimation(event: ItemPickupAnimationEvent): void {
  activeItemPickups.push({ ...event, startedAt: null });
}

export function clearCombatAnimations(): void {
  activeStrikes.length = 0;
  activeMoves.clear();
  activeDeaths.length = 0;
  actorFacingX.clear();
  activeDamagePopups.length = 0;
  activeItemPickups.length = 0;
}

export function detachMapCameraBy(dx: number, dy: number): void {
  isCameraDetached = true;
  detachedCameraPan = {
    x: detachedCameraPan.x + dx,
    y: detachedCameraPan.y + dy,
  };
}

export function snapMapCameraToHero(hard = false): void {
  isCameraDetached = false;
  detachedCameraPan = { x: 0, y: 0 };
  if (hard) {
    cameraFocusX = null;
    cameraFocusY = null;
  }
}

export function isMapCameraDetached(): boolean {
  return isCameraDetached;
}

export let cameraFocusX: number | null = null;
export let cameraFocusY: number | null = null;
// SPD's Camera.panFollow continuously eases toward the target. Keeping this
// as a damped glide avoids the sticky/deadzone jumps that feel harsh on mobile.
const CAMERA_PAN_INTENSITY = 7.5;

export function computeMapSceneViewport(
  viewW: number,
  viewH: number,
  grid: Grid,
  focusPos: { x: number; y: number },
  zoomMultiplier = 1,
): Viewport {
  const pan = currentCameraPan();
  return computeCameraViewport(viewW, viewH, grid, focusPos, zoomMultiplier, pan, {
    allowOutOfBounds: isCameraDetached,
  });
}

function currentCameraPan(): CameraPan {
  if (!isCameraDetached) return { x: 0, y: 0 };
  return detachedCameraPan;
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
    type?: string;
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

  let targetX = grid.xOf(view.heroPos) + 0.5;
  let targetY = grid.yOf(view.heroPos) + 0.5;

  for (const move of activeMoves.values()) {
    if (move.toCell === view.heroPos) {
      const elapsedMs = nowMs() - move.startedAtMs;
      const progress = Math.max(0, Math.min(1, elapsedMs / MOVE_TWEEN_DURATION_MS));
      if (progress < 1) {
        const fromX = grid.xOf(move.fromCell) + 0.5;
        const fromY = grid.yOf(move.fromCell) + 0.5;
        const toX = grid.xOf(move.toCell) + 0.5;
        const toY = grid.yOf(move.toCell) + 0.5;
        targetX = fromX + (toX - fromX) * progress;
        targetY = fromY + (toY - fromY) * progress;
      }
      break;
    }
  }

  if (
    cameraFocusX === null ||
    cameraFocusY === null ||
    Math.abs(cameraFocusX - targetX) > 10 ||
    Math.abs(cameraFocusY - targetY) > 10
  ) {
    cameraFocusX = targetX;
    cameraFocusY = targetY;
  } else {
    const dt = Math.min(0.1, frame.dt);
    const step = 1 - Math.exp(-dt * CAMERA_PAN_INTENSITY);
    cameraFocusX += (targetX - cameraFocusX) * step;
    cameraFocusY += (targetY - cameraFocusY) * step;
  }

  const vp = computeMapSceneViewport(
    frame.width, 
    frame.height, 
    grid, 
    { x: cameraFocusX, y: cameraFocusY }, 
    zoomMultiplier
  );
  const ts = vp.tileSize;
  const idleElapsed = idleElapsedAfterStillness(frame.elapsed, view);
  updateCombatAnimations(frame.elapsed);
  updateDeathAnimations(frame.elapsed);
  updateItemPickupAnimations(frame.elapsed);
  const minX = Math.max(0, Math.floor(-vp.offsetX / ts) - 1);
  const minY = Math.max(0, Math.floor(-vp.offsetY / ts) - 1);
  const maxX = Math.min(grid.width - 1, Math.ceil((frame.width - vp.offsetX) / ts) + 1);
  const maxY = Math.min(grid.height - 1, Math.ceil((frame.height - vp.offsetY) / ts) + 1);
  const wallOverlays: WallOverlayDraw[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = grid.cell(x, y);
      const terrain = grid.get(cell);
      const visible = view.visible.has(cell);
      const explored = view.explored.has(cell);
      ctx.fillStyle = visible || explored ? VISIBLE[terrain] : COLORS.unseen;
      ctx.fillRect(vp.offsetX + x * ts, vp.offsetY + y * ts, ts, ts);

      if (assets && terrain !== Terrain.EMPTY && explored) {
        const drawX = vp.offsetX + x * ts;
        const drawY = vp.offsetY + y * ts;
        ctx.fillStyle = COLORS.unseen;
        ctx.fillRect(drawX, drawY, ts, ts);

        let spriteKey: SpriteKey | null = assets.spriteForTerrain(terrain, view.depth);
        let tileIndex: number | null = null;
        let overhangIndex: number | null = null;
        let drewTerrain = false;
        if (terrain === Terrain.WATER) {
          drewTerrain = drawSprite(ctx, assets, "water", drawX, drawY, ts, 1, undefined, view.depth);
          spriteKey = null;
          tileIndex = stitchWaterTile(grid, x, y);
        } else if (isWallStitchable(grid, x, y)) {
          const southTerrain = terrainAt(grid, x, y + 1);
          if (isDoorTerrain(southTerrain)) {
            const southCell = grid.cell(x, y + 1);
            spriteKey = null;
            tileIndex = stitchRaisedWallTile(RAISED_WALL_DOOR, grid, x, y);
            overhangIndex = view.openDoors.has(southCell) ? null : DOOR_SIDEWAYS;
          } else if (isWallStitchable(grid, x, y + 1)) {
            spriteKey = null;
            tileIndex = stitchInternalWallTile(grid, x, y);
          } else {
            spriteKey = wallFrontSprite(grid, x, y);
          }
        } else if (isDoorTerrain(terrain)) {
          const isOpen = view.openDoors.has(cell);
          spriteKey = null;
          tileIndex = isWallStitchable(grid, x, y - 1)
            ? RAISED_DOOR_SIDEWAYS
            : isOpen
              ? RAISED_DOOR_OPEN
              : RAISED_DOOR;
        } else if (isFloorLikeTerrain(terrain)) {
          spriteKey = floorSpriteForCell(view, cell);
        }

        if (!isWallStitchable(grid, x, y)) {
          const southTerrain = terrainAt(grid, x, y + 1);
          if (isWallStitchable(grid, x, y + 1)) {
            overhangIndex = stitchWallOverhangTile(grid, x, y, view.openDoors.has(cell));
          } else if (isDoorTerrain(southTerrain)) {
            const doorCell = grid.cell(x, y + 1);
            overhangIndex = view.openDoors.has(doorCell) ? DOOR_OVERHANG_OPEN : DOOR_OVERHANG;
          }
        }

        if (tileIndex !== null) {
          const drewTile = drawTileIndex(ctx, assets, tileIndex, drawX, drawY, ts, 1, view.depth);
          if (terrain !== Terrain.WATER) drewTerrain = drewTile;
        } else if (spriteKey !== null) {
          drewTerrain = drawSprite(
            ctx,
            assets,
            spriteKey,
            drawX,
            drawY,
            ts,
            1,
            undefined,
            view.depth,
          );
        }
        if (!drewTerrain) {
          ctx.fillStyle = VISIBLE[terrain];
          ctx.fillRect(drawX, drawY, ts, ts);
        }

        if (overhangIndex !== null) {
          wallOverlays.push({ tileIndex: overhangIndex, drawX, drawY });
        }

        if (isWalkableTerrain(terrain) && terrainAt(grid, x, y - 1) === Terrain.WALL) {
          drawWallCastShadow(ctx, drawX, drawY, ts);
        }

      }
    }
  }

  if (ts >= 8 && !assets?.ready) {
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

  const actors: Array<{ cell: number; draw: () => void; sortY: number }> = [];
  const actorOverlays: Array<() => void> = [];

  for (const enemy of view.enemies) {
    if (!view.visible.has(enemy.pos)) continue;
    const enemySprite = assets?.spriteForEnemy(enemy) ?? "rat";
    actors.push({
      cell: enemy.pos,
      sortY: actorSortY(assets, vp, grid, enemy.pos, enemySprite, enemy.id, 1, view.depth),
      draw: () => drawCell(
        ctx,
        assets,
        vp,
        grid,
        enemy.pos,
        enemySprite,
        enemy.state === "hunt" ? COLORS.enemyHunt : COLORS.enemyWander,
        COLORS.enemyEdge,
        {
          elapsed: idleElapsed,
          key: `${enemy.id}:${enemy.pos}`,
          actorId: enemy.id,
          frameElapsed: frame.elapsed,
        },
      ),
    });
    actorOverlays.push(() => drawEnemyHealthBar(
        ctx,
        assets,
        vp,
        grid,
        enemy.pos,
        enemy.hp,
        enemy.maxHealth,
        enemy.id,
        enemySprite,
        view.depth,
      ));
  }

  for (const death of activeDeaths) {
    if (death.actorId === "hero" || !view.explored.has(death.cell)) continue;
    const sprite = spriteForDeathName(death.name);
    actors.push({
      cell: death.cell,
      sortY: actorSortY(assets, vp, grid, death.cell, sprite, death.actorId, 1, view.depth),
      draw: () => drawCell(
        ctx,
        assets,
        vp,
        grid,
        death.cell,
        sprite,
        COLORS.enemyHunt,
        COLORS.enemyEdge,
        {
          elapsed: 0,
          key: `${death.actorId}:death`,
          actorId: death.actorId,
          frameElapsed: frame.elapsed,
        },
      ),
    });
  }

  actors.push({
    cell: view.heroPos,
    sortY: actorSortY(assets, vp, grid, view.heroPos, view.hero.sprite, "hero", HERO_DRAW_SCALE, view.depth),
    draw: () => drawCell(
      ctx,
      assets,
      vp,
      grid,
      view.heroPos,
      view.hero.sprite,
      COLORS.hero,
      COLORS.heroEdge,
      {
        elapsed: idleElapsed,
        key: `hero:${view.heroPos}`,
        actorId: "hero",
        frameElapsed: frame.elapsed,
      },
      view.depth,
      HERO_DRAW_SCALE,
    ),
  });

  actors.sort((a, b) => a.sortY - b.sortY || a.cell - b.cell);
  for (const actor of actors) actor.draw();

  drawWallOverlays(ctx, assets, wallOverlays, ts, view.depth);
  drawFogOfWar(ctx, vp, view, minX, minY, maxX, maxY);
  for (const overlay of actorOverlays) overlay();

  drawDamagePopups(ctx, vp, grid, frame.elapsed, assets);
  drawItemPickupAnimations(ctx, vp, grid, frame, assets);

  if (view.selectedCell !== null) {
    const sx = grid.xOf(view.selectedCell);
    const sy = grid.yOf(view.selectedCell);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(vp.offsetX + sx * ts + 1, vp.offsetY + sy * ts + 1, ts - 2, ts - 2);
  }
}

type VP = { tileSize: number; offsetX: number; offsetY: number };

function sheetIndex(x: number, y: number): number {
  return x - 1 + TILE_SHEET_COLUMNS * (y - 1);
}

function terrainAt(grid: Grid, x: number, y: number): Terrain | null {
  return grid.inBounds(x, y) ? grid.get(grid.cell(x, y)) : null;
}

function floorSpriteForCell(view: MapView, cell: number): SpriteKey {
  const variant = view.floorVariants.get(cell);
  if (variant === 1) return "floorDeco";
  return "floor";
}

function wallFrontSprite(grid: Grid, x: number, y: number): SpriteKey {
  const rightOpen = !isWallStitchable(grid, x + 1, y);
  const leftOpen = !isWallStitchable(grid, x - 1, y);
  if (rightOpen && leftOpen) return "wallFrontOpenBoth";
  if (rightOpen) return "wallFrontOpenRight";
  if (leftOpen) return "wallFrontOpenLeft";
  return "wallFront";
}

function isWallStitchable(grid: Grid, x: number, y: number): boolean {
  if (!grid.inBounds(x, y)) return true;
  const terrain = grid.get(grid.cell(x, y));
  return terrain === Terrain.WALL || terrain === Terrain.WALL_DECO || terrain === Terrain.SECRET_DOOR;
}

function isWalkableTerrain(terrain: Terrain): boolean {
  return terrain !== Terrain.EMPTY && terrain !== Terrain.WALL && terrain !== Terrain.WALL_DECO && terrain !== Terrain.CHASM;
}

function stitchWaterTile(grid: Grid, x: number, y: number): number {
  let result = WATER;
  if (isWaterEdgeTerrain(terrainAt(grid, x, y - 1))) result += 1;
  if (isWaterEdgeTerrain(terrainAt(grid, x + 1, y))) result += 2;
  if (isWaterEdgeTerrain(terrainAt(grid, x, y + 1))) result += 4;
  if (isWaterEdgeTerrain(terrainAt(grid, x - 1, y))) result += 8;
  return result;
}

function isWaterEdgeTerrain(terrain: Terrain | null): boolean {
  return terrain === Terrain.EMPTY || isFloorLikeTerrain(terrain) || isDoorTerrain(terrain) || terrain === Terrain.GRASS || terrain === Terrain.REGION_DECO || terrain === Terrain.REGION_DECO_ALT;
}

function isFloorLikeTerrain(terrain: Terrain | null): boolean {
  return terrain === Terrain.FLOOR ||
    terrain === Terrain.EMPTY_SP ||
    terrain === Terrain.REGION_DECO ||
    terrain === Terrain.REGION_DECO_ALT ||
    terrain === Terrain.GRASS ||
    terrain === Terrain.TRAP ||
    terrain === Terrain.SECRET_TRAP ||
    terrain === Terrain.INACTIVE_TRAP;
}

function isDoorTerrain(terrain: Terrain | null): boolean {
  return terrain === Terrain.DOOR || terrain === Terrain.LOCKED_EXIT;
}

function drawWallCastShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
): void {
  const shadowHeight = Math.max(2, Math.round(tileSize * 0.13));
  const gradient = ctx.createLinearGradient(x, y, x, y + shadowHeight);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${WALL_CAST_SHADOW_ALPHA})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, tileSize, shadowHeight);
  ctx.restore();
}

function stitchRaisedWallTile(baseTile: number, grid: Grid, x: number, y: number): number {
  let result = baseTile;
  if (!isWallStitchable(grid, x + 1, y)) result += 1;
  if (!isWallStitchable(grid, x - 1, y)) result += 2;
  return result;
}

function stitchInternalWallTile(grid: Grid, x: number, y: number): number {
  let result = WALLS_INTERNAL;
  if (!isWallStitchable(grid, x + 1, y)) result += 1;
  if (!isWallStitchable(grid, x + 1, y + 1)) result += 2;
  if (!isWallStitchable(grid, x - 1, y + 1)) result += 4;
  if (!isWallStitchable(grid, x - 1, y)) result += 8;
  return result;
}

function stitchWallOverhangTile(grid: Grid, x: number, y: number, currentDoorOpen: boolean): number {
  const currentTerrain = terrainAt(grid, x, y);
  let result =
    isDoorTerrain(currentTerrain)
      ? currentDoorOpen
        ? DOOR_SIDEWAYS_OVERHANG
        : DOOR_SIDEWAYS_OVERHANG_CLOSED
      : WALLS_OVERHANG;

  if (!isWallStitchable(grid, x + 1, y + 1)) result += 1;
  if (!isWallStitchable(grid, x - 1, y + 1)) result += 2;
  return result;
}

function drawTileIndex(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets,
  tileIndex: number,
  x: number,
  y: number,
  size: number,
  alpha: number,
  depth: number,
): boolean {
  const image = assets.imageFor("floor", depth);
  if (!image) return false;
  const sourceX = (tileIndex % TILE_SHEET_COLUMNS) * 16;
  const sourceY = Math.floor(tileIndex / TILE_SHEET_COLUMNS) * 16;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sourceX, sourceY, 16, 16, x, y, size, size);
  ctx.restore();
  return true;
}

function drawGroundItem(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  item: { cell: number; itemId: string; type?: string },
): void {
  const ts = vp.tileSize;
  const size = Math.max(8, ts * 0.62);
  const x = vp.offsetX + grid.xOf(item.cell) * ts + (ts - size) / 2;
  const y = vp.offsetY + grid.yOf(item.cell) * ts + ts * 0.28;

  // Prefer the exact item sprite; fall back to a representative sprite for the
  // item's category so an unmapped id still draws real art (never a placeholder).
  const sprite =
    assets?.spriteForItem(item.itemId) ??
    (item.type ? assets?.spriteForItemType(item.type) : null) ??
    null;
  if (assets && sprite && drawSprite(ctx, assets, sprite, x, y, size, 1)) {
    return;
  }

  // Last resort (no assets at all): a small, tasteful pickup glint — not a
  // jarring placeholder.
  const cx = vp.offsetX + grid.xOf(item.cell) * ts + ts / 2;
  const cy = vp.offsetY + grid.yOf(item.cell) * ts + ts * 0.6;
  const r = Math.max(2, ts * 0.14);
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4);
  glow.addColorStop(0, "rgba(245, 235, 200, 0.85)");
  glow.addColorStop(1, "rgba(245, 235, 200, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f6edcb";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWallOverlays(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  overlays: readonly WallOverlayDraw[],
  tileSize: number,
  depth: number,
): void {
  if (!assets) return;
  for (const overlay of overlays) {
    drawTileIndex(ctx, assets, overlay.tileIndex, overlay.drawX, overlay.drawY, tileSize, 1, depth);
  }
}

function drawFogOfWar(
  ctx: CanvasRenderingContext2D,
  vp: VP,
  view: MapView,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const { grid } = view;
  const ts = vp.tileSize;
  ctx.save();
  ctx.fillStyle = "#000";

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = grid.cell(x, y);
      const drawX = vp.offsetX + x * ts;
      const drawY = vp.offsetY + y * ts;

      if (!grid.inBounds(x, y) || grid.get(cell) === Terrain.EMPTY) {
        fillFogRect(ctx, drawX, drawY, ts, ts, FOG_ALPHA.invisible);
        continue;
      }

      if (isWallStitchable(grid, x, y)) {
        drawWallFog(ctx, view, x, y, drawX, drawY, ts);
      } else {
        fillFogRect(ctx, drawX, drawY, ts, ts, fogAlphaAt(view, x, y));
      }
    }
  }

  ctx.restore();
}

function drawWallFog(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  x: number,
  y: number,
  drawX: number,
  drawY: number,
  tileSize: number,
): void {
  const { grid } = view;
  const half = tileSize / 2;

  if (y + 1 >= grid.height) {
    fillFogRect(ctx, drawX, drawY, tileSize, tileSize, FOG_ALPHA.invisible);
    return;
  }

  if (isWallStitchable(grid, x, y + 1)) {
    const leftAlpha = x !== 0
      ? wallSideFogAlpha(view, x, y, -1)
      : FOG_ALPHA.invisible;
    const rightAlpha = x + 1 < grid.width
      ? wallSideFogAlpha(view, x, y, 1)
      : FOG_ALPHA.invisible;
    fillFogRect(ctx, drawX, drawY, half, tileSize, leftAlpha);
    fillFogRect(ctx, drawX + half, drawY, tileSize - half, tileSize, rightAlpha);
  } else {
    fillFogRect(
      ctx,
      drawX,
      drawY,
      tileSize,
      tileSize,
      Math.max(fogAlphaAt(view, x, y), fogAlphaAt(view, x, y + 1)),
    );
  }
}

function wallSideFogAlpha(view: MapView, x: number, y: number, dx: -1 | 1): number {
  const sideX = x + dx;
  if (isWallStitchable(view.grid, sideX, y)) {
    if (isWallStitchable(view.grid, sideX, y + 1)) return FOG_ALPHA.invisible;
    return Math.max(
      fogAlphaAt(view, x, y),
      fogAlphaAt(view, sideX, y),
      fogAlphaAt(view, sideX, y + 1),
    );
  }
  return Math.max(fogAlphaAt(view, x, y), fogAlphaAt(view, sideX, y));
}

function fogAlphaAt(view: MapView, x: number, y: number): number {
  const { grid } = view;
  if (!grid.inBounds(x, y)) return FOG_ALPHA.invisible;
  const cell = grid.cell(x, y);
  if (grid.get(cell) === Terrain.EMPTY) return FOG_ALPHA.invisible;
  if (view.visible.has(cell)) return FOG_ALPHA.visible;
  if (view.explored.has(cell)) return FOG_ALPHA.visited;
  return FOG_ALPHA.invisible;
}

function fillFogRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, width, height);
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
  visualScale = 1,
): void {
  const ts = vp.tileSize;
  const isActor = motion?.actorId !== undefined;
  const visual = motion?.actorId
    ? visualOffsetForActor(motion.actorId, grid, ts)
    : { pixelOffsetX: 0, pixelOffsetY: 0, movingElapsed: null };
  const pixelX = vp.offsetX + grid.xOf(cell) * ts + visual.pixelOffsetX;
  const pixelY = vp.offsetY + grid.yOf(cell) * ts + visual.pixelOffsetY;
  const size = actorSpriteSize(assets, sprite, ts, visualScale, depth);
  const x = pixelX + (ts - size.width) / 2;
  const perspectiveRaise = isActor ? ts * ACTOR_PERSPECTIVE_RAISE : 0;
  const y = pixelY + ts - perspectiveRaise - size.height;
  const drawMotion = motion && visual.movingElapsed !== null
    ? { ...motion, movingElapsed: visual.movingElapsed }
    : motion;
  const facingX = motion?.actorId ? actorFacingX.get(motion.actorId) ?? 1 : 1;

  if (isActor) {
    drawActorShadow(ctx, pixelX, pixelY, ts, visualScale, perspectiveRaise);
  }

  if (assets && drawSprite(ctx, assets, sprite, x, y, size.width, 1, drawMotion, depth, size.height, facingX < 0)) {
    return;
  }

  const fallbackSize = Math.min(size.width, size.height);
  if (edge) drawDisc(ctx, x + size.width / 2, y + size.height / 2, fallbackSize, fill, edge);
  else drawSquare(ctx, x, y, fallbackSize, fill);
}

function actorSortY(
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  cell: number,
  sprite: SpriteKey,
  actorId: string,
  visualScale: number,
  depth: number,
): number {
  const ts = vp.tileSize;
  const visual = visualOffsetForActor(actorId, grid, ts);
  const pixelY = vp.offsetY + grid.yOf(cell) * ts + visual.pixelOffsetY;
  const size = actorSpriteSize(assets, sprite, ts, visualScale, depth);
  return pixelY + ts - ts * ACTOR_PERSPECTIVE_RAISE - Math.max(1, Math.round(size.height * 0.03));
}

function actorSpriteSize(
  assets: SpriteSheetAssets | undefined,
  sprite: SpriteKey,
  tileSize: number,
  visualScale: number,
  depth: number,
): { width: number; height: number } {
  let height = tileSize * visualScale;
  let width = height;
  if (assets) {
    const source = assets.sourceRect(sprite, depth);
    width = height * (source.w / source.h);
    if (width > tileSize) {
      const fit = tileSize / width;
      width *= fit;
      height *= fit;
    }
  }
  return { width, height };
}

function drawActorShadow(
  ctx: CanvasRenderingContext2D,
  pixelX: number,
  pixelY: number,
  tileSize: number,
  visualScale: number,
  perspectiveRaise: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.ellipse(
    pixelX + tileSize / 2,
    pixelY + tileSize - perspectiveRaise - Math.max(1, Math.round(tileSize * 0.04)),
    Math.max(3, tileSize * 0.22 * visualScale),
    Math.max(2, tileSize * 0.08 * visualScale),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function drawEnemyHealthBar(
  ctx: CanvasRenderingContext2D,
  assets: SpriteSheetAssets | undefined,
  vp: VP,
  grid: Grid,
  cell: number,
  hp: number,
  maxHealth: number,
  actorId: string,
  sprite: SpriteKey,
  depth: number,
): void {
  if (maxHealth <= 0) return;
  const ts = vp.tileSize;
  const offset = visualOffsetForActor(actorId, grid, ts);
  const size = actorSpriteSize(assets, sprite, ts, 1, depth);
  const ratio = Math.max(0, Math.min(1, hp / maxHealth));
  const barWidth = Math.max(10, Math.round(ts * 0.58));
  const barHeight = Math.max(3, Math.round(ts * 0.08));
  const border = Math.max(1, Math.round(ts * 0.025));
  const x = vp.offsetX + grid.xOf(cell) * ts + offset.pixelOffsetX + (ts - barWidth) / 2;
  const actorTop =
    vp.offsetY +
    grid.yOf(cell) * ts +
    offset.pixelOffsetY +
    ts -
    ts * ACTOR_PERSPECTIVE_RAISE -
    size.height;
  const y = actorTop - barHeight - border * 2 - Math.max(1, Math.round(ts * 0.04));

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
  ctx.fillStyle = "#4b1515";
  ctx.fillRect(x, y, barWidth, barHeight);
  ctx.fillStyle = ratio > 0.5 ? "#75d35c" : ratio > 0.25 ? "#e0c64b" : "#d8493f";
  ctx.fillRect(x, y, Math.max(1, Math.round(barWidth * ratio)), barHeight);
  ctx.restore();
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
  height = size,
  flipX = false,
): boolean {
  const image = assets.imageFor(sprite, depth);
  if (!image) return false;
  const base = assets.sourceRect(sprite, depth);
  const motion = spriteMotion(sprite, idle);
  const src = { ...base, x: base.x + base.w * motion.frameOffset };
  const dx = x + motion.dx * Math.max(1, size / 48);
  const dy = y + motion.dy * Math.max(1, size / 48);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  if (flipX) {
    ctx.translate(dx + size + motion.dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(
      image,
      src.x,
      src.y,
      src.w,
      src.h,
      0,
      0,
      size + motion.dw,
      height + motion.dh,
    );
  } else {
    ctx.drawImage(
      image,
      src.x,
      src.y,
      src.w,
      src.h,
      dx,
      dy,
      size + motion.dw,
      height + motion.dh,
    );
  }
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
  movingElapsed?: number;
}

function isIdleAnimated(sprite: SpriteKey): boolean {
  return sprite === "hero" || sprite === "mageHero" || sprite === "rat" || sprite === "zombie";
}

interface SpriteMotion {
  frameOffset: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function spriteMotion(sprite: SpriteKey, idle?: IdleState | ActorDrawMotion): SpriteMotion {
  const dying = deathMotion(sprite, idle);
  if (dying) return dying;
  const attacking = attackMotion(sprite, idle);
  if (attacking) return attacking;
  if (idle && "movingElapsed" in idle && typeof idle.movingElapsed === "number") {
    return runMotion(sprite, idle.movingElapsed);
  }
  return idleMotion(sprite, idle);
}

function idleMotion(sprite: SpriteKey, idle?: IdleState): SpriteMotion {
  const still: SpriteMotion = { frameOffset: 0, dx: 0, dy: 0, dw: 0, dh: 0 };
  if (!idle || idle.elapsed <= 0 || !isIdleAnimated(sprite)) return still;

  const h = visualHash(`${sprite}:${idle.key}`);
  const offset = (h % 1700) / 1000;
  const cycle = 2.4 + ((h >>> 8) % 1800) / 1000;
  const phase = (idle.elapsed + offset) % cycle;
  const pulse = phase / cycle;

  if (pulse < 0.08) {
    return { frameOffset: 0, dx: 0, dy: -1, dw: 0, dh: 1 };
  }

  if (pulse >= 0.42 && pulse < 0.5) {
    return { frameOffset: 0, dx: 0, dy: 1, dw: 0, dh: -1 };
  }

  if (pulse >= 0.72 && pulse < 0.82) {
    const useFrameOne = ((h >>> 16) + Math.floor((idle.elapsed + offset) / cycle)) % 3 === 0;
    return useFrameOne
      ? { frameOffset: 1, dx: 0, dy: 0, dw: 0, dh: 0 }
      : { frameOffset: 0, dx: sprite === "rat" ? 1 : 0, dy: 0, dw: 0, dh: 0 };
  }

  return still;
}

function deathMotion(sprite: SpriteKey, idle?: IdleState | ActorDrawMotion): SpriteMotion | null {
  if (!isActorDrawMotion(idle)) return null;
  const death = deathAnimation(sprite);
  if (!death) return null;
  let active: ActorDeathAnimation | null = null;
  for (let i = activeDeaths.length - 1; i >= 0; i--) {
    const candidate = activeDeaths[i]!;
    if (candidate.actorId === idle.actorId && candidate.startedAt !== null) {
      active = candidate;
      break;
    }
  }
  if (!active) return null;

  const elapsed = Math.max(0, idle.frameElapsed - active.startedAt!);
  const frameIndex = Math.min(death.frames.length - 1, Math.floor(elapsed * death.fps));
  return { frameOffset: death.frames[frameIndex]!, dx: 0, dy: 0, dw: 0, dh: 0 };
}

function attackMotion(sprite: SpriteKey, idle?: IdleState | ActorDrawMotion): SpriteMotion | null {
  if (!isActorDrawMotion(idle)) return null;
  const attack = attackAnimation(sprite);
  if (!attack) return null;

  let active: CombatStrikeAnimation | null = null;
  for (let i = activeStrikes.length - 1; i >= 0; i--) {
    const strike = activeStrikes[i]!;
    if (strike.attackerId === idle.actorId && strike.startedAt !== null) {
      active = strike;
      break;
    }
  }
  if (!active) return null;

  const elapsed = Math.max(0, idle.frameElapsed - active.startedAt!);
  const frameIndex = Math.min(attack.frames.length - 1, Math.floor(elapsed * attack.fps));
  return { frameOffset: attack.frames[frameIndex]!, dx: 0, dy: 0, dw: 0, dh: 0 };
}

function isActorDrawMotion(idle?: IdleState | ActorDrawMotion): idle is ActorDrawMotion {
  return Boolean(
    idle &&
    "actorId" in idle &&
    idle.actorId &&
    "frameElapsed" in idle &&
    typeof idle.frameElapsed === "number",
  );
}

function runMotion(sprite: SpriteKey, movingElapsed: number): SpriteMotion {
  const run = runAnimation(sprite);
  if (!run) return { frameOffset: 0, dx: 0, dy: 0, dw: 0, dh: 0 };
  const frame = run.frames[Math.floor(Math.max(0, movingElapsed) * run.fps) % run.frames.length]!;
  return { frameOffset: frame, dx: 0, dy: 0, dw: 0, dh: 0 };
}

function runAnimation(sprite: SpriteKey): { frames: number[]; fps: number } | null {
  if (sprite === "hero" || sprite === "mageHero") {
    // HeroSprite.java: RUN_FRAMERATE=20, run.frames(film, 2,3,4,5,6,7).
    return { frames: [2, 3, 4, 5, 6, 7], fps: 20 };
  }
  if (sprite === "rat") {
    // RatSprite.java: run = 10 fps; frames 6..10.
    return { frames: [6, 7, 8, 9, 10], fps: 10 };
  }
  if (sprite === "zombie") {
    // UndeadSprite.java: run = 15 fps; frames 4..9.
    return { frames: [4, 5, 6, 7, 8, 9], fps: 15 };
  }
  return null;
}

function attackAnimation(sprite: SpriteKey): { frames: number[]; fps: number } | null {
  if (sprite === "hero" || sprite === "mageHero") {
    // HeroSprite.java: attack = 15 fps; attack.frames(film, 13,14,15,0).
    return { frames: [13, 14, 15, 0], fps: 15 };
  }
  if (sprite === "rat") {
    // RatSprite.java: attack = 15 fps; attack.frames(frames, 2,3,4,5,0).
    return { frames: [2, 3, 4, 5, 0], fps: 15 };
  }
  if (sprite === "zombie") {
    // UndeadSprite.java: attack = 15 fps; attack.frames(frames, 14,15,16).
    return { frames: [14, 15, 16], fps: 15 };
  }
  return null;
}

function deathAnimation(sprite: SpriteKey): { frames: number[]; fps: number } | null {
  if (sprite === "hero" || sprite === "mageHero") {
    // HeroSprite.java: die = 20 fps; die.frames(film, 8,9,10,11,12,11).
    return { frames: [8, 9, 10, 11, 12, 11], fps: 20 };
  }
  if (sprite === "rat") {
    // RatSprite.java: die = 10 fps; die.frames(frames, 11,12,13,14).
    return { frames: [11, 12, 13, 14], fps: 10 };
  }
  if (sprite === "zombie") {
    // UndeadSprite.java: die = 12 fps; die.frames(frames, 10,11,12,13).
    return { frames: [10, 11, 12, 13], fps: 12 };
  }
  return null;
}

function deathDuration(sprite: SpriteKey): number {
  const death = deathAnimation(sprite);
  return death ? death.frames.length / death.fps + DEATH_ANIMATION_EXTRA_SECONDS : 0.35;
}

function spriteForDeathName(name: string): SpriteKey {
  const normalized = name.toLowerCase();
  if (normalized.includes("mage")) return "mageHero";
  if (normalized.includes("hero") || normalized.includes("warrior")) return "hero";
  if (normalized.includes("zombie") || normalized.includes("undead")) return "zombie";
  return "rat";
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

  removeExpired(activeStrikes, elapsed, STRIKE_ANIMATION_DURATION_SECONDS);
  removeExpired(activeDamagePopups, elapsed, DAMAGE_POPUP_DURATION_SECONDS);
}

function updateDeathAnimations(elapsed: number): void {
  for (const death of activeDeaths) {
    death.startedAt ??= elapsed;
  }
  for (let i = activeDeaths.length - 1; i >= 0; i--) {
    const death = activeDeaths[i]!;
    if (death.startedAt === null) continue;
    const sprite = spriteForDeathName(death.name);
    if (elapsed - death.startedAt >= deathDuration(sprite)) {
      activeDeaths.splice(i, 1);
    }
  }
}

function updateItemPickupAnimations(elapsed: number): void {
  for (const pickup of activeItemPickups) {
    pickup.startedAt ??= elapsed;
  }
  removeExpired(activeItemPickups, elapsed, PICKUP_ANIMATION_DURATION_SECONDS);
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
): { pixelOffsetX: number; pixelOffsetY: number; movingElapsed: number | null } {
  let pixelOffsetX = 0;
  let pixelOffsetY = 0;
  let movingElapsed: number | null = null;
  const move = activeMoves.get(actorId);
  if (move) {
    const elapsedMs = nowMs() - move.startedAtMs;
    const progress = Math.max(0, Math.min(1, elapsedMs / MOVE_TWEEN_DURATION_MS));
    if (progress >= 1) {
      activeMoves.delete(actorId);
    } else {
      const fromX = grid.xOf(move.fromCell);
      const fromY = grid.yOf(move.fromCell);
      const toX = grid.xOf(move.toCell);
      const toY = grid.yOf(move.toCell);
      if (toX !== fromX) {
        actorFacingX.set(actorId, toX < fromX ? -1 : 1);
      }
      const visualX = fromX + (toX - fromX) * progress;
      const visualY = fromY + (toY - fromY) * progress;
      pixelOffsetX += (visualX - toX) * tileSize;
      pixelOffsetY += (visualY - toY) * tileSize;
      movingElapsed = elapsedMs / 1000;
    }
  }
  for (const strike of activeStrikes) {
    if (strike.startedAt === null) continue;
    const attackerX = grid.xOf(strike.attackerCell);
    const defenderX = grid.xOf(strike.defenderCell);
    if (strike.attackerId !== actorId) continue;
    // SPD's CharSprite.attack only turns and plays the attack frames. It does
    // not tween the actor's position; the sword/staff swing is in the sheet.
    if (defenderX !== attackerX) {
      actorFacingX.set(actorId, defenderX < attackerX ? -1 : 1);
    }
  }
  return { pixelOffsetX, pixelOffsetY, movingElapsed };
}

function drawItemPickupAnimations(
  ctx: CanvasRenderingContext2D,
  vp: VP,
  grid: Grid,
  frame: FrameInfo,
  assets?: SpriteSheetAssets,
): void {
  if (!assets) return;
  const ts = vp.tileSize;
  const targetX = frame.width - Math.max(44, ts * 0.9);
  const targetY = frame.height - Math.max(40, ts * 0.72);

  for (const pickup of activeItemPickups) {
    if (pickup.startedAt === null) continue;
    const progress = Math.max(
      0,
      Math.min(1, (frame.elapsed - pickup.startedAt) / PICKUP_ANIMATION_DURATION_SECONDS),
    );
    const left = 1 - progress;
    const sprite =
      assets.spriteForItem(pickup.itemId) ??
      assets.spriteForItemType("potion");
    const size = Math.max(6, ts * 0.62 * Math.sqrt(left));
    const startX = vp.offsetX + grid.xOf(pickup.cell) * ts + ts / 2;
    const startY = vp.offsetY + grid.yOf(pickup.cell) * ts + ts * 0.5;
    const lift = Math.sin(progress * Math.PI) * ts * 0.55;
    const x = startX * left + targetX * progress;
    const y = startY * left + targetY * progress - lift;
    drawSprite(
      ctx,
      assets,
      sprite,
      x - size / 2,
      y - size / 2,
      size,
      Math.max(0, Math.min(1, left * 1.2)),
    );
  }
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function drawDamagePopups(
  ctx: CanvasRenderingContext2D,
  vp: VP,
  grid: Grid,
  elapsed: number,
  assets?: SpriteSheetAssets,
): void {
  const ts = vp.tileSize;
  const stackByCell = new Map<number, number>();
  for (const popup of activeDamagePopups) {
    if (popup.startedAt === null) continue;
    const progress = Math.max(
      0,
      Math.min(1, (elapsed - popup.startedAt) / DAMAGE_POPUP_DURATION_SECONDS),
    );
    const stackIndex = stackByCell.get(popup.cell) ?? 0;
    stackByCell.set(popup.cell, stackIndex + 1);
    const x = vp.offsetX + grid.xOf(popup.cell) * ts + ts / 2;
    const y = vp.offsetY + grid.yOf(popup.cell) * ts + ts * 0.18 - progress * ts - stackIndex * ts * 0.38;
    const text = popup.hit ? String(popup.damage) : "MISS";
    const alpha = progress > 0.5 ? 1 - (progress - 0.5) * 2 : 1;
    const fontSize = Math.max(12, Math.floor(ts * 0.42));
    const iconSize = Math.max(7, Math.floor(ts * 0.34));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${fontSize}px "SPD Pixel", monospace`;
    ctx.textAlign = popup.hit && assets?.canDraw("textPhysDamage") ? "left" : "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, ts * 0.05);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.fillStyle = popup.hit ? "#ff3324" : "#ffff44";

    if (popup.hit && assets?.canDraw("textPhysDamage")) {
      const textWidth = ctx.measureText(text).width;
      const totalWidth = iconSize + 2 + textWidth;
      const left = x - totalWidth / 2;
      ctx.restore();
      drawSprite(ctx, assets, "textPhysDamage", left, y - iconSize / 2, iconSize, alpha);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${fontSize}px "SPD Pixel", monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, ts * 0.05);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.fillStyle = "#ff3324";
      ctx.strokeText(text, left + iconSize + 2, y);
      ctx.fillText(text, left + iconSize + 2, y);
    } else {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
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
