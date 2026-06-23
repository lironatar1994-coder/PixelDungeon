/**
 * LevelGenerator — turns a seed into a finished floor (pure logic).
 *
 * Pipeline:
 *   1. Build an SPD-style room graph: entrance -> main path -> exit, then
 *      side branches and occasional extra connections.
 *   2. Place rooms edge-to-edge with a one-tile door seam rather than carving
 *      arbitrary A* tunnels through a BSP map.
 *   3. Paint rooms, doors, water, grass, stairs, and loot.
 *
 * Regular floors derive scoped RNG streams from the injected RNG so terrain
 * decoration changes do not silently move stairs, traps, or loot.
 */
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { Rect } from "@/core/grid/Rect";
import { RNG } from "@/core/rng/Mulberry32";
import { generatePatch } from "@/core/grid/gen/Patch";
import type { GeneratedRoomMetadata, GeneratedTrapMetadata, RegularLevelPlan } from "./regular/types";
import { buildRegularRoomGraph } from "./regular/builders";
import { paintRegularLevel } from "./regular/painter";

export interface GeneratedGroundItem {
  cell: number;
  itemId: string;
}

export interface GeneratedLevel {
  grid: Grid;
  rooms: Rect[];
  entrance: number;
  exit: number;
  groundItems: GeneratedGroundItem[];
  floorVariants: Map<number, number>;
  roomMetadata?: GeneratedRoomMetadata[];
  trapMetadata?: GeneratedTrapMetadata[];
}

export interface LootGenerationOptions {
  /** Random loot pool. Potion of Strength may be excluded by the caller. */
  itemIds?: readonly string[];
  /** Items that must appear on this floor, placed before random loot. */
  guaranteedItemIds?: readonly string[];
  /** Random item count; defaults to a small deterministic 2..4 when itemIds exist. */
  itemCount?: number;
}

export interface LevelGenerationOptions {
  plan?: RegularLevelPlan | null;
}

type Direction = "north" | "east" | "south" | "west";

interface PlacedRoom {
  rect: Rect;
  kind: "entrance" | "exit" | "standard" | "large";
}

interface PlacedConnection {
  from: number;
  to: number;
  door: number;
}

interface RoomGraph {
  rooms: PlacedRoom[];
  connections: PlacedConnection[];
  entranceRoom: number;
  exitRoom: number;
}

const DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export function generateLevel(
  width: number,
  height: number,
  rng: RNG,
  opts: LevelGenerationOptions = {},
  loot: LootGenerationOptions = {},
): GeneratedLevel {
  if (opts.plan?.kind === "regular") {
    return generateRegularLevel(width, height, rng, opts.plan, loot);
  }

  const grid = new Grid(width, height, Terrain.WALL);
  const floorVariants = new Map<number, number>();

  const graph = buildRoomGraph(width, height, rng);
  const rooms = graph.rooms.map((room) => room.rect);

  paintRoomGraph(grid, graph, floorVariants, rng);

  const entranceRect = graph.rooms[graph.entranceRoom]?.rect ?? rooms[0]!;
  const exitRect = graph.rooms[graph.exitRoom]?.rect ?? rooms[rooms.length - 1]!;
  let entrance = grid.cell(entranceRect.centerX, entranceRect.centerY);
  let exit = grid.cell(exitRect.centerX, exitRect.centerY);
  // Stairs always stand on plain floor (never a door).
  grid.set(entrance, Terrain.FLOOR);
  grid.set(exit, Terrain.FLOOR);

  const groundItems = generateGroundItems(grid, rng, entrance, exit, loot);

  return { grid, rooms, entrance, exit, groundItems, floorVariants };
}

function generateRegularLevel(
  width: number,
  height: number,
  rng: RNG,
  plan: RegularLevelPlan,
  loot: LootGenerationOptions,
): GeneratedLevel {
  const scopeSeed = regularScopeSeed(rng, plan);
  for (let attempt = 0; attempt < 96; attempt++) {
    const attemptSeed = `${scopeSeed}:attempt:${attempt}`;
    const built = buildRegularRoomGraph(plan, new RNG(`${attemptSeed}:builder`));
    if (!built) continue;
    const generated = paintRegularLevel(
      built,
      plan,
      {
        terrain: new RNG(`${attemptSeed}:terrain`),
        placement: new RNG(`${attemptSeed}:placement`),
        traps: new RNG(`${attemptSeed}:traps`),
        loot: new RNG(`${attemptSeed}:loot`),
      },
      loot,
    );
    if (generated.grid.width >= Math.min(16, width) && generated.grid.height >= Math.min(16, height)) {
      return generated;
    }
  }
  throw new Error(`Unable to generate regular ${plan.region} level for depth ${plan.depth}`);
}

function regularScopeSeed(rng: RNG, plan: RegularLevelPlan): string {
  return [
    rng.label,
    rng.initialState,
    rng.state,
    "regular",
    plan.region,
    plan.depth,
    plan.builder.kind,
  ].join(":");
}

