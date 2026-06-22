/**
 * ContentDatabase — the in-memory home for all loaded game content (pure).
 *
 * Holds the parsed, validated enemy/item definitions and provides lookup plus
 * weighted, depth-aware enemy selection for spawning. It guarantees it is
 * never empty: if the enemy config is missing or every entry was rejected, it
 * falls back to a single built-in `DEFAULT_ENEMY` so the game can always spawn
 * something valid rather than crash. No fetch/DOM here — construct it from
 * already-parsed data (see loadContent.ts for the async wiring).
 */
import type { EnemyDef, HeroDef, ItemDef } from "./types";
import { parseEnemies, parseHeroes, parseItems } from "./parse";
import type { RNG } from "@/core/rng/Mulberry32";

export class ContentDatabase {
  /** Last-resort enemy if no valid definitions were loaded. */
  static readonly DEFAULT_ENEMY: EnemyDef = {
    id: "unknown",
    name: "Unknown Creature",
    maxHealth: 10,
    speed: 1,
    vision: 6,
    accuracy: 10,
    evasion: 4,
    damageMin: 1,
    damageMax: 3,
    armor: 0,
    spawnWeight: 1,
    minDepth: 1,
    expReward: 1,
    maxLevelCap: 30,
    description: "A fallback creature used when content failed to load.",
  };

  static readonly DEFAULT_HERO: HeroDef = {
    id: "warrior",
    name: "Warrior",
    maxHealth: 20,
    strength: 15,
    sprite: "warrior",
    startingItems: ["short_sword", "ration"],
    description: "A resilient melee fighter.",
  };

  private readonly enemyList: EnemyDef[];
  private readonly enemyById: Map<string, EnemyDef>;
  private readonly itemList: ItemDef[];
  private readonly itemById: Map<string, ItemDef>;
  private readonly heroList: HeroDef[];
  private readonly heroById: Map<string, HeroDef>;

  constructor(enemies: EnemyDef[], items: ItemDef[], heroes: HeroDef[] = []) {
    this.enemyList = enemies.length > 0 ? enemies : [ContentDatabase.DEFAULT_ENEMY];
    this.enemyById = new Map(this.enemyList.map((e) => [e.id, e]));
    this.itemList = items;
    this.itemById = new Map(this.itemList.map((i) => [i.id, i]));
    this.heroList = heroes.length > 0 ? heroes : [ContentDatabase.DEFAULT_HERO];
    this.heroById = new Map(this.heroList.map((h) => [h.id, h]));
  }

  /** Build from raw (untrusted) JSON values, running them through the parser. */
  static fromRaw(
    rawEnemies: unknown,
    rawItems: unknown,
    rawHeroes: unknown = null,
  ): ContentDatabase {
    return new ContentDatabase(
      parseEnemies(rawEnemies),
      parseItems(rawItems),
      parseHeroes(rawHeroes),
    );
  }

  getEnemy(id: string): EnemyDef | undefined {
    return this.enemyById.get(id);
  }

  get allEnemies(): readonly EnemyDef[] {
    return this.enemyList;
  }

  getItem(id: string): ItemDef | undefined {
    return this.itemById.get(id);
  }

  get allItems(): readonly ItemDef[] {
    return this.itemList;
  }

  getHero(id: string): HeroDef | undefined {
    return this.heroById.get(id);
  }

  get defaultHero(): HeroDef {
    return this.heroList[0] ?? ContentDatabase.DEFAULT_HERO;
  }

  get allHeroes(): readonly HeroDef[] {
    return this.heroList;
  }

  /**
   * Pick an enemy eligible at `depth`, weighted by `spawnWeight` (deterministic
   * for a given RNG state). Falls back gracefully if nothing is eligible.
   */
  randomEnemyForDepth(depth: number, rng: RNG): EnemyDef {
    const eligible = this.enemyList.filter(
      (e) => e.minDepth <= depth && e.spawnWeight > 0,
    );
    const pool = eligible.length > 0 ? eligible : this.enemyList;

    const total = pool.reduce((sum, e) => sum + Math.max(e.spawnWeight, 0), 0);
    if (total <= 0) return pool[0] ?? ContentDatabase.DEFAULT_ENEMY;

    let roll = rng.next() * total;
    for (const enemy of pool) {
      roll -= Math.max(enemy.spawnWeight, 0);
      if (roll < 0) return enemy;
    }
    return pool[pool.length - 1]!;
  }
}
