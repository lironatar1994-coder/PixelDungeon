/**
 * DistanceMap - SPD-style uniform 8-way path routing.
 *
 * Shattered Pixel Dungeon builds a distance field from the destination and
 * then actors move "downhill" through the lowest neighbouring distance. All
 * eight directions cost 1, including diagonals. This is intentionally separate
 * from A* so player travel can get the classic Pixel Dungeon feel while A*
 * remains available for weighted or generation-specific routes.
 */
import type { Grid } from "@/core/grid/Grid";

export interface DistanceMapOptions {
  /** Whether a cell can be entered while flooding. The target is always seeded. */
  passable?: (cell: number) => boolean;
}

const UNREACHABLE = Number.POSITIVE_INFINITY;

export class DistanceMap {
  readonly target: number;
  private readonly grid: Grid;
  private readonly distance: number[];

  private constructor(grid: Grid, target: number, distance: number[]) {
    this.grid = grid;
    this.target = target;
    this.distance = distance;
  }

  static build(
    grid: Grid,
    target: number,
    opts: DistanceMapOptions = {},
  ): DistanceMap {
    const passable = opts.passable ?? (() => true);
    const distance = new Array<number>(grid.length).fill(UNREACHABLE);
    const queue = new Array<number>(grid.length);
    let head = 0;
    let tail = 0;

    if (!grid.inBoundsCell(target)) {
      return new DistanceMap(grid, target, distance);
    }

    distance[target] = 0;
    queue[tail++] = target;

    while (head < tail) {
      const cell = queue[head++]!;
      const nextDistance = distance[cell]! + 1;
      for (const next of spdFloodNeighbours(grid, cell)) {
        if (!passable(next) || distance[next]! <= nextDistance) continue;
        distance[next] = nextDistance;
        queue[tail++] = next;
      }
    }

    return new DistanceMap(grid, target, distance);
  }

  getDistance(cell: number): number {
    return this.grid.inBoundsCell(cell) ? this.distance[cell]! : UNREACHABLE;
  }

  isReachable(cell: number): boolean {
    return Number.isFinite(this.getDistance(cell));
  }

  /**
   * Return the neighbouring cell that moves one step closer to the target.
   * The tie-break order mirrors SPD's getStep order: horizontal/vertical first,
   * then diagonals.
   */
  getNextStep(current: number): number | null {
    if (!this.grid.inBoundsCell(current) || current === this.target) return null;
    let best = current;
    let bestDistance = this.getDistance(current);

    for (const next of spdStepNeighbours(this.grid, current)) {
      const d = this.getDistance(next);
      if (d < bestDistance) {
        best = next;
        bestDistance = d;
      }
    }

    return best === current ? null : best;
  }

  /** Build a cached path from `start` to this map's target, inclusive. */
  pathFrom(start: number): number[] | null {
    if (start === this.target) return [start];
    if (!this.isReachable(start)) return null;

    const path = [start];
    let current = start;
    for (let guard = 0; guard < this.grid.length; guard++) {
      const next = this.getNextStep(current);
      if (next === null) return null;
      path.push(next);
      if (next === this.target) return path;
      current = next;
    }
    return null;
  }
}

function spdFloodNeighbours(grid: Grid, cell: number): number[] {
  return neighboursInOrder(grid, cell, [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ]);
}

function spdStepNeighbours(grid: Grid, cell: number): number[] {
  return neighboursInOrder(grid, cell, [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]);
}

function neighboursInOrder(
  grid: Grid,
  cell: number,
  offsets: readonly (readonly [number, number])[],
): number[] {
  const x = grid.xOf(cell);
  const y = grid.yOf(cell);
  const out: number[] = [];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (grid.inBounds(nx, ny)) out.push(grid.cell(nx, ny));
  }
  return out;
}