function buildRoomGraph(width: number, height: number, rng: RNG): RoomGraph {
  const rooms: PlacedRoom[] = [];
  const connections: PlacedConnection[] = [];
  const entrance = centeredRoom(width, height, rng);
  rooms.push({ rect: entrance, kind: "entrance" });

  const mainPathLength = rng.range(5, 8);
  let current = 0;
  let previousDirection: Direction | null = null;
  for (let i = 1; i < mainPathLength; i++) {
    const placed = placeConnectedRoom(width, height, rng, rooms, current, previousDirection, i === mainPathLength - 1);
    if (!placed) break;
    rooms.push(placed.room);
    connections.push({ from: current, to: rooms.length - 1, door: placed.door });
    current = rooms.length - 1;
    previousDirection = placed.direction;
  }

  const branchAttempts = rng.range(5, 8);
  for (let i = 0; i < branchAttempts; i++) {
    const parent = rng.range(0, Math.max(0, rooms.length - 1));
    const placed = placeConnectedRoom(width, height, rng, rooms, parent, null, false);
    if (!placed) continue;
    rooms.push(placed.room);
    connections.push({ from: parent, to: rooms.length - 1, door: placed.door });
  }

  addExtraDoors(width, height, rng, rooms, connections);

  return {
    rooms,
    connections,
    entranceRoom: 0,
    exitRoom: farthestRoomFrom(rooms, 0),
  };
}

function centeredRoom(width: number, height: number, rng: RNG): Rect {
  const w = rng.range(6, 8);
  const h = rng.range(6, 8);
  return new Rect(
    clamp(Math.floor(width / 2) - Math.floor(w / 2), 2, width - w - 2),
    clamp(Math.floor(height / 2) - Math.floor(h / 2), 2, height - h - 2),
    w,
    h,
  );
}

function placeConnectedRoom(
  width: number,
  height: number,
  rng: RNG,
  rooms: readonly PlacedRoom[],
  parentIndex: number,
  previousDirection: Direction | null,
  exitLike: boolean,
): { room: PlacedRoom; door: number; direction: Direction } | null {
  const directions = shuffledDirections(rng, previousDirection);
  for (const direction of directions) {
    for (let tries = 0; tries < 12; tries++) {
      const rect = adjacentRoomRect(rooms[parentIndex]!.rect, direction, width, height, rng, exitLike);
      if (!rect || collides(rect, rooms)) continue;
      const door = doorBetween(width, height, rooms[parentIndex]!.rect, rect, direction, rng);
      if (door === null) continue;
      return {
        room: { rect, kind: exitLike ? "exit" : roomKind(rect) },
        door,
        direction,
      };
    }
  }
  return null;
}

function shuffledDirections(rng: RNG, previousDirection: Direction | null): Direction[] {
  const directions = rng.shuffle([...DIRECTIONS]);
  if (!previousDirection) return directions;
  const reverse = opposite(previousDirection);
  return directions.sort((a, b) => (a === reverse ? 1 : 0) - (b === reverse ? 1 : 0));
}

function adjacentRoomRect(
  parent: Rect,
  direction: Direction,
  width: number,
  height: number,
  rng: RNG,
  exitLike: boolean,
): Rect | null {
  const large = exitLike || rng.chance(0.2);
  const w = large ? rng.range(7, 11) : rng.range(5, 9);
  const h = large ? rng.range(7, 11) : rng.range(5, 9);
  let x = parent.x;
  let y = parent.y;

  if (direction === "east" || direction === "west") {
    const overlapY = rng.range(parent.y + 1, parent.bottom - 2);
    y = overlapY - rng.range(1, h - 2);
    y = clamp(y, 2, height - h - 2);
    x = direction === "east" ? parent.right + 1 : parent.x - w - 1;
  } else {
    const overlapX = rng.range(parent.x + 1, parent.right - 2);
    x = overlapX - rng.range(1, w - 2);
    x = clamp(x, 2, width - w - 2);
    y = direction === "south" ? parent.bottom + 1 : parent.y - h - 1;
  }

  if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) return null;
  return new Rect(x, y, w, h);
}

function doorBetween(
  width: number,
  height: number,
  a: Rect,
  b: Rect,
  direction: Direction,
  rng: RNG,
): number | null {
  if (direction === "east" || direction === "west") {
    const doorX = direction === "east" ? a.right : a.x - 1;
    const minY = Math.max(a.y + 1, b.y + 1);
    const maxY = Math.min(a.bottom - 2, b.bottom - 2);
    if (doorX <= 0 || doorX >= width - 1 || minY > maxY) return null;
    return doorX + rng.range(minY, maxY) * width;
  }

  const doorY = direction === "south" ? a.bottom : a.y - 1;
  const minX = Math.max(a.x + 1, b.x + 1);
  const maxX = Math.min(a.right - 2, b.right - 2);
  if (doorY <= 0 || doorY >= height - 1 || minX > maxX) return null;
  return rng.range(minX, maxX) + doorY * width;
}

