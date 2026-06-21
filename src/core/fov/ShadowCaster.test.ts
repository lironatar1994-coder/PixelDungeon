import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { computeFOV } from "@/core/fov/ShadowCaster";

/** Build a grid from ASCII rows: '#' wall, '.' floor. Returns the grid. */
function gridFrom(rows: string[]): Grid {
  const h = rows.length;
  const w = rows[0]!.length;
  const g = new Grid(w, h, Terrain.FLOOR);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      g.set(g.cell(x, y), rows[y]![x] === "#" ? Terrain.WALL : Terrain.FLOOR);
    }
  }
  return g;
}

describe("computeFOV (recursive shadowcasting)", () => {
  it("always sees its own cell", () => {
    const g = new Grid(5, 5, Terrain.FLOOR);
    const vis = computeFOV(g, g.cell(2, 2), 8);
    expect(vis.has(g.cell(2, 2))).toBe(true);
  });

  it("sees all clear cells in an open room within radius", () => {
    const g = new Grid(5, 5, Terrain.FLOOR);
    const vis = computeFOV(g, g.cell(2, 2), 8);
    // every cell in a 5x5 open room is within radius 8 and unobstructed
    expect(vis.size).toBe(25);
  });

  it("sees a wall but not the floor directly behind it", () => {
    // origin . wall hidden
    const g = gridFrom(["....."]);
    g.set(g.cell(2, 0), Terrain.WALL);
    const vis = computeFOV(g, g.cell(0, 0), 8);
    expect(vis.has(g.cell(1, 0))).toBe(true); // open, visible
    expect(vis.has(g.cell(2, 0))).toBe(true); // the wall itself is seen
    expect(vis.has(g.cell(3, 0))).toBe(false); // hidden behind the wall
    expect(vis.has(g.cell(4, 0))).toBe(false);
  });

  it("respects the radius limit", () => {
    const g = new Grid(21, 1, Terrain.FLOOR);
    const vis = computeFOV(g, g.cell(0, 0), 4);
    expect(vis.has(g.cell(4, 0))).toBe(true);
    expect(vis.has(g.cell(5, 0))).toBe(false);
  });

  it("casts a shadow behind a wall (cells directly behind it are hidden)", () => {
    // Origin top-left; a solid wall row blocks the floor beneath it.
    const g = gridFrom([
      "@....",
      "####.",
      ".....",
    ]);
    const origin = g.cell(0, 0);
    const vis = computeFOV(g, origin, 8);
    expect(vis.has(g.cell(1, 0))).toBe(true); // open neighbour: visible
    expect(vis.has(g.cell(1, 2))).toBe(false); // behind the wall: hidden
    expect(vis.has(g.cell(2, 2))).toBe(false); // behind the wall: hidden
  });
});
