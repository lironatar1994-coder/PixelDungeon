/**
 * GameWorld — the headless game state orchestrator (pure logic, no DOM).
 *
 * Ties the Phase 1–4 systems together and acts as the single authority for
 * combat:
 *   - DungeonManager  (26 persistent, seeded floors)
 *   - TurnQueue       (the tick scheduler)
 *   - Hero + Enemies  (Actors; their CombatStats live in components)
 *   - FieldOfView     (3-state fog of war for the hero)
 *   - Inventory       (the hero's items + equipment, from items.json)
 *   - combatRng       (a dedicated seeded stream so fights are reproducible)
 *
 * Turn model is strictly input-driven: `tryMoveHero` buffers a move OR a bump-
 * attack, runs the queue until the hero yields (enemies take their ticks,
 * possibly attacking back), then recomputes FOV once. Combat resolution is
 * centralised here so actors stay simple and decoupled.
 */
import {
  DungeonManager,
  type DungeonLootConfig,
  type DungeonSnapshot,
} from "@/core/dungeon/DungeonManager";
import type { Level } from "@/core/dungeon/Level";
import { Terrain } from "@/core/grid/terrain";
import { TurnQueue, type TurnQueueSnapshot } from "@/core/turn/TurnQueue";
import { RNG } from "@/core/rng/Mulberry32";
import { Hero, type HeroContext } from "@/core/actors/Hero";
import { Enemy, type EnemySenses, type EnemyState } from "@/core/actors/Enemy";
import { FieldOfView } from "@/core/fov/FieldOfView";
import { lineOfFire } from "@/core/fov/lineOfFire";
import { resolveAttack } from "@/core/combat/resolveAttack";
import type { BaseStats, CombatStatsSnapshot } from "@/core/combat/CombatStats";
import { Inventory, type InventorySnapshot } from "@/core/items/Inventory";
import { ItemFactory } from "@/core/items/ItemFactory";
import type { WorldTimedEffect } from "@/core/items/PotionEffects";
import { ContentDatabase, type ContentDatabase as ContentDatabaseType } from "@/core/data/ContentDatabase";
import type { HeroDef } from "@/core/data/types";
import { hydrateTrap, trapDefinition, type HydratedTrapMetadata } from "@/core/traps/registry";
import type { GeneratedTrapMetadata } from "@/core/procgen/regular/types";

/** Payload emitted whenever the hero loses hit points. */
export interface HeroDamagedInfo {
  /** Hit points actually lost. */
  amount: number;
  /** What dealt the damage (e.g. the monster's name). */
  source: string;
  /** The hero's hit points remaining after the hit. */
  hp: number;
}

export interface CombatStrikeInfo {
  attackerId: string;
  defenderId: string;
  attackerCell: number;
  defenderCell: number;
  hit: boolean;
  damage: number;
}

export interface ActorMoveInfo {
  actorId: string;
  fromCell: number;
  toCell: number;
}

export interface ActorDeathInfo {
  actorId: string;
  cell: number;
  name: string;
}

export interface ItemPickupInfo {
  itemUid: string;
  itemId: string;
  cell: number;
}

export interface ItemQuaffedInfo {
  itemUid: string;
  itemId: string;
  effectId: string;
  cell: number;
}

export interface HeroLevelUpInfo {
  level: number;
}

export interface TrapTriggeredInfo {
  cell: number;
  kind: string;
}

export interface WorldOptions {
  /** How far the hero can see (the player's fog radius — not enemy content). */
  visionRadius?: number;
  /** Max enemies spawned per floor. */
  enemyCount?: number;
  /** Hero profile id from heroes.json. */
  heroId?: string;
  onChange?: (world: GameWorld) => void;
  onLog?: (line: string) => void;
  /** Fired when the hero takes damage. The orchestrator bridges this to the
   *  EventBus; Core stays decoupled from the browser/event layer (Pillar 1). */
  onHeroDamaged?: (info: HeroDamagedInfo) => void;
  /** Fired after an attack roll resolves; render/UI bridge it to EventBus. */
  onCombatStrike?: (info: CombatStrikeInfo) => void;
  /** Fired after an actor's core grid position changes; render may tween it. */
  onActorMove?: (info: ActorMoveInfo) => void;
  /** Fired after an actor dies; render may animate it before it disappears. */
  onActorDeath?: (info: ActorDeathInfo) => void;
  /** Fired after an item is removed from the floor and added to inventory. */
  onItemPickup?: (info: ItemPickupInfo) => void;
  /** Fired after a potion successfully applies its core effect. */
  onItemQuaffed?: (info: ItemQuaffedInfo) => void;
  /** Fired after the hero gains one or more levels. */
  onHeroLevelUp?: (info: HeroLevelUpInfo) => void;
  /** Fired when a trap activates; the composition root may play SFX. */
  onTrapTriggered?: (info: TrapTriggeredInfo) => void;
}

export interface EnemySnapshot {
  id: string;
  defId: string;
  pos: number;
  state: EnemyState;
  lastKnownHeroPos: number | null;
  stats: CombatStatsSnapshot;
}

export interface HeroSnapshot {
  pos: number;
  stats: CombatStatsSnapshot;
  level: number;
  experience: number;
}

export interface GameWorldSnapshot {
  version: 1;
  seed: string;
  heroProfileId: string;
  depth: number;
  visionRadius: number;
  enemyCount: number;
  dungeon: DungeonSnapshot;
  hero: HeroSnapshot;
  inventory: InventorySnapshot;
  enemies: EnemySnapshot[];
  queue: TurnQueueSnapshot;
  combatRngState: number;
  enemyAiRngState: number;
  trapRngState?: number;
  heroDead: boolean;
  log: string[];
  worldEffects?: WorldTimedEffect[];
}

/** The hero's intrinsic (unarmed, unarmored) base stats. */
const HERO_BASE: BaseStats = {
  maxHealth: 20,
  accuracy: 12,
  evasion: 8,
  damageMin: 1,
  damageMax: 3,
  armor: 0,
  speed: 1,
  strength: 15,
};

const MAX_LOG = 50;

function positiveLog(line: string): string {
  return `++ ${line}`;
}

