import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { findPath } from "@/core/pathfinding/AStar";

describe("AStar.findPath", () => {
  it("returns [start] when start equals goal", () => {
    const g = new Grid(5, 5, Terrain.FLOOR);
    expect(findPath(g, g.cell(2, 2), g.cell(2, 2))).toEqual([g.cell(2, 2)]);
  });

  it("finds a shortest path on an open grid (Manhattan length + 1)", () => {
    const g = new Grid(10, 10, Terrain.FLOOR);
    const start = g.cell(1, 1);
    const goal = g.cell(4, 5); // Manhattan distance 3 + 4 = 7 steps -> 8 cells
    const path = findPath(g, start, goal);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(start);
    expect(path![path!.length - 1]).toBe(goal);
    expect(path!).toHaveLength(8);
  });

  it("routes around impassable cells", () => {
    const g = new Grid(7, 3, Terrain.FLOOR);
    // Build a vertical wall at x=3 with a single gap at the bottom row.
    const blocked = new Set([g.cell(3, 0), g.cell(3, 1)]);
    const path = findPath(g, g.cell(0, 0), g.cell(6, 0), {
      passable: (c) => !blocked.has(c),
    });
    expect(path).not.toBeNull();
    // Every cell on the path must be passable.
    for (const c of path!) expect(blocked.has(c)).toBe(false);
  });

  it("returns null when the goal is unreachable", () => {
    const g = new Grid(5, 5, Terrain.FLOOR);
    const goal = g.cell(2, 2);
    // Wall off the goal completely.
    const walls = new Set(g.neighbours4(goal));
    const path = findPath(g, g.cell(0, 0), goal, {
      passable: (c) => c === goal || !walls.has(c),
    });
    expect(path).toBeNull();
  });

  it("is deterministic", () => {
    const g = new Grid(12, 12, Terrain.FLOOR);
    const a = findPath(g, g.cell(0, 0), g.cell(11, 11));
    const b = findPath(g, g.cell(0, 0), g.cell(11, 11));
    expect(a).toEqual(b);
  });
});
