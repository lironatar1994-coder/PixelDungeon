import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { hasLineOfSight } from "@/core/fov/lineOfSight";

describe("hasLineOfSight", () => {
  it("sees a clear straight line", () => {
    const g = new Grid(10, 3, Terrain.FLOOR);
    expect(hasLineOfSight(g, g.cell(1, 1), g.cell(8, 1), 20)).toBe(true);
  });

  it("is blocked by a wall between the two points", () => {
    const g = new Grid(10, 3, Terrain.FLOOR);
    g.set(g.cell(4, 1), Terrain.WALL);
    expect(hasLineOfSight(g, g.cell(1, 1), g.cell(8, 1), 20)).toBe(false);
  });

  it("returns false beyond the range", () => {
    const g = new Grid(10, 3, Terrain.FLOOR);
    expect(hasLineOfSight(g, g.cell(0, 1), g.cell(9, 1), 4)).toBe(false);
  });

  it("always sees an adjacent cell", () => {
    const g = new Grid(5, 5, Terrain.FLOOR);
    expect(hasLineOfSight(g, g.cell(2, 2), g.cell(2, 3), 8)).toBe(true);
  });
});
