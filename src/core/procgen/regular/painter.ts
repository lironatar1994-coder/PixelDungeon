/*
 * Algorithmic TypeScript port of SPD RegularPainter/SewerPainter ordering
 * and supported sewer room paint hooks.
 */
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import type { RNG } from "@/core/rng/Mulberry32";
import type { LootGenerationOptions, GeneratedGroundItem, GeneratedLevel } from "@/core/procgen/LevelGenerator";
import type { BuiltRegularLevel, GeneratedRoomMetadata, GeneratedTrapMetadata, RegularLevelPlan } from "./types";
import { RegularRoom, doorCandidates, intersectRooms, normalIntRange, type Point, type RegularDoor } from "./rooms";

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
  const rooms = built.rooms as RegularRoom[];
  normalizeRooms(rooms, 1);
  placeDoors(rooms, rngs.placement);

  const bounds = roomBounds(rooms, 1);
  const grid = new Grid(bounds.width, bounds.height, Terrain.WALL);
  const floorVariants = new Map<number, number>();
  const protectedCells = new Set<number>();

  const paintOrder = rngs.terrain.shuffle(rooms.slice());
  for (const room of paintOrder) paintRoom(grid, floorVariants, room, rngs.terrain);

  paintDoors(grid, floorVariants, rooms, plan, rngs.placement, protectedCells);

  const entrance = stairCell(grid, built.entrance as RegularRoom, rngs.placement, protectedCells, plan.levelKind === "sewerBoss" ? 3 : 2);
  const exit = plan.levelKind === "sewerBoss"
    ? grid.cell((built.exit as RegularRoom).centerX, (built.exit as RegularRoom).centerY)
    : stairCell(grid, built.exit as RegularRoom, rngs.placement, protectedCells, 2);
  setVariant(grid, floorVariants, grid.xOf(entrance), grid.yOf(entrance), Terrain.FLOOR, rngs.placement);
  setVariant(
    grid,
    floorVariants,
    grid.xOf(exit),
    grid.yOf(exit),
    plan.levelKind === "sewerBoss" ? Terrain.LOCKED_EXIT : Terrain.FLOOR,
    rngs.placement,
  );
  protectedCells.add(entrance);
  protectedCells.add(exit);

  paintWater(grid, floorVariants, rooms, protectedCells, plan, rngs.terrain);
  paintGrass(grid, floorVariants, rooms, protectedCells, plan, rngs.terrain);
  const trapMetadata = placeTraps(grid, rooms, plan, rngs.traps, protectedCells);
  decorateSewer(grid, floorVariants, rngs.terrain);
  const groundItems = generateGroundItems(grid, rngs.loot, entrance, exit, loot, protectedCells, rooms);

  return {
    grid,
    rooms: rooms
      .filter((room) => room.rect !== null && room.role !== "connection")
      .map((room) => room.rect!),
    entrance,
    exit,
    groundItems,
    floorVariants,
    roomMetadata: roomMetadata(rooms, plan),
    trapMetadata,
  };
}

function normalizeRooms(rooms: RegularRoom[], padding: number): void {
  let leftMost = Number.POSITIVE_INFINITY;
  let topMost = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    if (!room.rect) continue;
    leftMost = Math.min(leftMost, room.left);
    topMost = Math.min(topMost, room.top);
  }
  leftMost -= padding;
  topMost -= padding;
  const dx = -leftMost;
  const dy = -topMost;
  for (const room of rooms) room.shift(dx, dy);
}

function roomBounds(rooms: RegularRoom[], padding: number): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const room of rooms) {
    if (!room.rect) continue;
    right = Math.max(right, room.right);
    bottom = Math.max(bottom, room.bottom);
  }
  return { width: right + padding + 1, height: bottom + padding + 1 };
}

function placeDoors(rooms: RegularRoom[], rng: RNG): void {
  for (const room of rooms) {
    for (const [other, existing] of room.connected.entries()) {
      if (existing !== null) continue;
      const candidates = doorCandidates(room, other);
      if (candidates.length === 0) continue;
      const door: RegularDoor = { ...rng.pick(candidates), type: "regular" };
      room.connected.set(other, door);
      other.connected.set(room, door);
    }
  }
}

