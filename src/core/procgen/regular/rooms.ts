/*
 * Algorithmic TypeScript port of Shattered Pixel Dungeon regular room
 * geometry. Coordinates in this class use SPD's inclusive right/bottom room
 * edges; public Level rooms are converted back to the engine's half-open Rect.
 */
import { Rect } from "@/core/grid/Rect";
import type { RNG } from "@/core/rng/Mulberry32";
import type {
  RegularRoomLike,
  RegularRoomSpec,
  RoomFamily,
  RoomRole,
  SizeCategory,
} from "./types";

export type DoorType =
  | "empty"
  | "tunnel"
  | "water"
  | "regular"
  | "unlocked"
  | "hidden"
  | "barricade"
  | "locked"
  | "crystal"
  | "wall";

export interface RegularDoor {
  x: number;
  y: number;
  type: DoorType;
  locked?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface InclusiveRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const ALL = 0;
export const LEFT = 1;
export const TOP = 2;
export const RIGHT = 3;
export const BOTTOM = 4;

const SIZE_CATEGORY: Record<SizeCategory, { min: number; max: number; value: number }> = {
  normal: { min: 4, max: 10, value: 1 },
  large: { min: 10, max: 14, value: 2 },
  giant: { min: 14, max: 18, value: 3 },
};

const FAMILY_CLASS: Record<RoomFamily, string> = {
  empty: "EmptyRoom",
  sewerPipe: "SewerPipeRoom",
  ring: "RingRoom",
  waterBridge: "WaterBridgeRoom",
  regionDecoPatch: "RegionDecoPatchRoom",
  circleBasin: "CircleBasinRoom",
  safeSpecial: "SafeSpecialRoom",
  safeSecret: "SafeSecretRoom",
  connection: "ConnectionRoom",
  bossEntrance: "SewerBossEntranceRoom",
  bossExit: "SewerBossExitRoom",
  gooDiamond: "DiamondGooRoom",
  gooWalled: "WalledGooRoom",
  gooThinPillars: "ThinPillarsGooRoom",
  gooThickPillars: "ThickPillarsGooRoom",
  ratKing: "RatKingRoom",
};

export class RegularRoom implements RegularRoomLike {
  readonly id: string;
  readonly role: RoomRole;
  readonly family: RoomFamily;
  sizeCategory: SizeCategory;
  readonly className: string;
  rect: Rect | null = null;
  readonly neighbours = new Set<RegularRoom>();
  readonly connected = new Map<RegularRoom, RegularDoor | null>();

  constructor(spec: RegularRoomSpec) {
    this.id = spec.id;
    this.role = spec.role;
    this.family = spec.family;
    this.sizeCategory = spec.sizeCategory;
    this.className = spec.className ?? FAMILY_CLASS[spec.family];
  }

  get connectedRooms(): RegularRoom[] {
    return [...this.connected.keys()];
  }

  get left(): number {
    return this.rect?.x ?? 0;
  }

  get top(): number {
    return this.rect?.y ?? 0;
  }

  get right(): number {
    return this.rect ? this.rect.right - 1 : 0;
  }

  get bottom(): number {
    return this.rect ? this.rect.bottom - 1 : 0;
  }

  get width(): number {
    return this.rect?.w ?? 0;
  }

  get height(): number {
    return this.rect?.h ?? 0;
  }

  get centerX(): number {
    return Math.floor((this.left + this.right) / 2);
  }

  get centerY(): number {
    return Math.floor((this.top + this.bottom) / 2);
  }

  get sizeFactor(): number {
    return SIZE_CATEGORY[this.sizeCategory].value;
  }

  get connectionWeight(): number {
    return this.role === "standard" || this.isEntrance() || this.isExit()
      ? this.sizeFactor * this.sizeFactor
      : 1;
  }

  setEmpty(): void {
    this.rect = null;
    this.clearConnections();
  }

  isEntrance(): boolean {
    return this.role === "entrance";
  }

  isExit(): boolean {
    return this.role === "exit";
  }

  isStandardLike(): boolean {
    return this.role === "standard" || this.role === "entrance" || this.role === "exit";
  }

