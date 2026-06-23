import { Grid } from "@/core/grid/Grid";
import { Rect } from "@/core/grid/Rect";
import { Terrain } from "@/core/grid/terrain";
import { generatePatch } from "@/core/grid/gen/Patch";
import type { RNG } from "@/core/rng/Mulberry32";
import type { LootGenerationOptions, GeneratedGroundItem, GeneratedLevel } from "@/core/procgen/LevelGenerator";
import type { BuiltRegularLevel, GeneratedRoomMetadata, GeneratedTrapMetadata, RegularLevelPlan } from "./types";
import { RegularRoom, type RegularDoor } from "./rooms";

export interface RegularPainterRngs {
  terrain: RNG;
  placement: RNG;
  traps: RNG;
  loot: RNG;
}

export function paintRegularLevel(
  built: BuiltRegularLevel,
  plan: RegularLevelPlan,
  rngs: RegularPainterRngs,
  loot: LootGenerationOptions,
): GeneratedLevel {
  const padding = plan.feeling === "large" ? 2 : 1;
  normalizeRooms(built.rooms as RegularRoom[], padding);
  const bounds = roomBounds(built.rooms as RegularRoom[], padding);
  const grid = new Grid(bounds.width, bounds.height, Terrain.WALL);
  const floorVariants = new Map<number, number>();
  const protectedCells = new Set<number>();

  for (const room of built.rooms as RegularRoom[]) {
    paintRoom(grid, floorVariants, room, rngs.terrain);
  }

  for (const room of built.rooms as RegularRoom[]) {
    for (const [connected, door] of room.connected.entries()) {
      if (!grid.inBounds(door.x, door.y)) continue;
      paintDoorApproaches(grid, floorVariants, room, connected, door.x, door.y, rngs.terrain);
      const cell = grid.cell(door.x, door.y);
      grid.set(cell, Terrain.DOOR);
      floorVariants.set(cell, rngs.terrain.pick([0, 1, 2]));
      protectedCells.add(cell);
    }
  }

  paintPatches(grid, floorVariants, protectedCells, plan, rngs.terrain);

  const entrance = stairCell(grid, built.entrance as RegularRoom, rngs.placement, protectedCells);
  const exit = stairCell(grid, built.exit as RegularRoom, rngs.placement, protectedCells);
  grid.set(entrance, Terrain.FLOOR);
  grid.set(exit, Terrain.FLOOR);
  protectedCells.add(entrance);
  protectedCells.add(exit);

  const trapMetadata = placeTraps(grid, plan, rngs.traps, protectedCells);
  const groundItems = generateGroundItems(grid, rngs.loot, entrance, exit, loot, protectedCells);

  return {
    grid,
    rooms: (built.rooms as RegularRoom[])
      .filter((room) => room.rect !== null && room.role !== "connection")
      .map((room) => room.rect!),
    entrance,
    exit,
    groundItems,
    floorVariants,
    roomMetadata: roomMetadata(built.rooms as RegularRoom[]),
    trapMetadata,
  };
}

function normalizeRooms(rooms: RegularRoom[], padding: number): void {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    if (!room.rect) continue;
    left = Math.min(left, room.rect.x);
    top = Math.min(top, room.rect.y);
  }
  const dx = -left + padding;
  const dy = -top + padding;
  const doors = new Set<RegularDoor>();
  for (const room of rooms) {
    for (const door of room.connected.values()) doors.add(door);
  }
  for (const room of rooms) room.shift(dx, dy);
  for (const door of doors) {
    door.x += dx;
    door.y += dy;
  }
}

function roomBounds(rooms: RegularRoom[], padding: number): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const room of rooms) {
    if (!room.rect) continue;
    right = Math.max(right, room.rect.right);
    bottom = Math.max(bottom, room.rect.bottom);
  }
  return { width: right + padding, height: bottom + padding };
}

function paintRoom(grid: Grid, floorVariants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  if (!room.rect) return;
  paintBaseRoom(grid, floorVariants, room.rect, rng);
  if (room.family === "sewerPipe") paintSewerPipe(grid, floorVariants, room.rect, rng);
  else if (room.family === "ring") paintRing(grid, room.rect);
  else if (room.family === "waterBridge") paintWaterBridge(grid, floorVariants, room.rect, rng);
  else if (room.family === "regionDecoPatch") paintRoomPatch(grid, floorVariants, room.rect, Terrain.GRASS, rng);
  else if (room.family === "circleBasin") paintCircleBasin(grid, floorVariants, room.rect, rng);
  else if (room.family === "safeSpecial") paintSafeSpecial(grid, floorVariants, room.rect, rng);
  else if (room.family === "safeSecret") paintSafeSecret(grid, floorVariants, room.rect, rng);
}

