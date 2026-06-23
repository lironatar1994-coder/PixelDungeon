/**
 * tapPlan — pure decision logic for "what should a tap do?" (headless-testable).
 *
 * Touch-to-attack means a single tap can mean three different things depending
 * on what's under it. Keeping that decision pure (no DOM, no GameWorld, no
 * mutation) lets us unit-test the targeting rules exhaustively while the
 * orchestrator (main.ts) stays a thin executor that only issues intents.
 *
 * It is generic over the enemy type so tests can pass trivial `{ pos }` mocks
 * while the app passes real `Enemy` instances.
 */
import type { Grid } from "@/core/grid/Grid";

export type TapPlan<E> =
  | { kind: "none" }
  | { kind: "travel"; cell: number }
  /** A visible enemy is adjacent — bump-attack it now. */
  | { kind: "attack"; enemy: E }
  /** A visible enemy is out of melee range — auto-walk toward it. */
  | { kind: "approach"; enemy: E };

export interface TapView<E extends { pos: number }> {
  grid: Grid;
  heroPos: number;
  enemies: readonly E[];
  isAlive: (enemy: E) => boolean;
  isVisible: (cell: number) => boolean;
}

/** Chebyshev distance: melee range includes orthogonal and diagonal neighbours. */
function chebyshev(grid: Grid, a: number, b: number): number {
  return Math.max(
    Math.abs(grid.xOf(a) - grid.xOf(b)),
    Math.abs(grid.yOf(a) - grid.yOf(b)),
  );
}

export function planTap<E extends { pos: number }>(
  view: TapView<E>,
  cell: number | null,
): TapPlan<E> {
  if (cell === null) return { kind: "none" };

  // 1. Target identification: a *visible, alive* enemy on the tapped cell.
  const enemy = view.enemies.find(
    (e) => e.pos === cell && view.isAlive(e) && view.isVisible(cell),
  );
  if (enemy) {
    // 2 & 3. In melee range -> attack now; otherwise approach via pathfinding.
    return chebyshev(view.grid, view.heroPos, cell) === 1
      ? { kind: "attack", enemy }
      : { kind: "approach", enemy };
  }

  // No (visible) enemy there: walk to the tile if it's somewhere we can stand.
  if (cell === view.heroPos || !view.grid.isWalkable(cell)) return { kind: "none" };
  return { kind: "travel", cell };
}
