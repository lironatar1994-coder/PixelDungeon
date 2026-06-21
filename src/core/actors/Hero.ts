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
  | { kind: "wait" };

/** What the hero needs from the world to resolve an attack. */
export interface HeroContext {
  attack(targetCell: number): void;
}

export class Hero extends Actor {
  pos: number;
  readonly stats: CombatStats;
  /** The action the hero will take on its next turn, or null while waiting. */
  pending: HeroAction | null = null;

  private readonly ctx: HeroContext;

  constructor(pos: number, base: BaseStats, ctx: HeroContext) {
    super();
    this.pos = pos;
    this.stats = new CombatStats(base);
    this.ctx = ctx;
    this.actPriority = ActorPriority.HERO;
  }

  act(): boolean {
    if (this.pending === null) {
      return false; // no input buffered -> yield, pausing the queue
    }
    // Count down any timed stat modifiers (buffs/debuffs) at turn start.
    this.stats.tick();

    const action = this.pending;
    this.pending = null;
    if (action.kind === "move") {
      this.pos = action.cell;
    } else if (action.kind === "attack") {
      this.ctx.attack(action.target);
    }
    this.spend(TICK / this.stats.speed);
    return true;
  }
}