  minWidth(): number {
    let min = SIZE_CATEGORY[this.sizeCategory].min;
    if (this.isEntrance() || this.isExit()) min = Math.max(min, 5);
    if (this.family === "sewerPipe" || this.family === "ring") min = Math.max(min, 7);
    if (this.family === "waterBridge" || this.family === "regionDecoPatch") min = Math.max(min, 5);
    if (this.family === "circleBasin") min = SIZE_CATEGORY[this.sizeCategory].min + 1;
    if (this.family === "bossEntrance") min = Math.max(min, 7);
    if (this.family === "bossExit") min = Math.max(min, 8);
    if (this.role === "connection") min = 4;
    return min;
  }

  maxWidth(): number {
    if (this.role === "connection") return 4;
    return SIZE_CATEGORY[this.sizeCategory].max;
  }

  minHeight(): number {
    let min = SIZE_CATEGORY[this.sizeCategory].min;
    if (this.isEntrance() || this.isExit()) min = Math.max(min, 5);
    if (this.family === "sewerPipe" || this.family === "ring") min = Math.max(min, 7);
    if (this.family === "waterBridge" || this.family === "regionDecoPatch") min = Math.max(min, 5);
    if (this.family === "circleBasin") min = SIZE_CATEGORY[this.sizeCategory].min + 1;
    if (this.family === "bossEntrance") min = Math.max(min, 7);
    if (this.family === "bossExit") min = Math.max(min, 8);
    if (this.role === "connection") min = 4;
    return min;
  }

  maxHeight(): number {
    if (this.role === "connection") return 4;
    return SIZE_CATEGORY[this.sizeCategory].max;
  }

  maxConnections(direction = ALL): number {
    if (direction !== ALL) return this.role === "connection" ? 2 : 4;
    if (this.role === "special" || this.role === "secret" || this.role === "shop") return 1;
    if (this.role === "connection") return 2;
    if (this.family === "gooDiamond" || this.family === "gooWalled" || this.family === "gooThinPillars" || this.family === "gooThickPillars") return 16;
    return 16;
  }

  curConnections(direction = ALL): number {
    if (direction === ALL) return this.connected.size;
    let total = 0;
    for (const other of this.connected.keys()) {
      const i = intersectRooms(this, other);
      if (!i) continue;
      if (direction === LEFT && i.left === this.left && i.right === this.left) total++;
      else if (direction === TOP && i.top === this.top && i.bottom === this.top) total++;
      else if (direction === RIGHT && i.left === this.right && i.right === this.right) total++;
      else if (direction === BOTTOM && i.top === this.bottom && i.bottom === this.bottom) total++;
    }
    return total;
  }

  remConnections(direction = ALL): number {
    if (this.curConnections(ALL) >= this.maxConnections(ALL)) return 0;
    return this.maxConnections(direction) - this.curConnections(direction);
  }

  setSize(rng: RNG): boolean {
    return this.setSizeRange(this.minWidth(), this.maxWidth(), this.minHeight(), this.maxHeight(), rng);
  }

  forceSize(width: number, height: number): void {
    this.rect = new Rect(0, 0, width, height);
    this.normalizeShape();
  }

  setSizeWithLimit(width: number, height: number, rng: RNG): boolean {
    if (width < this.minWidth() || height < this.minHeight()) return false;
    if (!this.setSize(rng)) return false;
    if (!this.rect) return false;
    this.rect = new Rect(0, 0, Math.min(this.width, width), Math.min(this.height, height));
    this.normalizeShape();
    return true;
  }

  private setSizeRange(minW: number, maxW: number, minH: number, maxH: number, rng: RNG): boolean {
    if (
      minW < this.minWidth() ||
      maxW > this.maxWidth() ||
      minH < this.minHeight() ||
      maxH > this.maxHeight() ||
      minW > maxW ||
      minH > maxH
    ) return false;
    this.rect = new Rect(0, 0, normalIntRange(rng, minW, maxW), normalIntRange(rng, minH, maxH));
    this.normalizeShape();
    return true;
  }

  private normalizeShape(): void {
    if (!this.rect) return;
    if (this.family === "circleBasin") {
      this.rect = new Rect(
        this.rect.x,
        this.rect.y,
        this.rect.w % 2 === 0 ? this.rect.w - 1 : this.rect.w,
        this.rect.h % 2 === 0 ? this.rect.h - 1 : this.rect.h,
      );
    }
  }

