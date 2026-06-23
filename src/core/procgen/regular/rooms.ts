import { Rect } from "@/core/grid/Rect";
import type {
  RegularRoomLike,
  RegularRoomSpec,
  RoomFamily,
  RoomRole,
  SizeCategory,
} from "./types";
import type { RNG } from "@/core/rng/Mulberry32";

export type Direction = "north" | "east" | "south" | "west";

export interface RegularDoor {
  x: number;
  y: number;
  type: "regular" | "hidden";
}

const SIZE_CATEGORY: Record<SizeCategory, { min: number; max: number; value: number }> = {
  normal: { min: 4, max: 10, value: 1 },
  large: { min: 10, max: 14, value: 2 },
  giant: { min: 14, max: 18, value: 3 },
};

export class RegularRoom implements RegularRoomLike {
  readonly id: string;
  readonly role: RoomRole;
  readonly family: RoomFamily;
  readonly sizeCategory: SizeCategory;
  rect: Rect | null = null;
  readonly neighbours = new Set<RegularRoom>();
  readonly connected = new Map<RegularRoom, RegularDoor>();

  constructor(spec: RegularRoomSpec) {
    this.id = spec.id;
    this.role = spec.role;
    this.family = spec.family;
    this.sizeCategory = spec.sizeCategory;
  }

  get connectedRooms(): RegularRoom[] {
    return [...this.connected.keys()];
  }

  get sizeFactor(): number {
    return SIZE_CATEGORY[this.sizeCategory].value;
  }

  get connectionWeight(): number {
    return this.role === "standard" ? this.sizeFactor * this.sizeFactor : 1;
  }

  get maxConnections(): number {
    if (this.role === "special" || this.role === "secret" || this.role === "shop") return 1;
    if (this.role === "connection") return 2;
    return 4;
  }

  setEmpty(): void {
    this.rect = null;
    this.neighbours.clear();
    this.connected.clear();
  }

  setSize(rng: RNG, maxWidth = Number.POSITIVE_INFINITY, maxHeight = Number.POSITIVE_INFINITY): boolean {
    const size = SIZE_CATEGORY[this.sizeCategory];
    const maxW = Math.min(size.max, Math.floor(maxWidth));
    const maxH = Math.min(size.max, Math.floor(maxHeight));
    if (maxW < size.min || maxH < size.min) return false;
    const width = rng.range(size.min, maxW);
    const height = rng.range(size.min, maxH);
    this.rect = new Rect(0, 0, width, height);
    return true;
  }

  forceSize(width: number, height: number): void {
    this.rect = new Rect(0, 0, width, height);
  }

  setPos(x: number, y: number): void {
    if (!this.rect) throw new Error(`Cannot position unsized room ${this.id}`);
    this.rect = new Rect(x, y, this.rect.w, this.rect.h);
  }

  shift(dx: number, dy: number): void {
    if (!this.rect) return;
    this.rect = new Rect(this.rect.x + dx, this.rect.y + dy, this.rect.w, this.rect.h);
  }

  addNeighbour(other: RegularRoom): boolean {
    if (this === other || this.neighbours.has(other)) return this.neighbours.has(other);
    if (doorCandidates(this, other).length === 0) return false;
    this.neighbours.add(other);
    other.neighbours.add(this);
    return true;
  }

  canConnect(other: RegularRoom): boolean {
    return (
      this !== other &&
      !this.connected.has(other) &&
      this.connected.size < this.maxConnections &&
      other.connected.size < other.maxConnections &&
      doorCandidates(this, other).length > 0
    );
  }

  connect(other: RegularRoom, rng: RNG, type: RegularDoor["type"] = "regular"): boolean {
    if (!this.neighbours.has(other)) this.addNeighbour(other);
    if (!this.canConnect(other)) return false;
    const candidates = doorCandidates(this, other);
    if (candidates.length === 0) return false;
    const door = { ...rng.pick(candidates), type };
    this.connected.set(other, door);
    other.connected.set(this, door);
    return true;
  }

  clearConnections(): void {
    for (const room of this.neighbours) room.neighbours.delete(this);
    this.neighbours.clear();
    for (const room of this.connected.keys()) room.connected.delete(this);
    this.connected.clear();
  }
}

export function cloneRooms(specs: readonly RegularRoomSpec[]): RegularRoom[] {
  return specs.map((spec) => new RegularRoom(spec));
}

export function roomCenter(room: RegularRoom): { x: number; y: number } {
  if (!room.rect) throw new Error(`Room ${room.id} has no rect`);
  return { x: room.rect.centerX, y: room.rect.centerY };
}

export function angleBetweenRooms(from: RegularRoom, to: RegularRoom): number {
  const a = roomCenter(from);
  const b = roomCenter(to);
  const radians = Math.atan2(b.y - a.y, b.x - a.x);
  return (radians * 180 / Math.PI + 450) % 360;
}

export function findNeighbours(rooms: readonly RegularRoom[]): void {
  for (let i = 0; i < rooms.length - 1; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      rooms[i]!.addNeighbour(rooms[j]!);
    }
  }
}

export function doorCandidates(a: RegularRoom, b: RegularRoom): Array<{ x: number; y: number }> {
  if (!a.rect || !b.rect) return [];
  const ar = a.rect;
  const br = b.rect;
  if (ar.right - 1 === br.x) return verticalDoorCandidates(ar.right - 1, ar, br);
  if (br.right - 1 === ar.x) return verticalDoorCandidates(ar.x, ar, br);
  if (ar.bottom - 1 === br.y) return horizontalDoorCandidates(ar.bottom - 1, ar, br);
  if (br.bottom - 1 === ar.y) return horizontalDoorCandidates(ar.y, ar, br);
  return [];
}

function verticalDoorCandidates(x: number, a: Rect, b: Rect): Array<{ x: number; y: number }> {
  const minY = Math.max(a.y + 1, b.y + 1);
  const maxY = Math.min(a.bottom - 2, b.bottom - 2);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = minY; y <= maxY; y++) out.push({ x, y });
  return out;
}

function horizontalDoorCandidates(y: number, a: Rect, b: Rect): Array<{ x: number; y: number }> {
  const minX = Math.max(a.x + 1, b.x + 1);
  const maxX = Math.min(a.right - 2, b.right - 2);
  const out: Array<{ x: number; y: number }> = [];
  for (let x = minX; x <= maxX; x++) out.push({ x, y });
  return out;
}

export function directionFromAngle(angle: number): Direction {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return "north";
  if (normalized < 135) return "east";
  if (normalized < 225) return "south";
  return "west";
}
