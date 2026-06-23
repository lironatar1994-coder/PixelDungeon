import type { RNG } from "@/core/rng/Mulberry32";
import {
  RegularRoom,
  angleBetweenRooms,
  cloneRooms,
  directionFromAngle,
  doorCandidates,
  findNeighbours,
  type Direction,
} from "./rooms";
import type {
  BuiltRegularLevel,
  RegularBuilderConfig,
  RegularLevelPlan,
  RegularRoomLike,
  RegularRoomSpec,
} from "./types";
import { weightedIndex } from "./plan";

const FALLBACK_LOOP_ROOM_SIZE = 9;
const FALLBACK_LOOP_STEP = FALLBACK_LOOP_ROOM_SIZE - 1;
const FALLBACK_BRANCH_ROOM_SIZE = 7;

export function buildRegularRoomGraph(plan: RegularLevelPlan, rng: RNG): BuiltRegularLevel | null {
  for (let attempt = 0; attempt < 32; attempt++) {
    const rooms = cloneRooms(plan.rooms);
    const builder = new RegularGraphBuilder(plan.builder, rng);
    const built = plan.builder.kind === "loop"
      ? builder.buildLoop(rooms)
      : builder.buildFigureEight(rooms);
    if (built && isUsableGraph(built)) return built;
  }
  return buildGuaranteedGraph(plan, rng);
}

class RegularGraphBuilder {
  private entrance: RegularRoom | null = null;
  private exit: RegularRoom | null = null;
  private mainPathRooms: RegularRoom[] = [];
  private multiConnections: RegularRoom[] = [];
  private singleConnections: RegularRoom[] = [];
  private firstLoopCenter: { x: number; y: number } | null = null;
  private secondLoopCenter: { x: number; y: number } | null = null;

  constructor(
    private readonly config: RegularBuilderConfig,
    private readonly rng: RNG,
  ) {}

  buildLoop(roomList: RegularRoom[]): BuiltRegularLevel | null {
    this.setupRooms(roomList);
    if (!this.entrance || !this.exit) return null;
    this.entrance.setSize(this.rng);
    this.entrance.setPos(0, 0);

    const startAngle = this.rng.next() * 360;
    this.mainPathRooms.unshift(this.entrance);
    this.mainPathRooms.splice(Math.floor((this.mainPathRooms.length + 1) / 2), 0, this.exit);

    const loop = this.withConnectionRooms(this.mainPathRooms, this.config.pathTunnelChances);
    const placed = [this.entrance];
    let previous = this.entrance;
    for (let i = 1; i < loop.length; i++) {
      const room = loop[i]!;
      const target = startAngle + this.targetAngle(i / loop.length);
      if (this.placeRoom(placed, previous, room, target) === -1) return null;
      if (!placed.includes(room)) placed.push(room);
      previous = room;
    }

    let stitchGuard = 0;
    while (!previous.connect(this.entrance, this.rng)) {
      if (++stitchGuard > 8) return null;
      const connection = connectionRoom(`loop:stitch:${stitchGuard}`);
      const angle = angleBetweenRooms(previous, this.entrance);
      if (this.placeRoom(placed, previous, connection, angle) === -1) return null;
      placed.push(connection);
      loop.push(connection);
      previous = connection;
    }

    this.firstLoopCenter = centerOf(loop);
    const branchable = this.weightRooms(loop.slice());
    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    if (!this.createBranches(placed, branchable, roomsToBranch, this.config.branchTunnelChances, "loop")) {
      return null;
    }

    this.addExtraConnections(placed);
    return this.finish(placed);
  }