function paintRoom(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  if (!room.rect) return;
  switch (room.family) {
    case "sewerPipe":
      paintSewerPipe(grid, variants, room, rng);
      break;
    case "ring":
      paintRing(grid, variants, room, rng);
      break;
    case "waterBridge":
      paintWaterBridge(grid, variants, room, rng);
      break;
    case "regionDecoPatch":
      paintRegionDecoPatch(grid, variants, room, rng);
      break;
    case "circleBasin":
      paintCircleBasin(grid, variants, room, rng);
      break;
    case "bossEntrance":
      paintBossEntrance(grid, variants, room, rng);
      break;
    case "bossExit":
      paintBossExit(grid, variants, room, rng);
      break;
    case "gooDiamond":
      paintDiamondGoo(grid, variants, room, rng);
      break;
    case "gooWalled":
      paintWalledGoo(grid, variants, room, rng);
      break;
    case "gooThinPillars":
      paintThinPillarsGoo(grid, variants, room, rng);
      break;
    case "gooThickPillars":
      paintThickPillarsGoo(grid, variants, room, rng);
      break;
    default:
      paintEmptyRoom(grid, variants, room, rng);
      break;
  }
}

function paintEmptyRoom(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.FLOOR, rng, 1);
  for (const door of room.connected.values()) if (door) door.type = "regular";
}

function paintSewerPipe(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  const doors = [...room.connected.values()].filter((door): door is RegularDoor => door !== null);
  const center = doors.length <= 1 ? room.center(rng) : doorCenter(room, doors, rng);
  const points = doors.map((door) => pointInsideByTwo(room, door));
  if (points.length === 0) points.push(center);
  if (doors.length === 1 || (doors.length === 2 && room.sizeCategory === "normal")) {
    for (const door of doors) drawPipeToCenter(grid, variants, room, door, center, rng);
  } else {
    const toFill = points.slice();
    const filled = [toFill.shift()!];
    while (toFill.length > 0) {
      let bestFrom = filled[0]!;
      let bestTo = toFill[0]!;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const from of filled) {
        for (const to of toFill) {
          const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
          if (dist < bestDist) {
            bestFrom = from;
            bestTo = to;
            bestDist = dist;
          }
        }
      }
      drawLine(grid, variants, bestFrom, bestTo, Terrain.WATER, rng);
      filled.push(bestTo);
      toFill.splice(toFill.indexOf(bestTo), 1);
    }
  }
  for (let y = room.top + 1; y < room.bottom; y++) {
    for (let x = room.left + 1; x < room.right; x++) {
      const cell = grid.cell(x, y);
      if (grid.get(cell) !== Terrain.WATER) continue;
      for (const n of grid.neighbours8(cell)) {
        if (grid.get(n) === Terrain.WALL) setCell(grid, variants, n, Terrain.FLOOR, rng);
      }
    }
  }
  for (const [other, door] of room.connected.entries()) {
    if (!door) continue;
    if (other.family === "sewerPipe") {
      fillRect(grid, variants, door.x - 1, door.y - 1, 3, 3, Terrain.FLOOR, rng);
      if (door.x === room.left || door.x === room.right) fillRect(grid, variants, door.x - 1, door.y, 3, 1, Terrain.WATER, rng);
      else fillRect(grid, variants, door.x, door.y - 1, 1, 3, Terrain.WATER, rng);
      door.type = "water";
    } else {
      door.type = "regular";
    }
  }
}

function paintRing(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.FLOOR, rng, 1);
  const minDim = Math.min(room.width, room.height);
  const passageWidth = Math.floor(0.2 * (minDim + 3));
  fillRoom(grid, variants, room, Terrain.WALL, rng, passageWidth + 1);
  if (minDim >= 10) {
    fillRoom(grid, variants, room, Terrain.REGION_DECO_ALT, rng, passageWidth + 2);
    const center = room.center(rng);
    setVariant(grid, variants, center.x, center.y, Terrain.EMPTY_SP, rng);
    const xDir = rng.bool() ? (center.x <= (room.left + room.right) / 2 ? 1 : -1) : 0;
    const yDir = xDir === 0 ? (center.y <= (room.top + room.bottom) / 2 ? 1 : -1) : 0;
    let p = { x: center.x + xDir, y: center.y + yDir };
    while (grid.inBounds(p.x, p.y) && grid.get(grid.cell(p.x, p.y)) !== Terrain.WALL) {
      setVariant(grid, variants, p.x, p.y, Terrain.EMPTY_SP, rng);
      p = { x: p.x + xDir, y: p.y + yDir };
    }
    if (grid.inBounds(p.x, p.y)) setVariant(grid, variants, p.x, p.y, Terrain.DOOR, rng);
  }
  for (const door of room.connected.values()) if (door) door.type = "regular";
}

