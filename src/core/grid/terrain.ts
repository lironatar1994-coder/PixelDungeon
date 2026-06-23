/**
 * Terrain types and their physical properties.
 *
 * SPD stores a flat `int[] map` of terrain plus parallel boolean arrays
 * (`passable`, `solid`, `losBlocking`, ...). We keep the same flat-map idea
 * but derive the three properties Phase 1 cares about from a single lookup
 * table, so adding a terrain type is one entry — no scattered booleans.
 *
 * The table lives here as a typed constant for now; per Directive 5 this is
 * the natural thing to move into JSON during the Phase 3.5 data pipeline.
 */

export enum Terrain {
  /** Out-of-bounds / chasm. Treated as solid, blocks movement and sight. */
  EMPTY = 0,
  /** Open ground an entity can stand on. */
  FLOOR = 1,
  /** A wall: blocks movement and line of sight. */
  WALL = 2,
  /** A doorway: walkable, and (when open) transparent. */
  DOOR = 3,
  /** High grass: walkable, but might obstruct vision or spawn dew drops later. */
  GRASS = 4,
  /** Shallow water: walkable, but might wash off debuffs or take longer to cross. */
  WATER = 5,
}

export interface CellProperties {
  /** Physically blocks movement and projectiles. */
  solid: boolean;
  /** An entity can occupy / move into this cell. */
  walkable: boolean;
  /** Light and line-of-sight pass through (used by FOV in Phase 3). */
  transparent: boolean;
}

export const TERRAIN_PROPERTIES: Record<Terrain, CellProperties> = {
  [Terrain.EMPTY]: { solid: true, walkable: false, transparent: false },
  [Terrain.FLOOR]: { solid: false, walkable: true, transparent: true },
  [Terrain.WALL]: { solid: true, walkable: false, transparent: false },
  [Terrain.DOOR]: { solid: false, walkable: true, transparent: true },
  [Terrain.GRASS]: { solid: false, walkable: true, transparent: true },
  [Terrain.WATER]: { solid: false, walkable: true, transparent: true },
};