  buildFigureEight(roomList: RegularRoom[]): BuiltRegularLevel | null {
    this.setupRooms(roomList);
    if (!this.entrance || !this.exit) return null;

    const landmark = this.pickLandmark();
    if (!landmark) return null;
    removeOnce(this.mainPathRooms, landmark);
    removeOnce(this.multiConnections, landmark);

    const startAngle = this.rng.next() * 360;
    const firstCount = Math.floor(this.mainPathRooms.length / 2) + (this.mainPathRooms.length % 2 === 1 && this.rng.bool() ? 1 : 0);
    const roomsToLoop = this.mainPathRooms.slice();
    const firstTemp = [landmark, ...roomsToLoop.splice(0, firstCount)];
    firstTemp.splice(Math.floor((firstTemp.length + 1) / 2), 0, this.entrance);
    const secondTemp = [landmark, ...roomsToLoop];
    secondTemp.splice(Math.floor((secondTemp.length + 1) / 2), 0, this.exit);

    landmark.setSize(this.rng);
    landmark.setPos(0, 0);
    const placed = [landmark];
    const firstLoop = this.placeLoopArm(placed, firstTemp, startAngle, landmark, "first");
    if (!firstLoop) return null;
    const secondLoop = this.placeLoopArm(placed, secondTemp, startAngle + 180, landmark, "second");
    if (!secondLoop) return null;

    this.firstLoopCenter = centerOf(firstLoop);
    this.secondLoopCenter = centerOf(secondLoop);
    const branchable = this.weightRooms([...firstLoop, ...secondLoop.filter((room) => room !== landmark)]);
    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    if (!this.createBranches(placed, branchable, roomsToBranch, this.config.branchTunnelChances, "figure")) {
      return null;
    }

    this.addExtraConnections(placed);
    return this.finish(placed);
  }

  private setupRooms(rooms: RegularRoom[]): void {
    for (const room of rooms) room.setEmpty();
    this.entrance = rooms.find((room) => room.role === "entrance") ?? null;
    this.exit = rooms.find((room) => room.role === "exit") ?? null;
    this.mainPathRooms = [];
    this.multiConnections = [];
    this.singleConnections = [];
    for (const room of rooms) {
      if (room.role === "entrance" || room.role === "exit") continue;
      if (room.maxConnections > 1) this.multiConnections.push(room);
      else this.singleConnections.push(room);
    }
    this.multiConnections = uniqueRooms(this.rng.shuffle(this.weightRooms(this.multiConnections)));
    this.rng.shuffle(this.multiConnections);

    let roomsOnMainPath =
      Math.floor(this.multiConnections.length * this.config.pathLength) +
      weightedIndex(this.rng, this.config.pathLenJitterChances);
    while (roomsOnMainPath > 0 && this.multiConnections.length > 0) {
      const room = this.multiConnections.shift()!;
      roomsOnMainPath -= room.sizeFactor;
      this.mainPathRooms.push(room);
    }
  }

  private pickLandmark(): RegularRoom | null {
    let best: RegularRoom | null = null;
    for (const room of this.mainPathRooms) {
      if (room.maxConnections >= 4 && (!best || room.sizeFactor > best.sizeFactor)) best = room;
    }
    if (!best) best = this.mainPathRooms[0] ?? this.multiConnections.shift() ?? null;
    if (!best && this.entrance) best = this.entrance;
    if (best && this.multiConnections.length > 0) this.mainPathRooms.push(this.multiConnections.shift()!);
    return best;
  }

  private placeLoopArm(
    placed: RegularRoom[],
    pathRooms: RegularRoom[],
    startAngle: number,
    landmark: RegularRoom,
    label: string,
  ): RegularRoom[] | null {
    const loop = this.withConnectionRooms(pathRooms, this.config.pathTunnelChances);
    let previous = landmark;
    for (let i = 1; i < loop.length; i++) {
      const room = loop[i]!;
      const target = startAngle + this.targetAngle(i / loop.length);
      if (this.placeRoom(placed, previous, room, target) === -1) return null;
      if (!placed.includes(room)) placed.push(room);
      previous = room;
    }

    let stitchGuard = 0;
    while (!previous.connect(landmark, this.rng)) {
      if (++stitchGuard > 8) return null;
      const connection = connectionRoom(`${label}:stitch:${stitchGuard}`);
      const angle = angleBetweenRooms(previous, landmark);
      if (this.placeRoom(placed, previous, connection, angle) === -1) return null;
      placed.push(connection);
      loop.push(connection);
      previous = connection;
    }
    return loop;
  }

  private withConnectionRooms(path: readonly RegularRoom[], tunnelChances: readonly number[]): RegularRoom[] {
    const out: RegularRoom[] = [];
    let connectionIndex = 0;
    for (const room of path) {
      out.push(room);
      const tunnels = Math.max(0, weightedIndex(this.rng, tunnelChances));
      for (let i = 0; i < tunnels; i++) {
        out.push(connectionRoom(`path:${connectionIndex++}`));
      }
    }
    return out;
  }

