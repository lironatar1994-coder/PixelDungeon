import { describe, it, expect } from "vitest";
import { DungeonManager, DUNGEON_DEPTH } from "@/core/dungeon/DungeonManager";
import { Terrain } from "@/core/grid/terrain";

describe("DungeonManager", () => {
  it("manages 26 floors and starts at depth 1", () => {
    const d = new DungeonManager("ABCD");
    expect(DUNGEON_DEPTH).toBe(26);
    expect(d.depth).toBe(1);
  });

  it("generates floors lazily (only on access)", () => {
    const d = new DungeonManager("LAZY");
    expect(d.generatedCount).toBe(0);
    d.levelAt(1);
    d.levelAt(2);
    expect(d.generatedCount).toBe(2);
    expect(d.isGenerated(3)).toBe(false);
  });

  it("REQUIRED: preserves floor state across stair travel", () => {
    const d = new DungeonManager("PERSIST");

    // Visit floor 2 and mutate one of its cells.
    d.descend(); // now on depth 2
    const floor2 = d.current;
    const sameObjectFirstVisit = floor2;
    const cell = floor2.entrance;
    floor2.grid.set(cell, Terrain.DOOR);

    // Go up, then back down.
    d.ascend(); // depth 1
    d.descend(); // depth 2 again

    // It must be the very same Level instance, with our mutation intact.
    expect(d.current).toBe(sameObjectFirstVisit);
    expect(d.current.grid.get(cell)).toBe(Terrain.DOOR);
  });

  it("is deterministic: same seed -> identical floors", () => {
    const a = new DungeonManager("SAME-SEED");
    const b = new DungeonManager("SAME-SEED");
    const la = a.levelAt(5);
    const lb = b.levelAt(5);
    expect(la.seed).toBe(lb.seed);
    expect(la.grid.snapshot()).toEqual(lb.grid.snapshot());
    expect(la.entrance).toBe(lb.entrance);
    expect(la.exit).toBe(lb.exit);
  });

  it("produces different floors for different master seeds", () => {
    const a = new DungeonManager("SEED-ONE");
    const b = new DungeonManager("SEED-TWO");
    expect(a.levelAt(3).grid.snapshot()).not.toEqual(
      b.levelAt(3).grid.snapshot(),
    );
  });

  it("derives a distinct seed per depth", () => {
    const d = new DungeonManager("DEPTHS");
    const seeds = new Set<number>();
    for (let depth = 1; depth <= DUNGEON_DEPTH; depth++) {
      seeds.add(d.seedForDepth(depth));
    }
    // Extremely unlikely to collide; proves each floor is independently seeded.
    expect(seeds.size).toBe(DUNGEON_DEPTH);
  });

  it("guarantees exactly two Potions of Strength across depths 1..5", () => {
    const d = new DungeonManager("STRENGTH-LOOT", {
      itemIds: ["ration", "potion_healing"],
      strengthPotionId: "potion_strength",
    });

    const strengthDepths: number[] = [];
    for (let depth = 1; depth <= 5; depth++) {
      const level = d.levelAt(depth);
      const count = level.groundItems.filter((item) => item.item.defId === "potion_strength").length;
      if (count > 0) strengthDepths.push(depth);
      expect(count).toBeLessThanOrEqual(1);
    }

    expect(strengthDepths).toHaveLength(2);
  });

  it("uses sewer regular metadata for depths 1..4, Goo boss metadata on depth 5, and legacy generation after that", () => {
    const d = new DungeonManager("SEWER-METADATA");
    const sewer = d.levelAt(1);
    const boss = d.levelAt(5);
    const deeper = d.levelAt(6);

    expect(sewer.roomMetadata.length).toBeGreaterThan(0);
    expect(sewer.trapMetadata.length).toBeGreaterThan(0);
    expect(boss.roomMetadata.some((room) => room.markers?.includes("spawn:goo"))).toBe(true);
    expect(boss.roomMetadata.some((room) => room.markers?.includes("spawn:ratKing"))).toBe(true);
    expect(boss.trapMetadata).toEqual([]);
    expect(deeper.roomMetadata).toEqual([]);
    expect(deeper.trapMetadata).toEqual([]);
    expect(d.snapshot().generationPlans?.[1]?.region).toBe("sewer");
    expect(d.snapshot().generationPlans?.[5]?.levelKind).toBe("sewerBoss");
    expect(d.snapshot().generationPlans?.[6]).toBeNull();
  });

  it("loads legacy snapshots without generation plans or room/trap metadata", () => {
    const d = new DungeonManager("LEGACY-SNAPSHOT");
    d.levelAt(1);
    const snapshot = d.snapshot();
    delete snapshot.generationPlans;
    for (const level of snapshot.levels) {
      delete level.roomMetadata;
      delete level.trapMetadata;
    }

    const restored = DungeonManager.fromSnapshot(snapshot);

    expect(restored.levelAt(1).roomMetadata).toEqual([]);
    expect(restored.levelAt(2).roomMetadata.length).toBeGreaterThan(0);
  });

  it("rejects out-of-range depths", () => {
    const d = new DungeonManager("RANGE");
    expect(() => d.levelAt(0)).toThrow();
    expect(() => d.levelAt(DUNGEON_DEPTH + 1)).toThrow();
  });

  it("clamps stair travel at the top and bottom", () => {
    const d = new DungeonManager("CLAMP");
    d.ascend(); // already at top
    expect(d.depth).toBe(1);
    for (let i = 0; i < DUNGEON_DEPTH + 5; i++) d.descend();
    expect(d.depth).toBe(DUNGEON_DEPTH);
  });
});
