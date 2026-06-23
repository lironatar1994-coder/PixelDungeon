import { describe, it, expect } from "vitest";
import { RNG } from "@/core/rng/Mulberry32";
import { Terrain } from "@/core/grid/terrain";
import { generateLevel } from "@/core/procgen/LevelGenerator";
import { createSewerRegularLevelPlan, buildDungeonGenerationPlans } from "./plan";
import { buildRegularRoomGraph } from "./builders";
import { doorCandidates } from "./rooms";

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

describe("sewer regular level plans", () => {
  it("uses original sewer standard and special room ranges", () => {
    for (const seed of ["sewer-count-a", "sewer-count-b", "sewer-count-c"]) {
      const plan = createSewerRegularLevelPlan(2, new RNG(seed), {
        feeling: "none",
        secretRoomCount: 0,
      });
      expect(plan.standardRoomBudget).toBeGreaterThanOrEqual(4);
      expect(plan.standardRoomBudget).toBeLessThanOrEqual(6);
      expect(plan.specialRoomBudget).toBeGreaterThanOrEqual(1);
      expect(plan.specialRoomBudget).toBeLessThanOrEqual(2);
    }
  });

  it("forces original large sewer room budgets", () => {
    const plan = createSewerRegularLevelPlan(3, new RNG("large-sewer"), {
      feeling: "large",
      secretRoomCount: 0,
    });
    expect(plan.standardRoomBudget).toBe(6);
    expect(plan.specialRoomBudget).toBe(2);
  });

  it("keeps depth 1 free of secret rooms and distributes sewer secrets deterministically", () => {
    const a = buildDungeonGenerationPlans("SECRET-DIST", 26);
    const b = buildDungeonGenerationPlans("SECRET-DIST", 26);
    expect(a).toEqual(b);
    expect(a[1]?.secretRoomCount).toBe(0);
    const sewerSecretDepths = [1, 2, 3, 4, 5].filter((depth) => (a[depth]?.secretRoomCount ?? 0) > 0);
    expect(sewerSecretDepths).toHaveLength(2);
    expect(sewerSecretDepths).not.toContain(1);
  });
});

describe("regular builders", () => {
  it("builds a loop graph with a connected cycle containing entrance and exit", () => {
    const plan = createSewerRegularLevelPlan(2, new RNG("loop-plan"), {
      builderKind: "loop",
      secretRoomCount: 0,
    });
    const built = buildRegularRoomGraph(plan, new RNG("loop-build"));
    expect(built).not.toBeNull();
    expect(built!.builderKind).toBe("loop");
    expect(built!.entrance.connectedRooms.length).toBeGreaterThanOrEqual(2);
    expect(built!.exit.connectedRooms.length).toBeGreaterThanOrEqual(2);
    const connectionCount = new Set(
      built!.rooms.flatMap((room) =>
        room.connectedRooms.map((other) => [room.id, other.id].sort().join(":")),
      ),
    ).size;
    expect(connectionCount).toBeGreaterThanOrEqual(built!.rooms.length);
  });

  it("builds a figure-eight graph with extra connectivity around a landmark", () => {
    const plan = createSewerRegularLevelPlan(4, new RNG("figure-plan"), {
      builderKind: "figureEight",
      secretRoomCount: 1,
    });
    const built = buildRegularRoomGraph(plan, new RNG("figure-build"));
    expect(built).not.toBeNull();
    expect(built!.builderKind).toBe("figureEight");
    expect(built!.entrance.connectedRooms.length).toBeGreaterThanOrEqual(2);
    expect(built!.exit.connectedRooms.length).toBeGreaterThanOrEqual(2);
    expect(built!.rooms.some((room) => room.connectedRooms.length >= 3)).toBe(true);
  });

  it("does not let unconnected rooms share door seams", () => {
    for (const seed of ["seam-loop", "seam-figure", "seam-branch"]) {
      const plan = createSewerRegularLevelPlan(3, new RNG(`${seed}:plan`), {
        builderKind: seed === "seam-loop" ? "loop" : "figureEight",
        secretRoomCount: 1,
      });
      const built = buildRegularRoomGraph(plan, new RNG(`${seed}:build`));
      expect(built).not.toBeNull();
      for (let i = 0; i < built!.rooms.length - 1; i++) {
        for (let j = i + 1; j < built!.rooms.length; j++) {
          const a = built!.rooms[i]!;
          const b = built!.rooms[j]!;
          if (a.connectedRooms.includes(b)) continue;
          const candidates = doorCandidates(
            a as Parameters<typeof doorCandidates>[0],
            b as Parameters<typeof doorCandidates>[1],
          );
          expect(candidates, `${seed}: ${a.id} should not share a seam with ${b.id}`)
            .toHaveLength(0);
        }
      }
    }
  });
});

