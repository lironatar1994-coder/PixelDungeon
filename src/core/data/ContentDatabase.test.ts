import { describe, it, expect, vi } from "vitest";
import { ContentDatabase } from "@/core/data/ContentDatabase";
import { RNG } from "@/core/rng/Mulberry32";

const RAW_ENEMIES = [
  { id: "rat", name: "Sewer Rat", maxHealth: 8, speed: 2, vision: 6, spawnWeight: 4, minDepth: 1 },
  { id: "zombie", name: "Rotting Zombie", maxHealth: 25, speed: 0.5, vision: 4, spawnWeight: 2, minDepth: 1 },
  { id: "gnoll", name: "Gnoll Scout", maxHealth: 14, speed: 1, vision: 7, spawnWeight: 3, minDepth: 2 },
];

describe("ContentDatabase", () => {
  it("indexes enemies and items by id", () => {
    const db = ContentDatabase.fromRaw(RAW_ENEMIES, [
      { id: "sword", name: "Short Sword", type: "weapon" },
    ], [
      { id: "mage", name: "Mage", maxHealth: 15, strength: 15, sprite: "mage", startingItems: ["staff"] },
    ]);
    expect(db.getEnemy("rat")?.name).toBe("Sewer Rat");
    expect(db.getItem("sword")?.type).toBe("weapon");
    expect(db.getHero("mage")?.maxHealth).toBe(15);
    expect(db.allHeroes.length).toBe(1);
    expect(db.allEnemies.length).toBe(3);
  });

  it("falls back to built-in defaults when content is missing", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = ContentDatabase.fromRaw(null, null);
    expect(db.allEnemies.length).toBe(1);
    expect(db.allEnemies[0]!.id).toBe(ContentDatabase.DEFAULT_ENEMY.id);
    expect(db.defaultHero.id).toBe(ContentDatabase.DEFAULT_HERO.id);
    spy.mockRestore();
  });

  it("only spawns depth-eligible enemies", () => {
    const db = ContentDatabase.fromRaw(RAW_ENEMIES, []);
    const rng = new RNG("spawn");
    // The gnoll has minDepth 2, so on floor 1 it must never be chosen.
    for (let i = 0; i < 200; i++) {
      const def = db.randomEnemyForDepth(1, rng);
      expect(def.minDepth).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a given RNG state", () => {
    const db = ContentDatabase.fromRaw(RAW_ENEMIES, []);
    const pick = (seed: string) =>
      Array.from({ length: 10 }, ((r) => () => db.randomEnemyForDepth(3, r).id)(new RNG(seed)));
    expect(pick("same")).toEqual(pick("same"));
  });

  it("respects spawn weights statistically", () => {
    const db = ContentDatabase.fromRaw(RAW_ENEMIES, []);
    const rng = new RNG("weights");
    const counts: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const id = db.randomEnemyForDepth(1, rng).id; // rat(4) vs zombie(2) eligible
      counts[id] = (counts[id] ?? 0) + 1;
    }
    // Rat (weight 4) should appear clearly more often than zombie (weight 2).
    expect(counts["rat"]!).toBeGreaterThan(counts["zombie"]!);
  });
});
