/**
 * Actor — anything that takes turns (translated from SPD's Actor.java).
 *
 * The whole turn system is built on ONE number per actor: `time`. The actor
 * with the smallest `time` acts next. When it acts, it "spends" time, pushing
 * its `time` further into the future. An actor that spends LESS per action
 * comes back to the front of the line sooner — that is literally what makes
 * something "fast".
 *
 *   normal action  -> spend(TICK)      (TICK = 1.0)
 *   fast actor      -> spend(TICK / 2) (acts twice as often)
 *   slow actor      -> spend(TICK * 2) (acts half as often)
 *
 * This class is pure logic — it never draws or plays sound. Subclasses
 * implement `act()` and return whether the queue may immediately continue.
 */

/** Base cost of one ordinary action. */
export const TICK = 1.0;

/**
 * Tie-breaker bands for actors that share the same `time`. Higher acts first.
 * Mirrors SPD's priority constants so ordering feels identical.
 */
export const ActorPriority = {
  VFX: 100, // visual effects resolve first
  HERO: 0, // the player
  BLOB: -10, // gases/liquids after the hero
  MOB: -20, // monsters
  BUFF: -30, // status effects last
  DEFAULT: -100,
} as const;

export abstract class Actor {
  /** Position of this actor on the global timeline. Lower = acts sooner. */
  time = 0;

  /** Tie-breaker when two actors share the same `time` (higher acts first). */
  actPriority: number = ActorPriority.DEFAULT;

  /**
   * Final, fully-deterministic tie-breaker assigned by the TurnQueue when the
   * actor is added (lower = added earlier = acts first). This is our
   * improvement over SPD, whose HashSet iteration order is undefined when
   * both `time` and `actPriority` are equal.
   */
  seq = 0;

  /**
   * Perform this actor's action.
   * @param now The current global time (equals this actor's `time`).
   * @returns `true` if the queue may immediately process the next actor,
   *          `false` to pause (e.g. the hero is waiting for player input).
   */
  abstract act(now: number): boolean;

  /**
   * Advance this actor's time by `amount`. A tiny snap-to-integer guards
   * against floating-point drift accumulating over thousands of turns
   * (same trick SPD uses in spendConstant).
   */
  spend(amount: number): void {
    this.time += amount;
    const frac = Math.abs(this.time % 1);
    if (frac < 0.001 || frac > 0.999) {
      this.time = Math.round(this.time);
    }
  }
}
