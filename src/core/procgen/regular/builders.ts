/*
 * Algorithmic TypeScript port of Shattered Pixel Dungeon's RegularBuilder,
 * LoopBuilder, FigureEightBuilder, and Builder.placeRoom geometry.
 */
import type { RNG } from "@/core/rng/Mulberry32";
import {
  ALL,
  BOTTOM,
  LEFT,
  RegularRoom,
  RIGHT,
  TOP,
  angleBetweenPoints,
  angleBetweenRooms,
  cloneRooms,
  findNeighbours,
  inclusiveIntersects,
  rectOf,
  type InclusiveRect,
  type Point,
} from "./rooms";
import type {
  BuiltRegularLevel,
  RegularBuilderConfig,
  RegularLevelPlan,
  RegularRoomLike,
  RegularRoomSpec,
} from "./types";
import { weightedIndex } from "./plan";

export function buildRegularRoomGraph(plan: RegularLevelPlan, rng: RNG): BuiltRegularLevel | null {
  for (let attempt = 0; attempt < 48; attempt++) {
    const rooms = cloneRooms(plan.rooms);
    const builder = new RegularGraphBuilder(plan.builder, rng);
    const built = plan.builder.kind === "loop"
      ? builder.buildLoop(rooms)
      : builder.buildFigureEight(rooms, plan.rooms.find((room) => room.id === "goo"));
    if (built && isUsableGraph(built, plan.levelKind === "sewerBoss")) return built;
  }
  return null;
}

class RegularGraphBuilder {
  private entrance: RegularRoom | null = null;
  private exit: RegularRoom | null = null;
  private shop: RegularRoom | null = null;
  private mainPathRooms: RegularRoom[] = [];
  private multiConnections: RegularRoom[] = [];
  private singleConnections: RegularRoom[] = [];
  private loopCenter: { x: number; y: number } | null = null;
  private firstLoop: RegularRoom[] = [];
  private secondLoop: RegularRoom[] = [];
  private firstLoopCenter: { x: number; y: number } | null = null;
  private secondLoopCenter: { x: number; y: number } | null = null;

  constructor(
    private readonly config: RegularBuilderConfig,
    private readonly rng: RNG,
  ) {}

  buildLoop(roomList: RegularRoom[]): BuiltRegularLevel | null {
    this.setupRooms(roomList);
    if (!this.entrance) return null;

    this.entrance.setSize(this.rng);
    this.entrance.setPos(0, 0);

    const startAngle = this.rng.next() * 360;
    this.mainPathRooms.unshift(this.entrance);
    if (this.exit) this.mainPathRooms.splice(Math.floor((this.mainPathRooms.length + 1) / 2), 0, this.exit);

    const loop = this.withConnectionRooms(this.mainPathRooms, this.config.pathTunnelChances);
    const placed = [this.entrance];
    let prev = this.entrance;
    for (let i = 1; i < loop.length; i++) {
      const room = loop[i]!;
      const targetAngle = startAngle + this.targetAngle(i / loop.length);
      if (placeRoom(placed, prev, room, targetAngle, this.rng, this.config.pathVariance) === -1) return null;
      if (!placed.includes(room)) placed.push(room);
      prev = room;
    }

    let stitchGuard = 0;
    while (!prev.connect(this.entrance, this.rng)) {
      if (++stitchGuard > 24) return null;
      const c = connectionRoom(`loop:stitch:${stitchGuard}`);
      if (placeRoom(loop, prev, c, angleBetweenRooms(prev, this.entrance), this.rng, 0) === -1) return null;
      loop.push(c);
      placed.push(c);
      prev = c;
    }

    if (this.shop) {
      let angle = -1;
      let tries = 10;
      do {
        angle = placeRoom(loop, this.entrance, this.shop, this.rng.next() * 360, this.rng, 0);
        tries--;
      } while (angle === -1 && tries >= 0);
      if (angle === -1) return null;
      placed.push(this.shop);
    }

    this.loopCenter = centerOf(loop);
    const branchable = this.weightRooms(loop.slice());
    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    if (!this.createBranches(placed, branchable, roomsToBranch, this.config.branchTunnelChances, "loop")) return null;

    this.addExtraConnections(placed);
    return this.finish(placed);
  }

