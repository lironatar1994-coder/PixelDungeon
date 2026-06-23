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
import type { ItemInstance, ItemInstanceSnapshot } from "@/core/items/ItemInstance";

export interface GroundItem {
  cell: number;
  item: ItemInstance;
}

export interface LegacyGroundItem {
  cell: number;
  itemId: string;
}

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
  groundItems: Array<GroundItem | LegacyGroundItem>;
  openDoors: number[];
  floorVariants: [number, number][];
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

  /** Cells of doors that have been opened. */
  readonly openDoors: Set<number>;

  /** Static random visual variant (0, 1, or 2) assigned to each floor cell. */
  readonly floorVariants: Map<number, number>;

  /** One loose physical item instance per cell. */
  private readonly groundItemByCell = new Map<number, ItemInstance>();

  constructor(params: {
    depth: number;
    seed: number;
    grid: Grid;
    rooms: Rect[];
    entrance: number;
    exit: number;
    groundItems?: ReadonlyArray<GroundItem | LegacyGroundItem>;
    openDoors?: Set<number>;
    floorVariants?: Map<number, number>;
  }) {
    this.depth = params.depth;
    this.seed = params.seed;
    this.grid = params.grid;
    this.rooms = params.rooms;
    this.entrance = params.entrance;
    this.exit = params.exit;
    for (const item of params.groundItems ?? []) {
      this.placeGroundItem(item.cell, normalizeGroundItem(item, params.depth));
    }
    this.openDoors = params.openDoors ?? new Set();
    this.floorVariants = params.floorVariants ?? new Map();
  }

  get groundItems(): GroundItem[] {
    return [...this.groundItemByCell.entries()].map(([cell, item]) => ({ cell, item }));
  }

  itemAt(cell: number): ItemInstance | null {
    return this.groundItemByCell.get(cell) ?? null;
  }

  placeGroundItem(cell: number, item: ItemInstance): boolean {
    if (!this.grid.inBoundsCell(cell) || !this.grid.isWalkable(cell)) return false;
    if (cell === this.entrance || cell === this.exit) return false;
    if (this.groundItemByCell.has(cell)) return false;
    this.groundItemByCell.set(cell, { ...item });
    return true;
  }

  takeGroundItem(cell: number): ItemInstance | null {
    const item = this.groundItemByCell.get(cell) ?? null;
    if (item !== null) this.groundItemByCell.delete(cell);
    return item === null ? null : { ...item };
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
      groundItems: this.groundItems.map((ground) => ({
        cell: ground.cell,
        item: snapshotGroundItem(ground.item),
      })),
      openDoors: [...this.openDoors],
      floorVariants: [...this.floorVariants.entries()],
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
      groundItems: snapshot.groundItems ?? [],
      openDoors: new Set(snapshot.openDoors ?? []),
      floorVariants: new Map(snapshot.floorVariants ?? []),
    });
    for (const cell of snapshot.explored) {
      if (grid.inBoundsCell(cell)) level.explored.add(cell);
    }
    return level;
  }
}

function normalizeGroundItem(
  ground: GroundItem | LegacyGroundItem,
  depth: number,
): ItemInstance {
  if ("item" in ground) return { ...ground.item };
  return {
    uid: `legacy_ground_${depth}_${ground.cell}_${ground.itemId}`,
    defId: ground.itemId,
    level: 0,
    levelKnown: true,
    cursed: false,
    cursedKnown: false,
  };
}

function snapshotGroundItem(item: ItemInstance): ItemInstanceSnapshot {
  const snapshot: ItemInstanceSnapshot = {
    uid: item.uid,
    defId: item.defId,
    level: item.level,
    levelKnown: item.levelKnown,
    cursed: item.cursed,
    cursedKnown: item.cursedKnown,
  };
  if (item.quantity !== undefined) snapshot.quantity = item.quantity;
  return snapshot;
}
