/**
 * ShadowCaster — recursive shadowcasting field of view (pure logic).
 *
 * Translated from the algorithm SPD uses (RogueBasin's recursive
 * shadowcasting). It computes exactly which cells the origin can see, taking
 * walls into account, by sweeping the eight 45° octants around the origin and
 * tracking visibility as a range of *slopes* (angles). When a wall is hit it
 * recurses into the still-visible sub-wedge beside the wall and narrows the
 * current sweep to continue past it — which is what gives crisp, correct
 * shadows around corners.
 *
 * No DOM, no rendering: it returns the set of visible cells, so it is fully
 * headless-testable and only recomputed when something actually changes.
 */
import type { Grid } from "@/core/grid/Grid";

/** Per-octant coordinate transform: [xx, xy, yx, yy]. */
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

export type OpacityFn = (cell: number) => boolean;

/**
 * Compute the set of cells visible from `origin` within `radius`.
 * @param isOpaque defaults to "this cell is not transparent" from the Grid.
 */
export function computeFOV(
  grid: Grid,
  origin: number,
  radius: number,
  isOpaque: OpacityFn = (cell) => !grid.isTransparent(cell),
): Set<number> {
  const visible = new Set<number>([origin]);
  const cx = grid.xOf(origin);
  const cy = grid.yOf(origin);
  const r2 = radius * radius;

  const castLight = (
    row: number,
    startSlope: number,
    endSlope: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ): void => {
    if (startSlope < endSlope) return;
    let nextStart = startSlope;
    let blocked = false;

    for (let distance = row; distance <= radius && !blocked; distance++) {
      const dy = -distance;
      for (let dx = -distance; dx <= 0; dx++) {
        const leftSlope = (dx - 0.5) / (dy + 0.5);
        const rightSlope = (dx + 0.5) / (dy - 0.5);
        if (startSlope < rightSlope) continue;
        if (endSlope > leftSlope) break;

        const curX = cx + dx * xx + dy * xy;
        const curY = cy + dx * yx + dy * yy;
        const inBounds = grid.inBounds(curX, curY);
        const cell = inBounds ? grid.cell(curX, curY) : -1;

        // Light the cell if it is within the circular radius.
        if (inBounds && dx * dx + dy * dy <= r2) {
          visible.add(cell);
        }

        const opaque = !inBounds || isOpaque(cell);
        if (blocked) {
          if (opaque) {
            nextStart = rightSlope;
            continue;
          } else {
            blocked = false;
            startSlope = nextStart;
          }
        } else if (opaque && distance < radius) {
          // Hit a wall: recurse into the wedge to its left, then keep
          // sweeping to its right with a tightened start slope.
          blocked = true;
          castLight(distance + 1, startSlope, leftSlope, xx, xy, yx, yy);
          nextStart = rightSlope;
        }
      }
    }
  };

  for (const [xx, xy, yx, yy] of OCTANTS) {
    castLight(1, 1.0, 0.0, xx, xy, yx, yy);
  }
  return visible;
}
