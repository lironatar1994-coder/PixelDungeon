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
import { ContentDatabase, type ContentDatabase as ContentDatabaseType } from "@/core/data/ContentDatabase";
import type { HeroDef } from "@/core/data/types";

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
  heroDead: boolean;
  log: string[];
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
  private enemyAiRng = new RNG(0);

  private queue = new TurnQueue();
  private hero!: Hero;
  private inventoryRef!: Inventory;
  private enemyList: Enemy[] = [];
  private heroDead = false;
  private readonly logLines: string[] = [];

  constructor(seed: string, content: ContentDatabaseType, opts: WorldOptions = {}) {
    this.content = content;
    this.heroProfile = this.resolveHeroProfile(opts.heroId);
    this.dungeon = new DungeonManager(seed, lootConfigForContent(content));
    this.combatRng = new RNG(`${seed}:combat`);
    this.visionRadius = opts.visionRadius ?? 8;
    this.enemyCount = opts.enemyCount ?? 6;
    this.onChange = opts.onChange;
    this.onLog = opts.onLog;
    this.onHeroDamaged = opts.onHeroDamaged;
    this.onCombatStrike = opts.onCombatStrike;
    this.onActorMove = opts.onActorMove;

    this.createHero(); // the hero persists across floors
    this.enterFloor();
  }

  static fromSnapshot(
    snapshot: GameWorldSnapshot,
    content: ContentDatabaseType,
    opts: Pick<WorldOptions, "onChange" | "onLog" | "onHeroDamaged" | "onCombatStrike" | "onActorMove"> = {},
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
    for (const id of this.heroProfile.startingItems) {
      const item = this.content.getItem(id);
      if (item) this.inventoryRef.add(item);
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

    const senses = this.makeSenses();
    const used = new Set<number>([
      level.entrance,
      ...level.groundItems.map((item) => item.cell),
    ]);
    const count = Math.min(this.enemyCount, pool.length);
    for (let i = 0; i < count; i++) {
      const room = pool[i]!;
      const cell = grid.cell(room.centerX, room.centerY);
      if (used.has(cell) || !grid.isWalkable(cell)) continue;
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
    return this.enemyList.some((e) => e.pos === cell);
  }

  isOpenDoor(cell: number): boolean {
    return this.grid.inBoundsCell(cell) &&
      this.grid.get(cell) === Terrain.DOOR &&
      this.level.openDoors.has(cell);
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
          this.pushLog(`You gain ${progress.gained} experience.`);
          if (progress.levelsGained > 0) {
            this.pushLog(`You are now level ${this.hero.level}!`);
          }
        }
      }
      this.removeEnemy(enemy);
      this.pushLog(`The ${enemy.name} dies!`);
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
    this.pushLog(`The ${attacker.name} hits you for ${r.damage}.`);
    if (dealt > 0) {
      this.onHeroDamaged?.({
        amount: dealt,
        source: attacker.name,
        hp: this.hero.stats.hp,
      });
    }
    if (!this.hero.stats.alive) {
      this.heroDead = true;
      this.pushLog(`You have died on depth ${this.depth}.`);
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
      (it) => it.type === "potion" && typeof it.heal === "number",
    );
    if (!potion) return false;
    return this.consumeItem(potion.id);
  }

  equipItem(itemId: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.all.find((it) => it.id === itemId);
    if (!item || !this.inventoryRef.equip(item)) return false;
    this.pushLog(`You equip ${item.name}.`);
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  consumeItem(itemId: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.all.find((it) => it.id === itemId);
    if (!item) return false;
    if (item.type === "potion" && typeof item.strengthBonus === "number" && item.strengthBonus > 0) {
      this.hero.stats.increaseBase("strength", item.strengthBonus);
      this.inventoryRef.remove(item);
      this.inventoryRef.refreshEquipmentModifiers();
      this.pushLog(`You quaff ${item.name} (+${item.strengthBonus} STR).`);
    } else if (item.type === "potion" && typeof item.heal === "number") {
      const healed = this.hero.stats.heal(item.heal);
      this.inventoryRef.remove(item);
      this.pushLog(`You quaff ${item.name} (+${healed} HP).`);
    } else if (item.type === "food") {
      this.inventoryRef.remove(item);
      this.pushLog(`You eat ${item.name}.`);
    } else {
      return false;
    }
    this.hero.pending = { kind: "wait" };
    this.processTurns();
    return true;
  }

  dropItem(itemId: string): boolean {
    if (this.heroDead) return false;
    const item = this.inventoryRef.all.find((it) => it.id === itemId);
    if (!item || !this.inventoryRef.remove(item)) return false;
    this.level.placeGroundItem(this.hero.pos, item.id);
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

  tryPickUpItem(): boolean {
    if (this.heroDead) return false;
    const itemId = this.level.itemAt(this.hero.pos);
    if (itemId === null) {
      this.pushLog("Nothing here.");
      return false;
    }
    const item = this.content.getItem(itemId);
    if (!item) {
      this.level.takeGroundItem(this.hero.pos);
      this.pushLog("The item crumbles away.");
      this.emitChange();
      return false;
    }
    if (this.inventoryRef.isFull()) {
      this.pushLog("Your pack is full.");
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
      this.pushLog("No target there.");
      return false;
    }

    const path = lineOfFire(this.hero.pos, targetCell, this.grid, {
      blocksCell: (cell) =>
        cell !== targetCell &&
        (this.enemyAt(cell) !== null || !this.isCellTransparent(cell)),
    });
    if (path.at(-1) !== targetCell) {
      this.pushLog("No clear shot.");
      return false;
    }

    this.hero.pending = { kind: "rangedAttack", target: targetCell };
    this.processTurns();
    return true;
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
      this.pushLog("You open the door.");
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
    this.pushLog("You close the door.");
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
          this.onActorMove?.({ actorId, fromCell, toCell });
        }
      },
    });
    this.queue.fixTime();
    this.checkOpenDoors();
    this.recomputeFOV();
    this.emitChange();
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
    const itemId = this.level.itemAt(this.hero.pos);
    if (itemId === null || this.inventoryRef.isFull()) return;
    const item = this.content.getItem(itemId);
    if (!item) return;
    const removed = this.level.takeGroundItem(this.hero.pos);
    if (removed === null) return;
    if (!this.inventoryRef.add(item)) {
      this.level.placeGroundItem(this.hero.pos, removed);
      return;
    }
    this.pushLog(`You pick up ${item.name}.`);
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
    this.dungeon.descend();
    this.enterFloor();
    this.emitChange();
  }

  ascend(): void {
    if (this.heroDead) return;
    this.dungeon.ascend();
    this.enterFloor();
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
      heroDead: this.heroDead,
      log: this.logLines.slice(),
    };
  }

  private restore(snapshot: GameWorldSnapshot): void {
    this.heroProfile = this.resolveHeroProfile(snapshot.heroProfileId);
    this.dungeon = DungeonManager.fromSnapshot(
      snapshot.dungeon,
      lootConfigForContent(this.content),
    );
    this.combatRng.state = snapshot.combatRngState;
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
    strengthPotionId: hasStrengthPotion ? "potion_strength" : null,
  };
}