function negativeLog(line: string): string {
  return `-- ${line}`;
}

function warningLog(line: string): string {
  return `** ${line}`;
}

function highlightLog(line: string): string {
  return `@@ ${line}`;
}

export class GameWorld {
  dungeon: DungeonManager;
  readonly fov = new FieldOfView();
  readonly visionRadius: number;
  readonly enemyCount: number;

  private readonly content: ContentDatabaseType;
  private heroProfile: HeroDef;
  private readonly combatRng: RNG;
  private readonly onChange?: (world: GameWorld) => void;
  private readonly onLog?: (line: string) => void;
  private readonly onHeroDamaged?: (info: HeroDamagedInfo) => void;
  private readonly onCombatStrike?: (info: CombatStrikeInfo) => void;
  private readonly onActorMove?: (info: ActorMoveInfo) => void;
  private readonly onActorDeath?: (info: ActorDeathInfo) => void;
  private readonly onItemPickup?: (info: ItemPickupInfo) => void;
  private readonly onHeroLevelUp?: (info: HeroLevelUpInfo) => void;
  private readonly onTrapTriggered?: (info: TrapTriggeredInfo) => void;
  private enemyAiRng = new RNG(0);
  private trapRng: RNG;

  private queue = new TurnQueue();
  private hero!: Hero;
  private inventoryRef!: Inventory;
  private enemyList: Enemy[] = [];
  private worldEffects: WorldTimedEffect[] = [];
  public heroDead = false;
  public deathReason: string | undefined;
  private readonly logLines: string[] = [];

  constructor(seed: string, content: ContentDatabaseType, opts: WorldOptions = {}) {
    this.content = content;
    this.heroProfile = this.resolveHeroProfile(opts.heroId);
    this.dungeon = new DungeonManager(seed, lootConfigForContent(content));
    this.combatRng = new RNG(`${seed}:combat`);
    this.trapRng = new RNG(`${seed}:trap-runtime`);
    this.visionRadius = opts.visionRadius ?? 8;
    this.enemyCount = opts.enemyCount ?? 6;
    this.onChange = opts.onChange;
    this.onLog = opts.onLog;
    this.onHeroDamaged = opts.onHeroDamaged;
    this.onCombatStrike = opts.onCombatStrike;
    this.onActorMove = opts.onActorMove;
    this.onActorDeath = opts.onActorDeath;
    this.onItemPickup = opts.onItemPickup;
    this.onHeroLevelUp = opts.onHeroLevelUp;
    this.onTrapTriggered = opts.onTrapTriggered;

    this.createHero(); // the hero persists across floors
    this.enterFloor();
  }

  static fromSnapshot(
    snapshot: GameWorldSnapshot,
    content: ContentDatabaseType,
    opts: Pick<WorldOptions, "onChange" | "onLog" | "onHeroDamaged" | "onCombatStrike" | "onActorMove" | "onActorDeath" | "onItemPickup" | "onItemQuaffed" | "onHeroLevelUp" | "onTrapTriggered"> = {},
  ): GameWorld {
    const world = new GameWorld(snapshot.seed, content, {
      visionRadius: snapshot.visionRadius,
      enemyCount: snapshot.enemyCount,
      heroId: snapshot.heroProfileId,
      onChange: opts.onChange,
      onLog: opts.onLog,
      onHeroDamaged: opts.onHeroDamaged,
      onCombatStrike: opts.onCombatStrike,
      onActorMove: opts.onActorMove,
      onActorDeath: opts.onActorDeath,
      onItemPickup: opts.onItemPickup,
      onItemQuaffed: opts.onItemQuaffed,
      onHeroLevelUp: opts.onHeroLevelUp,
      onTrapTriggered: opts.onTrapTriggered,
    });
    world.restore(snapshot);
    return world;
  }

  // --- read-only views for the renderer ---
  get level(): Level {
    return this.dungeon.current;
  }
  get grid() {
    return this.dungeon.current.grid;
  }
  get depth(): number {
    return this.dungeon.depth;
  }
  get seed(): string {
    return this.dungeon.seed;
  }
  get heroPos(): number {
    return this.hero.pos;
  }
  get heroStats() {
    return this.hero.stats;
  }
  get heroLevel(): number {
    return this.hero.level;
  }
  get heroExperience(): number {
    return this.hero.experience;
  }
  get heroMaxExperience(): number {
    return this.hero.maxExperience();
  }
  get heroProfileId(): string {
    return this.heroProfile.id;
  }
  get heroClassName(): string {
    return this.heroProfile.name;
  }
  get heroSprite(): string {
    return this.heroProfile.sprite;
  }
  get inventory(): Inventory {
    return this.inventoryRef;
  }
  get heroAlive(): boolean {
    return !this.heroDead;
  }
  get enemies(): ReadonlyArray<Enemy> {
    return this.enemyList;
  }
  get log(): readonly string[] {
    return this.logLines;
  }

  // --- setup ---
  private createHero(): void {
    const ctx: HeroContext = {
      attack: (cell) => this.heroAttack(cell),
      pickUp: () => this.pickUpHere(),
    };
    this.hero = new Hero(
      this.dungeon.current.entrance,
      this.baseStatsForHero(this.heroProfile),
      ctx,
    );

    // Build the inventory from loaded items, then equip weapon + armor. The
    // equipment applies its stats as removable modifiers (no base mutation).
    this.inventoryRef = new Inventory(this.hero.stats, 20);
    let starterIndex = 0;
    const starterFactory = new ItemFactory(this.content, {
      // Starter gear should be class-defined, not randomly upgraded.
      rng: { next: () => 0 },
      createUid: () => `starter_${++starterIndex}`,
    });
    for (const id of this.heroProfile.startingItems) {
      const item = this.content.getItem(id);
      if (item) this.inventoryRef.addInstance(starterFactory.create(id), item);
    }
    for (const item of this.inventoryRef.all) {
      if (item.type === "weapon" || item.type === "armor") {
        this.inventoryRef.equip(item);
      }
    }
  }

  private resolveHeroProfile(heroId?: string): HeroDef {
    if (heroId) return this.content.getHero(heroId) ?? this.content.defaultHero;
    return this.content.defaultHero;
  }