function paintWaterBridge(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.FLOOR, rng, 1);
  const doorsXY = [...room.connected.values()].reduce((sum, door) => {
    if (!door) return sum;
    door.type = "regular";
    return sum + (door.x === room.left || door.x === room.right ? 1 : -1);
  }, 0) + Math.floor((room.width - room.height) / 2);
  if (doorsXY > 0 || (doorsXY === 0 && rng.bool())) {
    const spacePoints = [...room.connected.values()]
      .filter((door): door is RegularDoor => door !== null && (door.y === room.top || door.y === room.bottom))
      .map((door) => door.x);
    spacePoints.push(room.left + 1, room.right - 1);
    spacePoints.sort((a, b) => a - b);
    let start = spacePoints[0]!;
    let end = spacePoints[1]!;
    for (let i = 0; i < spacePoints.length - 1; i++) {
      if (end - start < spacePoints[i + 1]! - spacePoints[i]!) {
        start = spacePoints[i]!;
        end = spacePoints[i + 1]!;
      }
    }
    while (end - start > (room.width >= 8 ? 3 : 2) + 1) {
      if (rng.bool()) start++;
      else end--;
    }
    fillRect(grid, variants, start + 1, room.top + 1, end - start - 1, room.height - 2, Terrain.WATER, rng);
    const bridgeY = normalIntRange(rng, room.top + 2, room.bottom - 2);
    fillRect(grid, variants, start + 1, bridgeY, end - start - 1, 2, Terrain.EMPTY_SP, rng);
  } else {
    const spacePoints = [...room.connected.values()]
      .filter((door): door is RegularDoor => door !== null && (door.x === room.left || door.x === room.right))
      .map((door) => door.y);
    spacePoints.push(room.top + 1, room.bottom - 1);
    spacePoints.sort((a, b) => a - b);
    let start = spacePoints[0]!;
    let end = spacePoints[1]!;
    for (let i = 0; i < spacePoints.length - 1; i++) {
      if (end - start < spacePoints[i + 1]! - spacePoints[i]!) {
        start = spacePoints[i]!;
        end = spacePoints[i + 1]!;
      }
    }
    while (end - start > (room.height >= 8 ? 3 : 2) + 1) {
      if (rng.bool()) start++;
      else end--;
    }
    fillRect(grid, variants, room.left + 1, start + 1, room.width - 2, end - start - 1, Terrain.WATER, rng);
    const bridgeX = normalIntRange(rng, room.left + 2, room.right - 2);
    fillRect(grid, variants, bridgeX, start + 1, 2, end - start - 1, Terrain.EMPTY_SP, rng);
  }
}

function paintRegionDecoPatch(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  paintEmptyRoom(grid, variants, room, rng);
  const fill = 0.2 + Math.min(room.width * room.height, 100) / 1024;
  const patch = generateSpdPatch(room.width - 2, room.height - 2, fill, 1, true, rng);
  for (let y = room.top + 1; y < room.bottom; y++) {
    for (let x = room.left + 1; x < room.right; x++) {
      if (patch[(x - room.left - 1) + (y - room.top - 1) * (room.width - 2)]) {
        setVariant(grid, variants, x, y, Terrain.REGION_DECO, rng);
      }
    }
  }
}

function paintCircleBasin(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillEllipse(grid, variants, room, 1, Terrain.FLOOR, rng);
  for (const door of room.connected.values()) {
    if (!door) continue;
    door.type = "regular";
    drawInside(grid, variants, room, door, door.x === room.left || door.x === room.right ? Math.floor(room.width / 2) : Math.floor(room.height / 2), Terrain.FLOOR, rng);
  }
  fillEllipse(grid, variants, room, 3, Terrain.CHASM, rng);
  drawLine(grid, variants, { x: room.left + Math.floor(room.width / 2), y: room.top + 3 }, { x: room.left + Math.floor(room.width / 2), y: room.bottom - 3 }, Terrain.EMPTY_SP, rng);
  drawLine(grid, variants, { x: room.left + 3, y: room.top + Math.floor(room.height / 2) }, { x: room.right - 3, y: room.top + Math.floor(room.height / 2) }, Terrain.EMPTY_SP, rng);
  if (room.width > 11 || room.height > 11) {
    const center = room.center(rng);
    fillRect(grid, variants, center.x - 1, center.y - 1, 3, 3, Terrain.EMPTY_SP, rng);
    setVariant(grid, variants, center.x, center.y, Terrain.WALL, rng);
  }
  const patch = generateSpdPatch(room.width - 2, room.height - 2, 0.5, 5, true, rng);
  for (let y = room.top + 1; y < room.bottom; y++) {
    for (let x = room.left + 1; x < room.right; x++) {
      const cell = grid.cell(x, y);
      if (grid.get(cell) === Terrain.FLOOR && patch[(x - room.left - 1) + (y - room.top - 1) * (room.width - 2)]) {
        setVariant(grid, variants, x, y, Terrain.WATER, rng);
        if (grid.get(cell - grid.width) === Terrain.WALL) grid.set(cell - grid.width, Terrain.WALL_DECO);
      }
    }
  }
}

