import { describe, it, expect } from "vitest";
import {
  GameWorld,
  type WorldOptions,
  type HeroDamagedInfo,
} from "@/core/game/GameWorld";
import { ContentDatabase } from "@/core/data/ContentDatabase";
import { Terrain } from "@/core/grid/terrain";

// A small, valid content set so the world has data-driven enemies to spawn.
const content = ContentDatabase.fromRaw(
  [
    { id: "rat", name: "Sewer Rat", maxHealth: 8, speed: 2, vision: 6, spawnWeight: 4, minDepth: 1 },
    { id: "zombie", name: "Rotting Zombie", maxHealth: 25, speed: 0.5, vision: 4, spawnWeight: 2, minDepth: 1 },
  ],
  [],
);

const makeWorld = (seed: string, opts?: WorldOptions) =>
  new GameWorld(seed, content, opts);

const contentWithPotion = ContentDatabase.fromRaw(
  [],
  [{ id: "potion_healing", name: "Potion of Healing", type: "potion", heal: 15 }],
);

const contentWithFastWeapon = ContentDatabase.fromRaw(
  [
    {
      id: "training_dummy",
      name: "Training Dummy",
      maxHealth: 1,
      speed: 1,
      vision: 0,
      accuracy: 0,
      evasion: 0,
      damageMin: 0,
      damageMax: 0,
      armor: 0,
      spawnWeight: 1,
      minDepth: 1,
    },
  ],
  [
    {
      id: "short_sword",
      name: "Quick Test Blade",
      type: "weapon",
      damageMin: 10,
      damageMax: 10,
      attackDelay: 0.5,
    },
  ],
);

