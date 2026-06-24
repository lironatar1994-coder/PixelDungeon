import { describe, it, expect } from "vitest";
import {
  GameWorld,
  type CombatStrikeInfo,
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
  [{ id: "tester", name: "Tester", maxHealth: 20, strength: 15, sprite: "warrior", startingItems: ["potion_healing"] }],
);

const contentWithGroundPotion = ContentDatabase.fromRaw(
  [],
  [{ id: "potion_strength", name: "Potion of Strength", type: "potion", strengthBonus: 1 }],
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
  [{ id: "tester", name: "Tester", maxHealth: 20, strength: 15, sprite: "warrior", startingItems: ["short_sword"] }],
);

const contentWithLevelUpEnemy = ContentDatabase.fromRaw(
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
      expReward: 10,
    },
  ],
  [
    {
      id: "short_sword",
      name: "Test Blade",
      type: "weapon",
      damageMin: 10,
      damageMax: 10,
    },
  ],
);

const contentWithHeavyStarter = ContentDatabase.fromRaw(
  [],
  [
    {
      id: "short_sword",
      name: "Heavy Starter Sword",
      type: "weapon",
      tier: 4,
      damageMin: 2,
      damageMax: 6,
      strengthRequired: 16,
    },
    {
      id: "potion_strength",
      name: "Potion of Strength",
      type: "potion",
      strengthBonus: 1,
    },
  ],
  [{ id: "tester", name: "Tester", maxHealth: 20, strength: 15, sprite: "warrior", startingItems: ["short_sword"] }],
);