function paintBossEntrance(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  paintEmptyRoom(grid, variants, room, rng);
  fillRect(grid, variants, room.left + 1, room.top + 1, room.width - 2, 1, Terrain.WALL_DECO, rng);
  fillRect(grid, variants, room.left + 1, room.top + 2, room.width - 2, 1, Terrain.WATER, rng);
}

function paintBossExit(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  paintEmptyRoom(grid, variants, room, rng);
  const c = { x: room.centerX, y: room.centerY };
  fillRect(grid, variants, c.x - 1, c.y - 1, 3, 2, Terrain.WALL, rng);
  fillRect(grid, variants, c.x - 1, c.y + 1, 3, 1, Terrain.EMPTY_SP, rng);
}

function paintDiamondGoo(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillDiamond(grid, variants, room, 1, Terrain.FLOOR, rng);
  for (const door of room.connected.values()) {
    if (!door) continue;
    door.type = "regular";
    drawInside(grid, variants, room, door, Math.max(room.width, room.height), Terrain.EMPTY_SP, rng);
  }
  const cx = room.left + Math.floor(room.width / 2);
  const cy = room.top + Math.floor(room.height / 2);
  fillRect(grid, variants, cx - 1, cy - 2, 2 + room.width % 2, 4 + room.height % 2, Terrain.WATER, rng);
  fillRect(grid, variants, cx - 2, cy - 1, 4 + room.width % 2, 2 + room.height % 2, Terrain.WATER, rng);
}

function paintWalledGoo(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.EMPTY_SP, rng, 1);
  fillRoom(grid, variants, room, Terrain.FLOOR, rng, 2);
  const pillarW = Math.floor((room.width - 6) / 2);
  const pillarH = Math.floor((room.height - 6) / 2);
  fillRect(grid, variants, room.left + 2, room.top + 2, pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + 2, room.top + 2, 1, pillarH, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + 2, room.bottom - 2, pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + 2, room.bottom - 1 - pillarH, 1, pillarH, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 1 - pillarW, room.top + 2, pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 2, room.top + 2, 1, pillarH, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 1 - pillarW, room.bottom - 2, pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 2, room.bottom - 1 - pillarH, 1, pillarH, Terrain.WALL, rng);
  for (const door of room.connected.values()) if (door) door.type = "regular";
}

function paintThinPillarsGoo(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.WATER, rng, 1);
  const pillarW = (room.width === 14 ? 4 : 2) + room.width % 2;
  const pillarH = (room.height === 14 ? 4 : 2) + room.height % 2;
  fillRect(grid, variants, room.left + Math.floor((room.width - pillarW) / 2), room.top + (room.height < 12 ? 2 : 3), pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + Math.floor((room.width - pillarW) / 2), room.bottom - (room.height < 12 ? 2 : 3), pillarW, 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + (room.width < 12 ? 2 : 3), room.top + Math.floor((room.height - pillarH) / 2), 1, pillarH, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - (room.width < 12 ? 2 : 3), room.top + Math.floor((room.height - pillarH) / 2), 1, pillarH, Terrain.WALL, rng);
  fillPerimeterPaths(grid, variants, room, Terrain.EMPTY_SP, rng);
  for (const door of room.connected.values()) if (door) door.type = "regular";
}

function paintThickPillarsGoo(grid: Grid, variants: Map<number, number>, room: RegularRoom, rng: RNG): void {
  fillRoom(grid, variants, room, Terrain.WALL, rng);
  fillRoom(grid, variants, room, Terrain.WATER, rng, 1);
  const pillarW = Math.floor((room.width - 8) / 2);
  const pillarH = Math.floor((room.height - 8) / 2);
  fillRect(grid, variants, room.left + 2, room.top + 2, pillarW + 1, pillarH + 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.left + 2, room.bottom - 2 - pillarH, pillarW + 1, pillarH + 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 2 - pillarW, room.top + 2, pillarW + 1, pillarH + 1, Terrain.WALL, rng);
  fillRect(grid, variants, room.right - 2 - pillarW, room.bottom - 2 - pillarH, pillarW + 1, pillarH + 1, Terrain.WALL, rng);
  fillPerimeterPaths(grid, variants, room, Terrain.EMPTY_SP, rng);
  for (const door of room.connected.values()) if (door) door.type = "regular";
}

