/**
 * Mulberry32 — the deterministic heart of the game (Directive 4).
 *
 * Every random decision in the dungeon (map carving, spawns, damage rolls)
 * flows through one of these generators. Given the same string `GameSeed`,
 * the exact same sequence of numbers comes out every time — so a player can
 * report a seed and we can reproduce their run bug-for-bug.
 *
 * This file is pure math: it imports nothing and touches no browser API,
 * so it runs identically in the browser and in headless Vitest.
 *
 * Algorithm: Mulberry32, a fast 32-bit PRNG with a full 2^32 period.
 * String seeds are folded down to a 32-bit integer with an xmur3-style
 * hash so human-friendly seeds ("CAVE-DELVE") map to a numeric state.
 */

/** Fold an arbitrary string into a well-mixed unsigned 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export class RNG {
  /** Human-readable label of the seed (the original string, or the number). */
  readonly label: string;
  /** The 32-bit state this generator was created with (for reseeding). */
  readonly initialState: number;

  private s: number;

  constructor(seed: string | number) {
    if (typeof seed === "string") {
      this.label = seed;
      this.s = hashSeed(seed);
    } else {
      this.s = seed >>> 0;
      this.label = String(this.s);
    }
    this.initialState = this.s;
  }

  /** Current internal state — serialize this to resume an identical stream. */
  get state(): number {
    return this.s;
  }
  set state(value: number) {
    this.s = value >>> 0;
  }

  /** A copy that will produce the same future sequence as this one. */
  clone(): RNG {
    const r = new RNG(this.initialState);
    r.s = this.s;
    return r;
  }

  /** Reset back to the original seed state. */
  reset(): void {
    this.s = this.initialState;
  }

  /** Raw 32-bit unsigned output and the primitive every other method builds on. */
  nextUint32(): number {
    let a = (this.s = (this.s + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max], inclusive of both ends. */
  range(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + this.nextInt(max - min + 1);
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A fair coin flip. */
  bool(): boolean {
    return this.nextUint32() < 0x80000000;
  }

  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("RNG.pick called on an empty array");
    }
    return items[this.nextInt(items.length)]!;
  }

  /** In-place Fisher–Yates shuffle (deterministic for a given seed). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }
}
