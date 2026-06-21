import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseEnemy, parseEnemies, parseItems } from "@/core/data/parse";

describe("parseEnemy (corruption guard)", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("parses a well-formed entry", () => {
    const def = parseEnemy({
      id: "rat",
      name: "Sewer Rat",
      maxHealth: 8,
      speed: 2,
      vision: 6,
      spawnWeight: 4,
      minDepth: 1,
    });
    expect(def).toMatchObject({ id: "rat", name: "Sewer Rat", maxHealth: 8, speed: 2 });
  });

  it("rejects entries with no id (returns null)", () => {
    expect(parseEnemy({ name: "Nameless", maxHealth: 5 })).toBeNull();
    expect(parseEnemy(null)).toBeNull();
    expect(parseEnemy("not an object")).toBeNull();
  });

  it("fills missing fields with safe defaults", () => {
    const def = parseEnemy({ id: "blank" })!;
    expect(def.name).toBe("blank"); // falls back to id
    expect(def.maxHealth).toBe(10);
    expect(def.speed).toBe(1);
    expect(def.vision).toBe(6);
    expect(def.minDepth).toBe(1);
  });

  it("NEVER yields a zero/negative/NaN speed (protects TICK / speed math)", () => {
    expect(parseEnemy({ id: "a", speed: 0 })!.speed).toBeGreaterThan(0);
    expect(parseEnemy({ id: "b", speed: -5 })!.speed).toBeGreaterThan(0);
    expect(parseEnemy({ id: "c", speed: "fast" })!.speed).toBe(1); // non-numeric -> default
    expect(Number.isFinite(parseEnemy({ id: "d", speed: "fast" })!.speed)).toBe(true);
  });

  it("coerces numeric strings and clamps to valid ranges", () => {
    const def = parseEnemy({ id: "x", maxHealth: "20", vision: 999, minDepth: 0 })!;
    expect(def.maxHealth).toBe(20); // "20" -> 20
    expect(def.vision).toBe(20); // clamped to max
    expect(def.minDepth).toBe(1); // clamped to min
  });

  it("rounds integer fields", () => {
    expect(parseEnemy({ id: "r", maxHealth: 7.8 })!.maxHealth).toBe(8);
  });
});

describe("parseEnemies / parseItems (collection guards)", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("drops invalid entries but keeps valid ones", () => {
    const list = parseEnemies([
      { id: "ok", name: "Fine" },
      { name: "missing id" },
      null,
      42,
      { id: "ok2" },
    ]);
    expect(list.map((e) => e.id)).toEqual(["ok", "ok2"]);
  });

  it("returns an empty array for non-array / missing input", () => {
    expect(parseEnemies(undefined)).toEqual([]);
    expect(parseEnemies({ not: "an array" })).toEqual([]);
    expect(parseItems(null)).toEqual([]);
  });

  it("preserves item type-specific fields", () => {
    const items = parseItems([
      { id: "sword", name: "Short Sword", type: "weapon", damageMin: 2, damageMax: 6 },
    ]);
    expect(items[0]).toMatchObject({ id: "sword", type: "weapon", damageMin: 2, damageMax: 6 });
  });
});
