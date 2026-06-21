import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { lineOfFire } from "@/core/fov/lineOfFire";

describe("lineOfFire", () => {
  it("returns the full ray when nothing blocks the target", () => {
    const grid = new Grid(7, 3, Terrain.FLOOR);
    expect(lineOfFire(grid.cell(1, 1), grid.cell(5, 1), grid)).toEqual([
      grid.cell(1, 1),
      grid.cell(2, 1),
      grid.cell(3, 1),
      grid.cell(4, 1),
      grid.cell(5, 1),
    ]);
  });

  it("stops early on a solid wall", () => {
    const grid = new Grid(7, 3, Terrain.FLOOR);
    grid.set(grid.cell(3, 1), Terrain.WALL);

    expect(lineOfFire(grid.cell(1, 1), grid.cell(5, 1), grid).at(-1)).toBe(
      grid.cell(3, 1),
    );
  });

  it("stops on an intermediate entity blocker but permits the target cell", () => {
    const grid = new Grid(7, 3, Terrain.FLOOR);
    const blocker = grid.cell(3, 1);
    const target = grid.cell(5, 1);

    const blocked = lineOfFire(grid.cell(1, 1), target, grid, {
      blocksCell: (cell) => cell === blocker || cell === target,
    });
    expect(blocked.at(-1)).toBe(blocker);

    const clearToTarget = lineOfFire(grid.cell(1, 1), target, grid, {
      blocksCell: (cell) => cell === target,
    });
    expect(clearToTarget.at(-1)).toBe(target);
  });
});
