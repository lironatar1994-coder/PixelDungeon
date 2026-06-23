import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { RNG } from "@/core/rng/Mulberry32";
import { TICK } from "@/core/turn/Actor";
import { TurnQueue } from "@/core/turn/TurnQueue";
import { Enemy, type EnemySenses } from "@/core/actors/Enemy";
import type { EnemyDef } from "@/core/data/types";

/** A test enemy definition with overridable fields. */
function def(over: Partial<EnemyDef> = {}): EnemyDef {
  return {
    id: "test",
    name: "Test Beast",
    maxHealth: 10,
    speed: 1,
    vision: 8,
    accuracy: 10,
    evasion: 5,
    damageMin: 1,
    damageMax: 3,
    armor: 0,
    spawnWeight: 1,
    minDepth: 1,
    expReward: 1,
    maxLevelCap: 30,
    description: "",
    ...over,
  };
}

/** A controllable senses object for isolated AI tests. */
function makeSenses(
  grid: Grid,
  hero: { pos: number },
  overrides: Partial<EnemySenses> = {},
): EnemySenses {
  return {
    grid,
    rng: new RNG("enemy-test"),
    heroPos: () => hero.pos,
    isOccupied: () => false,
    isTransparent: (cell) => grid.isTransparent(cell),
    attackHero: () => {},
    ...overrides,
  };
}

describe("Enemy state machine", () => {
  it("REQUIRED: transitions Wander -> Hunt when it gains line of sight", () => {
    const grid = new Grid(11, 3, Terrain.FLOOR);
    const hero = { pos: grid.cell(8, 1) };
    const enemy = new Enemy(grid.cell(1, 1), def(), makeSenses(grid, hero));

    expect(enemy.state).toBe("wander");
    enemy.act();
    expect(enemy.state).toBe("hunt");
    expect(enemy.lastKnownHeroPos).toBe(hero.pos);
  });

  it("REQUIRED: stays in Wander when line of sight is blocked by a wall", () => {
    const grid = new Grid(11, 3, Terrain.FLOOR);
    grid.set(grid.cell(4, 1), Terrain.WALL); // wall between enemy and hero
    const hero = { pos: grid.cell(8, 1) };
    const enemy = new Enemy(grid.cell(1, 1), def(), makeSenses(grid, hero));

    enemy.act();
    expect(enemy.state).toBe("wander");
  });

  it("REQUIRED: respects the tick-cost system (spends TICK / speed)", () => {
    const grid = new Grid(11, 3, Terrain.FLOOR);
    const hero = { pos: grid.cell(8, 1) };

    const normal = new Enemy(grid.cell(1, 1), def({ speed: 1 }), makeSenses(grid, hero));
    normal.act();
    expect(normal.time).toBeCloseTo(TICK, 6);

    const fast = new Enemy(grid.cell(1, 1), def({ speed: 2 }), makeSenses(grid, hero));
    fast.act();
    expect(fast.time).toBeCloseTo(TICK / 2, 6);
  });

  it("REQUIRED: a fast enemy gets more turns than a slow one in the queue", () => {
    const grid = new Grid(15, 15, Terrain.FLOOR);
    const hero = { pos: grid.cell(14, 14) }; // far away -> both wander

    class CountingEnemy extends Enemy {
      acted = 0;
      override act(): boolean {
        this.acted++;
        return super.act();
      }
    }

    const queue = new TurnQueue();
    const fast = new CountingEnemy(grid.cell(1, 1), def({ speed: 2 }), makeSenses(grid, hero));
    const slow = new CountingEnemy(grid.cell(2, 2), def({ speed: 1 }), makeSenses(grid, hero));
    queue.add(fast);
    queue.add(slow);
    for (let i = 0; i < 300; i++) queue.step();

    expect(fast.acted).toBeGreaterThan(slow.acted);
    const ratio = fast.acted / slow.acted;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it("hunts: chases the hero with A* and stops adjacent (no overlap)", () => {
    const grid = new Grid(11, 3, Terrain.FLOOR);
    const hero = { pos: grid.cell(8, 1) };
    const enemy = new Enemy(grid.cell(1, 1), def(), makeSenses(grid, hero));

    const distance = () =>
      Math.abs(grid.xOf(enemy.pos) - grid.xOf(hero.pos)) +
      Math.abs(grid.yOf(enemy.pos) - grid.yOf(hero.pos));

    const before = distance();
    enemy.act();
    expect(distance()).toBeLessThan(before); // moved closer

    for (let i = 0; i < 20; i++) enemy.act();
    expect(enemy.state).toBe("hunt");
    expect(distance()).toBe(1); // adjacent
    expect(enemy.pos).not.toBe(hero.pos); // never steps onto the hero
  });

  it("attacks before pathfinding when the hero is diagonally adjacent", () => {
    const grid = new Grid(5, 5, Terrain.FLOOR);
    const hero = { pos: grid.cell(3, 3) };
    let attacks = 0;
    const enemy = new Enemy(
      grid.cell(2, 2),
      def(),
      makeSenses(grid, hero, { attackHero: () => attacks++ }),
    );

    enemy.act();

    expect(enemy.state).toBe("hunt");
    expect(attacks).toBe(1);
    expect(enemy.pos).toBe(grid.cell(2, 2));
  });

  it("gives up (Hunt -> Wander) after reaching the hero's last known spot", () => {
    const grid = new Grid(11, 3, Terrain.FLOOR);
    const hero = { pos: grid.cell(5, 1) };
    const enemy = new Enemy(grid.cell(1, 1), def(), makeSenses(grid, hero));

    enemy.act(); // sees hero -> hunt, records last known pos
    expect(enemy.state).toBe("hunt");

    // Hero teleports out of sight behind a wall; enemy walks to last known spot.
    grid.set(grid.cell(8, 1), Terrain.WALL);
    hero.pos = grid.cell(10, 1); // now blocked from view
    for (let i = 0; i < 20; i++) enemy.act();

    expect(enemy.state).toBe("wander");
  });
});