  setSizeCat(maxRoomValue?: number, rng?: RNG): boolean {
    if (maxRoomValue === undefined || !rng) return true;
    const allowed = (["normal", "large", "giant"] as const).filter((cat) => SIZE_CATEGORY[cat].value <= maxRoomValue);
    if (allowed.length === 0) return false;
    this.sizeCategory = chooseSizeCategoryForFamily(this.family, rng, allowed);
    return true;
  }

  setPos(x: number, y: number): void {
    if (!this.rect) throw new Error(`Cannot position unsized room ${this.id}`);
    this.rect = new Rect(x, y, this.rect.w, this.rect.h);
  }

  shift(dx: number, dy: number): void {
    if (!this.rect) return;
    this.rect = new Rect(this.rect.x + dx, this.rect.y + dy, this.rect.w, this.rect.h);
  }

  inside(p: Point): boolean {
    return p.x > this.left && p.y > this.top && p.x < this.right && p.y < this.bottom;
  }

  random(rng: RNG, margin = 1): Point {
    return {
      x: rng.range(this.left + margin, this.right - margin),
      y: rng.range(this.top + margin, this.bottom - margin),
    };
  }

  center(rng: RNG): Point {
    return {
      x: Math.floor((this.left + this.right) / 2) + ((this.right - this.left) % 2 === 1 && rng.bool() ? 1 : 0),
      y: Math.floor((this.top + this.bottom) / 2) + ((this.bottom - this.top) % 2 === 1 && rng.bool() ? 1 : 0),
    };
  }

  pointInside(from: Point, n: number): Point {
    const p = { ...from };
    if (from.x === this.left) p.x += n;
    else if (from.x === this.right) p.x -= n;
    else if (from.y === this.top) p.y += n;
    else if (from.y === this.bottom) p.y -= n;
    return p;
  }

  getPoints(): Point[] {
    const out: Point[] = [];
    for (let y = this.top; y <= this.bottom; y++) {
      for (let x = this.left; x <= this.right; x++) out.push({ x, y });
    }
    return out;
  }

  canConnectPoint(p: Point): boolean {
    const onVertical = p.x === this.left || p.x === this.right;
    const onHorizontal = p.y === this.top || p.y === this.bottom;
    if (onVertical === onHorizontal) return false;
    if (this.family === "sewerPipe") {
      return (p.x > this.left + 1 && p.x < this.right - 1) || (p.y > this.top + 1 && p.y < this.bottom - 1);
    }
    return true;
  }

  canConnectDirection(direction: number): boolean {
    return this.remConnections(direction) > 0;
  }

  canConnect(other: RegularRoom): boolean {
    if ((this.isExit() && other.isEntrance()) || (this.isEntrance() && other.isExit())) return false;
    if (this.connected.has(other)) return false;
    if (this.connected.size >= this.maxConnections(ALL) || other.connected.size >= other.maxConnections(ALL)) return false;
    const candidates = doorCandidates(this, other);
    return candidates.length > 0;
  }

  addNeighbour(other: RegularRoom): boolean {
    if (this === other || this.neighbours.has(other)) return this.neighbours.has(other);
    const i = intersectRooms(this, other);
    if (!i) return false;
    if ((i.left === i.right && i.bottom - i.top >= 2) || (i.top === i.bottom && i.right - i.left >= 2)) {
      this.neighbours.add(other);
      other.neighbours.add(this);
      return true;
    }
    return false;
  }

  connect(other: RegularRoom, rng: RNG, type: DoorType = "regular"): boolean {
    if ((!this.neighbours.has(other) && !this.addNeighbour(other)) || !this.canConnect(other)) return false;
    void rng;
    void type;
    this.connected.set(other, null);
    other.connected.set(this, null);
    return true;
  }

  clearConnections(): void {
    for (const room of this.neighbours) room.neighbours.delete(this);
    this.neighbours.clear();
    for (const room of this.connected.keys()) room.connected.delete(this);
    this.connected.clear();
  }

  canMerge(other: RegularRoom, p: Point, terrainAtInside: (room: RegularRoom, p: Point) => boolean): boolean {
    if (this.family === "sewerPipe") return false;
    if (this.isEntrance()) return false;
    if (this.family === "waterBridge") {
      return terrainAtInside(this, p);
    }
    if (this.family === "gooDiamond" || this.family === "gooWalled" || this.family === "gooThinPillars" || this.family === "gooThickPillars") return false;
    void other;
    return terrainAtInside(this, p);
  }