  private createBranches(
    placed: RegularRoom[],
    branchable: RegularRoom[],
    roomsToBranch: RegularRoom[],
    tunnelChances: readonly number[],
    label: string,
  ): boolean {
    let index = 0;
    let failedAttempts = 0;
    while (index < roomsToBranch.length) {
      if (failedAttempts > 120) return false;
      const target = roomsToBranch[index]!;
      const created: RegularRoom[] = [];
      let current = this.rng.pick(branchable);
      const tunnels = Math.max(0, weightedIndex(this.rng, tunnelChances));
      let failed = false;

      for (let i = 0; i < tunnels; i++) {
        const connection = connectionRoom(`${label}:branch:${index}:${i}`);
        const angle = this.randomBranchAngle(current);
        if (this.placeRoom(placed, current, connection, angle) === -1) {
          failed = true;
          break;
        }
        placed.push(connection);
        created.push(connection);
        current = connection;
      }

      if (!failed && this.placeRoom(placed, current, target, this.randomBranchAngle(current)) !== -1) {
        placed.push(target);
        if (target.maxConnections > 1 && this.rng.nextInt(3) === 0) branchable.push(target);
        for (const connection of created) {
          if (this.rng.nextInt(3) <= 1) branchable.push(connection);
        }
        index++;
      } else {
        for (const room of created) {
          room.clearConnections();
          removeOnce(placed, room);
        }
        target.clearConnections();
        failedAttempts++;
      }
    }
    return true;
  }

  private placeRoom(
    collision: readonly RegularRoom[],
    previous: RegularRoom,
    next: RegularRoom,
    angle: number,
  ): number {
    if (!previous.rect) return -1;
    for (let attempt = 0; attempt < 16; attempt++) {
      if (!next.setSize(this.rng)) return -1;
      const varied = angle + this.rng.range(-Math.round(this.config.pathVariance), Math.round(this.config.pathVariance));
      const direction = directionFromAngle(varied);
      positionAdjacent(previous, next, direction, this.rng);
      if (!next.rect || collides(next, previous, collision)) continue;
      if (next.connect(previous, this.rng)) return angleBetweenRooms(previous, next);
    }
    return -1;
  }

  private randomBranchAngle(room: RegularRoom): number {
    const roomRect = room.rect;
    const center = this.secondLoopCenter && this.firstLoopCenter
      ? nearestLoopCenter(room, this.firstLoopCenter, this.secondLoopCenter)
      : this.firstLoopCenter;
    if (!roomRect || !center) return this.rng.next() * 360;
    const towardCenter = angleBetweenPoint({ x: roomRect.centerX, y: roomRect.centerY }, center);
    let current = this.rng.next() * 360;
    for (let i = 0; i < 4; i++) {
      const candidate = this.rng.next() * 360;
      if (angleDistance(candidate, towardCenter) > angleDistance(current, towardCenter)) {
        current = candidate;
      }
    }
    return current;
  }

  private addExtraConnections(rooms: RegularRoom[]): void {
    findNeighbours(rooms);
    for (const room of rooms) {
      for (const neighbour of room.neighbours) {
        if (!room.connected.has(neighbour) && this.rng.next() < this.config.extraConnectionChance) {
          room.connect(neighbour, this.rng);
        }
      }
    }
  }

  private targetAngle(percentAlong: number): number {
    const x = percentAlong + this.config.curveOffset;
    const curved =
      Math.pow(4, 2 * this.config.curveExponent) *
      Math.pow((x % 0.5) - 0.25, 2 * this.config.curveExponent + 1) +
      0.25 +
      0.5 * Math.floor(2 * x);
    return 360 * (
      this.config.curveIntensity * curved +
      (1 - this.config.curveIntensity) * percentAlong -
      this.config.curveOffset
    );
  }

  private weightRooms(rooms: RegularRoom[]): RegularRoom[] {
    const out = rooms.slice();
    for (const room of rooms) {
      for (let i = 1; i < room.connectionWeight; i++) out.push(room);
    }
    return out;
  }

  private finish(rooms: RegularRoom[]): BuiltRegularLevel | null {
    if (!this.entrance || !this.exit || rooms.length === 0) return null;
    return {
      rooms: uniqueRooms(rooms),
      entrance: this.entrance,
      exit: this.exit,
      builderKind: this.config.kind,
    };
  }
}

function connectionRoom(id: string): RegularRoom {
  const spec: RegularRoomSpec = {
    id: `connection:${id}`,
    role: "connection",
    family: "connection",
    sizeCategory: "normal",
  };
  const room = new RegularRoom(spec);
  room.forceSize(4, 4);
  return room;
}

