import { describe, it, expect } from "vitest";
import { Hero } from "@/core/actors/Hero";

function makeHero(): Hero {
  return new Hero(
    0,
    {
      maxHealth: 20,
      accuracy: 12,
      evasion: 8,
      damageMin: 1,
      damageMax: 3,
      armor: 0,
      speed: 1,
      strength: 15,
    },
    { attack: () => {} },
  );
}

describe("Hero progression", () => {
  it("uses SPD-style level thresholds and heals on level up", () => {
    const hero = makeHero();
    hero.stats.takeDamage(12);

    expect(hero.level).toBe(1);
    expect(hero.maxExperience()).toBe(10);

    const result = hero.addExperience(10);

    expect(result).toEqual({ gained: 10, levelsGained: 1 });
    expect(hero.level).toBe(2);
    expect(hero.experience).toBe(0);
    expect(hero.stats.baseOf("maxHealth")).toBe(25);
    expect(hero.stats.hp).toBe(25);
    expect(hero.stats.baseOf("accuracy")).toBe(13);
    expect(hero.stats.baseOf("evasion")).toBe(9);
    expect(hero.maxExperience()).toBe(15);
  });

  it("preserves overflow experience across multiple thresholds", () => {
    const hero = makeHero();

    hero.addExperience(12);

    expect(hero.level).toBe(2);
    expect(hero.experience).toBe(2);
  });

  it("spends a speed-scaled turn when resolving a pick-up intent", () => {
    let pickedUp = 0;
    const hero = new Hero(
      0,
      {
        maxHealth: 20,
        accuracy: 12,
        evasion: 8,
        damageMin: 1,
        damageMax: 3,
        armor: 0,
        speed: 2,
        strength: 15,
      },
      { attack: () => {}, pickUp: () => pickedUp++ },
    );

    hero.pending = { kind: "pickUp" };

    expect(hero.act()).toBe(true);
    expect(pickedUp).toBe(1);
    expect(hero.time).toBeCloseTo(0.5);
  });
});