function paintDoors(
  grid: Grid,
  variants: Map<number, number>,
  rooms: RegularRoom[],
  plan: RegularLevelPlan,
  rng: RNG,
  protectedCells: Set<number>,
): void {
  const hiddenDoorChance = plan.depth > 1 ? Math.min(1, plan.depth / 20) : 0;
  const processed = new Set<string>();
  const merged = new Map<RegularRoom, RegularRoom>();
  for (const room of rooms) {
    for (const [other, door] of room.connected.entries()) {
      if (!door) continue;
      const key = [room.id, other.id].sort().join(":");
      if (processed.has(key)) continue;
      processed.add(key);
      if (
        room.isStandardLike() &&
        other.isStandardLike() &&
        merged.get(room) !== other &&
        merged.get(other) !== room &&
        !merged.has(room) &&
        !merged.has(other) &&
        mergeRooms(grid, variants, room, other, door, Terrain.FLOOR, rng)
      ) {
        if (room.sizeCategory === "normal") merged.set(room, other);
        if (other.sizeCategory === "normal") merged.set(other, room);
        continue;
      }
      if (door.type === "regular") door.type = rng.next() < hiddenDoorChance ? "hidden" : "unlocked";
      const terrain = doorTerrain(door.type);
      setVariant(grid, variants, door.x, door.y, terrain, rng);
      protectedCells.add(grid.cell(door.x, door.y));
    }
  }
}

function mergeRooms(
  grid: Grid,
  variants: Map<number, number>,
  room: RegularRoom,
  other: RegularRoom,
  start: Point,
  terrain: Terrain,
  rng: RNG,
): boolean {
  const intersect = intersectRooms(room, other);
  if (!intersect) return false;
  if (intersect.left === intersect.right) {
    let top = start.y;
    let bottom = start.y;
    while (top > intersect.top && canMergeAt(grid, room, other, { x: intersect.left, y: top - 1 })) top--;
    while (bottom < intersect.bottom && canMergeAt(grid, room, other, { x: intersect.left, y: bottom + 1 })) bottom++;
    if (bottom - top >= 3) {
      fillRect(grid, variants, intersect.left, top + 1, 1, bottom - top, terrain, rng);
      return true;
    }
  } else if (intersect.top === intersect.bottom) {
    let left = start.x;
    let right = start.x;
    while (left > intersect.left && canMergeAt(grid, room, other, { x: left - 1, y: intersect.top })) left--;
    while (right < intersect.right && canMergeAt(grid, room, other, { x: right + 1, y: intersect.top })) right++;
    if (right - left >= 3) {
      fillRect(grid, variants, left + 1, intersect.top, right - left, 1, terrain, rng);
      return true;
    }
  }
  return false;
}

function canMergeAt(grid: Grid, room: RegularRoom, other: RegularRoom, p: Point): boolean {
  const terrainAtInside = (target: RegularRoom, point: Point) => {
    const inside = target.pointInside(point, 1);
    const terrain = grid.get(grid.cell(inside.x, inside.y));
    return terrain !== Terrain.WALL && terrain !== Terrain.WALL_DECO && terrain !== Terrain.WATER;
  };
  return room.canMerge(other, p, terrainAtInside) && other.canMerge(room, p, terrainAtInside);
}

function paintWater(
  grid: Grid,
  variants: Map<number, number>,
  rooms: RegularRoom[],
  protectedCells: Set<number>,
  plan: RegularLevelPlan,
  rng: RNG,
): void {
  if (plan.painter.waterFill <= 0) return;
  const lake = generateSpdPatch(grid.width, grid.height, plan.painter.waterFill, plan.painter.waterSmoothness, true, rng);
  for (const room of rooms) {
    for (const p of room.getPoints()) {
      const cell = grid.cell(p.x, p.y);
      if (!protectedCells.has(cell) && lake[cell] && grid.get(cell) === Terrain.FLOOR && room.canPlaceWater(p)) {
        setVariant(grid, variants, p.x, p.y, Terrain.WATER, rng);
      }
    }
  }
}

function paintGrass(
  grid: Grid,
  variants: Map<number, number>,
  rooms: RegularRoom[],
  protectedCells: Set<number>,
  plan: RegularLevelPlan,
  rng: RNG,
): void {
  if (plan.painter.grassFill <= 0) return;
  const grass = generateSpdPatch(grid.width, grid.height, plan.painter.grassFill, plan.painter.grassSmoothness, true, rng);
  for (const room of rooms) {
    for (const p of room.getPoints()) {
      const cell = grid.cell(p.x, p.y);
      if (!protectedCells.has(cell) && grass[cell] && grid.get(cell) === Terrain.FLOOR && room.canPlaceGrass(p)) {
        setVariant(grid, variants, p.x, p.y, Terrain.GRASS, rng);
      }
    }
  }
}

