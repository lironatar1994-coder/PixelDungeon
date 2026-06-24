/**
 * Hero — the player's avatar in the turn queue (pure logic).
 *
 * Like every Actor it is turn-based, not real-time: with no buffered action it
 * returns `false` from `act()`, pausing the TurnQueue until the player provides
 * input (mirroring SPD's hero). Its combat attributes live in a separate
 * CombatStats component (Directive 1), so position/input concerns here stay
 * independent of stats. Attacks are resolved by the world via an injected
 * HeroContext, keeping combat authority out of the actor itself.
 */
import { Actor, ActorPriority, TICK } from "@/core/turn/Actor";
import { CombatStats, type BaseStats } from "@/core/combat/CombatStats";

/** A buffered intent the hero will carry out on its next turn. */
export type HeroAction =
  | { kind: "move"; cell: number }
  | { kind: "attack"; target: number }
  | { kind: "rangedAttack"; target: number }
  | { kind: "pickUp" }
  | { kind: "search" }
  | { kind: "wait" };

/** What the hero needs from the world to resolve an attack. */
export interface HeroContext {
  attack(targetCell: number): void;
  pickUp?(): void;
}

export class Hero extends Actor {
  static readonly MAX_LEVEL = 30;

  pos: number;
  readonly stats: CombatStats;
  level: number;
  experience: number;
  /** The action the hero will take on its next turn, or null while waiting. */
  pending: HeroAction | null = null;

  private readonly ctx: HeroContext;

  constructor(
    pos: number,
    base: BaseStats,
    ctx: HeroContext,
    progression: { level?: number; experience?: number } = {},
  ) {
    super();
    this.pos = pos;
    this.stats = new CombatStats(base);
    this.level = progression.level ?? 1;
    this.experience = progression.experience ?? 0;
    this.ctx = ctx;
    this.actPriority = ActorPriority.HERO;
  }

  maxExperience(): number {
    return Hero.maxExperience(this.level);
  }

  static maxExperience(level: number): number {
    return 5 + Math.max(1, level) * 5;
  }

  addExperience(amount: number): { gained: number; levelsGained: number } {
    const gained = Math.max(0, Math.floor(amount));
    if (gained === 0 || this.level >= Hero.MAX_LEVEL) {
      return { gained, levelsGained: 0 };
    }

    this.experience += gained;
    let levelsGained = 0;
    while (this.experience >= this.maxExperience()) {
      this.experience -= this.maxExperience();
      if (this.level < Hero.MAX_LEVEL) {
        this.level++;
        levelsGained++;
        this.stats.increaseBase("maxHealth", 5);
        this.stats.increaseBase("accuracy", 1);
        this.stats.increaseBase("evasion", 1);
        this.stats.healToFull();
      }
      if (this.level >= Hero.MAX_LEVEL) {
        this.experience = 0;
        break;
      }
    }

    return { gained, levelsGained };
  }

  act(): boolean {
    if (this.pending === null) {
      return false; // no input buffered -> yield, pausing the queue
    }
    // Count down any timed stat modifiers (buffs/debuffs) at turn start.
    this.stats.tick();

    const action = this.pending;
    this.pending = null;
    const actionCost =
      action.kind === "attack" || action.kind === "rangedAttack"
        ? (TICK * this.stats.attackDelay) / this.stats.speed
        : TICK / this.stats.speed;
    if (action.kind === "move") {
      this.pos = action.cell;
    } else if (action.kind === "attack" || action.kind === "rangedAttack") {
      this.ctx.attack(action.target);
    } else if (action.kind === "pickUp") {
      this.ctx.pickUp?.();
    }
    this.spend(actionCost);
    return true;
  }
}