function paintBaseRoom(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  fillRect(grid, rect, Terrain.WALL);
  for (let y = rect.y + 1; y < rect.bottom - 1; y++) {
    for (let x = rect.x + 1; x < rect.right - 1; x++) {
      const cell = grid.cell(x, y);
      grid.set(cell, Terrain.FLOOR);
      floorVariants.set(cell, rng.pick([0, 1, 2]));
    }
  }
}

function paintSewerPipe(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  const horizontal = rect.w >= rect.h;
  if (horizontal) {
    const y = rect.centerY;
    for (let x = rect.x + 1; x < rect.right - 1; x++) setVariant(grid, floorVariants, x, y, Terrain.WATER, rng);
  } else {
    const x = rect.centerX;
    for (let y = rect.y + 1; y < rect.bottom - 1; y++) setVariant(grid, floorVariants, x, y, Terrain.WATER, rng);
  }
}

function paintRing(grid: Grid, rect: Rect): void {
  if (rect.w < 7 || rect.h < 7) return;
  const inner = new Rect(rect.x + 3, rect.y + 3, Math.max(1, rect.w - 6), Math.max(1, rect.h - 6));
  fillRect(grid, inner, Terrain.WATER);
}

function paintWaterBridge(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  for (let y = rect.y + 1; y < rect.bottom - 1; y++) {
    for (let x = rect.x + 1; x < rect.right - 1; x++) {
      setVariant(grid, floorVariants, x, y, Terrain.WATER, rng);
    }
  }
  const horizontal = rect.w >= rect.h;
  if (horizontal) {
    for (let x = rect.x + 1; x < rect.right - 1; x++) setVariant(grid, floorVariants, x, rect.centerY, Terrain.FLOOR, rng);
  } else {
    for (let y = rect.y + 1; y < rect.bottom - 1; y++) setVariant(grid, floorVariants, rect.centerX, y, Terrain.FLOOR, rng);
  }
}

function paintRoomPatch(
  grid: Grid,
  floorVariants: Map<number, number>,
  rect: Rect,
  terrain: Terrain,
  rng: RNG,
): void {
  for (let y = rect.y + 2; y < rect.bottom - 2; y++) {
    for (let x = rect.x + 2; x < rect.right - 2; x++) {
      if (rng.chance(0.45)) setVariant(grid, floorVariants, x, y, terrain, rng);
    }
  }
}

function paintCircleBasin(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  const radius = Math.max(1, Math.min(rect.w, rect.h) / 4);
  for (let y = rect.y + 1; y < rect.bottom - 1; y++) {
    for (let x = rect.x + 1; x < rect.right - 1; x++) {
      const dx = x - rect.centerX;
      const dy = y - rect.centerY;
      if (Math.hypot(dx, dy) <= radius) setVariant(grid, floorVariants, x, y, Terrain.WATER, rng);
    }
  }
}

function paintSafeSpecial(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  paintRoomPatch(grid, floorVariants, rect, Terrain.GRASS, rng);
}

function paintSafeSecret(grid: Grid, floorVariants: Map<number, number>, rect: Rect, rng: RNG): void {
  if (rect.w >= 6 && rect.h >= 6) {
    fillRect(grid, new Rect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4), Terrain.FLOOR);
  }
  paintRoomPatch(grid, floorVariants, rect, Terrain.GRASS, rng);
}

function paintPatches(
  grid: Grid,
  floorVariants: Map<number, number>,
  protectedCells: Set<number>,
  plan: RegularLevelPlan,
  rng: RNG,
): void {
  const waterPatch = generatePatch(grid.width, grid.height, plan.painter.waterFill, plan.painter.waterSmoothness, rng);
  for (let cell = 0; cell < grid.length; cell++) {
    if (!protectedCells.has(cell) && waterPatch[cell] && grid.get(cell) === Terrain.FLOOR) {
      grid.set(cell, Terrain.WATER);
      floorVariants.set(cell, rng.pick([0, 1, 2]));
    }
  }

  const grassPatch = generatePatch(grid.width, grid.height, plan.painter.grassFill, plan.painter.grassSmoothness, rng);
  for (let cell = 0; cell < grid.length; cell++) {
    if (!protectedCells.has(cell) && grassPatch[cell] && grid.get(cell) === Terrain.FLOOR) {
      grid.set(cell, Terrain.GRASS);
      floorVariants.set(cell, rng.pick([0, 1, 2]));
    }
  }
}

function stairCell(grid: Grid, room: RegularRoom, rng: RNG, protectedCells: ReadonlySet<number>): number {
  if (!room.rect) throw new Error(`Room ${room.id} has no rect`);
  const candidates = innerCells(grid, room.rect)
    .filter((cell) => grid.isWalkable(cell) && !protectedCells.has(cell));
  return candidates.length > 0 ? rng.pick(candidates) : grid.cell(room.rect.centerX, room.rect.centerY);
}

