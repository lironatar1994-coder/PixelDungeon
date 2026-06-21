/**
 * BSP — Binary Space Partitioning room generator (seeded, pure logic).
 *
 * The classic roguelike technique: start with the whole map as one rectangle,
 * then recursively slice it into two with a single straight cut, alternating
 * the cut direction. Stop when a partition is too small to slice again; each
 * remaining "leaf" partition gets one rectangular room carved inside it (with
 * a little padding so rooms never touch and stay distinct). Because every cut
 * and every room size/position is drawn from the seeded RNG, the same seed
 * reproduces the same tree — and therefore the same layout (Directive 4).
 *
 * This module only computes geometry (the tree + room rectangles). Painting
 * those rooms onto a Grid and connecting them is the LevelGenerator's job.
 */
import { Rect } from "@/core/grid/Rect";
import type { RNG } from "@/core/rng/Mulberry32";

export interface BSPOptions {
  /** A partition must be at least 2*minLeaf along an axis to be split. */
  minLeaf: number;
  /** Smallest allowed room width/height. */
  minRoom: number;
  /** Gap kept between a room and its partition edge (keeps rooms separated). */
  roomPadding: number;
  /** Hard cap on recursion depth. */
  maxDepth: number;
}

export const DEFAULT_BSP_OPTIONS: BSPOptions = {
  minLeaf: 8,
  minRoom: 4,
  roomPadding: 1,
  maxDepth: 6,
};

export class BSPNode {
  left: BSPNode | null = null;
  right: BSPNode | null = null;
  /** The carved room (only present on leaf nodes). */
  room: Rect | null = null;

  constructor(public readonly bounds: Rect) {}

  get isLeaf(): boolean {
    return this.left === null && this.right === null;
  }

  /** Collect every leaf node (deterministic left-to-right DFS order). */
  leaves(out: BSPNode[] = []): BSPNode[] {
    if (this.isLeaf) {
      out.push(this);
    } else {
      this.left?.leaves(out);
      this.right?.leaves(out);
    }
    return out;
  }
}

/** Build a BSP tree over `area` (in tile coordinates) using the seeded RNG. */
export function buildBSP(
  area: Rect,
  rng: RNG,
  opts: BSPOptions = DEFAULT_BSP_OPTIONS,
): BSPNode {
  const root = new BSPNode(area);
  split(root, 0, rng, opts);
  return root;
}

function split(node: BSPNode, depth: number, rng: RNG, opts: BSPOptions): void {
  const b = node.bounds;
  const canSplitVert = b.w >= 2 * opts.minLeaf; // a vertical cut -> left | right
  const canSplitHoriz = b.h >= 2 * opts.minLeaf; // a horizontal cut -> top / bottom

  if (depth >= opts.maxDepth || (!canSplitVert && !canSplitHoriz)) {
    node.room = carveRoom(b, rng, opts);
    return;
  }

  // Prefer cutting the longer axis so rooms stay reasonably square; only
  // fall back to a coin flip when the partition is roughly square.
  let vertical: boolean;
  if (canSplitVert && !canSplitHoriz) vertical = true;
  else if (canSplitHoriz && !canSplitVert) vertical = false;
  else if (b.w / b.h >= 1.25) vertical = true;
  else if (b.h / b.w >= 1.25) vertical = false;
  else vertical = rng.bool();

  if (vertical) {
    const splitX = rng.range(b.x + opts.minLeaf, b.right - opts.minLeaf);
    node.left = new BSPNode(new Rect(b.x, b.y, splitX - b.x, b.h));
    node.right = new BSPNode(new Rect(splitX, b.y, b.right - splitX, b.h));
  } else {
    const splitY = rng.range(b.y + opts.minLeaf, b.bottom - opts.minLeaf);
    node.left = new BSPNode(new Rect(b.x, b.y, b.w, splitY - b.y));
    node.right = new BSPNode(new Rect(b.x, splitY, b.w, b.bottom - splitY));
  }

  split(node.left, depth + 1, rng, opts);
  split(node.right, depth + 1, rng, opts);
}

function carveRoom(b: Rect, rng: RNG, opts: BSPOptions): Rect {
  const maxW = Math.max(opts.minRoom, b.w - 2 * opts.roomPadding);
  const maxH = Math.max(opts.minRoom, b.h - 2 * opts.roomPadding);
  const roomW = rng.range(opts.minRoom, maxW);
  const roomH = rng.range(opts.minRoom, maxH);
  const roomX = b.x + opts.roomPadding + rng.range(0, Math.max(0, maxW - roomW));
  const roomY = b.y + opts.roomPadding + rng.range(0, Math.max(0, maxH - roomH));
  return new Rect(roomX, roomY, roomW, roomH);
}

/**
 * Decide which rooms to connect: for every internal node, link a room from its
 * left subtree to a room from its right subtree. With N leaf rooms this yields
 * N-1 connections forming a spanning tree, so the whole floor is reachable
 * (the corridors themselves are carved by the LevelGenerator via A*).
 */
export function planConnections(root: BSPNode, rng: RNG): Array<[Rect, Rect]> {
  const connections: Array<[Rect, Rect]> = [];

  const visit = (node: BSPNode): void => {
    if (node.isLeaf || !node.left || !node.right) return;
    visit(node.left);
    visit(node.right);
    const a = pickRoom(node.left, rng);
    const b = pickRoom(node.right, rng);
    if (a && b) connections.push([a, b]);
  };

  visit(root);
  return connections;
}

/** Pick a representative room from a subtree by descending it at random. */
function pickRoom(node: BSPNode, rng: RNG): Rect | null {
  if (node.isLeaf) return node.room;
  if (!node.left) return node.right ? pickRoom(node.right, rng) : null;
  if (!node.right) return pickRoom(node.left, rng);
  return rng.bool() ? pickRoom(node.left, rng) : pickRoom(node.right, rng);
}
