/**
 * LevelGenerator — turns a seed into a finished floor (pure logic).
 *
 * Pipeline:
 *   1. BSP-partition the interior and carve a distinct room in each leaf.
 *   2. For each planned room pair, run A* and dig the shortest route as a
 *      1-tile-wide corridor (corridors prefer reusing existing floor, so they
 *      naturally merge into junctions instead of running in parallel).
 *   3. Mark corridor cells that touch a room as DOOR tiles.
 *   4. Place the up/down stairs in the two rooms that are farthest apart.
 *
 * Everything is driven by the single injected RNG, so a master seed always
 * yields the exact same dungeon (Directive 4). No DOM, no rendering here.
 */
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import { Rect } from "@/core/grid/Rect";
import type { RNG } from "@/core/rng/Mulberry32";
import { findPath } from "@/core/pathfinding/AStar";
import type { GroundItem } from "@/core/dungeon/Level";
import {
  buildBSP,
  planConnections,
  DEFAULT_BSP_OPTIONS,
  type BSPOptions,
} from "./BSP";
import { LevelPainter } from "../grid/gen/Painter";

export interface GeneratedLevel {
  grid: Grid;
  rooms: Rect[];
  entrance: number;
  exit: number;
  groundItems: GroundItem[];
  floorVariants: Map<number, number>;
}

export interface LootGenerationOptions {
  /** Random loot pool. Potion of Strength may be excluded by the caller. */
  itemIds?: readonly string[];
  /** Items that must appear on this floor, placed before random loot. */
  guaranteedItemIds?: readonly string[];
  /** Random item count; defaults to a small deterministic 2..4 when itemIds exist. */
  itemCount?: number;
}

export function generateLevel(
  width: number,
  height: number,
  rng: RNG,
  opts: BSPOptions = DEFAULT_BSP_OPTIONS,
  loot: LootGenerationOptions = {},
): GeneratedLevel {
  const grid = new Grid(width, height, Terrain.WALL);
  const floorVariants = new Map<number, number>();

  // Partition only the interior so the outer ring always stays solid wall.
  const area = new Rect(1, 1, width - 2, height - 2);
  const tree = buildBSP(area, rng, opts);
  const rooms = tree
    .leaves()
    .map((leaf) => leaf.room)
    .filter((room): room is Rect => room !== null);

  // Corridors may carve anywhere except the outer wall ring.
  const interior = (cell: number): boolean => {
    const x = grid.xOf(cell);
    const y = grid.yOf(cell);
    return x >= 1 && y >= 1 && x < width - 1 && y < height - 1;
  };

  // 2) Connect rooms with A* corridors.
  const corridorCells = new Set<number>();
  for (const [a, b] of planConnections(tree, rng)) {
    const start = grid.cell(a.centerX, a.centerY);
    const goal = grid.cell(b.centerX, b.centerY);
    const path = findPath(grid, start, goal, {
      passable: interior,
      // Reusing existing floor is cheaper than digging new wall, which makes
      // corridors share segments rather than run side by side.
      cost: (_from, to) => (grid.get(to) === Terrain.WALL ? 2 : 1),
    });
    if (!path) continue;
    for (const cell of path) {
      corridorCells.add(cell);
    }
  }

  LevelPainter.paint(grid, rooms, corridorCells, floorVariants, rng);

  // 4) Stairs: the two room centers with the greatest Manhattan separation.
  let entrance = grid.cell(area.x, area.y);
  let exit = entrance;
  if (rooms.length === 1) {
    entrance = exit = grid.cell(rooms[0]!.centerX, rooms[0]!.centerY);
  } else {
    let best = -1;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const ri = rooms[i]!;
        const rj = rooms[j]!;
        const dist =
          Math.abs(ri.centerX - rj.centerX) + Math.abs(ri.centerY - rj.centerY);
        if (dist > best) {
          best = dist;
          entrance = grid.cell(ri.centerX, ri.centerY);
          exit = grid.cell(rj.centerX, rj.centerY);
        }
      }
    }
  }
  // Stairs always stand on plain floor (never a door).
  grid.set(entrance, Terrain.FLOOR);
  grid.set(exit, Terrain.FLOOR);

  const groundItems = generateGroundItems(grid, rng, entrance, exit, loot);

  return { grid, rooms, entrance, exit, groundItems, floorVariants };
}

function generateGroundItems(
  grid: Grid,
  rng: RNG,
  entrance: number,
  exit: number,
  loot: LootGenerationOptions,
): GroundItem[] {
  const itemIds = loot.itemIds ?? [];
  const guaranteedItemIds = loot.guaranteedItemIds ?? [];
  const randomCount = itemIds.length > 0
    ? Math.max(0, Math.floor(loot.itemCount ?? rng.range(2, 4)))
    : 0;
  if (guaranteedItemIds.length === 0 && randomCount === 0) return [];

  const candidates: number[] = [];
  for (let cell = 0; cell < grid.length; cell++) {
    if (cell !== entrance && cell !== exit && grid.isWalkable(cell)) {
      candidates.push(cell);
    }
  }
  rng.shuffle(candidates);

  const groundItems: GroundItem[] = [];
  const place = (itemId: string): void => {
    const cell = candidates.pop();
    if (cell === undefined) return;
    groundItems.push({ cell, itemId });
  };

  for (const itemId of guaranteedItemIds) place(itemId);
  for (let i = 0; i < randomCount; i++) place(rng.pick(itemIds));

  return groundItems;
}
