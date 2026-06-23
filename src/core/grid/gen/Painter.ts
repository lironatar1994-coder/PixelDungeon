import type { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import type { Rect } from "@/core/grid/Rect";
import type { RNG } from "@/core/rng/Mulberry32";
import { generatePatch } from "./Patch";

export class LevelPainter {
  static paint(
    grid: Grid,
    rooms: Rect[],
    corridorCells: Set<number>,
    floorVariants: Map<number, number>,
    rng: RNG
  ) {
    // 1. Paint Rooms
    const roomCells = new Set<number>();
    for (const room of rooms) {
      for (let y = room.y; y < room.bottom; y++) {
        for (let x = room.x; x < room.right; x++) {
          const cell = grid.cell(x, y);
          grid.set(cell, Terrain.FLOOR);
          floorVariants.set(cell, rng.pick([0, 1, 2]));
          roomCells.add(cell);
        }
      }
    }

    // 2. Paint Corridors
    for (const cell of corridorCells) {
      grid.set(cell, Terrain.FLOOR);
      if (!floorVariants.has(cell)) {
        floorVariants.set(cell, rng.pick([0, 1, 2]));
      }
    }

    // 3. Paint Doors
    // A corridor cell touching exactly 2 empty cells and at least 1 room cell becomes a door.
    for (const cell of corridorCells) {
      let adjacentRooms = 0;
      let adjacentWalls = 0;
      for (const n of grid.neighbours4(cell)) {
        if (roomCells.has(n)) adjacentRooms++;
        if (grid.get(n) === Terrain.WALL) adjacentWalls++;
      }
      if (adjacentRooms >= 1 && adjacentWalls >= 2) {
        grid.set(cell, Terrain.DOOR);
      }
    }

    // 4. Paint Water Patches
    // Fill 20% of the map with water, smoothed twice.
    const waterPatch = generatePatch(grid.width, grid.height, 0.2, 2, rng);
    for (let i = 0; i < grid.length; i++) {
      if (waterPatch[i] && grid.get(i) === Terrain.FLOOR) {
        grid.set(i, Terrain.WATER);
      }
    }

    // 5. Paint Grass Patches
    // Fill 25% of the map with grass, smoothed twice.
    const grassPatch = generatePatch(grid.width, grid.height, 0.25, 2, rng);
    for (let i = 0; i < grid.length; i++) {
      // Grass overwrites floor, but doesn't overwrite water to keep puddles clean
      if (grassPatch[i] && grid.get(i) === Terrain.FLOOR) {
        grid.set(i, Terrain.GRASS);
      }
    }
  }
}
