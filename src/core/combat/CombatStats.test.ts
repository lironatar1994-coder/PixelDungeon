import { describe, it, expect } from "vitest";
import { CombatStats, type BaseStats } from "@/core/combat/CombatStats";

function stats(over: Partial<BaseStats> = {}): CombatStats {
  return new CombatStats({
    maxHealth: 20,
    accuracy: 10,
    evasion: 5,
    damageMin: 2,
    damageMax: 6,
    armor: 0,
    ...over,
  });
}

describe("CombatStats component", () => {
  it("starts at full health and reports base stats", () => {
    const s = stats();
    expect(s.hp).toBe(20);
    expect(s.accuracy).toBe(10);
    expect(s.evasion).toBe(5);
    expect(s.alive).toBe(true);
  });

  it("applies a modifier on top of the base without changing the base", () => {
    const s = stats({ evasion: 5 });
    s.addModifier({ id: "buff", stat: "evasion", amount: 10 });
    expect(s.evasion).toBe(15); // effective
    expect(s.baseOf("evasion")).toBe(5); // base untouched
  });

  it("REQUIRED: a temporary modifier expires and restores the base stat", () => {
    const s = stats({ evasion: 5 });
    s.addModifier({ id: "elixir", stat: "evasion", amount: 8, turns: 3 });
    expect(s.evasion).toBe(13);
    s.tick(); // 2 left
    s.tick(); // 1 left
    expect(s.evasion).toBe(13);
    s.tick(); // expires
    expect(s.evasion).toBe(5); // back to base, no corruption
    expect(s.baseOf("evasion")).toBe(5);
  });

  it("removes all modifiers sharing a source id (e.g. unequip)", () => {
    const s = stats({ damageMin: 1, damageMax: 3 });
    s.addModifier({ id: "equip:weapon", stat: "damageMin", amount: 2 });
    s.addModifier({ id: "equip:weapon", stat: "damageMax", amount: 6 });
    expect(s.damageMin).toBe(3);
    expect(s.damageMax).toBe(9);
    s.removeModifiers("equip:weapon");
    expect(s.damageMin).toBe(1);
    expect(s.damageMax).toBe(3);
  });

  it("defaults attack delay to one turn and layers modifiers safely", () => {
    const s = stats();
    expect(s.attackDelay).toBe(1);
    expect(s.baseOf("attackDelay")).toBe(1);

    s.addModifier({ id: "quick-weapon", stat: "attackDelay", amount: -0.5 });
    expect(s.attackDelay).toBe(0.5);
    expect(s.baseOf("attackDelay")).toBe(1);

    s.removeModifiers("quick-weapon");
    expect(s.attackDelay).toBe(1);
  });

  it("never lets an effective stat go negative", () => {
    const s = stats({ armor: 2 });
    s.addModifier({ id: "shred", stat: "armor", amount: -10 });
    expect(s.armor).toBe(0);
  });

  it("clamps current hp when a maxHealth bonus is removed", () => {
    const s = stats({ maxHealth: 20 });
    s.addModifier({ id: "vitality", stat: "maxHealth", amount: 10 });
    s.heal(100);
    expect(s.hp).toBe(30);
    s.removeModifiers("vitality");
    expect(s.maxHealth).toBe(20);
    expect(s.hp).toBe(20); // clamped down, not left at 30
  });

  it("takes damage and dies at zero", () => {
    const s = stats({ maxHealth: 10 });
    expect(s.takeDamage(4)).toBe(4);
    expect(s.hp).toBe(6);
    s.takeDamage(999); // can't over-drain below 0
    expect(s.hp).toBe(0);
    expect(s.alive).toBe(false);
  });

  it("heals but not past maxHealth", () => {
    const s = stats({ maxHealth: 10 });
    s.takeDamage(8);
    expect(s.heal(100)).toBe(8);
    expect(s.hp).toBe(10);
  });
});
