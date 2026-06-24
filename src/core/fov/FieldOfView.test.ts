import { describe, expect, it } from "vitest";
import { FieldOfView } from "@/core/fov/FieldOfView";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";

describe("FieldOfView", () => {
  it("remembers adjacent cells even when they are outside current visibility", () => {
    const grid = new Grid(3, 3, Terrain.FLOOR);
    const origin = grid.cell(1, 1);
    const north = grid.cell(1, 0);
    grid.set(north, Terrain.WALL);

    const fov = new FieldOfView();
    fov.bindMemory(new Set());
    fov.update(grid, origin, 0, (cell) => grid.get(cell) === Terrain.WALL);

    expect(fov.isVisible(north)).toBe(false);
    expect(fov.isExplored(north)).toBe(true);
  });
});
