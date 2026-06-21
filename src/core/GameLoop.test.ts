import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@/events/EventBus";
import { GameLoop } from "@/core/GameLoop";

/**
 * Proves the testing pipeline (Directive 3): the GameLoop is fully
 * headless. We inject a fake clock and a manual scheduler so we can step
 * frames by hand and assert on the emitted timing — no browser required.
 *
 * The scheduled callback is stashed on a holder object (`frame.cb`) rather
 * than a bare `let`, because TypeScript cannot prove a closure assignment
 * to a local ran, and would narrow a plain `let` to `null`/`never`.
 */
describe("GameLoop", () => {
  it("emits a frame with the correct delta time using an injected clock", () => {
    const bus = new EventBus();

    // A controllable clock and scheduler stand in for performance.now /
    // requestAnimationFrame. We capture the scheduled callback so the test
    // decides exactly when the next frame happens.
    let clock = 1000;
    const frame: { cb: (() => void) | null } = { cb: null };
    const scheduler = vi.fn((cb: () => void) => {
      frame.cb = cb;
      return 1;
    });

    const loop = new GameLoop({
      bus,
      scheduler,
      canceller: vi.fn(),
      now: () => clock,
    });

    const frames: number[] = [];
    bus.on("loop:frame", ({ dt }) => frames.push(dt));

    loop.start();
    expect(loop.isRunning).toBe(true);

    // Advance the fake clock by 16ms (~60fps) and run the queued frame.
    clock += 16;
    frame.cb?.();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeCloseTo(0.016, 5); // 16ms -> 0.016s
  });

  it("clamps delta time after a long pause so the sim cannot jump", () => {
    const bus = new EventBus();
    let clock = 0;
    const frame: { cb: (() => void) | null } = { cb: null };

    const loop = new GameLoop({
      bus,
      scheduler: (cb) => {
        frame.cb = cb;
        return 1;
      },
      canceller: vi.fn(),
      now: () => clock,
    });

    const frames: number[] = [];
    bus.on("loop:frame", ({ dt }) => frames.push(dt));

    loop.start();
    clock += 10_000; // simulate a 10-second background-tab pause
    frame.cb?.();

    expect(frames[0]).toBe(0.25); // clamped to the 0.25s ceiling
  });

  it("stops emitting frames after stop()", () => {
    const bus = new EventBus();
    const cancel = vi.fn();
    const frame: { cb: (() => void) | null } = { cb: null };

    const loop = new GameLoop({
      bus,
      scheduler: (cb) => {
        frame.cb = cb;
        return 7;
      },
      canceller: cancel,
      now: () => 0,
    });

    let count = 0;
    bus.on("loop:frame", () => count++);

    loop.start();
    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(cancel).toHaveBeenCalledWith(7);

    frame.cb?.(); // a late, already-queued tick must be ignored
    expect(count).toBe(0);
  });
});