  private baseStatsForHero(profile: HeroDef): BaseStats {
    return {
      ...HERO_BASE,
      maxHealth: profile.maxHealth,
      strength: profile.strength,
    };
  }

  private enterFloor(): void {
    const level = this.dungeon.current;
    this.queue.clear();

    this.hero.pos = level.entrance;
    this.hero.pending = null;
    this.queue.add(this.hero);

    this.spawnEnemies(level);

    this.fov.bindMemory(level.explored);
    this.recomputeFOV();
  }

  private spawnEnemies(level: Level): void {
    const grid = level.grid;
    const rng = new RNG((level.seed ^ 0x9e3779b9) >>> 0);
    this.enemyAiRng = new RNG((level.seed ^ 0x85ebca6b) >>> 0);
    this.enemyList = [];

    const heroX = grid.xOf(level.entrance);
    const heroY = grid.yOf(level.entrance);
    const rooms = level.rooms.filter((r) => !r.contains(heroX, heroY));
    const pool = rng.shuffle((rooms.length > 0 ? rooms : level.rooms).slice());
    const initialFov = new FieldOfView();
    initialFov.update(
      grid,
      level.entrance,
      this.visionRadius,
      (cell) => grid.get(cell) === Terrain.WALL || grid.get(cell) === Terrain.DOOR,
    );

    const senses = this.makeSenses();
    const used = new Set<number>([
      level.entrance,
      level.exit,
      ...level.groundItems.map((item) => item.cell),
    ]);
    const candidates: number[] = [];
    for (const room of pool) {
      for (let y = room.y + 1; y < room.bottom - 1; y++) {
        for (let x = room.x + 1; x < room.right - 1; x++) {
          const cell = grid.cell(x, y);
          if (
            !used.has(cell) &&
            grid.isWalkable(cell) &&
            !initialFov.visible.has(cell) &&
            Math.max(Math.abs(x - heroX), Math.abs(y - heroY)) > 6
          ) {
            candidates.push(cell);
          }
        }
      }
    }
    rng.shuffle(candidates);

    const count = Math.min(this.enemyCount, candidates.length);
    for (let i = 0; i < count; i++) {
      const cell = candidates[i]!;
      used.add(cell);
      // The full stat profile (health/speed/vision/accuracy/...) comes from JSON.
      const def = this.content.randomEnemyForDepth(this.dungeon.depth, rng);
      const enemy = new Enemy(cell, def, senses);
      this.enemyList.push(enemy);
      this.queue.add(enemy);
    }
  }

  private makeSenses(): EnemySenses {
    return {
      grid: this.grid,
      rng: this.enemyAiRng,
      heroPos: () => this.hero.pos,
      isOccupied: (cell) => this.isOccupied(cell),
      isTransparent: (cell) => this.isCellTransparent(cell),
      attackHero: (enemy) => this.enemyAttackHero(enemy),
    };
  }

  isOccupied(cell: number): boolean {
    if (this.hero.pos === cell) return true;
    if (this.worldEffects.some((effect) => effect.blocksMovement && effect.cells?.includes(cell))) return true;
    return this.enemyList.some((e) => e.pos === cell);
  }

  isOpenDoor(cell: number): boolean {
    return this.grid.inBoundsCell(cell) &&
      this.grid.get(cell) === Terrain.DOOR &&
      this.level.openDoors.has(cell);
  }

  isClosedDoor(cell: number): boolean {
    return this.grid.inBoundsCell(cell) &&
      this.grid.get(cell) === Terrain.DOOR &&
      !this.level.openDoors.has(cell);
  }

  hasGroundItem(cell: number): boolean {
    return this.level.itemAt(cell) !== null;
  }

  private isCellTransparent(cell: number): boolean {
    if (!this.grid.inBoundsCell(cell)) return false;
    if (this.grid.get(cell) === Terrain.DOOR) {
      return this.level.openDoors.has(cell);
    }
    return this.grid.isTransparent(cell);
  }

  private enemyAt(cell: number): Enemy | null {
    return this.enemyList.find((e) => e.pos === cell) ?? null;
  }

  private enemyId(enemy: Enemy): string {
    return `enemy:${enemy.seq}`;
  }

  // --- combat resolution (world is the authority) ---
  private heroAttack(targetCell: number): void {
    const enemy = this.enemyAt(targetCell);
    if (!enemy) return;
    const r = resolveAttack(this.hero.stats, enemy.stats, this.combatRng);
    if (!r.hit) {
      this.onCombatStrike?.({
        attackerId: "hero",
        defenderId: this.enemyId(enemy),
        attackerCell: this.hero.pos,
        defenderCell: enemy.pos,
        hit: false,
        damage: 0,
      });
      this.pushLog(`You miss the ${enemy.name}.`);
      return;
    }
    const dealt = enemy.stats.takeDamage(r.damage);
    this.onCombatStrike?.({
      attackerId: "hero",
      defenderId: this.enemyId(enemy),
      attackerCell: this.hero.pos,
      defenderCell: enemy.pos,
      hit: true,
      damage: dealt,
    });
    this.pushLog(`You hit the ${enemy.name} for ${r.damage}.`);
    if (!enemy.stats.alive) {
      if (this.hero.level <= enemy.def.maxLevelCap && enemy.def.expReward > 0) {
        const progress = this.hero.addExperience(enemy.def.expReward);
        if (progress.gained > 0) {
          this.pushLog(positiveLog(`+${progress.gained} EXP`));
          if (progress.levelsGained > 0) {
            this.pushLog(positiveLog("Level up! +Accuracy, +Evasion, +5 HP!"));
            this.onHeroLevelUp?.({ level: this.hero.level });
          }
        }
      }
      this.onActorDeath?.({
        actorId: this.enemyId(enemy),
        cell: enemy.pos,
        name: enemy.name,
      });
      this.removeEnemy(enemy);
      this.pushLog(positiveLog(`Defeated the ${enemy.name}.`));
    }
  }

