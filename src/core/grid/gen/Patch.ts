/**
 * Cellular Automata utility for generating natural-looking patches of terrain
 * (like lakes, puddles, and sweeping grass fields).
 */
import type { RNG } from "@/core/rng/Mulberry32";

export function generatePatch(
  width: number,
  height: number,
  fillPercentage: number,
  smoothness: number,
  rng: RNG,
): boolean[] {
  let map = new Array<boolean>(width * height).fill(false);
  
  // 1. Initial random fill
  for (let i = 0; i < map.length; i++) {
    map[i] = rng.next() < fillPercentage;
  }

  let nextMap = new Array<boolean>(width * height).fill(false);

  // 2. Cellular Automata Smoothing steps
  for (let s = 0; s < smoothness; s++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let neighbours = 0;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            
            // Edges are treated as 'solid' (true) to pull patches toward walls
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              neighbours++;
            } else {
              if (map[nx + ny * width]) neighbours++;
            }
          }
        }

        const cell = x + y * width;
        // Standard CA rules:
        // A live cell stays alive if it has 4+ neighbors.
        // A dead cell becomes alive if it has 5+ neighbors.
        if (map[cell]) {
          nextMap[cell] = neighbours >= 4;
        } else {
          nextMap[cell] = neighbours >= 5;
        }
      }
    }
    
    // Swap buffers for the next iteration
    const temp = map;
    map = nextMap;
    nextMap = temp;
  }

  return map;
}
