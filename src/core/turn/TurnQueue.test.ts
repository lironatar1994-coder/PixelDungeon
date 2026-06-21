import { describe, it, expect } from "vitest";
import { Actor, ActorPriority, TICK } from "@/core/turn/Actor";
import { TurnQueue } from "@/core/turn/TurnQueue";

/**
 * A test actor that counts how many times it acted and always spends a fixed
 * amount of time per action. `speed` is a multiplier on TICK:
 *   speed 2 -> spends TICK/2 -> twice as fast
 *   speed 0.5 -> spends TICK*2 -> half as fast
 * It always returns true so the queue keeps processing without pausing.
 */
class CountingActor extends Actor {
  acted = 0;
  constructor(private readonly speed: number, priority = ActorPriority.MOB) {
    super();
    this.actPriority = priority;
  }
  act(): boolean {
    this.acted++;
    this.spend(TICK / this.speed);
    return true;
  }
}

describe("TurnQueue", () => {
  it("REQUIRED: a fast entity receives more turns than a slow entity", () => {
    const queue = new TurnQueue();
    const fast = new CountingActor(2); // spends 0.5 per action
    const slow = new CountingActor(0.5); // spends 2.0 per action
    queue.add(fast);
    queue.add(slow);

    // Step the simulation a fixed number of times.
    for (let i = 0; i < 500; i++) queue.step();

    // The fast actor must act strictly more often...
    expect(fast.acted).toBeGreaterThan(slow.acted);
    // ...and by roughly the 4x ratio implied by 0.5 vs 2.0 time-per-action.
    const ratio = fast.acted / slow.acted;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("advances `now` to the acting actor's time (lowest time acts next)", () => {
    const queue = new TurnQueue();
    const a = new CountingActor(1);
    queue.add(a);

    expect(queue.now).toBe(0);
    queue.step(); // a acts at t=0, then spends 1.0
    expect(a.time).toBe(1);
    queue.step(); // now advances to 1.0
    expect(queue.now).toBe(1);
  });

  it("breaks ties by priority, then by insertion order (determinism)", () => {
    const queue = new TurnQueue();
    const log: string[] = [];

    class TagActor extends Actor {
      constructor(public tag: string, prio: number) {
        super();
        this.actPriority = prio;
      }
      act(): boolean {
        log.push(this.tag);
        this.spend(TICK);
        return true;
      }
    }

    // All three start at time 0. Expected order: higher priority first,
    // and for the equal-priority pair, the one added first.
    const hero = new TagActor("hero", ActorPriority.HERO);
    const mobA = new TagActor("mobA", ActorPriority.MOB);
    const mobB = new TagActor("mobB", ActorPriority.MOB);
    queue.add(hero);
    queue.add(mobA);
    queue.add(mobB);

    queue.step();
    queue.step();
    queue.step();

    expect(log).toEqual(["hero", "mobA", "mobB"]);
  });

  it("run() stops when an actor yields control (act returns false)", () => {
    const queue = new TurnQueue();

    class Yielder extends Actor {
      acted = 0;
      act(): boolean {
        this.acted++;
        this.spend(TICK);
        return false; // immediately pause (like the hero awaiting input)
      }
    }

    const y = new Yielder();
    queue.add(y);
    const steps = queue.run();
    expect(steps).toBe(1);
    expect(y.acted).toBe(1);
  });

  it("fixTime() pulls times back without changing relative order", () => {
    const queue = new TurnQueue();
    const a = new CountingActor(1);
    const b = new CountingActor(1);
    queue.add(a);
    queue.add(b);

    // Advance them well into the future.
    for (let i = 0; i < 20; i++) queue.step();
    const beforeA = a.time;
    const beforeB = b.time;
    const beforeNow = queue.now;

    queue.fixTime();

    const shift = Math.floor(Math.min(beforeA, beforeB));
    expect(a.time).toBe(beforeA - shift);
    expect(b.time).toBe(beforeB - shift);
    expect(queue.now).toBe(beforeNow - shift);
    // Relative gap preserved.
    expect(a.time - b.time).toBe(beforeA - beforeB);
  });

  it("is fully deterministic across two independent runs", () => {
    const trace = () => {
      const q = new TurnQueue();
      const actors = [
        new CountingActor(2),
        new CountingActor(0.5),
        new CountingActor(1),
      ];
      actors.forEach((a) => q.add(a));
      for (let i = 0; i < 300; i++) q.step();
      return actors.map((a) => a.acted);
    };
    expect(trace()).toEqual(trace());
  });
});
