/**
 * Grid — the 2D map as flat math (Directive 1: pure logic, no rendering).
 *
 * Like SPD's Level, the map is a single flat array indexed by
 *   cell = x + y * width
 * Flat arrays are cache-friendly and make a cell a single integer, which is
 * exactly what the turn queue, pathfinding (Phase 3) and serialization
 * (Phase 5) want to pass around. All neighbour/coordinate math lives here so
 * no other module has to recompute `x + y * width` by hand.
 */
import {
  Terrain,
  TERRAIN_PROPERTIES,
  type CellProperties,
} from "./terrain";

export class Grid {
  readonly width: number;
  readonly height: number;
  /** Total number of cells (width * height). */
  readonly length: number;

  private readonly map: Terrain[];

  constructor(width: number, height: number, fill: Terrain = Terrain.WALL) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Grid dimensions must be positive (got ${width}x${height})`);
    }
    this.width = width;
    this.height = height;
    this.length = width * height;
    this.map = new Array<Terrain>(this.length).fill(fill);
  }

  static fromSnapshot(width: number, height: number, terrain: readonly Terrain[]): Grid {
    const grid = new Grid(width, height);
    if (terrain.length !== grid.length) {
      throw new Error(
        `Grid snapshot length ${terrain.length} does not match ${width}x${height}`,
      );
    }
    for (let cell = 0; cell < terrain.length; cell++) {
      grid.set(cell, terrain[cell]!);
    }
    return grid;
  }

  // --- coordinate <-> cell conversion ---

  cell(x: number, y: number): number {
    return x + y * this.width;
  }

  xOf(cell: number): number {
    return cell % this.width;
  }

  yOf(cell: number): number {
    return Math.floor(cell / this.width);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  inBoundsCell(cell: number): boolean {
    return cell >= 0 && cell < this.length;
  }

  // --- terrain access ---

  /** Terrain at a cell. Out-of-bounds reads return EMPTY (solid), so callers
   *  never need to bounds-check before asking about the world edge. */
  get(cell: number): Terrain {
    return this.inBoundsCell(cell) ? this.map[cell]! : Terrain.EMPTY;
  }

  set(cell: number, terrain: Terrain): void {
    if (this.inBoundsCell(cell)) {
      this.map[cell] = terrain;
    }
  }

  /** Replace the whole map (used by generators). Length must match. */
  fill(terrain: Terrain): void {
    this.map.fill(terrain);
  }

  // --- derived cell properties (the three Phase 1 cares about) ---

  propertiesOf(cell: number): CellProperties {
    return TERRAIN_PROPERTIES[this.get(cell)];
  }

  isSolid(cell: number): boolean {
    return this.propertiesOf(cell).solid;
  }

  isWalkable(cell: number): boolean {
    return this.propertiesOf(cell).walkable;
  }

  isTransparent(cell: number): boolean {
    return this.propertiesOf(cell).transparent;
  }

  // --- neighbours (handy for pathfinding/FOV later) ---

  /** Orthogonal neighbours (N/E/S/W) that are inside the grid. */
  neighbours4(cell: number): number[] {
    const x = this.xOf(cell);
    const y = this.yOf(cell);
    const out: number[] = [];
    if (this.inBounds(x, y - 1)) out.push(this.cell(x, y - 1));
    if (this.inBounds(x + 1, y)) out.push(this.cell(x + 1, y));
    if (this.inBounds(x, y + 1)) out.push(this.cell(x, y + 1));
    if (this.inBounds(x - 1, y)) out.push(this.cell(x - 1, y));
    return out;
  }

  /** All 8 surrounding neighbours that are inside the grid. */
  neighbours8(cell: number): number[] {
    const x = this.xOf(cell);
    const y = this.yOf(cell);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.inBounds(x + dx, y + dy)) out.push(this.cell(x + dx, y + dy));
      }
    }
    return out;
  }

  /** A flat copy of the terrain array (for rendering or serialization). */
  snapshot(): Terrain[] {
    return this.map.slice();
  }
}
