/**
 * TurnQueue — the deterministic priority scheduler (from SPD's Actor.process).
 *
 * It owns the global clock `now` and a set of actors. Each step it finds the
 * actor with the lowest `time` and lets it act, advancing `now` to that time.
 * Unlike SPD's static, HashSet-based scheduler, this is an instance (so tests
 * and save-games can hold independent queues) and its ordering is 100%
 * deterministic thanks to the (time, priority, seq) ordering key.
 */
import { Actor } from "./Actor";

export interface TurnQueueActorSnapshot {
  id: string;
  time: number;
  seq: number;
}

export interface TurnQueueSnapshot {
  now: number;
  nextSeq: number;
  actors: TurnQueueActorSnapshot[];
}

export interface TurnQueueStepObserver {
  beforeAct?(actor: Actor, now: number): void;
  afterAct?(actor: Actor, continued: boolean, now: number): void;
}

export class TurnQueue {
  private actors: Actor[] = [];
  private nowTime = 0;
  private nextSeq = 1;

  /** The current point on the global timeline. */
  get now(): number {
    return this.nowTime;
  }

  get size(): number {
    return this.actors.length;
  }

  /** Add an actor, optionally delayed so it first acts `delay` after `now`. */
  add(actor: Actor, delay = 0): void {
    if (this.actors.includes(actor)) return;
    actor.time = this.nowTime + Math.max(delay, 0);
    actor.seq = this.nextSeq++;
    this.actors.push(actor);
  }

  remove(actor: Actor): void {
    const i = this.actors.indexOf(actor);
    if (i >= 0) this.actors.splice(i, 1);
  }

  contains(actor: Actor): boolean {
    return this.actors.includes(actor);
  }

  /**
   * The actor that will act next, without acting. Selection order:
   *   1. lowest `time`
   *   2. then highest `actPriority`
   *   3. then lowest `seq` (insertion order) — the deterministic tie-breaker
   */
  peek(): Actor | null {
    let best: Actor | null = null;
    for (const a of this.actors) {
      if (best === null || this.actsBefore(a, best)) {
        best = a;
      }
    }
    return best;
  }

  private actsBefore(a: Actor, b: Actor): boolean {
    if (a.time !== b.time) return a.time < b.time;
    if (a.actPriority !== b.actPriority) return a.actPriority > b.actPriority;
    return a.seq < b.seq;
  }

  /**
   * Process exactly one actor. Advances `now` to that actor's time, calls its
   * `act()`, and returns the actor (or null if the queue is empty).
   */
  step(): Actor | null {
    const actor = this.peek();
    if (!actor) return null;
    this.nowTime = actor.time;
    actor.act(this.nowTime);
    return actor;
  }

  /**
   * Drive the queue until an actor's `act()` returns false (it needs to
   * pause — e.g. waiting for player input) or `maxSteps` is reached.
   * Returns how many actors acted. The cap prevents an infinite loop if
   * every actor keeps yielding control.
   */
  run(maxSteps = 100_000, observer?: TurnQueueStepObserver): number {
    let steps = 0;
    while (steps < maxSteps) {
      const actor = this.peek();
      if (!actor) break;
      this.nowTime = actor.time;
      observer?.beforeAct?.(actor, this.nowTime);
      steps++;
      const continued = actor.act(this.nowTime);
      observer?.afterAct?.(actor, continued, this.nowTime);
      if (!continued) break;
    }
    return steps;
  }

  /**
   * Pull every actor's `time` back toward zero by the whole-number floor of
   * the minimum time, keeping `now` and all relative offsets intact. Run this
   * periodically so floats never grow large enough to lose precision over a
   * very long game (SPD calls this fixTime).
   */
  fixTime(): void {
    if (this.actors.length === 0) return;
    let min = Infinity;
    for (const a of this.actors) {
      if (a.time < min) min = a.time;
    }
    const shift = Math.floor(min);
    if (shift <= 0) return;
    for (const a of this.actors) {
      a.time -= shift;
    }
    this.nowTime -= shift;
  }

  clear(): void {
    this.actors = [];
    this.nowTime = 0;
    this.nextSeq = 1;
  }

  snapshot(idOf: (actor: Actor) => string | null): TurnQueueSnapshot {
    return {
      now: this.nowTime,
      nextSeq: this.nextSeq,
      actors: this.actors.flatMap((actor) => {
        const id = idOf(actor);
        return id === null ? [] : [{ id, time: actor.time, seq: actor.seq }];
      }),
    };
  }

  restore(
    snapshot: TurnQueueSnapshot,
    resolveActor: (id: string) => Actor | undefined,
  ): void {
    this.actors = [];
    this.nowTime = snapshot.now;
    this.nextSeq = snapshot.nextSeq;
    for (const entry of snapshot.actors) {
      const actor = resolveActor(entry.id);
      if (!actor) continue;
      actor.time = entry.time;
      actor.seq = entry.seq;
      this.actors.push(actor);
    }
    const maxSeq = this.actors.reduce((max, actor) => Math.max(max, actor.seq), 0);
    this.nextSeq = Math.max(this.nextSeq, maxSeq + 1);
  }
}