  canPlaceWater(p: Point): boolean {
    void p;
    return this.family !== "sewerPipe" &&
      this.family !== "waterBridge" &&
      this.family !== "gooDiamond" &&
      this.family !== "gooWalled";
  }

  canPlaceGrass(p: Point): boolean {
    void p;
    return true;
  }

  canPlaceTrap(p: Point): boolean {
    void p;
    return !(this.isEntrance());
  }

  canPlaceItem(p: Point): boolean {
    return this.inside(p);
  }

  canPlaceCharacter(p: Point): boolean {
    return this.inside(p);
  }
}

export function cloneRooms(specs: readonly RegularRoomSpec[]): RegularRoom[] {
  return specs.map((spec) => new RegularRoom(spec));
}

export function roomCenter(room: RegularRoom): { x: number; y: number } {
  return { x: (room.left + room.right) / 2, y: (room.top + room.bottom) / 2 };
}

export function angleBetweenRooms(from: RegularRoom, to: RegularRoom): number {
  return angleBetweenPoints(roomCenter(from), roomCenter(to));
}

export function angleBetweenPoints(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const m = (to.y - from.y) / (to.x - from.x);
  let angle = (180 / Math.PI) * (Math.atan(m) + Math.PI / 2);
  if (from.x > to.x) angle -= 180;
  return angle;
}

export function findNeighbours(rooms: readonly RegularRoom[]): void {
  for (let i = 0; i < rooms.length - 1; i++) {
    for (let j = i + 1; j < rooms.length; j++) rooms[i]!.addNeighbour(rooms[j]!);
  }
}

export function doorCandidates(a: RegularRoom, b: RegularRoom): Point[] {
  const i = intersectRooms(a, b);
  if (!i) return [];
  const out: Point[] = [];
  for (let y = i.top; y <= i.bottom; y++) {
    for (let x = i.left; x <= i.right; x++) {
      const p = { x, y };
      if (a.canConnectPoint(p) && b.canConnectPoint(p)) out.push(p);
    }
  }
  if (out.length === 0) return [];
  if (i.left === i.right && i.left === a.left) return a.canConnectDirection(LEFT) && b.canConnectDirection(RIGHT) ? out : [];
  if (i.left === i.right && i.right === a.right) return a.canConnectDirection(RIGHT) && b.canConnectDirection(LEFT) ? out : [];
  if (i.top === i.bottom && i.top === a.top) return a.canConnectDirection(TOP) && b.canConnectDirection(BOTTOM) ? out : [];
  if (i.top === i.bottom && i.bottom === a.bottom) return a.canConnectDirection(BOTTOM) && b.canConnectDirection(TOP) ? out : [];
  return [];
}

export function intersectRooms(a: RegularRoom, b: RegularRoom): InclusiveRect | null {
  if (!a.rect || !b.rect) return null;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (left > right || top > bottom) return null;
  return { left, top, right, bottom };
}

export function inclusiveIntersects(a: InclusiveRect, b: InclusiveRect): boolean {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
    Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}

export function rectOf(room: RegularRoom): InclusiveRect {
  return { left: room.left, top: room.top, right: room.right, bottom: room.bottom };
}

export function chooseSizeCategoryForFamily(
  family: RoomFamily,
  rng: RNG,
  allowed: readonly SizeCategory[] = ["normal", "large", "giant"],
): SizeCategory {
  const weights = sizeWeightsForFamily(family);
  const candidates = allowed.map((cat) => ({ cat, weight: weights[cat] ?? 0 })).filter((entry) => entry.weight > 0);
  if (candidates.length === 0) return allowed[0] ?? "normal";
  let total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of candidates) {
    roll -= entry.weight;
    if (roll < 0) return entry.cat;
  }
  return candidates[candidates.length - 1]!.cat;
}

function sizeWeightsForFamily(family: RoomFamily): Record<SizeCategory, number> {
  if (family === "sewerPipe") return { normal: 3, large: 2, giant: 1 };
  if (family === "ring") return { normal: 9, large: 3, giant: 1 };
  if (family === "circleBasin") return { normal: 0, large: 3, giant: 1 };
  if (family === "gooDiamond" || family === "gooWalled" || family === "gooThinPillars" || family === "gooThickPillars") {
    return { normal: 0, large: 1, giant: 0 };
  }
  return { normal: 1, large: 0, giant: 0 };
}

export function normalIntRange(rng: RNG, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor((rng.next() + rng.next()) * (max - min + 1) / 2);
}
