import { describe, it, expect } from "vitest";
import { RNG } from "@/core/rng/Mulberry32";
import { Terrain } from "@/core/grid/terrain";
import { generateLevel } from "@/core/procgen/LevelGenerator";

/** Flood fill over walkable cells from `start`; returns the reachable set. */
function reachable(grid: ReturnType<typeof generateLevel>["grid"], start: number) {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    for (const n of grid.neighbours4(cell)) {
      if (!seen.has(n) && grid.isWalkable(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

describe("generateLevel", () => {
  it("is deterministic: same seed -> identical map", () => {
    const a = generateLevel(40, 40, new RNG("MAP-SEED"));
    const b = generateLevel(40, 40, new RNG("MAP-SEED"));
    expect(a.grid.snapshot()).toEqual(b.grid.snapshot());
    expect(a.entrance).toBe(b.entrance);
    expect(a.exit).toBe(b.exit);
  });

  it("differs across seeds", () => {
    const a = generateLevel(40, 40, new RNG("seed-x"));
    const b = generateLevel(40, 40, new RNG("seed-y"));
    expect(a.grid.snapshot()).not.toEqual(b.grid.snapshot());
  });

  it("carves more than one room", () => {
    const level = generateLevel(40, 40, new RNG("rooms"));
    expect(level.rooms.length).toBeGreaterThan(1);
  });

  it("keeps the outer border solid", () => {
    const { grid } = generateLevel(40, 40, new RNG("border"));
    for (let x = 0; x < grid.width; x++) {
      expect(grid.isSolid(grid.cell(x, 0))).toBe(true);
      expect(grid.isSolid(grid.cell(x, grid.height - 1))).toBe(true);
    }
    for (let y = 0; y < grid.height; y++) {
      expect(grid.isSolid(grid.cell(0, y))).toBe(true);
      expect(grid.isSolid(grid.cell(grid.width - 1, y))).toBe(true);
    }
  });

  it("REQUIRED: every room is connected (entrance can reach the exit and all room centers)", () => {
    // Try several seeds to be confident the connection step is robust.
    for (const seed of ["c1", "c2", "c3", "c4", "c5"]) {
      const level = generateLevel(42, 42, new RNG(seed));
      const reach = reachable(level.grid, level.entrance);

      expect(reach.has(level.exit)).toBe(true);

      for (const room of level.rooms) {
        const center = level.grid.cell(room.centerX, room.centerY);
        expect(reach.has(center)).toBe(true);
      }
    }
  });

  it("places entrance and exit on walkable floor", () => {
    const level = generateLevel(40, 40, new RNG("stairs"));
    expect(level.grid.get(level.entrance)).toBe(Terrain.FLOOR);
    expect(level.grid.get(level.exit)).toBe(Terrain.FLOOR);
    expect(level.entrance).not.toBe(level.exit);
  });

  it("creates SPD-style room seams with door cells instead of only open tunnels", () => {
    const level = generateLevel(42, 42, new RNG("doors"));
    const doors = level.grid
      .snapshot()
      .map((terrain, cell) => ({ terrain, cell }))
      .filter(({ terrain }) => terrain === Terrain.DOOR)
      .map(({ cell }) => cell);

    expect(doors.length).toBeGreaterThanOrEqual(4);
    for (const door of doors) {
      const north = level.grid.get(door - level.grid.width);
      const south = level.grid.get(door + level.grid.width);
      const west = level.grid.get(door - 1);
      const east = level.grid.get(door + 1);
      const horizontalDoor = level.grid.isWalkable(door - 1) && level.grid.isWalkable(door + 1);
      const verticalDoor = level.grid.isWalkable(door - level.grid.width) && level.grid.isWalkable(door + level.grid.width);

      expect(horizontalDoor || verticalDoor).toBe(true);
      expect([north, south, west, east].filter((terrain) => terrain === Terrain.WALL).length)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it("generates a varied room graph across several seeds", () => {
    for (const seed of ["graph-a", "graph-b", "graph-c", "graph-d"]) {
      const level = generateLevel(42, 42, new RNG(seed));
      expect(level.rooms.length).toBeGreaterThanOrEqual(7);
      expect(level.rooms.some((room) => room.area >= 72)).toBe(true);
    }
  });

  it("still produces a room graph at the smallest regular dungeon size", () => {
    for (const seed of ["small-a", "small-b", "small-c"]) {
      const level = generateLevel(33, 33, new RNG(seed));
      const reach = reachable(level.grid, level.entrance);
      expect(level.rooms.length).toBeGreaterThanOrEqual(5);
      expect(reach.has(level.exit)).toBe(true);
    }
  });

  it("places deterministic loot only on walkable non-stair cells", () => {
    const a = generateLevel(40, 40, new RNG("loot"), undefined, {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 3,
    });
    const b = generateLevel(40, 40, new RNG("loot"), undefined, {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 3,
    });

    expect(a.groundItems).toEqual(b.groundItems);
    expect(a.groundItems).toHaveLength(4);
    expect(a.groundItems.some((item) => item.itemId === "potion_strength")).toBe(true);

    const cells = new Set<number>();
    for (const item of a.groundItems) {
      expect(a.grid.isWalkable(item.cell)).toBe(true);
      expect(item.cell).not.toBe(a.entrance);
      expect(item.cell).not.toBe(a.exit);
      expect(cells.has(item.cell)).toBe(false);
      cells.add(item.cell);
    }
  });
});