  private enemyAttackHero(attacker: Enemy): void {
    if (this.heroDead) return;
    const r = resolveAttack(attacker.stats, this.hero.stats, this.combatRng);
    if (!r.hit) {
      this.onCombatStrike?.({
        attackerId: this.enemyId(attacker),
        defenderId: "hero",
        attackerCell: attacker.pos,
        defenderCell: this.hero.pos,
        hit: false,
        damage: 0,
      });
      this.pushLog(`The ${attacker.name} misses you.`);
      return;
    }
    const dealt = this.hero.stats.takeDamage(r.damage);
    this.onCombatStrike?.({
      attackerId: this.enemyId(attacker),
      defenderId: "hero",
      attackerCell: attacker.pos,
      defenderCell: this.hero.pos,
      hit: true,
      damage: dealt,
    });
    this.pushLog(negativeLog(`The ${attacker.name} hits you for ${r.damage}.`));
    if (dealt > 0) {
      this.onHeroDamaged?.({
        amount: dealt,
        source: attacker.name,
        hp: this.hero.stats.hp,
      });
    }
    if (!this.hero.stats.alive) {
      this.heroDead = true;
      this.pushLog(negativeLog(`You have died on depth ${this.depth}.`));
      const normalCauses = attacker.def.deathCauses?.normal;
      if (normalCauses && normalCauses.length > 0) {
        const index = Math.floor(this.combatRng.next() * normalCauses.length);
        this.deathReason = normalCauses[index]?.replace("{name}", attacker.name);
      }
    }
  }

  private removeEnemy(enemy: Enemy): void {
    const i = this.enemyList.indexOf(enemy);
    if (i >= 0) this.enemyList.splice(i, 1);
    this.queue.remove(enemy);
  }

  /** Drink the first healing potion in the bag, if any. */
  quaffHealing(): boolean {
    if (this.heroDead) return false;
    const potion = this.inventoryRef.all.find(
      (it) => it.type === "potion" && typeof it.def.heal === "number",
    );
    if (!potion) return false;
    return this.consumeItem(potion.uid);
  }