function positionAdjacent(previous: RegularRoom, next: RegularRoom, direction: Direction, rng: RNG): void {
  if (!previous.rect || !next.rect) return;
  const p = previous.rect;
  const n = next.rect;
  if (direction === "east" || direction === "west") {
    const minY = p.y - n.h + 3;
    const maxY = p.bottom - 3;
    const y = rng.range(minY, maxY);
    next.setPos(direction === "east" ? p.right - 1 : p.x - n.w + 1, y);
  } else {
    const minX = p.x - n.w + 3;
    const maxX = p.right - 3;
    const x = rng.range(minX, maxX);
    next.setPos(x, direction === "south" ? p.bottom - 1 : p.y - n.h + 1);
  }
}

function collides(next: RegularRoom, previous: RegularRoom, rooms: readonly RegularRoom[]): boolean {
  if (!next.rect) return true;
  for (const room of rooms) {
    if (room === previous || room === next || !room.rect) continue;
    if (intersectsWithPadding(next.rect, room.rect, 1)) return true;
  }
  return false;
}

function intersectsWithPadding(
  a: { x: number; y: number; right: number; bottom: number },
  b: { x: number; y: number; right: number; bottom: number },
  padding: number,
): boolean {
  return (
    a.x - padding < b.right &&
    a.right + padding > b.x &&
    a.y - padding < b.bottom &&
    a.bottom + padding > b.y
  );
}

function centerOf(rooms: readonly RegularRoom[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const room of rooms) {
    if (!room.rect) continue;
    x += room.rect.centerX;
    y += room.rect.centerY;
    count++;
  }
  return count === 0 ? { x: 0, y: 0 } : { x: x / count, y: y / count };
}

function nearestLoopCenter(
  room: RegularRoom,
  first: { x: number; y: number },
  second: { x: number; y: number },
): { x: number; y: number } {
  if (!room.rect) return first;
  const point = { x: room.rect.centerX, y: room.rect.centerY };
  return distanceSquared(point, first) <= distanceSquared(point, second) ? first : second;
}

function angleBetweenPoint(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 450) % 360;
}

function angleDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function uniqueRooms(rooms: RegularRoom[]): RegularRoom[] {
  return [...new Set(rooms)];
}

function removeOnce<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}

function buildGuaranteedGraph(plan: RegularLevelPlan, rng: RNG): BuiltRegularLevel | null {
  const rooms = cloneRooms(plan.rooms);
  const entrance = rooms.find((room) => room.role === "entrance") ?? null;
  const exit = rooms.find((room) => room.role === "exit") ?? null;
  if (!entrance || !exit) return null;

  const ordered = [
    entrance,
    ...rooms.filter((room) => room.role === "standard"),
    exit,
  ];
  const branchRooms = rooms.filter((room) =>
    room.role !== "entrance" &&
    room.role !== "exit" &&
    room.role !== "standard"
  );
  let cols = 2;
  let rows = 2;
  while (perimeterCount(cols, rows) < ordered.length) {
    if (cols <= rows) cols++;
    else rows++;
  }
  while (ordered.length < perimeterCount(cols, rows)) {
    ordered.push(connectionRoom(`guaranteed:${ordered.length}`));
  }

  const positions = perimeterPositions(cols, rows);
  for (let i = 0; i < ordered.length; i++) {
    const room = ordered[i]!;
    room.forceSize(FALLBACK_LOOP_ROOM_SIZE, FALLBACK_LOOP_ROOM_SIZE);
    const pos = positions[i]!;
    room.setPos(pos.x * FALLBACK_LOOP_STEP, pos.y * FALLBACK_LOOP_STEP);
  }

  for (let i = 0; i < ordered.length; i++) {
    ordered[i]!.connect(ordered[(i + 1) % ordered.length]!, rng);
  }

  const figureReserved = plan.builder.kind === "figureEight"
    ? new Set<RegularRoom>([entrance, ordered[1]!])
    : new Set<RegularRoom>();
  const branchParents = ordered.filter((room) =>
    room.role !== "connection" && !figureReserved.has(room)
  );
  const fallbackBranchParents = ordered.filter((room) => room.role !== "connection");
  for (let i = 0; i < branchRooms.length; i++) {
    const room = branchRooms[i]!;
    room.forceSize(FALLBACK_BRANCH_ROOM_SIZE, FALLBACK_BRANCH_ROOM_SIZE);
    const parents = rotateRooms(
      branchParents.length > 0 ? branchParents : fallbackBranchParents,
      i,
    );
    if (!placeBranchAdjacent(
      parents.length > 0 ? parents : ordered,
      room,
      [...ordered, ...branchRooms.slice(0, i)],
      rng,
    )) return null;
  }

  if (plan.builder.kind === "figureEight") {
    const branch = connectionRoom("guaranteed:figure-center");
    branch.forceSize(FALLBACK_LOOP_ROOM_SIZE, FALLBACK_LOOP_ROOM_SIZE);
    const base = entrance.rect!;
    const next = ordered[1]!;
    const candidates = [
      { x: base.x + 4, y: base.y - FALLBACK_LOOP_STEP },
      { x: base.x + 4, y: base.bottom - 1 },
    ];
    for (const candidate of candidates) {
      branch.setPos(candidate.x, candidate.y);
      if (collidesWithAnyExcept(branch, [entrance, next], [...ordered, ...branchRooms])) continue;
      branch.connect(entrance, rng);
      branch.connect(next, rng);
      if (branch.connectedRooms.length >= 2) {
        ordered.push(branch);
        break;
      }
      branch.clearConnections();
    }
  }

  return {
    rooms: uniqueRooms([...ordered, ...branchRooms]),
    entrance,
    exit,
    builderKind: plan.builder.kind,
  };
}

