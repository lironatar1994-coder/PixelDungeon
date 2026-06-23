import { describe, expect, it } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { DistanceMap } from "@/core/pathfinding/DistanceMap";

describe("DistanceMap", () => {
  it("uses uniform 8-way movement where diagonals cost one step", () => {
    const grid = new Grid(8, 8, Terrain.FLOOR);
    const start = grid.cell(1, 1);
    const target = grid.cell(4, 4);
    const map = DistanceMap.build(grid, target, {
      passable: (cell) => grid.isWalkable(cell),
    });

    expect(map.getDistance(start)).toBe(3);
    expect(map.pathFrom(start)).toEqual([
      grid.cell(1, 1),
      grid.cell(2, 2),
      grid.cell(3, 3),
      grid.cell(4, 4),
    ]);
  });

  it("walks downhill around blocked cells", () => {
    const grid = new Grid(7, 5, Terrain.FLOOR);
    for (const y of [0, 1, 2, 3]) {
      grid.set(grid.cell(3, y), Terrain.WALL);
    }

    const start = grid.cell(1, 1);
    const target = grid.cell(5, 1);
    const map = DistanceMap.build(grid, target, {
      passable: (cell) => grid.isWalkable(cell),
    });
    const path = map.pathFrom(start);

    expect(path).not.toBeNull();
    expect(path![0]).toBe(start);
    expect(path!.at(-1)).toBe(target);
    for (const cell of path!) {
      expect(grid.isWalkable(cell)).toBe(true);
    }
  });

  it("returns null when the start cannot reach the target", () => {
    const grid = new Grid(5, 5, Terrain.FLOOR);
    const target = grid.cell(2, 2);
    for (const cell of grid.neighbours8(target)) {
      grid.set(cell, Terrain.WALL);
    }

    const map = DistanceMap.build(grid, target, {
      passable: (cell) => grid.isWalkable(cell),
    });

    expect(map.isReachable(grid.cell(0, 0))).toBe(false);
    expect(map.getNextStep(grid.cell(0, 0))).toBeNull();
    expect(map.pathFrom(grid.cell(0, 0))).toBeNull();
  });

  it("can be built from the hero to cheaply rank all reachable fallback cells", () => {
    const grid = new Grid(6, 6, Terrain.FLOOR);
    grid.set(grid.cell(3, 2), Terrain.WALL);
    const hero = grid.cell(1, 1);
    const map = DistanceMap.build(grid, hero, {
      passable: (cell) => grid.isWalkable(cell),
    });

    expect(map.getDistance(grid.cell(2, 2))).toBe(1);
    expect(map.getDistance(grid.cell(4, 2))).toBe(3);
  });
});