describe("sewer regular painter integration", () => {
  it("generates deterministic reachable sewer maps from regular plans", () => {
    const plan = createSewerRegularLevelPlan(3, new RNG("paint-plan"), {
      builderKind: "loop",
      secretRoomCount: 1,
    });
    const a = generateLevel(40, 40, new RNG("paint-map"), { plan }, {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 2,
    });
    const b = generateLevel(40, 40, new RNG("paint-map"), { plan }, {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 2,
    });

    expect(a.grid.snapshot()).toEqual(b.grid.snapshot());
    expect(a.groundItems).toEqual(b.groundItems);
    const reach = reachable(a.grid, a.entrance);
    expect(reach.has(a.exit)).toBe(true);
    for (const room of a.rooms) {
      expect(reach.has(a.grid.cell(room.centerX, room.centerY))).toBe(true);
    }
  });

  it("places doors only on room seams and protects doors, stairs, traps, and loot", () => {
    const plan = createSewerRegularLevelPlan(4, new RNG("door-plan"), {
      builderKind: "figureEight",
      feeling: "water",
      secretRoomCount: 1,
    });
    const level = generateLevel(40, 40, new RNG("door-map"), { plan }, {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 3,
    });

    expect(level.grid.get(level.entrance)).toBe(Terrain.FLOOR);
    expect(level.grid.get(level.exit)).toBe(Terrain.FLOOR);
    expect(level.roomMetadata?.length).toBeGreaterThan(0);
    expect(level.trapMetadata?.length).toBe(plan.painter.trapCount);

    const occupied = new Set<number>([level.entrance, level.exit]);
    for (const trap of level.trapMetadata ?? []) {
      expect(level.grid.get(trap.cell)).toBe(Terrain.FLOOR);
      expect(occupied.has(trap.cell)).toBe(false);
      occupied.add(trap.cell);
    }
    for (const item of level.groundItems) {
      expect(level.grid.isWalkable(item.cell)).toBe(true);
      expect(occupied.has(item.cell)).toBe(false);
      occupied.add(item.cell);
    }

    const doors = level.grid.snapshot()
      .map((terrain, cell) => ({ terrain, cell }))
      .filter(({ terrain }) => terrain === Terrain.DOOR)
      .map(({ cell }) => cell);
    expect(doors.length).toBeGreaterThanOrEqual(4);
    for (const door of doors) {
      const horizontal = level.grid.isWalkable(door - 1) && level.grid.isWalkable(door + 1);
      const vertical = level.grid.isWalkable(door - level.grid.width) && level.grid.isWalkable(door + level.grid.width);
      expect(horizontal || vertical).toBe(true);
    }
  });

  it("keeps painted sewer exits and room centers reachable across depths", () => {
    for (const seed of ["painted-reach-a", "painted-reach-b"]) {
      const plans = buildDungeonGenerationPlans(seed, 26);
      for (let depth = 1; depth <= 5; depth++) {
        const plan = plans[depth]!;
        const level = generateLevel(40, 40, new RNG(`${seed}:map:${depth}`), { plan });
        const reach = reachable(level.grid, level.entrance);
        expect(reach.has(level.exit)).toBe(true);
        for (const room of level.rooms) {
          expect(reach.has(level.grid.cell(room.centerX, room.centerY))).toBe(true);
        }
      }
    }
  });

  it("keeps loot, traps, and stairs stable when only terrain paint density changes", () => {
    const plan = createSewerRegularLevelPlan(3, new RNG("scoped-plan"), {
      builderKind: "loop",
      secretRoomCount: 1,
    });
    const dryPlan = {
      ...plan,
      painter: { ...plan.painter, waterFill: 0, grassFill: 0 },
    };
    const wetPlan = {
      ...plan,
      painter: { ...plan.painter, waterFill: 0.95, grassFill: 0.95 },
    };
    const loot = {
      itemIds: ["ration", "potion_healing"],
      guaranteedItemIds: ["potion_strength"],
      itemCount: 3,
    };
    const dry = generateLevel(40, 40, new RNG("scoped-map"), { plan: dryPlan }, loot);
    const wet = generateLevel(40, 40, new RNG("scoped-map"), { plan: wetPlan }, loot);

    expect(dry.grid.snapshot()).not.toEqual(wet.grid.snapshot());
    expect(dry.entrance).toBe(wet.entrance);
    expect(dry.exit).toBe(wet.exit);
    expect(dry.trapMetadata).toEqual(wet.trapMetadata);
    expect(dry.groundItems).toEqual(wet.groundItems);
  });
});