function placeTraps(
  grid: Grid,
  rooms: RegularRoom[],
  plan: RegularLevelPlan,
  rng: RNG,
  protectedCells: Set<number>,
): GeneratedTrapMetadata[] {
  const valid: number[] = [];
  for (const room of rooms) {
    for (const p of room.getPoints()) {
      const cell = grid.cell(p.x, p.y);
      if (!protectedCells.has(cell) && grid.get(cell) === Terrain.FLOOR && room.canPlaceTrap(p)) valid.push(cell);
    }
  }
  rng.shuffle(valid);
  const count = Math.min(plan.painter.trapCount, Math.floor(valid.length / 5));
  const traps: GeneratedTrapMetadata[] = [];
  for (let i = 0; i < count; i++) {
    const cell = valid.pop();
    if (cell === undefined) break;
    const visible = false;
    grid.set(cell, visible ? Terrain.TRAP : Terrain.SECRET_TRAP);
    protectedCells.add(cell);
    traps.push({ cell, kind: rng.pick(plan.painter.trapKinds), visible, active: true });
  }
  return traps;
}

function decorateSewer(grid: Grid, variants: Map<number, number>, rng: RNG): void {
  for (let x = 0; x < grid.width; x++) {
    const cell = grid.cell(x, 0);
    if (grid.get(cell) === Terrain.WALL && grid.get(cell + grid.width) === Terrain.WATER && rng.nextInt(4) === 0) {
      grid.set(cell, Terrain.WALL_DECO);
    }
  }
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cell(x, y);
      if (grid.get(cell) === Terrain.WALL && grid.get(cell - grid.width) === Terrain.WALL && grid.get(cell + grid.width) === Terrain.WATER && rng.nextInt(2) === 0) {
        grid.set(cell, Terrain.WALL_DECO);
      }
    }
  }
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      const cell = grid.cell(x, y);
      if (grid.get(cell) !== Terrain.FLOOR) continue;
      const count =
        (grid.get(cell + 1) === Terrain.WALL ? 1 : 0) +
        (grid.get(cell - 1) === Terrain.WALL ? 1 : 0) +
        (grid.get(cell + grid.width) === Terrain.WALL ? 1 : 0) +
        (grid.get(cell - grid.width) === Terrain.WALL ? 1 : 0);
      if (rng.nextInt(16) < count * count) setCell(grid, variants, cell, Terrain.EMPTY_SP, rng);
    }
  }
}

function stairCell(
  grid: Grid,
  room: RegularRoom,
  rng: RNG,
  protectedCells: ReadonlySet<number>,
  margin: number,
): number {
  const candidates = innerCells(grid, room, margin)
    .filter((cell) => grid.isWalkable(cell) && !protectedCells.has(cell));
  if (candidates.length > 0) return rng.pick(candidates);
  return grid.cell(room.centerX, room.centerY);
}

function generateGroundItems(
  grid: Grid,
  rng: RNG,
  entrance: number,
  exit: number,
  loot: LootGenerationOptions,
  protectedCells: ReadonlySet<number>,
  rooms: RegularRoom[],
): GeneratedGroundItem[] {
  const itemIds = loot.itemIds ?? [];
  const guaranteedItemIds = loot.guaranteedItemIds ?? [];
  const randomCount = itemIds.length > 0 ? Math.max(0, Math.floor(loot.itemCount ?? rng.range(2, 4))) : 0;
  if (guaranteedItemIds.length === 0 && randomCount === 0) return [];
  const candidates = rooms
    .filter((room) => room.role === "standard" || room.role === "special")
    .flatMap((room) => innerCells(grid, room, 1).filter((cell) =>
      cell !== entrance &&
      cell !== exit &&
      !protectedCells.has(cell) &&
      grid.isWalkable(cell) &&
      room.canPlaceItem({ x: grid.xOf(cell), y: grid.yOf(cell) })
    ));
  rng.shuffle(candidates);
  const out: GeneratedGroundItem[] = [];
  const place = (itemId: string) => {
    const cell = candidates.pop();
    if (cell !== undefined) out.push({ cell, itemId });
  };
  for (const itemId of guaranteedItemIds) place(itemId);
  for (let i = 0; i < randomCount; i++) place(rng.pick(itemIds));
  return out;
}