function collides(rect: Rect, rooms: readonly PlacedRoom[]): boolean {
  return rooms.some((room) => rect.intersects(room.rect));
}

function roomKind(rect: Rect): PlacedRoom["kind"] {
  return rect.area >= 72 ? "large" : "standard";
}

function addExtraDoors(
  width: number,
  height: number,
  rng: RNG,
  rooms: readonly PlacedRoom[],
  connections: PlacedConnection[],
): void {
  const existing = new Set<string>();
  for (const connection of connections) {
    existing.add(connectionKey(connection.from, connection.to));
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (existing.has(connectionKey(i, j)) || !rng.chance(0.22)) continue;
      const direction = adjacentDirection(rooms[i]!.rect, rooms[j]!.rect);
      if (!direction) continue;
      const door = doorBetween(width, height, rooms[i]!.rect, rooms[j]!.rect, direction, rng);
      if (door === null) continue;
      connections.push({ from: i, to: j, door });
      existing.add(connectionKey(i, j));
    }
  }
}

function adjacentDirection(a: Rect, b: Rect): Direction | null {
  if (b.x === a.right + 1 && overlaps(a.y + 1, a.bottom - 2, b.y + 1, b.bottom - 2)) return "east";
  if (b.right === a.x - 1 && overlaps(a.y + 1, a.bottom - 2, b.y + 1, b.bottom - 2)) return "west";
  if (b.y === a.bottom + 1 && overlaps(a.x + 1, a.right - 2, b.x + 1, b.right - 2)) return "south";
  if (b.bottom === a.y - 1 && overlaps(a.x + 1, a.right - 2, b.x + 1, b.right - 2)) return "north";
  return null;
}

function overlaps(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return Math.max(aMin, bMin) <= Math.min(aMax, bMax);
}

function connectionKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function farthestRoomFrom(rooms: readonly PlacedRoom[], startIndex: number): number {
  const start = rooms[startIndex]?.rect;
  if (!start) return startIndex;
  let best = startIndex;
  let bestDistance = -1;
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i]!.rect;
    const distance = Math.abs(room.centerX - start.centerX) + Math.abs(room.centerY - start.centerY);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function paintRoomGraph(
  grid: Grid,
  graph: RoomGraph,
  floorVariants: Map<number, number>,
  rng: RNG,
): void {
  const protectedCells = new Set<number>();

  for (const room of graph.rooms) {
    for (let y = room.rect.y; y < room.rect.bottom; y++) {
      for (let x = room.rect.x; x < room.rect.right; x++) {
        const cell = grid.cell(x, y);
        grid.set(cell, Terrain.FLOOR);
        floorVariants.set(cell, rng.pick([0, 1, 2]));
      }
    }
  }

  for (const connection of graph.connections) {
    grid.set(connection.door, Terrain.DOOR);
    floorVariants.set(connection.door, rng.pick([0, 1, 2]));
    protectedCells.add(connection.door);
  }

  paintPatches(grid, floorVariants, protectedCells, rng);
}

function paintPatches(
  grid: Grid,
  floorVariants: Map<number, number>,
  protectedCells: ReadonlySet<number>,
  rng: RNG,
): void {
  const waterPatch = generatePatch(grid.width, grid.height, 0.14, 2, rng);
  for (let cell = 0; cell < grid.length; cell++) {
    if (!protectedCells.has(cell) && waterPatch[cell] && grid.get(cell) === Terrain.FLOOR) {
      grid.set(cell, Terrain.WATER);
      floorVariants.set(cell, rng.pick([0, 1, 2]));
    }
  }

  const grassPatch = generatePatch(grid.width, grid.height, 0.18, 2, rng);
  for (let cell = 0; cell < grid.length; cell++) {
    if (!protectedCells.has(cell) && grassPatch[cell] && grid.get(cell) === Terrain.FLOOR) {
      grid.set(cell, Terrain.GRASS);
      floorVariants.set(cell, rng.pick([0, 1, 2]));
    }
  }
}

function opposite(direction: Direction): Direction {
  switch (direction) {
    case "north": return "south";
    case "south": return "north";
    case "east": return "west";
    case "west": return "east";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateGroundItems(
  grid: Grid,
  rng: RNG,
  entrance: number,
  exit: number,
  loot: LootGenerationOptions,
): GeneratedGroundItem[] {
  const itemIds = loot.itemIds ?? [];
  const guaranteedItemIds = loot.guaranteedItemIds ?? [];
  const randomCount = itemIds.length > 0
    ? Math.max(0, Math.floor(loot.itemCount ?? rng.range(2, 4)))
    : 0;
  if (guaranteedItemIds.length === 0 && randomCount === 0) return [];

  const candidates: number[] = [];
  for (let cell = 0; cell < grid.length; cell++) {
    if (cell !== entrance && cell !== exit && grid.isWalkable(cell)) {
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
