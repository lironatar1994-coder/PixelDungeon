import { describe, it, expect } from "vitest";
import { ContentDatabase } from "@/core/data/ContentDatabase";
import { Enemy } from "@/core/actors/Enemy";
import { GameWorld, type WorldOptions } from "@/core/game/GameWorld";
import { Inventory } from "@/core/items/Inventory";
import { SaveManager, type SaveStorage } from "@/core/save/SaveManager";

class MemoryStorage implements SaveStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const content = ContentDatabase.fromRaw(
  [
    {
      id: "rat",
      name: "Sewer Rat",
      maxHealth: 8,
      speed: 2,
      vision: 6,
      accuracy: 9,
      evasion: 4,
      damageMin: 1,
      damageMax: 3,
      armor: 0,
      spawnWeight: 4,
      minDepth: 1,
    },
    {
      id: "zombie",
      name: "Rotting Zombie",
      maxHealth: 25,
      speed: 0.5,
      vision: 4,
      accuracy: 8,
      evasion: 1,
      damageMin: 2,
      damageMax: 6,
      armor: 1,
      spawnWeight: 2,
      minDepth: 1,
    },
  ],
  [
    { id: "short_sword", name: "Short Sword", type: "weapon", damageMin: 2, damageMax: 6 },
    { id: "leather_armor", name: "Leather Armor", type: "armor", defense: 2 },
    { id: "potion_healing", name: "Potion of Healing", type: "potion", heal: 15 },
    { id: "ration", name: "Ration of Food", type: "food", nutrition: 300 },
  ],
);

function moveOnce(world: GameWorld): void {
  const moved = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ].some(([dx, dy]) => world.tryMoveHero(dx!, dy!));
  expect(moved).toBe(true);
}

function makeWorld(seed: string, opts: WorldOptions = {}): GameWorld {
  return new GameWorld(seed, content, { enemyCount: 3, ...opts });
}

describe("SaveManager", () => {
  it("serializes to plain JSON without circular references", () => {
    const world = makeWorld("SAVE-CIRCULAR");
    moveOnce(world);

    const raw = SaveManager.stringify(world);

    expect(raw).toContain('"version":1');
    expect(raw).not.toContain("senses");
    expect(raw).not.toContain("content");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("rehydrates a complex world into living class instances", () => {
    const world = makeWorld("SAVE-ROUNDTRIP");
    moveOnce(world);
    world.heroStats.takeDamage(7);
    const before = world.snapshot();

    const loaded = SaveManager.parse(SaveManager.stringify(world), content);
    const after = loaded.snapshot();

    expect(loaded.heroPos).toBe(before.hero.pos);
    expect(loaded.heroStats.hp).toBe(13);
    expect(loaded.inventory).toBeInstanceOf(Inventory);
    expect(loaded.inventory.count).toBe(before.inventory.itemIds.length);
    expect(loaded.inventory.equippedIn("weapon")?.id).toBe("short_sword");
    expect(loaded.inventory.equippedIn("armor")?.id).toBe("leather_armor");
    expect(loaded.enemies.length).toBe(before.enemies.length);
    expect(loaded.enemies[0]).toBeInstanceOf(Enemy);
    expect(typeof loaded.enemies[0]?.canSeeHero()).toBe("boolean");
    expect(after.queue).toEqual(before.queue);
    expect(after.dungeon).toEqual(before.dungeon);
  });

  it("auto-saves through a Storage-like adapter and loads a fresh world", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, "test-save");
    let saves = 0;
    const world = makeWorld("SAVE-AUTO", {
      onChange: (changedWorld) => {
        saves++;
        manager.save(changedWorld);
      },
    });

    const start = world.heroPos;
    moveOnce(world);

    expect(saves).toBeGreaterThan(0);
    expect(storage.getItem("test-save")).not.toBeNull();

    const loaded = manager.load(content);
    expect(loaded).not.toBeNull();
    expect(loaded!.heroPos).not.toBe(start);
    expect(loaded!.heroPos).toBe(world.heroPos);
    expect(loaded!.snapshot().queue).toEqual(world.snapshot().queue);
  });

  it("preserves consumed inventory and healed HP across save/load", () => {
    const world = makeWorld("SAVE-POTION", { enemyCount: 0 });
    world.heroStats.takeDamage(12);
    expect(world.quaffHealing()).toBe(true);

    const loaded = SaveManager.parse(SaveManager.stringify(world), content);

    expect(loaded.heroStats.hp).toBe(20);
    expect(loaded.inventory.all.some((item) => item.id === "potion_healing")).toBe(false);
    expect(loaded.inventory.equippedIn("weapon")?.id).toBe("short_sword");
  });

  it("clears storage instead of saving a dead hero", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, "test-save");
    const liveWorld = makeWorld("SAVE-PERMADEATH-LIVE", { enemyCount: 0 });
    expect(manager.save(liveWorld)).toBe(true);
    expect(storage.getItem("test-save")).not.toBeNull();

    const deadSnapshot = liveWorld.snapshot();
    deadSnapshot.heroDead = true;
    deadSnapshot.hero.stats.hp = 0;
    const deadWorld = GameWorld.fromSnapshot(deadSnapshot, content);

    expect(deadWorld.heroAlive).toBe(false);
    expect(manager.save(deadWorld)).toBe(true);
    expect(storage.getItem("test-save")).toBeNull();
  });

  it("refuses to load stale dead snapshots and wipes them", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, "test-save");
    const snapshot = makeWorld("SAVE-PERMADEATH-LOAD", { enemyCount: 0 }).snapshot();
    snapshot.heroDead = true;
    snapshot.hero.stats.hp = 0;
    storage.setItem("test-save", JSON.stringify(snapshot));

    expect(manager.load(content)).toBeNull();
    expect(storage.getItem("test-save")).toBeNull();
  });

  it("reports valid living saves for the main menu continue button", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, "test-save");
    const world = makeWorld("SAVE-CONTINUE", { enemyCount: 0 });

    expect(manager.hasValidRun(content)).toBe(false);
    expect(manager.save(world)).toBe(true);
    expect(manager.hasValidRun(content)).toBe(true);
  });

  it("hides continue and clears storage for dead menu saves", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, "test-save");
    const snapshot = makeWorld("SAVE-CONTINUE-DEAD", { enemyCount: 0 }).snapshot();
    snapshot.heroDead = true;
    snapshot.hero.stats.hp = 0;
    storage.setItem("test-save", JSON.stringify(snapshot));

    expect(manager.hasValidRun(content)).toBe(false);
    expect(storage.getItem("test-save")).toBeNull();
  });
});