const contentWithProfiles = ContentDatabase.fromRaw(
  [],
  [
    { id: "short_sword", name: "Short Sword", type: "weapon", damageMin: 2, damageMax: 6 },
    { id: "quarterstaff", name: "Quarterstaff", type: "weapon", damageMin: 1, damageMax: 8 },
    { id: "ration", name: "Ration", type: "food" },
  ],
  [
    { id: "warrior", name: "Warrior", maxHealth: 20, strength: 15, sprite: "warrior", startingItems: ["short_sword", "ration"] },
    { id: "mage", name: "Mage", maxHealth: 15, strength: 15, sprite: "mage", startingItems: ["quarterstaff", "ration"] },
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

  it("opens doors when entering them, closes on leave, and supports explicit close", () => {
    const w = makeWorld("WORLD-DOOR", { enemyCount: 0 });
    const start = w.heroPos;
    const door = w.grid.neighbours4(start)[0]!;
    w.grid.set(door, Terrain.DOOR);
    w.level.openDoors.add(door);
    expect(w.tryCloseDoor(door)).toBe(true);
    expect(w.isOpenDoor(door)).toBe(false);

    const dx = w.grid.xOf(door) - w.grid.xOf(start);
    const dy = w.grid.yOf(door) - w.grid.yOf(start);
    expect(w.tryMoveHero(dx, dy)).toBe(true);
    expect(w.heroPos).toBe(door);
    expect(w.isOpenDoor(door)).toBe(true);

    expect(w.tryMoveHero(-dx, -dy)).toBe(true);
    expect(w.heroPos).toBe(start);
    expect(w.isOpenDoor(door)).toBe(false);
    expect(w.log).not.toContain("You open the door.");
    expect(w.log).not.toContain("You close the door.");
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

  it("starts runs from the selected hero profile", () => {
    const mage = new GameWorld("WORLD-MAGE", contentWithProfiles, {
      enemyCount: 0,
      heroId: "mage",
    });

    expect(mage.heroClassName).toBe("Mage");
    expect(mage.heroProfileId).toBe("mage");
    expect(mage.heroSprite).toBe("mage");
    expect(mage.heroStats.maxHealth).toBe(15);
    expect(mage.inventory.all.map((item) => item.defId)).toEqual(["quarterstaff", "ration"]);
    expect(mage.inventory.equippedIn("weapon")?.defId).toBe("quarterstaff");
    expect(mage.snapshot().heroProfileId).toBe("mage");

    const loaded = GameWorld.fromSnapshot(mage.snapshot(), contentWithProfiles);
    expect(loaded.heroProfileId).toBe("mage");
    expect(loaded.heroClassName).toBe("Mage");
  });

  it("picks up a ground item into inventory as a hero action", () => {
    const base = new GameWorld("WORLD-PICKUP", contentWithGroundPotion, { enemyCount: 0 });
    const pickupCell = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => (
        base.grid.isWalkable(cell) &&
        cell !== base.level.entrance &&
        cell !== base.level.exit
      ));
    expect(pickupCell).toBeDefined();

    const snapshot = base.snapshot();
    snapshot.hero.pos = pickupCell!;
    snapshot.dungeon.levels[0]!.groundItems = [
      {
        cell: pickupCell!,
        item: {
          uid: "ground_strength",
          defId: "potion_strength",
          level: 0,
          levelKnown: true,
          cursed: false,
          cursedKnown: false,
        },
      },
    ];
    const w = GameWorld.fromSnapshot(snapshot, contentWithGroundPotion);

    expect(w.level.itemAt(w.heroPos)?.defId).toBe("potion_strength");
    expect(w.tryPickUpItem()).toBe(true);

    expect(w.level.itemAt(w.heroPos)).toBeNull();
    expect(w.inventory.all.some((item) => item.defId === "potion_strength")).toBe(true);
    expect(w.log.at(-1)).toBe("++ You picked up: Potion of Strength.");

    // With no other actors on the queue, fixTime normalizes the hero back to 0;
    // the successful pickup/log/inventory mutation proves the turn resolved.
    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBe(0);
  });

  it("emits a pickup callback after adding a ground item to inventory", () => {
    const base = new GameWorld("WORLD-PICKUP-EVENT", contentWithGroundPotion, { enemyCount: 0 });
    const pickupCell = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => (
        base.grid.isWalkable(cell) &&
        cell !== base.level.entrance &&
        cell !== base.level.exit
      ));
    expect(pickupCell).toBeDefined();

    const snapshot = base.snapshot();
    snapshot.hero.pos = pickupCell!;
    snapshot.dungeon.levels[0]!.groundItems = [
      {
        cell: pickupCell!,
        item: {
          uid: "ground_strength_event",
          defId: "potion_strength",
          level: 0,
          levelKnown: true,
          cursed: false,
          cursedKnown: false,
        },
      },
    ];

    const events: Array<{ itemUid: string; itemId: string; cell: number }> = [];
    const w = GameWorld.fromSnapshot(snapshot, contentWithGroundPotion, {
      onItemPickup: (event) => events.push(event),
    });

    expect(w.tryPickUpItem()).toBe(true);
    expect(events).toEqual([{ itemUid: "ground_strength_event", itemId: "potion_strength", cell: pickupCell! }]);
  });

  it("wait spends one hero action scaled by the current speed stat", () => {
    const w = makeWorld("WORLD-WAIT", { enemyCount: 0 });
    w.heroStats.addModifier({ id: "haste-test", stat: "speed", amount: 1 });

    expect(w.waitTurn()).toBe(true);

    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.5);
  });

  it("intentional search reveals adjacent hidden doors and traps", () => {
    const w = makeWorld("WORLD-SEARCH-FOUND", { enemyCount: 0 });
    const [doorCell, trapCell] = w.grid.neighbours4(w.heroPos);
    expect(doorCell).toBeDefined();
    expect(trapCell).toBeDefined();

    w.grid.set(doorCell!, Terrain.SECRET_DOOR);
    w.grid.set(trapCell!, Terrain.SECRET_TRAP);
    w.level.trapMetadata.push({
      cell: trapCell!,
      kind: "wornDart",
      visible: false,
      active: true,
    });
    w.heroStats.addModifier({ id: "haste-test", stat: "speed", amount: 1 });
    w.recomputeFOV();

    expect(w.search()).toBe(true);

    expect(w.grid.get(doorCell!)).toBe(Terrain.DOOR);
    expect(w.grid.get(trapCell!)).toBe(Terrain.TRAP);
    expect(w.level.trapMetadata.find((trap) => trap.cell === trapCell)?.visible).toBe(true);
    expect(w.log.at(-1)).toBe("** You noticed something.");
    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.5);
  });

  it("intentional search spends a turn even when nothing is found", () => {
    const w = makeWorld("WORLD-SEARCH-EMPTY", { enemyCount: 0 });
    const heroX = w.grid.xOf(w.heroPos);
    const heroY = w.grid.yOf(w.heroPos);
    for (let y = heroY - 1; y <= heroY + 1; y++) {
      for (let x = heroX - 1; x <= heroX + 1; x++) {
        if (w.grid.inBounds(x, y)) w.grid.set(w.grid.cell(x, y), Terrain.FLOOR);
      }
    }
    w.heroStats.addModifier({ id: "haste-test", stat: "speed", amount: 1 });
    w.recomputeFOV();

    expect(w.search()).toBe(true);

    expect(w.log).not.toContain("** You noticed something.");
    const heroTurn = w.snapshot().queue.actors.find((actor) => actor.id === "hero");
    expect(heroTurn?.time).toBeCloseTo(0.5);
  });

  it("hero hard-press triggers hidden traps while search only reveals them", () => {
    const triggered: string[] = [];
    const w = makeWorld("WORLD-HIDDEN-TRAP", {
      enemyCount: 0,
      onTrapTriggered: (info) => triggered.push(info.kind),
    });
    const target = w.grid.neighbours4(w.heroPos).find((cell) => w.grid.isWalkable(cell));
    expect(target).toBeDefined();
    w.grid.set(target!, Terrain.SECRET_TRAP);
    w.level.trapMetadata.push({
      cell: target!,
      kind: "alarm",
      visible: false,
      active: true,
    });

    const dx = w.grid.xOf(target!) - w.grid.xOf(w.heroPos);
    const dy = w.grid.yOf(target!) - w.grid.yOf(w.heroPos);
    expect(w.tryMoveHero(dx, dy)).toBe(true);

    const trap = w.level.trapMetadata.find((candidate) => candidate.cell === target);
    expect(triggered).toEqual(["alarm"]);
    expect(trap?.active).toBe(false);
    expect(trap?.visible).toBe(true);
    expect(w.grid.get(target!)).toBe(Terrain.INACTIVE_TRAP);
    expect(w.log.some((line) => line.includes("hidden alarm trap"))).toBe(true);
  });

  it("soft-pressing a hidden trap does not trigger it", () => {
    const w = makeWorld("WORLD-SOFT-HIDDEN-TRAP", { enemyCount: 1 });
    const cell = w.heroPos;
    w.grid.set(cell, Terrain.SECRET_TRAP);
    w.level.trapMetadata.push({ cell, kind: "alarm", visible: false, active: true });

    pressCellForTest(w, cell, false, w.enemies[0] ?? {});

    expect(w.level.trapMetadata.at(-1)?.active).toBe(true);
    expect(w.grid.get(cell)).toBe(Terrain.SECRET_TRAP);
  });

  it("worn dart traps damage the actor on the trap cell", () => {
    const w = makeWorld("WORLD-WORN-DART", { enemyCount: 0 });
    const before = w.heroStats.hp;

    triggerTrapForTest(w, "wornDart");

    expect(w.heroStats.hp).toBeLessThan(before);
    expect(w.grid.get(w.level.trapMetadata.at(-1)!.cell)).toBe(Terrain.INACTIVE_TRAP);
  });

  it("alarm traps beckon every enemy toward the trap cell", () => {
    const w = makeWorld("WORLD-ALARM", { enemyCount: 2 });
    expect(w.enemies.length).toBeGreaterThan(0);
    const cell = w.heroPos;

    triggerTrapForTest(w, "alarm");

    for (const enemy of w.enemies) {
      expect(enemy.state).toBe("hunt");
      expect(enemy.lastKnownHeroPos).toBe(cell);
    }
  });

  it("summoning traps spawn deterministic depth-valid enemies nearby", () => {
    const w = makeWorld("WORLD-SUMMONING", { enemyCount: 0 });
    const before = w.enemies.length;

    triggerTrapForTest(w, "summoning");

    expect(w.enemies.length).toBeGreaterThan(before);
    expect(w.enemies.length).toBeLessThanOrEqual(before + 3);
  });

  it("teleportation traps move the hero to a valid destination", () => {
    const w = makeWorld("WORLD-TELEPORTATION", { enemyCount: 0 });
    const before = w.heroPos;

    triggerTrapForTest(w, "teleportation");

    expect(w.heroPos).not.toBe(before);
    expect(w.grid.isWalkable(w.heroPos)).toBe(true);
  });

  it("gateway traps stay active and persist their destination through save/load", () => {
    const w = makeWorld("WORLD-GATEWAY", { enemyCount: 0 });

    triggerTrapForTest(w, "gateway");

    const trap = w.level.trapMetadata.at(-1)!;
    expect(trap.active).toBe(true);
    expect(trap.gatewayTargetCell).toBeDefined();
    expect(w.grid.get(trap.cell)).toBe(Terrain.TRAP);

    const loaded = GameWorld.fromSnapshot(w.snapshot(), content);
    const loadedTrap = loaded.level.trapMetadata.find((candidate) => candidate.cell === trap.cell);
    expect(loadedTrap?.active).toBe(true);
    expect(loadedTrap?.gatewayTargetCell).toBe(trap.gatewayTargetCell);
  });

  it.each([
    ["chilling", "freezing"],
    ["shocking", "electricity"],
    ["toxic", "toxicGas"],
    ["confusion", "confusionGas"],
  ] as const)("creates a serializable %s trap hazard", (kind, hazard) => {
    const w = makeWorld(`WORLD-${kind}`, { enemyCount: 0 });

    triggerTrapForTest(w, kind);

    expect(w.snapshot().worldEffects?.some((effect) => effect.kind === hazard)).toBe(true);
  });

  it("ooze traps apply timed ooze modifiers", () => {
    const w = makeWorld("WORLD-OOZE", { enemyCount: 0 });

    triggerTrapForTest(w, "ooze");

    expect(w.heroStats.activeModifiers().some((modifier) => modifier.id.startsWith("trap:ooze"))).toBe(true);
  });

  it("flock traps create temporary blocking cells", () => {
    const w = makeWorld("WORLD-FLOCK", { enemyCount: 0 });

    triggerTrapForTest(w, "flock");

    const flock = w.snapshot().worldEffects?.find((effect) => effect.kind === "flock");
    expect(flock?.blocksMovement).toBe(true);
    expect(flock?.cells?.length).toBeGreaterThan(0);
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

  it("grants enemy EXP only while the hero is within the enemy level cap", () => {
    const base = new GameWorld("WORLD-EXP-GRANT", contentWithFastWeapon, {
      enemyCount: 1,
    });
    const adjacent = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => base.grid.isWalkable(cell));
    expect(adjacent).toBeDefined();

    const snapshot = base.snapshot();
    snapshot.enemies[0]!.pos = adjacent!;
    snapshot.enemies[0]!.stats.hp = 1;
    const w = GameWorld.fromSnapshot(snapshot, contentWithFastWeapon);

    const dx = w.grid.xOf(adjacent!) - w.grid.xOf(w.heroPos);
    const dy = w.grid.yOf(adjacent!) - w.grid.yOf(w.heroPos);
    expect(w.tryMoveHero(dx, dy)).toBe(true);

    expect(w.enemies.length).toBe(0);
    expect(w.heroExperience).toBe(1);
    expect(w.heroLevel).toBe(1);
  });

  it("logs level up and enemy defeat events with positive tone", () => {
    const base = new GameWorld("WORLD-LEVEL-LOG", contentWithLevelUpEnemy, {
      enemyCount: 1,
    });
    const adjacent = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => base.grid.isWalkable(cell));
    expect(adjacent).toBeDefined();

    const snapshot = base.snapshot();
    snapshot.enemies[0]!.pos = adjacent!;
    snapshot.enemies[0]!.stats.hp = 1;
    const w = GameWorld.fromSnapshot(snapshot, contentWithLevelUpEnemy);

    const dx = w.grid.xOf(adjacent!) - w.grid.xOf(w.heroPos);
    const dy = w.grid.yOf(adjacent!) - w.grid.yOf(w.heroPos);
    expect(w.tryMoveHero(dx, dy)).toBe(true);

    expect(w.heroLevel).toBe(2);
    expect(w.log).toContain("++ Level up! +Accuracy, +Evasion, +5 HP!");
    expect(w.log).toContain("++ Defeated the Training Dummy.");
  });

  it("blocks EXP from enemies below the hero's current level", () => {
    const cappedContent = ContentDatabase.fromRaw(
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
          expReward: 10,
          maxLevelCap: 1,
        },
      ],
      [
        {
          id: "short_sword",
          name: "Test Blade",
          type: "weapon",
          damageMin: 10,
          damageMax: 10,
        },
      ],
    );
    const base = new GameWorld("WORLD-EXP-CAP", cappedContent, { enemyCount: 1 });
    const adjacent = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => base.grid.isWalkable(cell));
    expect(adjacent).toBeDefined();

    const snapshot = base.snapshot();
    snapshot.hero.level = 2;
    snapshot.enemies[0]!.pos = adjacent!;
    snapshot.enemies[0]!.stats.hp = 1;
    const w = GameWorld.fromSnapshot(snapshot, cappedContent);

    const dx = w.grid.xOf(adjacent!) - w.grid.xOf(w.heroPos);
    const dy = w.grid.yOf(adjacent!) - w.grid.yOf(w.heroPos);
    expect(w.tryMoveHero(dx, dy)).toBe(true);

    expect(w.enemies.length).toBe(0);
    expect(w.heroExperience).toBe(0);
  });

  it("quaffing Potion of Strength permanently increases strength and refreshes encumbrance", () => {
    const base = new GameWorld("WORLD-STRENGTH-POTION", contentWithHeavyStarter, {
      enemyCount: 0,
    });
    expect(base.heroStats.strength).toBe(15);
    expect(base.heroStats.attackDelay).toBeCloseTo(1.2);

    const snapshot = base.snapshot();
    snapshot.inventory.items!.push({
      uid: "strength_potion",
      defId: "potion_strength",
      level: 0,
      levelKnown: true,
      cursed: false,
      cursedKnown: false,
      quantity: 1,
    });
    const w = GameWorld.fromSnapshot(snapshot, contentWithHeavyStarter);

    expect(w.consumeItem("strength_potion")).toBe(true);

    expect(w.heroStats.baseOf("strength")).toBe(16);
    expect(w.heroStats.strength).toBe(16);
    expect(w.heroStats.attackDelay).toBe(1);
    expect(w.inventory.all.some((item) => item.defId === "potion_strength")).toBe(false);
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

    const strikes: CombatStrikeInfo[] = [];
    const w = GameWorld.fromSnapshot(snapshot, contentWithFastWeapon, {
      onCombatStrike: (info) => strikes.push(info),
    });
    expect(w.rangedAttack(targetCell)).toBe(true);
    expect(w.enemies.length).toBe(0);
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({
      attackerId: "hero",
      attackerCell: heroCell,
      defenderCell: targetCell,
      hit: true,
      damage: 1,
    });
    expect(strikes[0]!.defenderId).toMatch(/^enemy:/);

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
    expect(w.log.at(-1)).toBe("** No clear shot.");
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

    const base = new GameWorld("DMG-EVENT", aggressive, { enemyCount: 1 });
    const adjacent = base.grid
      .neighbours4(base.heroPos)
      .find((cell) => base.grid.isWalkable(cell));
    expect(adjacent).toBeDefined();
    const snapshot = base.snapshot();
    snapshot.enemies[0]!.pos = adjacent!;

    const events: HeroDamagedInfo[] = [];
    const w = GameWorld.fromSnapshot(snapshot, aggressive, {
      onHeroDamaged: (info) => events.push(info),
    });
    const maxHp = w.heroStats.maxHealth;

    expect(w.waitTurn()).toBe(true);

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

type TestPressWorld = {
  pressCell(cell: number, hard: boolean, actor: object): void;
};

function triggerTrapForTest(w: GameWorld, kind: string): void {
  const center = w.heroPos;
  for (const cell of [center, ...w.grid.neighbours8(center)]) {
    w.grid.set(cell, Terrain.FLOOR);
  }
  w.grid.set(center, Terrain.TRAP);
  w.level.trapMetadata.push({
    cell: center,
    kind,
    visible: true,
    active: true,
  });
  pressCellForTest(w, center, true, {});
}

function pressCellForTest(w: GameWorld, cell: number, hard: boolean, actor: object): void {
  (w as unknown as TestPressWorld).pressCell(cell, hard, actor);
}
