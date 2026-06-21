/**
 * lineOfSight — a single-ray "can A see B?" check (pure logic).
 *
 * Shadowcasting answers "everything the hero can see" for fog of war. AI only
 * needs the cheaper question "can this enemy see the player right now?", which
 * is one straight ray. We walk a Bresenham line from `from` to `to`; if any
 * intermediate cell blocks sight (not transparent) the view is broken. The
 * range check keeps enemies from spotting the hero across the whole map.
 *
 * Both this and the shadowcaster use the Grid's `isTransparent`, so the two
 * notions of sight stay consistent.
 */
import type { Grid } from "@/core/grid/Grid";

export function hasLineOfSight(
  grid: Grid,
  from: number,
  to: number,
  maxRange: number,
): boolean {
  const startX = grid.xOf(from);
  const startY = grid.yOf(from);
  const x1 = grid.xOf(to);
  const y1 = grid.yOf(to);
  let x0 = startX;
  let y0 = startY;

  const dxTotal = x1 - startX;
  const dyTotal = y1 - startY;
  if (dxTotal * dxTotal + dyTotal * dyTotal > maxRange * maxRange) {
    return false;
  }

  const dx = Math.abs(dxTotal);
  const dy = Math.abs(dyTotal);
  const sx = startX < x1 ? 1 : -1;
  const sy = startY < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    // Block on intermediate cells only — the endpoints (eye and target)
    // are allowed to be non-transparent themselves.
    const atStart = x0 === startX && y0 === startY;
    const atEnd = x0 === x1 && y0 === y1;
    if (!atStart && !atEnd && !grid.isTransparent(grid.cell(x0, y0))) {
      return false;
    }
    if (atEnd) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}
