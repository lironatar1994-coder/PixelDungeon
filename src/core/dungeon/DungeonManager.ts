/**
 * DungeonManager — owns all 26 floors and the current depth (SPD's Dungeon).
 *
 * Two responsibilities:
 *  1. Multi-floor state persistence. Floors are generated lazily and then
 *     cached, so descending and re-ascending returns the *same* Level object
 *     with all its state intact (Phase 1 spec: "stairs going up and down must
 *     preserve floor states").
 *  2. Per-floor deterministic seeding. Each floor's seed is derived from the
 *     master GameSeed by advancing a throwaway RNG `depth` times and taking
 *     the next value — exactly SPD's seedForDepth lookahead. So floor 7 is
 *     identical every time for a given master seed, independent of which
 *     floors the player has visited.
 */
import { RNG } from "@/core/rng/Mulberry32";
import { generateLevel } from "@/core/procgen/LevelGenerator";
import { Grid } from "@/core/grid/Grid";
import { Level, type LevelSnapshot } from "./Level";
import type { ItemDef } from "@/core/data/types";
import { ItemFactory } from "@/core/items/ItemFactory";

/** Number of floors, matching the Phase 1 spec (26 levels). */
export const DUNGEON_DEPTH = 26;

export interface DungeonSnapshot {
  seed: string;
  depth: number;
  levels: LevelSnapshot[];
}

export interface DungeonLootConfig {
  /** Random floor loot pool. Should contain validated item ids only. */
  itemIds?: readonly string[];
  /** All item defs needed to instantiate generated loot into ItemInstances. */
  itemDefs?: readonly ItemDef[];
  /** Progression potion id, if present in content. Spawned exactly twice on depths 1..5. */
  strengthPotionId?: string | null;
}

/** Floors grow modestly with depth (square), clamped to a sane range. */
function sizeForDepth(depth: number): number {
  return 32 + Math.min(depth, 14); // 33..46
}

export class DungeonManager {
  /** The human-readable master seed for the whole run. */
  readonly seed: string;

  /** levels[d] is the cached floor at depth d (1..26); null until generated. */
  private readonly levels: (Level | null)[];
  private readonly lootItemIds: string[];
  private readonly itemDefs: ItemDef[];
  private readonly strengthPotionId: string | null;
  private readonly strengthPotionDepths: Set<number>;
  private currentDepth = 1;

  constructor(seed: string, loot: DungeonLootConfig = {}) {
    this.seed = seed;
    this.levels = new Array<Level | null>(DUNGEON_DEPTH + 1).fill(null);
    this.lootItemIds = [...new Set(loot.itemIds ?? [])];
    this.itemDefs = [...(loot.itemDefs ?? [])];
    this.strengthPotionId = loot.strengthPotionId ?? null;
    this.strengthPotionDepths = this.strengthPotionId
      ? chooseStrengthPotionDepths(seed)
      : new Set<number>();
  }

  get depth(): number {
    return this.currentDepth;
  }

  /** The floor the player is currently on (generated on demand). */
  get current(): Level {
    return this.levelAt(this.currentDepth);
  }

  /** How many floors have actually been generated so far. */
  get generatedCount(): number {
    return this.levels.filter((l) => l !== null).length;
  }

  /**
   * Derive the 32-bit seed for a given depth from the master seed. Pure and
   * repeatable: it never disturbs any live RNG stream.
   */
  seedForDepth(depth: number): number {
    const r = new RNG(this.seed);
    for (let i = 0; i < depth; i++) r.nextUint32();
    return r.nextUint32();
  }

  /** Get (generating + caching on first access) the floor at a depth. */
  levelAt(depth: number): Level {
    if (depth < 1 || depth > DUNGEON_DEPTH) {
      throw new Error(`Depth ${depth} is out of range (1..${DUNGEON_DEPTH})`);
    }
    let level = this.levels[depth];
    if (!level) {
      const depthSeed = this.seedForDepth(depth);
      const size = sizeForDepth(depth);
      const guaranteedItemIds =
        this.strengthPotionId && this.strengthPotionDepths.has(depth)
          ? [this.strengthPotionId]
          : [];
      const generated = generateLevel(size, size, new RNG(depthSeed), undefined, {
        itemIds: this.lootItemIds,
        guaranteedItemIds,
      });
      const nextLootUid = createFloorLootUidFactory(depth);
      const itemFactory = new ItemFactory(this.itemDefs, {
        rng: new RNG((depthSeed ^ 0x27d4eb2d) >>> 0),
        createUid: nextLootUid,
      });
      level = new Level({
        depth,
        seed: depthSeed,
        grid: generated.grid,
        rooms: generated.rooms,
        entrance: generated.entrance,
        exit: generated.exit,
        groundItems: generated.groundItems
          .map((ground) => {
            try {
              return {
                cell: ground.cell,
                item: itemFactory.create(ground.itemId),
              };
            } catch {
              return {
                cell: ground.cell,
                item: {
                  uid: nextLootUid(),
                  defId: ground.itemId,
                  level: 0,
                  levelKnown: true,
                  cursed: false,
                  cursedKnown: false,
                },
              };
            }
          })
          .filter((ground): ground is NonNullable<typeof ground> => ground !== null),
        floorVariants: generated.floorVariants,
      });
      this.levels[depth] = level;
    }
    return level;
  }

  /** True if a floor has already been generated (not just requested). */
  isGenerated(depth: number): boolean {
    return depth >= 1 && depth <= DUNGEON_DEPTH && this.levels[depth] !== null;
  }

  /** Move down one floor (no-op at the bottom). Returns the new current floor. */
  descend(): Level {
    if (this.currentDepth < DUNGEON_DEPTH) this.currentDepth++;
    return this.current;
  }

  /** Move up one floor (no-op at the top). Returns the new current floor. */
  ascend(): Level {
    if (this.currentDepth > 1) this.currentDepth--;
    return this.current;
  }

  /** Jump directly to a depth (used by save/load and debugging). */
  travelTo(depth: number): Level {
    const level = this.levelAt(depth); // validates range
    this.currentDepth = depth;
    return level;
  }

  snapshot(): DungeonSnapshot {
    const levels: LevelSnapshot[] = [];
    for (let depth = 1; depth <= DUNGEON_DEPTH; depth++) {
      const level = this.levels[depth];
      if (level) levels.push(level.snapshot());
    }
    return {
      seed: this.seed,
      depth: this.currentDepth,
      levels,
    };
  }

  static fromSnapshot(snapshot: DungeonSnapshot, loot: DungeonLootConfig = {}): DungeonManager {
    const dungeon = new DungeonManager(snapshot.seed, loot);
    for (const levelSnapshot of snapshot.levels) {
      if (levelSnapshot.depth < 1 || levelSnapshot.depth > DUNGEON_DEPTH) continue;
      const grid = Grid.fromSnapshot(
        levelSnapshot.width,
        levelSnapshot.height,
        levelSnapshot.terrain,
      );
      dungeon.levels[levelSnapshot.depth] = Level.fromSnapshot(levelSnapshot, grid);
    }
    dungeon.travelTo(snapshot.depth);
    return dungeon;
  }
}

function createFloorLootUidFactory(depth: number): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `loot_d${depth}_${index.toString(36)}`;
  };
}

function chooseStrengthPotionDepths(seed: string): Set<number> {
  const depths = [1, 2, 3, 4, 5];
  new RNG(`${seed}:strength-potions`).shuffle(depths);
  return new Set(depths.slice(0, 2));
}
