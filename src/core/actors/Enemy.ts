/**
 * Enemy — a monster with a Wander/Hunt state machine (pure logic).
 *
 * Fully integrated into the Phase 1 tick queue: it is an Actor whose `act()`
 * runs once per turn and ends by spending `TICK / speed` (so a speed-2 enemy
 * takes two steps for each ordinary turn — no real-time loop anywhere).
 *
 * Behaviour each turn:
 *   1. Check line of sight to the hero (its "FOV").
 *   2. If it can see the hero -> enter HUNT and remember the hero's cell.
 *   3. HUNT: if the hero is already in Chebyshev melee range, attack before
 *      pathfinding; otherwise A*-path toward the last known hero cell.
 *      Lost the trail at the last known cell -> drop back to WANDER.
 *   4. WANDER: step to a random adjacent walkable cell.
 *
 * Everything it needs from the world arrives through the injected `EnemySenses`
 * interface, so the enemy stays decoupled and is trivial to unit-test.
 */
import { Actor, ActorPriority, TICK } from "@/core/turn/Actor";
import type { Grid } from "@/core/grid/Grid";
import type { RNG } from "@/core/rng/Mulberry32";
import type { EnemyDef } from "@/core/data/types";
import { CombatStats } from "@/core/combat/CombatStats";
import { findPath } from "@/core/pathfinding/AStar";
import { hasLineOfSight } from "@/core/fov/lineOfSight";

export type EnemyState = "wander" | "hunt";

/** The slice of the world an enemy is allowed to perceive / act upon. */
export interface EnemySenses {
  readonly grid: Grid;
  readonly rng: RNG;
  /** The hero's current cell. */
  heroPos(): number;
  /** True if another actor occupies the cell (so enemies don't overlap). */
  isOccupied(cell: number): boolean;
  /** Resolve an attack from `attacker` against the hero (world authority). */
  attackHero(attacker: Enemy): void;
}

export class Enemy extends Actor {
  pos: number;

  // --- AI state (kept separate from combat stats, per Directive 1) ---
  state: EnemyState = "wander";
  lastKnownHeroPos: number | null = null;

  /** The data-driven definition this enemy was spawned from (Directive 5). */
  readonly def: EnemyDef;
  /** Modular combat component — independent of the AI state above. */
  readonly stats: CombatStats;

  private readonly senses: EnemySenses;

  constructor(pos: number, def: EnemyDef, senses: EnemySenses) {
    super();
    this.pos = pos;
    this.def = def;
    this.stats = new CombatStats({
      maxHealth: def.maxHealth,
      accuracy: def.accuracy,
      evasion: def.evasion,
      damageMin: def.damageMin,
      damageMax: def.damageMax,
      armor: def.armor,
    });
    this.senses = senses;
    this.actPriority = ActorPriority.MOB;
  }

  // Stats are read straight from the loaded definition — nothing hard-coded.
  get name(): string {
    return this.def.name;
  }
  get hp(): number {
    return this.stats.hp;
  }
  get maxHealth(): number {
    return this.stats.maxHealth;
  }
  get speed(): number {
    return this.def.speed;
  }
  get vision(): number {
    return this.def.vision;
  }

  /** Whether the hero is currently within line of sight (its FOV). */
  canSeeHero(): boolean {
    return hasLineOfSight(
      this.senses.grid,
      this.pos,
      this.senses.heroPos(),
      this.def.vision,
    );
  }

  act(): boolean {
    // Count down any timed stat modifiers (e.g. a debuff) at turn start.
    this.stats.tick();
    const heroPos = this.senses.heroPos();

    // --- state transitions ---
    if (this.canSeeHero()) {
      this.state = "hunt";
      this.lastKnownHeroPos = heroPos;
    } else if (this.state === "hunt" && this.pos === this.lastKnownHeroPos) {
      // Arrived where the hero was last seen but it's gone -> give up.
      this.state = "wander";
      this.lastKnownHeroPos = null;
    }

    // --- behaviour ---
    if (this.state === "hunt" && this.lastKnownHeroPos !== null) {
      this.huntStep(this.lastKnownHeroPos);
    } else {
      this.wanderStep();
    }

    this.spend(TICK / this.def.speed);
    return true;
  }

  private huntStep(target: number): void {
    if (chebyshevDistance(this.senses.grid, this.pos, this.senses.heroPos()) === 1) {
      this.senses.attackHero(this);
      return;
    }

    if (target === this.pos) return;
    const grid = this.senses.grid;
    const path = findPath(grid, this.pos, target, {
      passable: (c) =>
        grid.isWalkable(c) && (c === target || !this.senses.isOccupied(c)),
    });
    if (!path || path.length < 2) return;

    const next = path[1]!;
    if (next === this.senses.heroPos()) {
      // Adjacent to the hero: attack instead of moving onto it.
      this.senses.attackHero(this);
    } else if (!this.senses.isOccupied(next)) {
      this.pos = next;
    }
  }

  private wanderStep(): void {
    const grid = this.senses.grid;
    const options = grid
      .neighbours4(this.pos)
      .filter(
        (c) =>
          grid.isWalkable(c) &&
          !this.senses.isOccupied(c) &&
          c !== this.senses.heroPos(),
      );
    if (options.length > 0) {
      this.pos = this.senses.rng.pick(options);
    }
  }
}

function chebyshevDistance(grid: Grid, a: number, b: number): number {
  return Math.max(
    Math.abs(grid.xOf(a) - grid.xOf(b)),
    Math.abs(grid.yOf(a) - grid.yOf(b)),
  );
}
