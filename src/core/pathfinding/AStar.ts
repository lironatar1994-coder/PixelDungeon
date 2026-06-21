/**
 * AStar — shortest-path search over the flat Grid (Directive 1: pure logic).
 *
 * Phase 2 uses this to carve corridors: given two room cells, A* finds the
 * shortest 4-directional route between them, which we then dig out as a
 * 1-tile-wide hallway. The same router will drive monster pathfinding in
 * Phase 3 ("Hunt" the player), so it is written generically — neighbours,
 * step cost, and passability are all injectable.
 *
 * It uses a binary min-heap as the open set and a Manhattan-distance
 * heuristic, which is admissible for a 4-connected grid (min step cost 1),
 * guaranteeing the path it returns is optimal.
 */
import type { Grid } from "@/core/grid/Grid";

export interface AStarOptions {
  /** Candidate moves from a cell. Default: orthogonal (4-directional). */
  neighbours?: (cell: number) => number[];
  /** Cost of moving from one cell to an adjacent one. Default: 1. */
  cost?: (from: number, to: number) => number;
  /** Whether a cell may be entered. Default: always. (Goal is always allowed.) */
  passable?: (cell: number) => boolean;
}

interface HeapEntry {
  cell: number;
  priority: number;
}

/** A small binary min-heap keyed on `priority`. */
class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cell: number, priority: number): void {
    const items = this.items;
    items.push({ cell, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.priority <= items[i]!.priority) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && items[l]!.priority < items[smallest]!.priority) smallest = l;
        if (r < n && items[r]!.priority < items[smallest]!.priority) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top.cell;
  }
}

/**
 * Find the lowest-cost path from `start` to `goal`.
 * @returns the ordered list of cells (start..goal inclusive), or null if no
 *          route exists.
 */
export function findPath(
  grid: Grid,
  start: number,
  goal: number,
  opts: AStarOptions = {},
): number[] | null {
  if (start === goal) return [start];

  const neighboursOf = opts.neighbours ?? ((c) => grid.neighbours4(c));
  const costOf = opts.cost ?? (() => 1);
  const passable = opts.passable ?? (() => true);
  const heuristic = (a: number, b: number): number =>
    Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b));

  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(start, heuristic(start, goal));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) break;
    if (closed.has(current)) continue;
    closed.add(current);

    const currentG = gScore.get(current)!;
    for (const next of neighboursOf(current)) {
      if (closed.has(next)) continue;
      if (next !== goal && !passable(next)) continue;
      const tentative = currentG + costOf(current, next);
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        cameFrom.set(next, current);
        open.push(next, tentative + heuristic(next, goal));
      }
    }
  }

  if (!cameFrom.has(goal)) return null;

  // Walk the parent links back from the goal and reverse.
  const path: number[] = [goal];
  let cell = goal;
  while (cell !== start) {
    const prev = cameFrom.get(cell);
    if (prev === undefined) return null;
    cell = prev;
    path.push(cell);
  }
  path.reverse();
  return path;
}
