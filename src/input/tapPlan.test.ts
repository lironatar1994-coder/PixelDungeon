import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { planTap, type TapView } from "@/input/tapPlan";

interface MockEnemy {
  pos: number;
  alive: boolean;
}

function makeView(
  grid: Grid,
  heroPos: number,
  enemies: MockEnemy[],
  visible: Set<number>,
): TapView<MockEnemy> {
  return {
    grid,
    heroPos,
    enemies,
    isAlive: (e) => e.alive,
    isVisible: (cell) => visible.has(cell),
  };
}

describe("planTap (touch-to-attack targeting)", () => {
  const grid = new Grid(10, 10, Terrain.FLOOR);
  grid.set(grid.cell(3, 3), Terrain.WALL);
  const hero = grid.cell(5, 5);
  const allVisible = new Set<number>(
    Array.from({ length: grid.length }, (_, i) => i),
  );

  it("returns none for a null tap", () => {
    expect(planTap(makeView(grid, hero, [], allVisible), null)).toEqual({
      kind: "none",
    });
  });

  it("travels to a visible empty floor tile", () => {
    const plan = planTap(makeView(grid, hero, [], allVisible), grid.cell(2, 2));
    expect(plan).toEqual({ kind: "travel", cell: grid.cell(2, 2) });
  });

  it("returns none for a wall tile", () => {
    expect(planTap(makeView(grid, hero, [], allVisible), grid.cell(3, 3))).toEqual({
      kind: "none",
    });
  });

  it("returns none when tapping the hero's own tile", () => {
    expect(planTap(makeView(grid, hero, [], allVisible), hero)).toEqual({
      kind: "none",
    });
  });

  it("attacks a visible enemy that is orthogonally adjacent", () => {
    const enemy: MockEnemy = { pos: grid.cell(5, 4), alive: true }; // distance 1
    const plan = planTap(makeView(grid, hero, [enemy], allVisible), enemy.pos);
    expect(plan).toEqual({ kind: "attack", enemy });
  });

  it("approaches a visible enemy that is out of melee range", () => {
    const enemy: MockEnemy = { pos: grid.cell(5, 1), alive: true }; // distance 4
    const plan = planTap(makeView(grid, hero, [enemy], allVisible), enemy.pos);
    expect(plan).toEqual({ kind: "approach", enemy });
  });

  it("treats a diagonally-adjacent enemy as out of melee range (approach)", () => {
    const enemy: MockEnemy = { pos: grid.cell(6, 6), alive: true }; // Manhattan 2
    const plan = planTap(makeView(grid, hero, [enemy], allVisible), enemy.pos);
    expect(plan.kind).toBe("approach");
  });

  it("ignores an enemy hidden in fog and walks to the tile instead", () => {
    const enemy: MockEnemy = { pos: grid.cell(5, 1), alive: true };
    const visible = new Set<number>([hero]); // enemy cell NOT visible
    const plan = planTap(makeView(grid, hero, [enemy], visible), enemy.pos);
    expect(plan).toEqual({ kind: "travel", cell: enemy.pos });
  });

  it("ignores a dead enemy on the tile", () => {
    const enemy: MockEnemy = { pos: grid.cell(5, 4), alive: false };
    const plan = planTap(makeView(grid, hero, [enemy], allVisible), enemy.pos);
    expect(plan).toEqual({ kind: "travel", cell: enemy.pos });
  });
});