  buildFigureEight(roomList: RegularRoom[], landmarkSpec?: RegularRoomSpec): BuiltRegularLevel | null {
    this.setupRooms(roomList);

    let landmark = landmarkSpec ? roomList.find((room) => room.id === landmarkSpec.id) ?? null : null;
    if (!landmark) landmark = this.pickLandmark();
    if (!landmark) return null;

    removeOnce(this.mainPathRooms, landmark);
    removeOnce(this.multiConnections, landmark);

    const startAngle = this.rng.next() * 360;
    let roomsOnFirstLoop = Math.floor(this.mainPathRooms.length / 2);
    if (this.mainPathRooms.length % 2 === 1) roomsOnFirstLoop += this.rng.nextInt(2);

    const roomsToLoop = this.mainPathRooms.slice();
    const firstTemp = [landmark, ...roomsToLoop.splice(0, roomsOnFirstLoop)];
    if (this.entrance) firstTemp.splice(Math.floor((firstTemp.length + 1) / 2), 0, this.entrance);
    const secondTemp = [landmark, ...roomsToLoop];
    if (this.exit) secondTemp.splice(Math.floor((secondTemp.length + 1) / 2), 0, this.exit);

    landmark.setSize(this.rng);
    landmark.setPos(0, 0);
    const placed = [landmark];
    this.firstLoop = this.placeLoopArm(placed, firstTemp, startAngle, landmark, "first") ?? [];
    if (this.firstLoop.length === 0) return null;
    this.secondLoop = this.placeLoopArm(placed, secondTemp, startAngle + 180, landmark, "second") ?? [];
    if (this.secondLoop.length === 0) return null;

    if (this.shop && this.entrance) {
      let angle = -1;
      let tries = 10;
      do {
        angle = placeRoom(placed, this.entrance, this.shop, this.rng.next() * 360, this.rng, 0);
        tries--;
      } while (angle === -1 && tries >= 0);
      if (angle === -1) return null;
      placed.push(this.shop);
    }

    this.firstLoopCenter = centerOf(this.firstLoop);
    this.secondLoopCenter = centerOf(this.secondLoop);
    const branchable = this.weightRooms([...this.firstLoop, ...this.secondLoop.filter((room) => room !== landmark)]);
    const roomsToBranch = [...this.multiConnections, ...this.singleConnections];
    if (!this.createBranches(placed, branchable, roomsToBranch, this.config.branchTunnelChances, "figure")) return null;

    this.addExtraConnections(placed);
    return this.finish(placed);
  }

  private setupRooms(rooms: RegularRoom[]): void {
    for (const room of rooms) room.setEmpty();
    this.entrance = null;
    this.exit = null;
    this.shop = null;
    this.mainPathRooms = [];
    this.singleConnections = [];
    this.multiConnections = [];
    this.loopCenter = null;
    this.firstLoop = [];
    this.secondLoop = [];
    for (const room of rooms) {
      if (room.isEntrance()) this.entrance = room;
      else if (room.isExit()) this.exit = room;
      else if (room.role === "shop" && room.maxConnections(ALL) === 1) this.shop = room;
      else if (room.maxConnections(ALL) > 1) this.multiConnections.push(room);
      else if (room.maxConnections(ALL) === 1) this.singleConnections.push(room);
    }

    this.multiConnections = uniqueRooms(this.rng.shuffle(this.weightRooms(this.multiConnections)));
    this.rng.shuffle(this.multiConnections);
    let roomsOnMainPath =
      Math.floor(this.multiConnections.length * this.config.pathLength) +
      Math.max(0, weightedIndex(this.rng, this.config.pathLenJitterChances));
    while (roomsOnMainPath > 0 && this.multiConnections.length > 0) {
      const room = this.multiConnections.shift()!;
      roomsOnMainPath -= room.sizeFactor;
      this.mainPathRooms.push(room);
    }
  }

  private pickLandmark(): RegularRoom | null {
    let landmark: RegularRoom | null = null;
    for (const room of this.mainPathRooms) {
      if (room.maxConnections(ALL) >= 4 && (!landmark || landmark.minWidth() * landmark.minHeight() < room.minWidth() * room.minHeight())) {
        landmark = room;
      }
    }
    if (!landmark) landmark = this.mainPathRooms[0] ?? this.multiConnections[0] ?? this.entrance;
    if (landmark && this.multiConnections.length > 0) this.mainPathRooms.push(this.multiConnections.shift()!);
    return landmark;
  }

