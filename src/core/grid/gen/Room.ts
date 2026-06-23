import { Terrain } from "../terrain";
import type { Grid } from "../Grid";
import type { RNG } from "@/core/rng/Mulberry32";

export abstract class Room {
  left: number = 0;
  top: number = 0;
  right: number = 0;
  bottom: number = 0;

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }

  setPos(left: number, top: number) {
    this.right += left - this.left;
    this.bottom += top - this.top;
    this.left = left;
    this.top = top;
  }

  setSize(width: number, height: number) {
    this.right = this.left + width;
    this.bottom = this.top + height;
  }

  intersect(other: Room): boolean {
    // We enforce at least a 1-tile gap so walls don't overlap awkwardly
    return !(
      this.left > other.right + 1 ||
      this.right < other.left - 1 ||
      this.top > other.bottom + 1 ||
      this.bottom < other.top - 1
    );
  }

  center(): { x: number; y: number } {
    return {
      x: Math.floor((this.left + this.right) / 2),
      y: Math.floor((this.top + this.bottom) / 2),
    };
  }

  abstract paint(grid: Grid, rng: RNG): void;
}

export class StandardRoom extends Room {
  paint(grid: Grid, _rng: RNG): void {
    // Paint the inner bounds as floor. The builder initializes the grid with EMPTY (walls).
    for (let y = this.top; y <= this.bottom; y++) {
      for (let x = this.left; x <= this.right; x++) {
        if (grid.inBounds(x, y)) {
          grid.set(grid.cell(x, y), Terrain.FLOOR);
        }
      }
    }
  }
}

export class EntranceRoom extends StandardRoom {}
export class ExitRoom extends StandardRoom {}
