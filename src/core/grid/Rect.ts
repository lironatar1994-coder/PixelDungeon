/**
 * Rect — an axis-aligned rectangle in tile coordinates.
 *
 * A tiny geometry primitive shared by the BSP partitioner (it describes both
 * the partition a node owns and the room carved inside it) and the Level (it
 * remembers each room for later mob/loot placement). Coordinates are in tiles;
 * `right`/`bottom` are exclusive, matching the half-open convention used when
 * looping `for (x = room.x; x < room.right; x++)`.
 */
export class Rect {
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
  ) {}

  /** Exclusive right edge (x + w). */
  get right(): number {
    return this.x + this.w;
  }

  /** Exclusive bottom edge (y + h). */
  get bottom(): number {
    return this.y + this.h;
  }

  get centerX(): number {
    return this.x + Math.floor(this.w / 2);
  }

  get centerY(): number {
    return this.y + Math.floor(this.h / 2);
  }

  get area(): number {
    return this.w * this.h;
  }

  contains(px: number, py: number): boolean {
    return px >= this.x && px < this.right && py >= this.y && py < this.bottom;
  }

  /** True if this rectangle shares any area with another. */
  intersects(other: Rect): boolean {
    return (
      this.x < other.right &&
      this.right > other.x &&
      this.y < other.bottom &&
      this.bottom > other.y
    );
  }
}