function perimeterCount(cols: number, rows: number): number {
  return 2 * cols + 2 * rows;
}

function perimeterPositions(cols: number, rows: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let x = 0; x <= cols; x++) positions.push({ x, y: 0 });
  for (let y = 1; y <= rows; y++) positions.push({ x: cols, y });
  for (let x = cols - 1; x >= 0; x--) positions.push({ x, y: rows });
  for (let y = rows - 1; y >= 1; y--) positions.push({ x: 0, y });
  return positions;
}

function placeBranchAdjacent(
  parents: readonly RegularRoom[],
  room: RegularRoom,
  placed: readonly RegularRoom[],
  rng: RNG,
): boolean {
  if (!room.rect) return false;
  for (const parent of parents) {
    if (!parent.rect) continue;
    for (const candidate of adjacentBranchCandidates(parent, room)) {
      room.clearConnections();
      room.setPos(candidate.x, candidate.y);
      if (collidesWithAnyExcept(room, [parent], placed)) continue;
      if (room.connect(parent, rng)) return true;
    }
  }
  return false;
}

function adjacentBranchCandidates(
  parent: RegularRoom,
  room: RegularRoom,
): Array<{ x: number; y: number }> {
  if (!parent.rect || !room.rect) return [];
  const offsets = [0, -4, 4, -2, 2, -3, 3, -1, 1];
  return [
    ...offsets.map((offset) => ({ x: parent.rect!.x + offset, y: parent.rect!.y - room.rect!.h + 1 })),
    ...offsets.map((offset) => ({ x: parent.rect!.x + offset, y: parent.rect!.bottom - 1 })),
    ...offsets.map((offset) => ({ x: parent.rect!.x - room.rect!.w + 1, y: parent.rect!.y + offset })),
    ...offsets.map((offset) => ({ x: parent.rect!.right - 1, y: parent.rect!.y + offset })),
  ];
}

function collidesWithAnyExcept(
  room: RegularRoom,
  allowed: readonly RegularRoom[],
  rooms: readonly RegularRoom[],
): boolean {
  if (!room.rect) return true;
  for (const other of rooms) {
    if (allowed.includes(other) || !other.rect) continue;
    if (room.rect.intersects(other.rect)) return true;
    if (doorCandidates(room, other).length > 0) return true;
  }
  return false;
}

function rotateRooms(rooms: RegularRoom[], offset: number): RegularRoom[] {
  if (rooms.length === 0) return [];
  const start = offset % rooms.length;
  return [...rooms.slice(start), ...rooms.slice(0, start)];
}

function isUsableGraph(built: BuiltRegularLevel): boolean {
  if (built.entrance.connectedRooms.length < 2 || built.exit.connectedRooms.length < 2) return false;
  const rooms = built.rooms;
  const seen = new Set<RegularRoomLike>([built.entrance]);
  const stack = [built.entrance];
  while (stack.length > 0) {
    const room = stack.pop()!;
    for (const next of room.connectedRooms) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (seen.size !== rooms.length) return false;
  const edgeCount = new Set(
    rooms.flatMap((room) =>
      room.connectedRooms.map((next) => [room.id, next.id].sort().join(":")),
    ),
  ).size;
  if (edgeCount < rooms.length) return false;
  return built.builderKind !== "figureEight" || rooms.some((room) => room.connectedRooms.length >= 3);
}
