export interface ActorHitCandidate {
  cell: number;
  centerX: number;
  centerY: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  priority: number;
}

const TILE_CENTER_HIT_RADIUS = 12 / 16;

export function actorHitCellAtWorldPoint(
  candidates: readonly ActorHitCandidate[],
  worldX: number,
  worldY: number,
): number | null {
  const hits: Array<{ cell: number; priority: number; distance: number }> = [];

  for (const candidate of candidates) {
    if (
      worldX < candidate.left ||
      worldX > candidate.right ||
      worldY < candidate.top ||
      worldY > candidate.bottom
    ) {
      continue;
    }

    const dx = Math.abs(worldX - candidate.centerX);
    const dy = Math.abs(worldY - candidate.centerY);
    if (dx > TILE_CENTER_HIT_RADIUS || dy > TILE_CENTER_HIT_RADIUS) continue;

    hits.push({
      cell: candidate.cell,
      priority: candidate.priority,
      distance: dx * dx + dy * dy,
    });
  }

  hits.sort((a, b) => a.distance - b.distance || a.priority - b.priority);
  return hits[0]?.cell ?? null;
}
