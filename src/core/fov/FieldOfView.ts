/**
 * FieldOfView — the 3-state fog of war (pure logic).
 *
 * Tracks two sets of cells:
 *   - visible:  currently lit by the shadowcaster (full brightness)
 *   - explored: ever seen (dim when no longer visible; black if never seen)
 *
 * `explored` memory belongs to the floor, not the hero, so it persists when
 * you leave and return — `bindMemory` points this FOV at the current Level's
 * explored set. `update` is called only when the hero moves or the level
 * changes (never per animation frame), satisfying the recompute-only-when-
 * needed requirement.
 */
import type { Grid } from "@/core/grid/Grid";
import { computeFOV } from "./ShadowCaster";

export type CellVisibility = "visible" | "explored" | "unseen";

export class FieldOfView {
  /** Cells visible right now. */
  readonly visible = new Set<number>();
  /** Cells ever seen (owned by the current floor; swapped via bindMemory). */
  private explored = new Set<number>();

  /** Point this FOV at a floor's persistent explored-memory set. */
  bindMemory(exploredMemory: Set<number>): void {
    this.explored = exploredMemory;
  }

  /** Recompute visibility from `origin`; fold newly seen cells into memory. */
  update(
    grid: Grid,
    origin: number,
    radius: number,
    isOpaque?: (cell: number) => boolean,
  ): void {
    this.visible.clear();
    for (const cell of computeFOV(grid, origin, radius, isOpaque)) {
      this.visible.add(cell);
      this.explored.add(cell);
    }
  }

  isVisible(cell: number): boolean {
    return this.visible.has(cell);
  }

  isExplored(cell: number): boolean {
    return this.explored.has(cell);
  }

  stateOf(cell: number): CellVisibility {
    if (this.visible.has(cell)) return "visible";
    if (this.explored.has(cell)) return "explored";
    return "unseen";
  }

  get exploredMemory(): ReadonlySet<number> {
    return this.explored;
  }
}
