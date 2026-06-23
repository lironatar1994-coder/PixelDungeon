import { describe, expect, it } from "vitest";
import { actorHitCellAtWorldPoint, type ActorHitCandidate } from "@/input/actorHitTest";

function candidate(overrides: Partial<ActorHitCandidate> = {}): ActorHitCandidate {
  return {
    cell: 1,
    centerX: 5.5,
    centerY: 5.5,
    left: 5.2,
    top: 4.85,
    right: 5.8,
    bottom: 6.12,
    priority: 1,
    ...overrides,
  };
}

describe("actorHitCellAtWorldPoint", () => {
  it("requires both tile-center proximity and actual sprite bounds", () => {
    const hero = candidate();

    expect(actorHitCellAtWorldPoint([hero], 5.5, 5.4)).toBe(hero.cell);
    expect(actorHitCellAtWorldPoint([hero], 5.5, 6.3)).toBeNull();
    expect(actorHitCellAtWorldPoint([hero], 4.6, 5.5)).toBeNull();
  });

  it("prefers the closest overlapping actor before stable priority", () => {
    const hero = candidate({ cell: 1, centerX: 5.5, centerY: 5.5, priority: 1 });
    const enemy = candidate({
      cell: 2,
      centerX: 6.5,
      centerY: 5.5,
      left: 6.0,
      right: 7.0,
      priority: 0,
    });

    expect(actorHitCellAtWorldPoint([hero, enemy], 6.35, 5.5)).toBe(enemy.cell);
  });
});
