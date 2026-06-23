/**
 * EventBus — a tiny, type-safe publish/subscribe hub.
 *
 * Directive 6 (Event-Driven Audio) and Directive 1 (Lego Brick) both
 * depend on this: core logic NEVER calls the renderer or audio directly.
 * Instead it `emit`s a named event, and isolated modules (audio, UI,
 * renderer) `on` those events. This keeps the game logic fully headless
 * and unit-testable — nothing in `core/` ever imports the browser.
 *
 * The event catalogue grows as the game grows. We keep it strongly typed
 * via a payload map so a typo in an event name is a compile error.
 */

/** Maps every event name to the shape of its payload. Extend as needed. */
export interface GameEvents {
  /** Fired once per rendered frame. dt = seconds since the previous frame. */
  "loop:frame": { dt: number; elapsed: number };
  /** Fired when the drawable surface changes size (window resize / DPR). */
  "render:resize": { width: number; height: number };
  /** A playable run/session has entered the Playing state. */
  "game:start": {};
  /** The hero died and the run ended. */
  "game:over": {
    class: string;
    hero_level: number;
    depth: number;
    killer: string;
    inventory: string[];
    turns: number;
  };
  /** A pointer that fell through all UI layers to the game world. */
  "input:world": { x: number; y: number };
  /** A world-space pointer drag used for camera inspection, never movement. */
  "input:world-pan": { x: number; y: number; dx: number; dy: number };
  /** A pointer consumed by a UI layer (the world must NOT react to it). */
  "input:ui": { layer: string; x: number; y: number };
  "combat:log": { line: string };
  "combat:strike": {
    attackerId: string;
    defenderId: string;
    attackerCell: number;
    defenderCell: number;
    hit: boolean;
    damage: number;
  };
  /** An actor's core grid cell changed instantly; render may animate it. */
  "actor:move": { actorId: string; fromCell: number; toCell: number };
  /** The hero just lost hit points (e.g. a monster landed a blow). */
  "hero:damaged": { amount: number; source: string; hp: number };
  /** UI command shell for future quickslot assignment/use behavior. */
  "ui:quickslot": {};
  /** UI command for SPD-style examine/select mode. */
  "ui:look": {};
  /** Browser-only sound cue requested by UI/orchestrator glue. */
  "audio:sfx": {
    cue:
      | "ui_click"
      | "hit"
      | "miss"
      | "death"
      | "drink"
      | "eat"
      | "descend"
      | "door"
      | "pickup"
      | "health_warn"
      | "health_critical"
      | "levelup";
  };
}

type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<Handler<EventName>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => this.off(event, handler);
  }

  /** Unsubscribe a previously registered handler. */
  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<EventName>);
  }

  /** Publish an event to every subscriber. Order of delivery is insertion order. */
  emit<K extends EventName>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<K>)(payload);
    }
  }

  /** Remove all handlers (useful for teardown between game sessions/tests). */
  clear(): void {
    this.handlers.clear();
  }
}
