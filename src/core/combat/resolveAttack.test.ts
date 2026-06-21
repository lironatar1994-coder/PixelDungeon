import { describe, it, expect } from "vitest";
import { RNG } from "@/core/rng/Mulberry32";
import { CombatStats, type BaseStats } from "@/core/combat/CombatStats";
import { resolveAttack } from "@/core/combat/resolveAttack";

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

describe("resolveAttack (two-pass seeded combat)", () => {
  it("REQUIRED: a fixed seed yields identical exchanges every time", () => {
    const run = () => {
      const rng = new RNG("FIGHT-SEED");
      const attacker = stats({ accuracy: 10, damageMin: 2, damageMax: 6 });
      const defender = stats({ evasion: 5, armor: 1 });
      return Array.from({ length: 50 }, () =>
        resolveAttack(attacker, defender, rng),
      );
    };
    expect(run()).toEqual(run());
  });

  it("different seeds diverge", () => {
    const seq = (seed: string) => {
      const rng = new RNG(seed);
      const a = stats();
      const d = stats();
      return Array.from({ length: 50 }, () => resolveAttack(a, d, rng).damage);
    };
    expect(seq("seed-1")).not.toEqual(seq("seed-2"));
  });

  it("always hits when the defender's evasion is 0", () => {
    const rng = new RNG("hit");
    const a = stats({ accuracy: 10 });
    const d = stats({ evasion: 0 });
    for (let i = 0; i < 100; i++) {
      expect(resolveAttack(a, d, rng).hit).toBe(true);
    }
  });

  it("deals exact damage with a fixed range and no armor", () => {
    const rng = new RNG("dmg");
    const a = stats({ accuracy: 10, damageMin: 4, damageMax: 4 });
    const d = stats({ evasion: 0, armor: 0 });
    for (let i = 0; i < 50; i++) {
      const r = resolveAttack(a, d, rng);
      expect(r.hit).toBe(true);
      expect(r.damage).toBe(4); // Random(4..4)=4, minus Random(0..0)=0
    }
  });

  it("never deals negative damage and respects max(0, raw - armor)", () => {
    const rng = new RNG("armor");
    const a = stats({ accuracy: 10, damageMin: 1, damageMax: 5 });
    const d = stats({ evasion: 0, armor: 8 }); // armor can exceed damage
    for (let i = 0; i < 200; i++) {
      const r = resolveAttack(a, d, rng);
      expect(r.damage).toBeGreaterThanOrEqual(0);
      if (r.hit) {
        expect(r.rawDamage).toBeGreaterThanOrEqual(1);
        expect(r.rawDamage).toBeLessThanOrEqual(5);
        expect(r.damage).toBe(Math.max(0, r.rawDamage - r.blocked));
      }
    }
  });
});