function placeTraps(
  grid: Grid,
  plan: RegularLevelPlan,
  rng: RNG,
  protectedCells: Set<number>,
): GeneratedTrapMetadata[] {
  const candidates: number[] = [];
  for (let cell = 0; cell < grid.length; cell++) {
    if (!protectedCells.has(cell) && grid.isWalkable(cell)) candidates.push(cell);
  }
  rng.shuffle(candidates);
  const traps: GeneratedTrapMetadata[] = [];
  for (let i = 0; i < plan.painter.trapCount; i++) {
    const cell = candidates.pop();
    if (cell === undefined) break;
    grid.set(cell, Terrain.FLOOR);
    protectedCells.add(cell);
    traps.push({
      cell,
      kind: rng.pick(plan.painter.trapKinds),
      visible: false,
      active: true,
    });
  }
  return traps;
}

function generateGroundItems(
  grid: Grid,
  rng: RNG,
  entrance: number,
  exit: number,
  loot: LootGenerationOptions,
  protectedCells: ReadonlySet<number>,
): GeneratedGroundItem[] {
  const itemIds = loot.itemIds ?? [];
  const guaranteedItemIds = loot.guaranteedItemIds ?? [];
  const randomCount = itemIds.length > 0
    ? Math.max(0, Math.floor(loot.itemCount ?? rng.range(2, 4)))
    : 0;
  if (guaranteedItemIds.length === 0 && randomCount === 0) return [];

  const candidates: number[] = [];
  for (let cell = 0; cell < grid.length; cell++) {
    if (
      cell !== entrance &&
      cell !== exit &&
      !protectedCells.has(cell) &&
      grid.isWalkable(cell)
    ) {
      candidates.push(cell);
    }
  }
  rng.shuffle(candidates);

  const groundItems: GeneratedGroundItem[] = [];
  const place = (itemId: string): void => {
    const cell = candidates.pop();
    if (cell === undefined) return;
    groundItems.push({ cell, itemId });
  };

  for (const itemId of guaranteedItemIds) place(itemId);
  for (let i = 0; i < randomCount; i++) place(rng.pick(itemIds));
  return groundItems;
}

function roomMetadata(rooms: RegularRoom[]): GeneratedRoomMetadata[] {
  return rooms
    .filter((room) => room.rect !== null)
    .map((room) => ({
      id: room.id,
      role: room.role,
      family: room.family,
      sizeCategory: room.sizeCategory,
      rect: {
        x: room.rect!.x,
        y: room.rect!.y,
        w: room.rect!.w,
        h: room.rect!.h,
      },
      connections: room.connectedRooms.map((connected) => connected.id),
    }));
}

function fillRect(grid: Grid, rect: Rect, terrain: Terrain): void {
  for (let y = rect.y; y < rect.bottom; y++) {
    for (let x = rect.x; x < rect.right; x++) {
      if (grid.inBounds(x, y)) grid.set(grid.cell(x, y), terrain);
    }
  }
}

function setVariant(
  grid: Grid,
  floorVariants: Map<number, number>,
  x: number,
  y: number,
  terrain: Terrain,
  rng: RNG,
): void {
  if (!grid.inBounds(x, y)) return;
  const cell = grid.cell(x, y);
  grid.set(cell, terrain);
  floorVariants.set(cell, rng.pick([0, 1, 2]));
}

function paintDoorApproaches(
  grid: Grid,
  floorVariants: Map<number, number>,
  room: RegularRoom,
  connected: RegularRoom,
  x: number,
  y: number,
  rng: RNG,
): void {
  if (!room.rect || !connected.rect) return;
  if (room.rect.right - 1 === x || connected.rect.right - 1 === x) {
    setVariant(grid, floorVariants, x - 1, y, Terrain.FLOOR, rng);
    setVariant(grid, floorVariants, x + 1, y, Terrain.FLOOR, rng);
  } else if (room.rect.bottom - 1 === y || connected.rect.bottom - 1 === y) {
    setVariant(grid, floorVariants, x, y - 1, Terrain.FLOOR, rng);
    setVariant(grid, floorVariants, x, y + 1, Terrain.FLOOR, rng);
  }
}

function innerCells(grid: Grid, rect: Rect): number[] {
  const cells: number[] = [];
  for (let y = rect.y + 1; y < rect.bottom - 1; y++) {
    for (let x = rect.x + 1; x < rect.right - 1; x++) {
      if (grid.inBounds(x, y)) cells.push(grid.cell(x, y));
    }
  }
  return cells;
}