function roomMetadata(rooms: RegularRoom[], plan: RegularLevelPlan): GeneratedRoomMetadata[] {
  return rooms.filter((room) => room.rect !== null).map((room) => {
    const markers: string[] = [];
    if (room.id === "goo") markers.push("spawn:goo");
    if (room.family === "ratKing") markers.push("spawn:ratKing");
    if (plan.levelKind === "sewerBoss" && room.family === "bossExit") markers.push("lockedExit");
    return {
      id: room.id,
      role: room.role,
      family: room.family,
      sizeCategory: room.sizeCategory,
      rect: { x: room.rect!.x, y: room.rect!.y, w: room.rect!.w, h: room.rect!.h },
      connections: room.connectedRooms.map((connected) => connected.id),
      className: room.className,
      markers,
    };
  });
}

function doorTerrain(type: string): Terrain {
  switch (type) {
    case "water": return Terrain.WATER;
    case "hidden": return Terrain.SECRET_DOOR;
    case "locked": return Terrain.DOOR;
    case "wall": return Terrain.WALL;
    case "empty": return Terrain.FLOOR;
    case "tunnel": return Terrain.EMPTY_SP;
    default: return Terrain.DOOR;
  }
}

function innerCells(grid: Grid, room: RegularRoom, margin: number): number[] {
  const cells: number[] = [];
  for (let y = room.top + margin; y <= room.bottom - margin; y++) {
    for (let x = room.left + margin; x <= room.right - margin; x++) {
      if (grid.inBounds(x, y)) cells.push(grid.cell(x, y));
    }
  }
  return cells;
}

function fillRoom(
  grid: Grid,
  variants: Map<number, number>,
  room: RegularRoom,
  terrain: Terrain,
  rng: RNG,
  margin = 0,
): void {
  fillRect(grid, variants, room.left + margin, room.top + margin, room.width - 2 * margin, room.height - 2 * margin, terrain, rng);
}

function fillRect(
  grid: Grid,
  variants: Map<number, number>,
  x: number,
  y: number,
  w: number,
  h: number,
  terrain: Terrain,
  rng: RNG,
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setVariant(grid, variants, xx, yy, terrain, rng);
  }
}

function setVariant(grid: Grid, variants: Map<number, number>, x: number, y: number, terrain: Terrain, rng: RNG): void {
  if (!grid.inBounds(x, y)) return;
  const cell = grid.cell(x, y);
  setCell(grid, variants, cell, terrain, rng);
}

function setCell(grid: Grid, variants: Map<number, number>, cell: number, terrain: Terrain, rng: RNG): void {
  grid.set(cell, terrain);
  if (terrain !== Terrain.WALL && terrain !== Terrain.WALL_DECO && terrain !== Terrain.EMPTY && terrain !== Terrain.CHASM) {
    variants.set(cell, rng.pick([0, 1, 2]));
  }
}

function drawLine(grid: Grid, variants: Map<number, number>, from: Point, to: Point, terrain: Terrain, rng: RNG): void {
  let x = from.x;
  let y = from.y;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  while (x !== to.x || y !== to.y) {
    setVariant(grid, variants, x, y, terrain, rng);
    if (x !== to.x) x += dx;
    if (y !== to.y) y += dy;
  }
  setVariant(grid, variants, to.x, to.y, terrain, rng);
}

function drawInside(grid: Grid, variants: Map<number, number>, room: RegularRoom, door: Point, length: number, terrain: Terrain, rng: RNG): void {
  const dir = door.x === room.left ? { x: 1, y: 0 } :
    door.x === room.right ? { x: -1, y: 0 } :
      door.y === room.top ? { x: 0, y: 1 } : { x: 0, y: -1 };
  let p = { ...door };
  for (let i = 0; i < length; i++) {
    setVariant(grid, variants, p.x, p.y, terrain, rng);
    p = { x: p.x + dir.x, y: p.y + dir.y };
  }
}