describe("GameWorld", () => {
  it("starts the hero on the floor entrance and spawns enemies", () => {
    const w = makeWorld("WORLD-A");
    expect(w.heroPos).toBe(w.level.entrance);
    expect(w.enemies.length).toBeGreaterThan(0);
  });

  it("lights the hero's cell and leaves distant cells unseen", () => {
    const w = makeWorld("WORLD-B");
    expect(w.fov.isVisible(w.heroPos)).toBe(true);
    // The down-stairs are placed in the farthest room -> not visible at start.
    expect(w.fov.isVisible(w.level.exit)).toBe(false);
  });

  it("only the hero moving grows explored memory", () => {
    const w = makeWorld("WORLD-C");
    const before = w.fov.exploredMemory.size;
    // Try each direction until one move succeeds.
    const moved = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].some(([dx, dy]) => w.tryMoveHero(dx!, dy!));
    expect(moved).toBe(true);
    expect(w.fov.exploredMemory.size).toBeGreaterThanOrEqual(before);
    expect(w.fov.isVisible(w.heroPos)).toBe(true);
  });

  it("is deterministic: same seed -> same hero & enemy placement", () => {
    const a = makeWorld("SAME");
    const b = makeWorld("SAME");
    expect(a.heroPos).toBe(b.heroPos);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
    expect(a.enemies.map((e) => e.speed)).toEqual(b.enemies.map((e) => e.speed));
  });

  it("rejects walking into a wall (no turn taken)", () => {
    const w = makeWorld("WORLD-D");
    const grid = w.grid;
    // Find a wall-adjacent direction and confirm the move is refused.
    const dirs: Array<[number, number]> = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dx, dy] of dirs) {
      const x = grid.xOf(w.heroPos) + dx;
      const y = grid.yOf(w.heroPos) + dy;
      if (grid.inBounds(x, y) && !grid.isWalkable(grid.cell(x, y))) {
        expect(w.tryMoveHero(dx, dy)).toBe(false);
        return;
      }
    }
  });

  it("preserves a floor's explored memory across stair travel", () => {
    const w = makeWorld("WORLD-E");
    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].some(([dx, dy]) => w.tryMoveHero(dx!, dy!));
    const exploredFloor1 = w.fov.exploredMemory.size;
    expect(exploredFloor1).toBeGreaterThan(0);

    w.descend();
    w.ascend();
    // Back on floor 1: its remembered cells are still there.
    expect(w.fov.exploredMemory.size).toBeGreaterThanOrEqual(exploredFloor1);
  });

  it("quaffs a healing potion from inventory as a hero action", () => {
    const w = new GameWorld("WORLD-F", contentWithPotion, { enemyCount: 0 });
    w.heroStats.takeDamage(12);

    expect(w.inventory.count).toBe(1);
    expect(w.quaffHealing()).toBe(true);

    expect(w.heroStats.hp).toBe(20);
    expect(w.inventory.count).toBe(0);
    expect(w.log.at(-1)).toContain("You quaff Potion of Healing");
  });

  it("wait spends one hero action scaled by the current speed stat", () => {
    const w = makeWorld("WORLD-WAIT", { enemyCount: 0 });
    w.heroStats.addModifier({ id: "haste-test", stat: "speed", amount: 1 });

    expect(w.waitTurn()).toBe(true);

    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.5);
  });

  it("bump-attacks spend weapon attack delay scaled by current hero speed", () => {
    const base = new GameWorld("WORLD-ATTACK-DELAY", contentWithFastWeapon, {
      enemyCount: 1,
    });
    const adjacent = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => base.grid.isWalkable(cell));
    expect(adjacent).toBeDefined();
    expect(base.enemies.length).toBeGreaterThan(0);

    const snapshot = base.snapshot();
    snapshot.enemies[0]!.pos = adjacent!;
    snapshot.enemies[0]!.stats.hp = 1;
    const w = GameWorld.fromSnapshot(snapshot, contentWithFastWeapon);
    w.heroStats.addModifier({ id: "haste-test", stat: "speed", amount: 1 });

    const dx = w.grid.xOf(adjacent!) - w.grid.xOf(w.heroPos);
    const dy = w.grid.yOf(adjacent!) - w.grid.yOf(w.heroPos);
    expect(w.tryMoveHero(dx, dy)).toBe(true);

    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.25);
  });

  it("rangedAttack damages an enemy through a clear line of fire", () => {
    const base = new GameWorld("WORLD-RANGED-CLEAR", contentWithFastWeapon, {
      enemyCount: 1,
    });
    const snapshot = base.snapshot();
    const level = snapshot.dungeon.levels[0]!;
    level.terrain = level.terrain.map(() => Terrain.FLOOR);

    const heroCell = base.grid.cell(1, 1);
    const targetCell = base.grid.cell(5, 1);
    snapshot.hero.pos = heroCell;
    snapshot.enemies[0]!.pos = targetCell;
    snapshot.enemies[0]!.stats.hp = 1;

    const w = GameWorld.fromSnapshot(snapshot, contentWithFastWeapon);
    expect(w.rangedAttack(targetCell)).toBe(true);
    expect(w.enemies.length).toBe(0);

    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.5);
  });

  it("rangedAttack refuses blocked lines without spending a turn", () => {
    const base = new GameWorld("WORLD-RANGED-BLOCKED", contentWithFastWeapon, {
      enemyCount: 1,
    });
    const snapshot = base.snapshot();
    const level = snapshot.dungeon.levels[0]!;
    level.terrain = level.terrain.map(() => Terrain.FLOOR);

    const heroCell = base.grid.cell(1, 1);
    const wallCell = base.grid.cell(3, 1);
    const targetCell = base.grid.cell(5, 1);
    level.terrain[wallCell] = Terrain.WALL;
    snapshot.hero.pos = heroCell;
    snapshot.enemies[0]!.pos = targetCell;

    const w = GameWorld.fromSnapshot(snapshot, contentWithFastWeapon);
    expect(w.rangedAttack(targetCell)).toBe(false);
    expect(w.enemies.length).toBe(1);

    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBe(0);
    expect(w.log.at(-1)).toBe("No clear shot.");
  });

  it("fires onHeroDamaged with the correct payload when a monster lands a hit", () => {
    // Aggressive, far-seeing monsters so contact + a landed hit is guaranteed.
    const aggressive = ContentDatabase.fromRaw(
      [
        {
          id: "brute",
          name: "Cave Brute",
          maxHealth: 40,
          speed: 1,
          vision: 20,
          accuracy: 60,
          evasion: 0,
          damageMin: 2,
          damageMax: 5,
          armor: 0,
          spawnWeight: 1,
          minDepth: 1,
        },
      ],
      [],
    );

    const events: HeroDamagedInfo[] = [];
    const w = new GameWorld("DMG-EVENT", aggressive, {
      enemyCount: 8,
      onHeroDamaged: (info) => events.push(info),
    });
    const maxHp = w.heroStats.maxHealth;

    // Walk one tile per turn toward the nearest enemy (bump-attacking when
    // adjacent) until the hero takes its first hit.
    let guard = 0;
    while (w.heroStats.hp === maxHp && w.heroAlive && guard++ < 4000) {
      const target = w.enemies[0];
      if (!target) {
        w.waitTurn();
        continue;
      }
      const dx = Math.sign(w.grid.xOf(target.pos) - w.grid.xOf(w.heroPos));
      const dy = Math.sign(w.grid.yOf(target.pos) - w.grid.yOf(w.heroPos));
      // Single-axis steps only (the world is 4-connected). Prefer the longer
      // axis, fall back to the other if blocked.
      if (Math.abs(w.grid.xOf(target.pos) - w.grid.xOf(w.heroPos)) >=
          Math.abs(w.grid.yOf(target.pos) - w.grid.yOf(w.heroPos))) {
        if (!w.tryMoveHero(dx, 0)) w.tryMoveHero(0, dy);
      } else {
        if (!w.tryMoveHero(0, dy)) w.tryMoveHero(dx, 0);
      }
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.amount > 0)).toBe(true);
    expect(events[0]!.source).toBe("Cave Brute");
    // The last event's reported hp matches the live stat, and the total damage
    // accounts for exactly the hp lost (no other source mutates hero hp here).
    expect(events.at(-1)!.hp).toBe(w.heroStats.hp);
    const totalDealt = events.reduce((sum, e) => sum + e.amount, 0);
    expect(totalDealt).toBe(maxHp - w.heroStats.hp);
  });
});
