import { describe, it, expect } from "vitest";
import { RNG, hashSeed } from "@/core/rng/Mulberry32";

describe("RNG (Mulberry32)", () => {
  it("is deterministic: identical seeds yield identical sequences", () => {
    const a = new RNG("CAVE-DELVE");
    const b = new RNG("CAVE-DELVE");
    const seqA = Array.from({ length: 20 }, () => a.nextUint32());
    const seqB = Array.from({ length: 20 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.nextUint32())(new RNG("seed-A")));
    const b = Array.from({ length: 20 }, ((r) => () => r.nextUint32())(new RNG("seed-B")));
    expect(a).not.toEqual(b);
  });

  it("hashSeed is stable and returns an unsigned 32-bit integer", () => {
    const h = hashSeed("hello");
    expect(h).toBe(hashSeed("hello"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("next() stays within [0, 1)", () => {
    const r = new RNG(12345);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("range() respects inclusive bounds", () => {
    const r = new RNG("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = r.range(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("clone() reproduces the original's future sequence", () => {
    const r = new RNG("clone-me");
    r.nextUint32();
    r.nextUint32();
    const copy = r.clone();
    const fromOriginal = Array.from({ length: 10 }, () => r.nextUint32());
    const fromClone = Array.from({ length: 10 }, () => copy.nextUint32());
    expect(fromClone).toEqual(fromOriginal);
  });

  it("state save/restore resumes an identical stream", () => {
    const r = new RNG("save-state");
    const saved = r.state;
    const expected = Array.from({ length: 5 }, () => r.nextUint32());
    r.state = saved;
    const replayed = Array.from({ length: 5 }, () => r.nextUint32());
    expect(replayed).toEqual(expected);
  });
});
