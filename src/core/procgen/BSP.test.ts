import { describe, it, expect } from "vitest";
import { Rect } from "@/core/grid/Rect";
import { RNG } from "@/core/rng/Mulberry32";
import { buildBSP, DEFAULT_BSP_OPTIONS } from "@/core/procgen/BSP";

const AREA = new Rect(1, 1, 38, 38);

/** Serialize a tree's leaf rooms so two builds can be compared exactly. */
function roomSignature(seed: string): string {
  const tree = buildBSP(AREA, new RNG(seed));
  return tree
    .leaves()
    .map((l) => l.room!)
    .map((r) => `${r.x},${r.y},${r.w},${r.h}`)
    .join("|");
}

describe("BSP", () => {
  it("is deterministic: same seed -> identical room layout", () => {
    expect(roomSignature("BSP-SEED")).toBe(roomSignature("BSP-SEED"));
  });

  it("produces different layouts for different seeds", () => {
    expect(roomSignature("layout-a")).not.toBe(roomSignature("layout-b"));
  });

  it("splits a large area into multiple rooms", () => {
    const tree = buildBSP(AREA, new RNG("multi"));
    expect(tree.leaves().length).toBeGreaterThan(1);
  });

  it("keeps every room inside the area, padded, and at least minRoom in size", () => {
    const tree = buildBSP(AREA, new RNG("bounds"));
    const { minRoom, roomPadding } = DEFAULT_BSP_OPTIONS;
    for (const leaf of tree.leaves()) {
      const room = leaf.room!;
      expect(room).not.toBeNull();
      expect(room.w).toBeGreaterThanOrEqual(minRoom);
      expect(room.h).toBeGreaterThanOrEqual(minRoom);
      // Inside the partition with padding...
      expect(room.x).toBeGreaterThanOrEqual(leaf.bounds.x + roomPadding);
      expect(room.y).toBeGreaterThanOrEqual(leaf.bounds.y + roomPadding);
      expect(room.right).toBeLessThanOrEqual(leaf.bounds.right - roomPadding);
      expect(room.bottom).toBeLessThanOrEqual(leaf.bounds.bottom - roomPadding);
      // ...and therefore inside the overall area.
      expect(room.x).toBeGreaterThanOrEqual(AREA.x);
      expect(room.right).toBeLessThanOrEqual(AREA.right);
    }
  });

  it("produces non-overlapping rooms (distinct rooms)", () => {
    const rooms = buildBSP(AREA, new RNG("disjoint"))
      .leaves()
      .map((l) => l.room!);
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        expect(rooms[i]!.intersects(rooms[j]!)).toBe(false);
      }
    }
  });
});
