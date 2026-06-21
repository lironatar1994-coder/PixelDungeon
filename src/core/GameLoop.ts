/**
 * GameLoop — the master clock.
 *
 * Directive 1 (Lego Brick): this file knows NOTHING about the canvas, the
 * DOM, or how things are drawn. It only measures time and tells the rest
 * of the game "a frame happened, here is how much time passed (dt)".
 *
 * It does this by emitting a "loop:frame" event on the EventBus. Whoever
 * cares (the renderer now; the turn system later) subscribes. Because the
 * timekeeping is decoupled from rendering, the same loop logic can be
 * driven by a fake clock in a headless Vitest test (Directive 3).
 *
 * The `scheduler`/`now` functions are injected so tests can replace
 * requestAnimationFrame and performance.now with deterministic stand-ins.
 */
import type { EventBus } from "@/events/EventBus";

/** Requests the next tick and returns a handle that `cancel` understands. */
export type FrameScheduler = (callback: () => void) => number;
export type FrameCanceller = (handle: number) => void;

export interface GameLoopOptions {
  bus: EventBus;
  /** Defaults to requestAnimationFrame. Override in tests. */
  scheduler?: FrameScheduler;
  /** Defaults to cancelAnimationFrame. Override in tests. */
  canceller?: FrameCanceller;
  /** Defaults to performance.now (ms). Override in tests for a fake clock. */
  now?: () => number;
}

export class GameLoop {
  private readonly bus: EventBus;
  private readonly scheduler: FrameScheduler;
  private readonly canceller: FrameCanceller;
  private readonly now: () => number;

  private running = false;
  private handle = 0;
  private lastTime = 0;
  /** Total seconds elapsed since start() — handy for animations later. */
  private elapsed = 0;

  constructor(options: GameLoopOptions) {
    this.bus = options.bus;
    this.scheduler =
      options.scheduler ?? ((cb) => requestAnimationFrame(cb));
    this.canceller =
      options.canceller ?? ((h) => cancelAnimationFrame(h));
    this.now = options.now ?? (() => performance.now());
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.now();
    this.handle = this.scheduler(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.canceller(this.handle);
  }

  /**
   * One iteration of the loop. Arrow function so `this` stays bound when
   * it is handed to the scheduler as a bare callback.
   */
  private tick = (): void => {
    if (!this.running) return;

    const current = this.now();
    // dt in seconds. Clamped so a paused tab (huge gap) cannot make the
    // simulation jump forward by a wild amount when it resumes.
    const dt = Math.min((current - this.lastTime) / 1000, 0.25);
    this.lastTime = current;
    this.elapsed += dt;

    this.bus.emit("loop:frame", { dt, elapsed: this.elapsed });

    this.handle = this.scheduler(this.tick);
  };
}