  private placeLoopArm(
    placed: RegularRoom[],
    pathRooms: RegularRoom[],
    startAngle: number,
    landmark: RegularRoom,
    label: string,
  ): RegularRoom[] | null {
    const loop = this.withConnectionRooms(pathRooms, this.config.pathTunnelChances);
    let prev = landmark;
    for (let i = 1; i < loop.length; i++) {
      const room = loop[i]!;
      const targetAngle = startAngle + this.targetAngle(i / loop.length);
      if (placeRoom(placed, prev, room, targetAngle, this.rng, this.config.pathVariance) === -1) return null;
      if (!placed.includes(room)) placed.push(room);
      prev = room;
    }

    let stitchGuard = 0;
    while (!prev.connect(landmark, this.rng)) {
      if (++stitchGuard > 24) return null;
      const c = connectionRoom(`${label}:stitch:${stitchGuard}`);
      if (placeRoom(placed, prev, c, angleBetweenRooms(prev, landmark), this.rng, 0) === -1) return null;
      loop.push(c);
      placed.push(c);
      prev = c;
    }
    return loop;
  }

  private withConnectionRooms(path: readonly RegularRoom[], tunnelChances: readonly number[]): RegularRoom[] {
    const out: RegularRoom[] = [];
    let pathTunnels = [...tunnelChances];
    let connectionIndex = 0;
    for (const room of path) {
      out.push(room);
      let tunnels = weightedIndex(this.rng, pathTunnels);
      if (tunnels === -1) {
        pathTunnels = [...tunnelChances];
        tunnels = weightedIndex(this.rng, pathTunnels);
      }
      if (tunnels < 0) tunnels = 0;
      pathTunnels[tunnels] = (pathTunnels[tunnels] ?? 0) - 1;
      for (let i = 0; i < tunnels; i++) out.push(connectionRoom(`path:${connectionIndex++}`));
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
    let connectionChances = [...tunnelChances];
    while (index < roomsToBranch.length) {
      if (failedAttempts > 100) return false;
      const target = roomsToBranch[index]!;
      const created: RegularRoom[] = [];
      let current = this.rng.pick(branchable);

      let tunnels = weightedIndex(this.rng, connectionChances);
      if (tunnels === -1) {
        connectionChances = [...tunnelChances];
        tunnels = weightedIndex(this.rng, connectionChances);
      }
      if (tunnels < 0) tunnels = 0;
      connectionChances[tunnels] = (connectionChances[tunnels] ?? 0) - 1;

      let failed = false;
      for (let i = 0; i < tunnels; i++) {
        const connection = connectionRoom(`${label}:branch:${index}:${i}`);
        let tries = 3;
        let angle = -1;
        do {
          angle = placeRoom(placed, current, connection, this.randomBranchAngle(current), this.rng, 0);
          tries--;
        } while (angle === -1 && tries > 0);
        if (angle === -1) {
          failed = true;
          break;
        }
        created.push(connection);
        placed.push(connection);
        current = connection;
      }

      if (!failed) {
        let tries = 10;
        let angle = -1;
        do {
          angle = placeRoom(placed, current, target, this.randomBranchAngle(current), this.rng, 0);
          tries--;
        } while (angle === -1 && tries > 0);
        failed = angle === -1;
      }

      if (failed) {
        target.clearConnections();
        for (const room of created) {
          room.clearConnections();
          removeOnce(placed, room);
        }
        failedAttempts++;
        continue;
      }

      placed.push(target);
      for (const room of created) {
        if (this.rng.nextInt(3) <= 1) branchable.push(room);
      }
      if (target.maxConnections(ALL) > 1 && this.rng.nextInt(3) === 0) {
        if (target.isStandardLike()) {
          for (let i = 0; i < target.connectionWeight; i++) branchable.push(target);
        } else {
          branchable.push(target);
        }
      }
      index++;
    }
    return true;
  }

  private randomBranchAngle(room: RegularRoom): number {
    const center = this.loopCenter ?? (this.firstLoop.includes(room) ? this.firstLoopCenter : this.secondLoopCenter);
    if (!center) return this.rng.next() * 360;
    let toCenter = angleBetweenPoints({ x: (room.left + room.right) / 2, y: (room.top + room.bottom) / 2 }, center);
    if (toCenter < 0) toCenter += 360;
    let current = this.rng.next() * 360;
    for (let i = 0; i < 4; i++) {
      const candidate = this.rng.next() * 360;
      if (Math.abs(toCenter - candidate) < Math.abs(toCenter - current)) current = candidate;
    }
    return current;
  }

  private addExtraConnections(rooms: RegularRoom[]): void {
    findNeighbours(rooms);
    for (const room of rooms) {
      for (const neighbour of room.neighbours) {
        if (!neighbour.connected.has(room) && this.rng.next() < this.config.extraConnectionChance) {
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
      if (!room.isStandardLike()) continue;
      for (let i = 1; i < room.connectionWeight; i++) out.push(room);
    }
    return out;
  }

  private finish(rooms: RegularRoom[]): BuiltRegularLevel | null {
    if (!this.entrance || rooms.length === 0) return null;
    return {
      rooms: uniqueRooms(rooms),
      entrance: this.entrance,
      exit: this.exit ?? this.entrance,
      builderKind: this.config.kind,
    };
  }
}

export function placeRoom(
  collision: readonly RegularRoom[],
  prev: RegularRoom,
  next: RegularRoom,
  angle: number,
  rng: RNG,
  variance = 0,
): number {
  if (!prev.rect) return -1;
  let targetAngle = ((angle % 360) + 360) % 360;
  if (variance > 0) targetAngle += rng.range(-Math.round(variance), Math.round(variance));
  targetAngle = ((targetAngle % 360) + 360) % 360;

  const prevCenter = { x: (prev.left + prev.right) / 2, y: (prev.top + prev.bottom) / 2 };
  const angleScale = 180 / Math.PI;
  const m = Math.tan(targetAngle / angleScale + Math.PI / 2);
  const b = prevCenter.y - m * prevCenter.x;

  let start: Point;
  let direction: number;
  if (Math.abs(m) >= 1) {
    if (targetAngle < 90 || targetAngle > 270) {
      direction = TOP;
      start = { x: Math.round((prev.top - b) / m), y: prev.top };
    } else {
      direction = BOTTOM;
      start = { x: Math.round((prev.bottom - b) / m), y: prev.bottom };
    }
  } else if (targetAngle < 180) {
    direction = RIGHT;
    start = { x: prev.right, y: Math.round(m * prev.right + b) };
  } else {
    direction = LEFT;
    start = { x: prev.left, y: Math.round(m * prev.left + b) };
  }

  if (direction === TOP || direction === BOTTOM) {
    start.x = gate(prev.left + 1, start.x, prev.right - 1);
  } else {
    start.y = gate(prev.top + 1, start.y, prev.bottom - 1);
  }

  const space = findFreeSpace(start, collision, Math.max(next.maxWidth(), next.maxHeight()), rng);
  if (!next.setSizeWithLimit(widthOf(space), heightOf(space), rng)) return -1;

  if (direction === TOP) {
    const targetCenterY = prev.top - (next.height - 1) / 2;
    const targetCenterX = (targetCenterY - b) / m;
    next.setPos(Math.round(targetCenterX - (next.width - 1) / 2), prev.top - (next.height - 1));
  } else if (direction === BOTTOM) {
    const targetCenterY = prev.bottom + (next.height - 1) / 2;
    const targetCenterX = (targetCenterY - b) / m;
    next.setPos(Math.round(targetCenterX - (next.width - 1) / 2), prev.bottom);
  } else if (direction === RIGHT) {
    const targetCenterX = prev.right + (next.width - 1) / 2;
    const targetCenterY = m * targetCenterX + b;
    next.setPos(prev.right, Math.round(targetCenterY - (next.height - 1) / 2));
  } else {
    const targetCenterX = prev.left - (next.width - 1) / 2;
    const targetCenterY = m * targetCenterX + b;
    next.setPos(prev.left - (next.width - 1), Math.round(targetCenterY - (next.height - 1) / 2));
  }

  if (direction === TOP || direction === BOTTOM) {
    if (next.right < prev.left + 2) next.shift(prev.left + 2 - next.right, 0);
    else if (next.left > prev.right - 2) next.shift(prev.right - 2 - next.left, 0);
    if (next.right > space.right) next.shift(space.right - next.right, 0);
    else if (next.left < space.left) next.shift(space.left - next.left, 0);
  } else {
    if (next.bottom < prev.top + 2) next.shift(0, prev.top + 2 - next.bottom);
    else if (next.top > prev.bottom - 2) next.shift(0, prev.bottom - 2 - next.top);
    if (next.bottom > space.bottom) next.shift(0, space.bottom - next.bottom);
    else if (next.top < space.top) next.shift(0, space.top - next.top);
  }

  return next.connect(prev, rng) ? angleBetweenRooms(prev, next) : -1;
}

function findFreeSpace(start: Point, collision: readonly RegularRoom[], maxSize: number, rng: RNG): InclusiveRect {
  const space = { left: start.x - maxSize, top: start.y - maxSize, right: start.x + maxSize, bottom: start.y + maxSize };
  const colliding = collision.filter((room) => room.rect);
  while (colliding.length > 0) {
    for (let i = colliding.length - 1; i >= 0; i--) {
      const room = colliding[i]!;
      if (!inclusiveIntersects(space, rectOf(room))) colliding.splice(i, 1);
    }

    let closestRoom: RegularRoom | null = null;
    let closestDiff = Number.POSITIVE_INFINITY;
    for (const room of colliding) {
      let inside = true;
      let diff = 0;
      if (start.x <= room.left) {
        inside = false;
        diff += room.left - start.x;
      } else if (start.x >= room.right) {
        inside = false;
        diff += start.x - room.right;
      }
      if (start.y <= room.top) {
        inside = false;
        diff += room.top - start.y;
      } else if (start.y >= room.bottom) {
        inside = false;
        diff += start.y - room.bottom;
      }
      if (inside) return { left: start.x, top: start.y, right: start.x, bottom: start.y };
      if (diff < closestDiff) {
        closestDiff = diff;
        closestRoom = room;
      }
    }

    if (!closestRoom) break;
    let wDiff = Number.POSITIVE_INFINITY;
    if (closestRoom.left >= start.x) wDiff = (space.right - closestRoom.left) * (heightOf(space) + 1);
    else if (closestRoom.right <= start.x) wDiff = (closestRoom.right - space.left) * (heightOf(space) + 1);
    let hDiff = Number.POSITIVE_INFINITY;
    if (closestRoom.top >= start.y) hDiff = (space.bottom - closestRoom.top) * (widthOf(space) + 1);
    else if (closestRoom.bottom <= start.y) hDiff = (closestRoom.bottom - space.top) * (widthOf(space) + 1);

    if (wDiff < hDiff || (wDiff === hDiff && rng.nextInt(2) === 0)) {
      if (closestRoom.left >= start.x && closestRoom.left < space.right) space.right = closestRoom.left;
      if (closestRoom.right <= start.x && closestRoom.right > space.left) space.left = closestRoom.right;
    } else {
      if (closestRoom.top >= start.y && closestRoom.top < space.bottom) space.bottom = closestRoom.top;
      if (closestRoom.bottom <= start.y && closestRoom.bottom > space.top) space.top = closestRoom.bottom;
    }
    removeOnce(colliding, closestRoom);
  }
  return space;
}

function connectionRoom(id: string): RegularRoom {
  const spec: RegularRoomSpec = {
    id: `connection:${id}`,
    role: "connection",
    family: "connection",
    sizeCategory: "normal",
    className: "ConnectionRoom",
  };
  const room = new RegularRoom(spec);
  return room;
}

function centerOf(rooms: readonly RegularRoom[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const room of rooms) {
    if (!room.rect) continue;
    x += (room.left + room.right) / 2;
    y += (room.top + room.bottom) / 2;
    count++;
  }
  return count === 0 ? { x: 0, y: 0 } : { x: x / count, y: y / count };
}

function widthOf(rect: InclusiveRect): number {
  return rect.right - rect.left + 1;
}

function heightOf(rect: InclusiveRect): number {
  return rect.bottom - rect.top + 1;
}

function gate(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueRooms(rooms: RegularRoom[]): RegularRoom[] {
  return [...new Set(rooms)];
}

function removeOnce<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}

function isUsableGraph(built: BuiltRegularLevel, boss: boolean): boolean {
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
  if (!boss && built.exit.connectedRooms.length === 0) return false;
  const edgeCount = new Set(
    rooms.flatMap((room) => room.connectedRooms.map((next) => [room.id, next.id].sort().join(":"))),
  ).size;
  return boss ? edgeCount >= rooms.length - 1 : edgeCount >= rooms.length;
}
