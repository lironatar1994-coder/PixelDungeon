/**
 * PointerRouter — the input multiplexer's brain (Directive 7), pure & headless.
 *
 * The problem: a tap at (x, y) might be meant for a UI button OR for the game
 * grid underneath it. If we are not careful, tapping an inventory button also
 * "walks" the hero on the tile behind it. This router solves that by giving
 * UI layers first refusal: layers are checked top-down, and the first one that
 * "hits" the point CONSUMES the tap. Only if no layer consumes it does the tap
 * fall through to the world.
 *
 * This class contains zero DOM code so it can be unit-tested directly; the
 * browser wiring lives in InputManager.
 */

export interface Point {
  x: number;
  y: number;
}

export interface InputLayer {
  /** Stable identifier reported back when this layer consumes a pointer. */
  id: string;
  /** Stacking order; higher layers are tested first (they sit "on top"). */
  z: number;
  /** Disabled layers are skipped (e.g. a closed modal). */
  enabled: boolean;
  /** Return true if the point lands on this layer and should be consumed. */
  hitTest(point: Point): boolean;
}

export class PointerRouter {
  /** Always kept sorted by descending z (top layer first). */
  private layers: InputLayer[] = [];

  addLayer(layer: InputLayer): void {
    this.layers.push(layer);
    this.layers.sort((a, b) => b.z - a.z);
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.enabled = enabled;
  }

  /**
   * Decide who owns a pointer event.
   * @returns the id of the consuming UI layer, or `null` if it falls through
   *          to the game world.
   */
  route(point: Point): string | null {
    for (const layer of this.layers) {
      if (layer.enabled && layer.hitTest(point)) {
        return layer.id;
      }
    }
    return null;
  }
}

/** Convenience factory for the common case: a rectangular UI region. */
export function rectLayer(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  z = 0,
): InputLayer {
  return {
    id,
    z,
    enabled: true,
    hitTest: (p) =>
      p.x >= rect.x &&
      p.x < rect.x + rect.w &&
      p.y >= rect.y &&
      p.y < rect.y + rect.h,
  };
}