  equipItem(itemUid: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.findByUid(itemUid);
    if (!item || !this.inventoryRef.equip(item)) return false;
    this.pushLog(positiveLog(`You equip ${item.name}.`));
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  consumeItem(itemUid: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.findByUid(itemUid);
    if (!item) return false;
    if (item.type === "potion" && typeof item.def.strengthBonus === "number" && item.def.strengthBonus > 0) {
      this.hero.stats.increaseBase("strength", item.def.strengthBonus);
      this.inventoryRef.remove(item);
      this.inventoryRef.refreshEquipmentModifiers();
      this.pushLog(positiveLog(`You quaff ${item.name} (+${item.def.strengthBonus} STR).`));
    } else if (item.type === "potion" && typeof item.def.heal === "number") {
      const healed = this.hero.stats.heal(item.def.heal);
      this.inventoryRef.remove(item);
      this.pushLog(positiveLog(`You quaff ${item.name} (+${healed} HP).`));
    } else if (item.type === "food") {
      this.inventoryRef.remove(item);
      this.pushLog(positiveLog(`You eat ${item.name}.`));
    } else {
      return false;
    }
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  dropItem(itemUid: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.findByUid(itemUid);
    if (!item || !this.inventoryRef.remove(item)) return false;
    this.level.placeGroundItem(this.hero.pos, item);
    this.pushLog(`You drop ${item.name}.`);
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  waitTurn(): boolean {
    if (this.heroDead) return false;
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  search(): boolean {
    if (this.heroDead) return false;
    const found = this.revealSearchableCells();
    if (found > 0) {
      this.pushLog(warningLog("You noticed something."));
    }
    this.hero.pending = { kind: "search" };
    this.processTurns();
    return true;
  }

  tryPickUpItem(): boolean {
    if (this.heroDead) return false;
    const groundItem = this.level.itemAt(this.hero.pos);
    if (groundItem === null) {
      this.pushLog("Nothing here.");
      return false;
    }
    const item = this.content.getItem(groundItem.defId);
    if (!item) {
      this.level.takeGroundItem(this.hero.pos);
      this.pushLog(warningLog("The item crumbles away."));
      this.emitChange();
      return false;
    }
    if (this.inventoryRef.isFull()) {
      this.pushLog(warningLog("Your pack is full."));
      return false;
    }

    this.hero.pending = { kind: "pickUp" };
    this.processTurns();
    return true;
  }

  rangedAttack(targetCell: number): boolean {
    if (this.heroDead || !this.grid.inBoundsCell(targetCell)) return false;
    const enemy = this.enemyAt(targetCell);
    if (!enemy) {
      this.pushLog(warningLog("No target there."));
      return false;
    }

    const path = lineOfFire(this.hero.pos, targetCell, this.grid, {
      blocksCell: (cell) =>
        cell !== targetCell &&
        (this.enemyAt(cell) !== null || !this.isCellTransparent(cell)),
    });
    if (path.at(-1) !== targetCell) {
      this.pushLog(warningLog("No clear shot."));
      return false;
    }

    this.hero.pending = { kind: "rangedAttack", target: targetCell };
    this.processTurns();
    return true;
  }

  private revealSearchableCells(): number {
    const radius = 1;
    const heroX = this.grid.xOf(this.hero.pos);
    const heroY = this.grid.yOf(this.hero.pos);
    let found = 0;

    for (let y = heroY - radius; y <= heroY + radius; y++) {
      for (let x = heroX - radius; x <= heroX + radius; x++) {
        if (!this.grid.inBounds(x, y)) continue;
        const cell = this.grid.cell(x, y);
        if (cell === this.hero.pos || !this.fov.visible.has(cell)) continue;
        const terrain = this.grid.get(cell);

        if (terrain === Terrain.SECRET_DOOR) {
          this.grid.set(cell, Terrain.DOOR);
          this.level.openDoors.delete(cell);
          found++;
        } else if (terrain === Terrain.SECRET_TRAP && this.trapAt(cell)?.canBeSearched !== false) {
          this.grid.set(cell, Terrain.TRAP);
          this.revealTrapMetadata(cell);
          found++;
        }
      }
    }

    return found;
  }

  private revealTrapMetadata(cell: number): void {
    for (const trap of this.level.trapMetadata) {
      if (trap.cell === cell) trap.visible = true;
    }
  }

  private trapAt(cell: number): HydratedTrapMetadata | null {
    const trap = this.level.trapMetadata.find((candidate) => candidate.cell === cell);
    return trap ? hydrateTrap(trap) : null;
  }

  // --- turn flow ---
  /**
   * Move the hero by (dx, dy), or bump-attack an enemy there. Returns true if
   * a turn was taken. Invalid moves cost nothing and freeze the world.
   */
  tryMoveHero(dx: number, dy: number): boolean {
    if (this.heroDead) return false;
    const grid = this.grid;
    const x = grid.xOf(this.hero.pos) + dx;
    const y = grid.yOf(this.hero.pos) + dy;
    if (!grid.inBounds(x, y)) return false;
    const target = grid.cell(x, y);

    const enemy = this.enemyAt(target);
    if (enemy) {
      this.hero.pending = { kind: "attack", target };
      this.processTurns();
      return true;
    }
    if (!grid.isWalkable(target) || this.isOccupied(target)) return false;

    if (grid.get(target) === Terrain.DOOR && !this.level.openDoors.has(target)) {
      this.level.openDoors.add(target);
    }

    this.hero.pending = { kind: "move", cell: target };
    this.processTurns();
    return true;
  }

  tryCloseDoor(cell?: number): boolean {
    if (this.heroDead) return false;
    const target = cell ?? this.firstAdjacentOpenDoor();
    if (target === null || !this.canCloseDoor(target)) return false;

    this.level.openDoors.delete(target);
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  private processTurns(): void {
    const cellsBeforeAct = new Map<Hero | Enemy, number>();
    this.queue.run(100_000, {
      beforeAct: (actor) => {
        const cell = this.actorCell(actor);
        if (cell !== null) cellsBeforeAct.set(actor as Hero | Enemy, cell);
      },
      afterAct: (actor) => {
        const fromCell = cellsBeforeAct.get(actor as Hero | Enemy);
        cellsBeforeAct.delete(actor as Hero | Enemy);
        if (fromCell === undefined) return;
        const toCell = this.actorCell(actor);
        const actorId = this.actorId(actor);
        if (toCell !== null && actorId !== null && toCell !== fromCell) {
          this.pressCell(toCell, actor === this.hero, actor as Hero | Enemy);
          const finalCell = this.actorCell(actor);
          if (finalCell !== null) this.onActorMove?.({ actorId, fromCell, toCell: finalCell });
        }
      },
    });
    this.queue.fixTime();
    this.tickWorldEffects();
    this.checkOpenDoors();
    this.recomputeFOV();
    this.emitChange();
  }

  private pressCell(cell: number, hard: boolean, actor: Hero | Enemy): void {
    const terrain = this.grid.get(cell);
    if (terrain !== Terrain.TRAP && terrain !== Terrain.SECRET_TRAP) return;
    if (terrain === Terrain.SECRET_TRAP && !hard) return;

    const trap = this.mutableTrapAt(cell);
    if (!trap || !trap.active) return;
    if (terrain === Terrain.SECRET_TRAP && actor === this.hero) {
      this.pushLog(warningLog(`You triggered a hidden ${trapDefinition(trap.kind).name}.`));
    }
    this.triggerTrap(trap, actor);
  }

  private mutableTrapAt(cell: number): GeneratedTrapMetadata | null {
    const trap = this.level.trapMetadata.find((candidate) => candidate.cell === cell) ?? null;
    if (trap) Object.assign(trap, hydrateTrap(trap));
    return trap;
  }

  private triggerTrap(trap: GeneratedTrapMetadata, triggeringActor: Hero | Enemy): void {
    const hydrated = hydrateTrap(trap);
    Object.assign(trap, hydrated, { visible: true });
    this.onTrapTriggered?.({ cell: trap.cell, kind: trap.kind });
    if (hydrated.disarmedByActivation) {
      trap.active = false;
      this.grid.set(trap.cell, Terrain.INACTIVE_TRAP);
    } else {
      this.grid.set(trap.cell, Terrain.TRAP);
    }

    switch (trap.kind) {
      case "wornDart":
        this.activateWornDartTrap(trap.cell);
        break;
      case "alarm":
        this.activateAlarmTrap(trap.cell);
        break;
      case "summoning":
        this.activateSummoningTrap(trap.cell);
        break;
      case "teleportation":
        this.activateTeleportationTrap(trap.cell);
        break;
      case "gateway":
        this.activateGatewayTrap(trap);
        break;
      case "chilling":
        this.activateHazardTrap("freezing", trap.cell, 3);
        break;
      case "shocking":
        this.activateHazardTrap("electricity", trap.cell, 2);
        break;
      case "toxic":
        this.activateHazardTrap("toxicGas", trap.cell, 6 + this.depth);
        break;
      case "confusion":
        this.activateHazardTrap("confusionGas", trap.cell, 6 + this.depth);
        break;
      case "ooze":
        this.activateOozeTrap(trap.cell);
        break;
      case "flock":
        this.activateFlockTrap(trap.cell, triggeringActor);
        break;
    }
  }

  private activateWornDartTrap(cell: number): void {
    const target = this.actorAt(cell) ?? this.nearestLineOfFireActor(cell, Math.max(6, this.visionRadius) + 0.5);
    if (!target) return;
    const damage = Math.max(0, normalIntRange(this.trapRng, 4, 8) - Math.floor(this.trapRng.next() * (target.stats.armor + 1)));
    this.damageActor(target, damage, "worn dart trap");
  }

  private nearestLineOfFireActor(cell: number, range: number): Hero | Enemy | null {
    let best: Hero | Enemy | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const actor of [this.hero, ...this.enemyList]) {
      const distance = this.trueDistance(cell, actor.pos);
      if (distance > range) continue;
      const path = lineOfFire(cell, actor.pos, this.grid, {
        blocksCell: (candidate) =>
          candidate !== actor.pos &&
          (this.enemyAt(candidate) !== null || candidate === this.hero.pos || !this.isCellTransparent(candidate)),
      });
      if (path.at(-1) !== actor.pos) continue;
      if (distance < bestDistance || (distance === bestDistance && actor === this.hero)) {
        best = actor;
        bestDistance = distance;
      }
    }
    return best;
  }

  private activateAlarmTrap(cell: number): void {
    for (const enemy of this.enemyList) {
      enemy.state = "hunt";
      enemy.lastKnownHeroPos = cell;
      enemy.wanderTarget = null;
    }
    if (this.fov.visible.has(cell)) this.pushLog(warningLog("The alarm trap echoes through the dungeon!"));
  }

  private activateSummoningTrap(cell: number): void {
    let count = 1;
    if (this.trapRng.nextInt(2) === 0) {
      count++;
      if (this.trapRng.nextInt(2) === 0) count++;
    }
    const candidates = this.neighbourhood8(cell)
      .filter((candidate) => this.canSpawnAt(candidate));
    this.trapRng.shuffle(candidates);
    for (let i = 0; i < count; i++) {
      const spawnCell = candidates.pop();
      if (spawnCell === undefined) break;
      this.spawnEnemyAt(spawnCell);
      this.pressCell(spawnCell, false, this.enemyAt(spawnCell)!);
    }
  }

  private activateTeleportationTrap(cell: number): void {
    for (const actor of this.actorsInCells(this.neighbourhood9(cell))) {
      this.teleportActorRandomly(actor);
    }
    for (const itemCell of this.neighbourhood9(cell)) {
      this.teleportGroundItem(itemCell);
    }
  }

  private activateGatewayTrap(trap: GeneratedTrapMetadata): void {
    if (trap.gatewayTargetCell === undefined) {
      for (const actor of this.actorsInCells(this.neighbourhood9(trap.cell))) {
        if (this.teleportActorRandomly(actor)) {
          trap.gatewayTargetCell = actor.pos;
          break;
        }
      }
      if (trap.gatewayTargetCell === undefined) {
        for (const itemCell of this.neighbourhood9(trap.cell)) {
          const target = this.teleportGroundItem(itemCell);
          if (target !== null) {
            trap.gatewayTargetCell = target;
            break;
          }
        }
      }
    }

    if (trap.gatewayTargetCell === undefined) return;
    const destinations = [trap.gatewayTargetCell, ...this.neighbourhood8(trap.gatewayTargetCell)]
      .filter((candidate) => this.canTeleportTo(candidate));
    this.trapRng.shuffle(destinations);
    for (const actor of this.actorsInCells(this.neighbourhood9(trap.cell))) {
      const destination = destinations.shift();
      if (destination === undefined) break;
      this.moveActorTo(actor, destination);
    }
  }

  private activateHazardTrap(kind: NonNullable<WorldTimedEffect["kind"]>, cell: number, turns: number): void {
    const cells = this.neighbourhood9(cell).filter((candidate) => !this.grid.isSolid(candidate));
    const effect: WorldTimedEffect = {
      id: `trap:${kind}:${cell}:${this.trapRng.nextUint32()}`,
      kind,
      cells,
      turns,
      source: trapEffectSource(kind),
    };
    if (kind === "electricity") effect.damagePerTurn = 1 + Math.floor(this.depth / 2);
    if (kind === "toxicGas") effect.damagePerTurn = 1;
    if (kind === "freezing") {
      effect.stat = "speed";
      effect.amount = -0.5;
    }
    if (kind === "confusionGas") {
      effect.stat = "accuracy";
      effect.amount = -3;
    }
    this.worldEffects.push(effect);
    this.applyWorldEffect(effect);
  }

  private activateOozeTrap(cell: number): void {
    for (const actor of this.actorsInCells(this.neighbourhood9(cell))) {
      this.applyTimedModifier(actor, "trap:ooze:speed", "speed", -0.25, 6);
      this.applyTimedModifier(actor, "trap:ooze:evasion", "evasion", -2, 6);
    }
  }

  private activateFlockTrap(cell: number, triggeringActor: Hero | Enemy): void {
    const cells = this.neighbourhood8(cell)
      .filter((candidate) => this.grid.isWalkable(candidate) && !this.isOccupied(candidate));
    this.trapRng.shuffle(cells);
    const blockers = cells.slice(0, Math.min(8, cells.length));
    if (blockers.length === 0) return;
    this.worldEffects.push({
      id: `trap:flock:${cell}:${this.trapRng.nextUint32()}`,
      kind: "flock",
      cells: blockers,
      turns: 5,
      blocksMovement: true,
    });
    for (const blocker of blockers) this.pressCell(blocker, true, triggeringActor);
  }

  private tickWorldEffects(): void {
    if (this.worldEffects.length === 0) return;
    const remaining: WorldTimedEffect[] = [];
    for (const effect of this.worldEffects) {
      this.applyWorldEffect(effect);
      const next = { ...effect, turns: effect.turns - 1 };
      if (next.turns > 0) remaining.push(next);
    }
    this.worldEffects = remaining;
  }

  private applyWorldEffect(effect: WorldTimedEffect): void {
    if (!effect.cells || effect.cells.length === 0 || effect.kind === "flock") return;
    for (const actor of this.actorsInCells(effect.cells)) {
      if (effect.damagePerTurn && effect.damagePerTurn > 0) {
        this.damageActor(actor, effect.damagePerTurn, effect.source ?? effect.id);
      }
      if (effect.stat && effect.amount) {
        this.applyTimedModifier(actor, effect.id, effect.stat, effect.amount, 2);
        if (effect.kind === "confusionGas") {
          this.applyTimedModifier(actor, `${effect.id}:evasion`, "evasion", effect.amount, 2);
        }
      }
    }
  }

  private applyTimedModifier(
    actor: Hero | Enemy,
    id: string,
    stat: "speed" | "accuracy" | "evasion",
    amount: number,
    turns: number,
  ): void {
    actor.stats.removeModifiers(id);
    actor.stats.addModifier({ id, stat, amount, turns });
  }

  private damageActor(actor: Hero | Enemy, amount: number, source: string): void {
    if (amount <= 0) return;
    const dealt = actor.stats.takeDamage(amount);
    if (actor === this.hero) {
      if (dealt > 0) {
        this.pushLog(negativeLog(`The ${source} hits you for ${dealt}.`));
        this.onHeroDamaged?.({ amount: dealt, source, hp: this.hero.stats.hp });
      }
      if (!this.hero.stats.alive) {
        this.heroDead = true;
        this.deathReason = `Killed by a ${source}.`;
        this.pushLog(negativeLog(`You have died on depth ${this.depth}.`));
      }
      return;
    }
    if (actor instanceof Enemy && !actor.stats.alive) {
      this.onActorDeath?.({ actorId: this.enemyId(actor), cell: actor.pos, name: actor.name });
      this.removeEnemy(actor);
    }
  }

  private actorAt(cell: number): Hero | Enemy | null {
    if (this.hero.pos === cell) return this.hero;
    return this.enemyAt(cell);
  }

  private actorsInCells(cells: readonly number[]): Array<Hero | Enemy> {
    const wanted = new Set(cells);
    return [this.hero, ...this.enemyList].filter((actor) => wanted.has(actor.pos));
  }

  private spawnEnemyAt(cell: number): Enemy | null {
    if (!this.canSpawnAt(cell)) return null;
    const def = this.content.randomEnemyForDepth(this.depth, this.trapRng);
    const enemy = new Enemy(cell, def, this.makeSenses());
    this.enemyList.push(enemy);
    this.queue.add(enemy);
    return enemy;
  }

  private canSpawnAt(cell: number): boolean {
    return this.grid.inBoundsCell(cell) &&
      this.grid.isWalkable(cell) &&
      !this.isOccupied(cell) &&
      this.level.itemAt(cell) === null;
  }

  private teleportActorRandomly(actor: Hero | Enemy): boolean {
    const destination = this.randomRespawnCell(actor);
    if (destination === null) return false;
    this.moveActorTo(actor, destination);
    if (actor instanceof Enemy && actor.state === "hunt") {
      actor.state = "wander";
      actor.lastKnownHeroPos = null;
      actor.wanderTarget = null;
    }
    return true;
  }

  private teleportGroundItem(cell: number): number | null {
    const item = this.level.itemAt(cell);
    if (!item) return null;
    const destination = this.randomRespawnCell(null);
    if (destination === null) return null;
    const removed = this.level.takeGroundItem(cell);
    if (removed === null) return null;
    if (!this.level.placeGroundItem(destination, removed)) {
      this.level.placeGroundItem(cell, removed);
      return null;
    }
    return destination;
  }

  private randomRespawnCell(actor: Hero | Enemy | null): number | null {
    const candidates: number[] = [];
    for (let cell = 0; cell < this.grid.length; cell++) {
      if (this.canTeleportTo(cell, actor)) candidates.push(cell);
    }
    if (candidates.length === 0) return null;
    return this.trapRng.pick(candidates);
  }

  private canTeleportTo(cell: number, actor: Hero | Enemy | null = null): boolean {
    if (!this.grid.inBoundsCell(cell) || !this.grid.isWalkable(cell)) return false;
    const terrain = this.grid.get(cell);
    if (terrain === Terrain.TRAP || terrain === Terrain.SECRET_TRAP) return false;
    if (cell === this.level.entrance || cell === this.level.exit) return false;
    if (this.level.itemAt(cell) !== null) return false;
    if (this.hero.pos === cell && actor !== this.hero) return false;
    return this.enemyList.every((enemy) => enemy === actor || enemy.pos !== cell);
  }

  private moveActorTo(actor: Hero | Enemy, cell: number): void {
    actor.pos = cell;
  }

  private neighbourhood8(cell: number): number[] {
    return this.grid.neighbours8(cell);
  }

  private neighbourhood9(cell: number): number[] {
    return [cell, ...this.grid.neighbours8(cell)];
  }

  private trueDistance(a: number, b: number): number {
    const dx = this.grid.xOf(a) - this.grid.xOf(b);
    const dy = this.grid.yOf(a) - this.grid.yOf(b);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private actorCell(actor: unknown): number | null {
    if (actor === this.hero) return this.hero.pos;
    if (actor instanceof Enemy && this.enemyList.includes(actor)) return actor.pos;
    return null;
  }

  private actorId(actor: unknown): string | null {
    if (actor === this.hero) return "hero";
    if (actor instanceof Enemy && this.enemyList.includes(actor)) return this.enemyId(actor);
    return null;
  }

  private checkOpenDoors(): void {
    const grid = this.grid;
    const occupied = new Set<number>();

    for (const actor of [this.hero, ...this.enemyList]) {
      occupied.add(actor.pos);
    }
    for (const item of this.level.groundItems) {
      occupied.add(item.cell);
    }

    for (const doorPos of this.level.openDoors) {
      if (!occupied.has(doorPos)) {
        this.level.openDoors.delete(doorPos);
      }
    }

    for (const actor of [this.hero, ...this.enemyList]) {
      if (grid.get(actor.pos) === Terrain.DOOR && !this.level.openDoors.has(actor.pos)) {
        this.level.openDoors.add(actor.pos);
      }
    }

    for (const item of this.level.groundItems) {
      if (grid.get(item.cell) === Terrain.DOOR) {
        this.level.openDoors.add(item.cell);
      }
    }
  }

  private firstAdjacentOpenDoor(): number | null {
    return this.grid
      .neighbours4(this.hero.pos)
      .find((cell) => this.canCloseDoor(cell)) ?? null;
  }

  private canCloseDoor(cell: number): boolean {
    if (!this.grid.inBoundsCell(cell)) return false;
    if (this.grid.get(cell) !== Terrain.DOOR || !this.level.openDoors.has(cell)) {
      return false;
    }
    if (this.isOccupied(cell) || this.level.itemAt(cell) !== null) return false;
    return this.grid.neighbours4(this.hero.pos).includes(cell);
  }

  private pickUpHere(): void {
    const groundItem = this.level.itemAt(this.hero.pos);
    if (groundItem === null || this.inventoryRef.isFull()) return;
    const item = this.content.getItem(groundItem.defId);
    if (!item) return;
    const removed = this.level.takeGroundItem(this.hero.pos);
    if (removed === null) return;
    if (!this.inventoryRef.addInstance(removed, item)) {
      this.level.placeGroundItem(this.hero.pos, removed);
      return;
    }
    this.onItemPickup?.({ itemUid: removed.uid, itemId: item.id, cell: this.hero.pos });
    this.pushLog(positiveLog(`You picked up: ${item.name}.`));
  }

  recomputeFOV(): void {
    this.fov.update(
      this.grid,
      this.hero.pos,
      this.visionRadius,
      (cell) => !this.isCellTransparent(cell),
    );
  }

  descend(): void {
    if (this.heroDead) return;
    const before = this.depth;
    this.dungeon.descend();
    this.enterFloor();
    if (this.depth !== before) {
      this.pushLog(highlightLog(`You descend to floor ${this.depth} of the dungeon.`));
    }
    this.emitChange();
  }

  ascend(): void {
    if (this.heroDead) return;
    const before = this.depth;
    this.dungeon.ascend();
    this.enterFloor();
    if (this.depth !== before) {
      this.pushLog(highlightLog(`You return to floor ${this.depth} of the dungeon.`));
    }
    this.emitChange();
  }

  private pushLog(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > MAX_LOG) this.logLines.shift();
    this.onLog?.(line);
  }

  snapshot(): GameWorldSnapshot {
    const enemyIds = new Map<Enemy, string>();
    this.enemyList.forEach((enemy, i) => enemyIds.set(enemy, `enemy:${i}`));
    return {
      version: 1,
      seed: this.seed,
      heroProfileId: this.heroProfile.id,
      depth: this.depth,
      visionRadius: this.visionRadius,
      enemyCount: this.enemyCount,
      dungeon: this.dungeon.snapshot(),
      hero: {
        pos: this.hero.pos,
        stats: this.hero.stats.snapshot(),
        level: this.hero.level,
        experience: this.hero.experience,
      },
      inventory: this.inventoryRef.snapshot(),
      enemies: this.enemyList.map((enemy, i) => ({
        id: `enemy:${i}`,
        defId: enemy.def.id,
        pos: enemy.pos,
        state: enemy.state,
        lastKnownHeroPos: enemy.lastKnownHeroPos,
        stats: enemy.stats.snapshot(),
      })),
      queue: this.queue.snapshot((actor) => {
        if (actor === this.hero) return "hero";
        if (actor instanceof Enemy) return enemyIds.get(actor) ?? null;
        return null;
      }),
      combatRngState: this.combatRng.state,
      enemyAiRngState: this.enemyAiRng.state,
      trapRngState: this.trapRng.state,
      heroDead: this.heroDead,
      log: this.logLines.slice(),
      worldEffects: this.worldEffects.map((effect) => ({
        ...effect,
        cells: effect.cells ? [...effect.cells] : undefined,
      })),
    };
  }

  private restore(snapshot: GameWorldSnapshot): void {
    this.heroProfile = this.resolveHeroProfile(snapshot.heroProfileId);
    this.dungeon = DungeonManager.fromSnapshot(
      snapshot.dungeon,
      lootConfigForContent(this.content),
    );
    this.combatRng.state = snapshot.combatRngState;
    this.trapRng = new RNG(`${snapshot.seed}:trap-runtime`);
    if (snapshot.trapRngState !== undefined) this.trapRng.state = snapshot.trapRngState;
    this.enemyAiRng = new RNG((this.dungeon.current.seed ^ 0x85ebca6b) >>> 0);
    this.enemyAiRng.state = snapshot.enemyAiRngState;

    const ctx: HeroContext = {
      attack: (cell) => this.heroAttack(cell),
      pickUp: () => this.pickUpHere(),
    };
    this.hero = new Hero(snapshot.hero.pos, snapshot.hero.stats.base, ctx, {
      level: snapshot.hero.level ?? 1,
      experience: snapshot.hero.experience ?? 0,
    });
    this.hero.stats.restore(snapshot.hero.stats);
    this.hero.pending = null;

    this.inventoryRef = Inventory.fromSnapshot(
      snapshot.inventory,
      this.hero.stats,
      (id) => this.content.getItem(id),
    );

    const senses = this.makeSenses();
    this.enemyList = snapshot.enemies.map((enemySnapshot) => {
      const def =
        this.content.getEnemy(enemySnapshot.defId) ??
        ContentDatabase.DEFAULT_ENEMY;
      const enemy = new Enemy(enemySnapshot.pos, def, senses);
      enemy.state = enemySnapshot.state;
      enemy.lastKnownHeroPos = enemySnapshot.lastKnownHeroPos;
      enemy.stats.restore(enemySnapshot.stats);
      return enemy;
    });

    const actors = new Map<string, Hero | Enemy>([["hero", this.hero]]);
    this.enemyList.forEach((enemy, i) => {
      const savedId = snapshot.enemies[i]?.id ?? `enemy:${i}`;
      actors.set(savedId, enemy);
    });
    this.queue = new TurnQueue();
    this.queue.restore(snapshot.queue, (id) => actors.get(id));

    this.heroDead = snapshot.heroDead;
    this.logLines.splice(0, this.logLines.length, ...snapshot.log.slice(-MAX_LOG));
    this.worldEffects = (snapshot.worldEffects ?? []).map((effect) => ({
      ...effect,
      cells: effect.cells ? [...effect.cells] : undefined,
    }));
    this.fov.bindMemory(this.level.explored);
    this.recomputeFOV();
  }

  private emitChange(): void {
    this.onChange?.(this);
  }
}

function lootConfigForContent(content: ContentDatabaseType): DungeonLootConfig {
  const hasStrengthPotion = content.getItem("potion_strength") !== undefined;
  return {
    // Potion of Strength is progression-critical and is distributed through the
    // guaranteed-depth rule so it cannot randomly over-spawn in depths 1..5.
    itemIds: content.allItems
      .map((item) => item.id)
      .filter((id) => id !== "potion_strength"),
    itemDefs: content.allItems,
    strengthPotionId: hasStrengthPotion ? "potion_strength" : null,
  };
}

function normalIntRange(rng: RNG, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor((rng.next() + rng.next()) * (max - min + 1) / 2);
}

function trapEffectSource(kind: NonNullable<WorldTimedEffect["kind"]>): string {
  switch (kind) {
    case "freezing": return "chilling trap";
    case "electricity": return "shocking trap";
    case "toxicGas": return "toxic trap";
    case "confusionGas": return "confusion trap";
    case "flock": return "flock trap";
  }
}