function fillEllipse(grid: Grid, variants: Map<number, number>, room: RegularRoom, margin: number, terrain: Terrain, rng: RNG): void {
  const cx = (room.left + room.right) / 2;
  const cy = (room.top + room.bottom) / 2;
  const rx = Math.max(1, (room.width - 2 * margin) / 2);
  const ry = Math.max(1, (room.height - 2 * margin) / 2);
  for (let y = room.top + margin; y <= room.bottom - margin; y++) {
    for (let x = room.left + margin; x <= room.right - margin; x++) {
      if (((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1) setVariant(grid, variants, x, y, terrain, rng);
    }
  }
}

function fillDiamond(grid: Grid, variants: Map<number, number>, room: RegularRoom, margin: number, terrain: Terrain, rng: RNG): void {
  const cx = (room.left + room.right) / 2;
  const cy = (room.top + room.bottom) / 2;
  const radius = Math.max(1, Math.min(room.width, room.height) / 2 - margin);
  for (let y = room.top + margin; y <= room.bottom - margin; y++) {
    for (let x = room.left + margin; x <= room.right - margin; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= radius) setVariant(grid, variants, x, y, terrain, rng);
    }
  }
}

function fillPerimeterPaths(grid: Grid, variants: Map<number, number>, room: RegularRoom, terrain: Terrain, rng: RNG): void {
  fillRect(grid, variants, room.left + 1, room.top + 1, room.width - 2, 1, terrain, rng);
  fillRect(grid, variants, room.left + 1, room.bottom - 1, room.width - 2, 1, terrain, rng);
  fillRect(grid, variants, room.left + 1, room.top + 1, 1, room.height - 2, terrain, rng);
  fillRect(grid, variants, room.right - 1, room.top + 1, 1, room.height - 2, terrain, rng);
}

function pointInsideByTwo(room: RegularRoom, door: Point): Point {
  if (door.x === room.left) return { x: door.x + 2, y: door.y };
  if (door.x === room.right) return { x: door.x - 2, y: door.y };
  if (door.y === room.top) return { x: door.x, y: door.y + 2 };
  return { x: door.x, y: door.y - 2 };
}

function doorCenter(room: RegularRoom, doors: RegularDoor[], rng: RNG): Point {
  const sum = doors.reduce((acc, door) => ({ x: acc.x + door.x, y: acc.y + door.y }), { x: 0, y: 0 });
  let x = Math.floor(sum.x / doors.length);
  let y = Math.floor(sum.y / doors.length);
  if (rng.next() < (sum.x / doors.length) % 1) x++;
  if (rng.next() < (sum.y / doors.length) % 1) y++;
  return {
    x: Math.max(room.left + 2, Math.min(room.right - 2, x)),
    y: Math.max(room.top + 2, Math.min(room.bottom - 2, y)),
  };
}

function drawPipeToCenter(grid: Grid, variants: Map<number, number>, room: RegularRoom, door: RegularDoor, center: Point, rng: RNG): void {
  const start = pointInsideByTwo(room, door);
  const rightShift = start.x < center.x ? center.x - start.x : start.x > center.x ? center.x - start.x : 0;
  const downShift = start.y < center.y ? center.y - start.y : start.y > center.y ? center.y - start.y : 0;
  if (door.x === room.left || door.x === room.right) {
    const mid = { x: start.x + rightShift, y: start.y };
    drawLine(grid, variants, start, mid, Terrain.WATER, rng);
    drawLine(grid, variants, mid, { x: mid.x, y: mid.y + downShift }, Terrain.WATER, rng);
  } else {
    const mid = { x: start.x, y: start.y + downShift };
    drawLine(grid, variants, start, mid, Terrain.WATER, rng);
    drawLine(grid, variants, mid, { x: mid.x + rightShift, y: mid.y }, Terrain.WATER, rng);
  }
}

function generateSpdPatch(width: number, height: number, fill: number, clustering: number, forceFillRate: boolean, rng: RNG): boolean[] {
  const length = width * height;
  let cur = new Array<boolean>(length).fill(false);
  let off = new Array<boolean>(length).fill(false);
  let fillDiff = -Math.round(length * fill);
  let adjustedFill = fill;
  if (forceFillRate && clustering > 0) adjustedFill += (0.5 - adjustedFill) * 0.5;
  for (let i = 0; i < length; i++) {
    off[i] = rng.next() < adjustedFill;
    if (off[i]) fillDiff++;
  }
  for (let i = 0; i < clustering; i++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = x + y * width;
        let count = 0;
        let neighbours = 0;
        for (let yy = y - 1; yy <= y + 1; yy++) {
          for (let xx = x - 1; xx <= x + 1; xx++) {
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            neighbours++;
            if (off[xx + yy * width]) count++;
          }
        }
        cur[pos] = 2 * count >= neighbours;
        if (cur[pos] !== off[pos]) fillDiff += cur[pos] ? 1 : -1;
      }
    }
    const tmp = cur;
    cur = off;
    off = tmp;
  }
  if (forceFillRate && Math.min(width, height) > 2) {
    const neighbours = [-width - 1, -width, -width + 1, -1, 0, 1, width - 1, width, width + 1];
    const growing = fillDiff < 0;
    while (fillDiff !== 0) {
      let cell = 0;
      let tries = 0;
      do {
        cell = rng.range(1, width - 2) + rng.range(1, height - 2) * width;
        tries++;
      } while (off[cell] !== growing && tries * 10 < length);
      for (const n of neighbours) {
        if (fillDiff !== 0 && off[cell + n] !== growing) {
          off[cell + n] = growing;
          fillDiff += growing ? 1 : -1;
        }
      }
    }
  }
  return off;
}
