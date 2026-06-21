/**
 * Level — the state of a single dungeon floor.
 *
 * For Phase 1 a Level is its `Grid` plus where the up/down stairs are. The
 * important property is that a Level is a *persistent object*: once the
 * DungeonManager generates it, the same instance is reused so any changes
 * (later: opened doors, dropped items, wounded monsters) survive the player
 * leaving and coming back via the stairs.
 *
 * Mob/heap/trap collections will hang off this class in later phases; the
 * placeholders are noted so the shape is clear.
 */
import type { Grid } from "@/core/grid/Grid";
import { Rect } from "@/core/grid/Rect";
import type { Terrain } from "@/core/grid/terrain";

export interface LevelSnapshot {
  depth: number;
  seed: number;
  width: number;
  height: number;
  terrain: Terrain[];
  rooms: Array<{ x: number; y: number; w: number; h: number }>;
  entrance: number;
  exit: number;
  explored: number[];
}

export class Level {
  /** 1-based floor number (1 = top, deeper = larger). */
  readonly depth: number;
  /** The 32-bit seed this floor was generated from (for reproducibility). */
  readonly seed: number;
  readonly grid: Grid;

  /** Rectangular rooms carved by the generator (for mob/loot placement). */
  readonly rooms: Rect[];

  /** Cell of the up-stairs (where you arrive descending) and down-stairs. */
  readonly entrance: number;
  readonly exit: number;

  /** Fog-of-war memory: cells ever seen on this floor (persists across visits). */
  readonly explored = new Set<number>();

  // Phase 3+/4 will populate these:
  // readonly mobs: Mob[] = [];
  // readonly heaps: Map<number, Heap> = new Map();

  constructor(params: {
    depth: number;
    seed: number;
    grid: Grid;
    rooms: Rect[];
    entrance: number;
    exit: number;
  }) {
    this.depth = params.depth;
    this.seed = params.seed;
    this.grid = params.grid;
    this.rooms = params.rooms;
    this.entrance = params.entrance;
    this.exit = params.exit;
  }

  snapshot(): LevelSnapshot {
    return {
      depth: this.depth,
      seed: this.seed,
      width: this.grid.width,
      height: this.grid.height,
      terrain: this.grid.snapshot(),
      rooms: this.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      entrance: this.entrance,
      exit: this.exit,
      explored: [...this.explored],
    };
  }

  static fromSnapshot(snapshot: LevelSnapshot, grid: Grid): Level {
    const level = new Level({
      depth: snapshot.depth,
      seed: snapshot.seed,
      grid,
      rooms: snapshot.rooms.map((r) => new Rect(r.x, r.y, r.w, r.h)),
      entrance: snapshot.entrance,
      exit: snapshot.exit,
    });
    for (const cell of snapshot.explored) {
      if (grid.inBoundsCell(cell)) level.explored.add(cell);
    }
    return level;
  }
}
