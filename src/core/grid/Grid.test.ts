import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";

describe("Grid", () => {
  it("converts between (x, y) and flat cell indices", () => {
    const g = new Grid(10, 8);
    const c = g.cell(3, 4);
    expect(c).toBe(3 + 4 * 10);
    expect(g.xOf(c)).toBe(3);
    expect(g.yOf(c)).toBe(4);
  });

  it("reports bounds correctly", () => {
    const g = new Grid(5, 5);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(4, 4)).toBe(true);
    expect(g.inBounds(5, 4)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);
  });

  it("treats out-of-bounds cells as solid EMPTY terrain", () => {
    const g = new Grid(4, 4, Terrain.FLOOR);
    expect(g.get(-1)).toBe(Terrain.EMPTY);
    expect(g.get(999)).toBe(Terrain.EMPTY);
    expect(g.isSolid(-1)).toBe(true);
    expect(g.isWalkable(-1)).toBe(false);
  });

  it("derives solid / walkable / transparent from terrain", () => {
    const g = new Grid(3, 3, Terrain.WALL);
    const floor = g.cell(1, 1);
    g.set(floor, Terrain.FLOOR);

    expect(g.isWalkable(floor)).toBe(true);
    expect(g.isTransparent(floor)).toBe(true);
    expect(g.isSolid(floor)).toBe(false);

    const wall = g.cell(0, 0);
    expect(g.isWalkable(wall)).toBe(false);
    expect(g.isTransparent(wall)).toBe(false);
    expect(g.isSolid(wall)).toBe(true);
  });

  it("returns only in-bounds neighbours", () => {
    const g = new Grid(5, 5);
    // A corner has 2 orthogonal and 3 diagonal-inclusive neighbours.
    expect(g.neighbours4(g.cell(0, 0))).toHaveLength(2);
    expect(g.neighbours8(g.cell(0, 0))).toHaveLength(3);
    // A central cell is fully surrounded.
    expect(g.neighbours4(g.cell(2, 2))).toHaveLength(4);
    expect(g.neighbours8(g.cell(2, 2))).toHaveLength(8);
  });

  it("rejects non-positive dimensions", () => {
    expect(() => new Grid(0, 5)).toThrow();
    expect(() => new Grid(5, -1)).toThrow();
  });
});
