/**
 * ItemFactory creates stateful ItemInstances from immutable ItemDefs.
 *
 * The class has an injectable instance API for tests and deterministic systems,
 * plus a small static facade for callers that want `ItemFactory.create(...)`.
 * No render, DOM, scene, or GameWorld state is imported here.
 */
import type { ItemDef } from "@/core/data/types";
import type { ItemInstance } from "./ItemInstance";

export interface ItemRegistry {
  getItem(id: string): ItemDef | undefined;
}

export interface RandomSource {
  /** Float in [0, 1). Matches RNG.next() and Math.random(). */
  next(): number;
}

export interface ItemFactoryOptions {
  rng?: RandomSource;
  createUid?: () => string;
}

const STACKABLE_TYPES = new Set(["potion", "scroll", "gold", "food"]);

let fallbackUidCounter = 0;

function nextFallbackUid(): string {
  fallbackUidCounter += 1;
  return `item_${fallbackUidCounter.toString(36)}`;
}

function registryFromDefs(defs: readonly ItemDef[]): ItemRegistry {
  const byId = new Map(defs.map((def) => [def.id, def]));
  return {
    getItem(id: string): ItemDef | undefined {
      return byId.get(id);
    },
  };
}

function isDefArray(value: ItemRegistry | readonly ItemDef[]): value is readonly ItemDef[] {
  return Array.isArray(value);
}

function toRegistry(value: ItemRegistry | readonly ItemDef[]): ItemRegistry {
  return isDefArray(value) ? registryFromDefs(value) : value;
}

function isStackable(def: ItemDef): boolean {
  return STACKABLE_TYPES.has(def.type);
}

function startingLevel(def: ItemDef, rng: RandomSource): number {
  if (def.type !== "weapon" && def.type !== "armor") return 0;

  // SPD random equipment level weights:
  // +0: 75%, +1: 20%, +2: 5%.
  const roll = rng.next();
  if (roll < 0.75) return 0;
  if (roll < 0.95) return 1;
  return 2;
}

function normalizeQuantity(def: ItemDef, quantity: number | undefined): number | undefined {
  if (!isStackable(def)) return undefined;
  return Math.max(1, Math.trunc(quantity ?? 1));
}

export class ItemFactory {
  private static configuredRegistry: ItemRegistry | null = null;
  private static configuredOptions: ItemFactoryOptions = {};

  private readonly registry: ItemRegistry;
  private readonly rng: RandomSource;
  private readonly createUid: () => string;

  constructor(registry: ItemRegistry | readonly ItemDef[], options: ItemFactoryOptions = {}) {
    this.registry = toRegistry(registry);
    this.rng = options.rng ?? { next: Math.random };
    this.createUid = options.createUid ?? nextFallbackUid;
  }

  /**
   * Configure the static facade. Composition roots can call this after loading
   * configs; tests should usually prefer `new ItemFactory(...)`.
   */
  static configure(
    registry: ItemRegistry | readonly ItemDef[],
    options: ItemFactoryOptions = {},
  ): void {
    this.configuredRegistry = toRegistry(registry);
    this.configuredOptions = { ...options };
  }

  /**
   * Requested convenience API. Requires `configure(...)` first so the module
   * does not import a global database or game scene.
   */
  static create(defId: string, quantity?: number): ItemInstance {
    if (this.configuredRegistry === null) {
      throw new Error("ItemFactory.create called before ItemFactory.configure");
    }
    return new ItemFactory(this.configuredRegistry, this.configuredOptions).create(defId, quantity);
  }

  create(defId: string, quantity?: number): ItemInstance {
    const def = this.registry.getItem(defId);
    if (def === undefined) {
      throw new Error(`Unknown item definition: ${defId}`);
    }

    const stackQuantity = normalizeQuantity(def, quantity);
    return {
      uid: this.createUid(),
      defId: def.id,
      level: startingLevel(def, this.rng),
      levelKnown: def.type !== "weapon" && def.type !== "armor",
      cursed: false,
      cursedKnown: false,
      ...(stackQuantity === undefined ? {} : { quantity: stackQuantity }),
    };
  }
}
