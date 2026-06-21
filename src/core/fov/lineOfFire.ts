/**
 * lineOfFire - projectile ray math (pure logic).
 *
 * Walks the Bresenham line from `start` to `end`, returning every traversed
 * cell until the intended target, a solid wall, or an injected entity blocker
 * stops the projectile. The start cell never blocks its own shot and the end
 * cell is allowed to contain the intended target.
 */
import type { Grid } from "@/core/grid/Grid";

export interface LineOfFireOptions {
  /** True when an intermediate entity blocks the projectile path. */
  blocksCell?: (cell: number) => boolean;
}

export function lineOfFire(
  start: number,
  end: number,
  grid: Grid,
  opts: LineOfFireOptions = {},
): number[] {
  if (!grid.inBoundsCell(start) || !grid.inBoundsCell(end)) return [];

  const out: number[] = [];
  const startX = grid.xOf(start);
  const startY = grid.yOf(start);
  const endX = grid.xOf(end);
  const endY = grid.yOf(end);
  let x = startX;
  let y = startY;

  const dxTotal = endX - startX;
  const dyTotal = endY - startY;
  const dx = Math.abs(dxTotal);
  const dy = Math.abs(dyTotal);
  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    const cell = grid.cell(x, y);
    out.push(cell);

    const atStart = cell === start;
    const atEnd = cell === end;
    if (!atStart && !atEnd && (grid.isSolid(cell) || opts.blocksCell?.(cell))) {
      return out;
    }
    if (atEnd) return out;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
