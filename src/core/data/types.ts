/**
 * Content type definitions (Directive 5: data-driven content).
 *
 * These are the *validated, in-game* shapes — after the raw JSON has passed
 * through the parser, which guarantees every numeric field is a finite, sane
 * number. Game code only ever sees these, never the raw JSON, so it can trust
 * the values completely.
 */

export interface EnemyDeathCauses {
  normal?: string[];
  crit?: string[];
  skills?: Record<string, string[]>;
}

export interface EnemyDef {
  id: string;
  name: string;
  /** Hit points the enemy spawns with. Always >= 1. */
  maxHealth: number;
  /** Turn-queue speed multiplier (TICK / speed per action). Always > 0. */
  speed: number;
  /** Line-of-sight radius used to spot the hero. Always >= 0. */
  vision: number;
  /** Attack roll ceiling (Random 0..accuracy). Always >= 0. */
  accuracy: number;
  /** Dodge roll ceiling (Random 0..evasion). Always >= 0. */
  evasion: number;
  /** Minimum damage dealt on a hit. Always >= 0. */
  damageMin: number;
  /** Maximum damage dealt on a hit. Always >= damageMin. */
  damageMax: number;
  /** Damage-reduction ceiling (Random 0..armor). Always >= 0. */
  armor: number;
  /** Relative likelihood of being chosen when spawning. Always >= 0. */
  spawnWeight: number;
  /** Earliest floor this enemy may appear on. Always >= 1. */
  minDepth: number;
  /** EXP awarded when killed, subject to maxLevelCap. Always >= 0. */
  expReward: number;
  /** Last hero level that can earn EXP from this enemy. Always >= 0. */
  maxLevelCap: number;
  description: string;
  /** Optional custom cause of death templates */
  deathCauses?: EnemyDeathCauses;
}

export type ItemType = "weapon" | "armor" | "potion" | "scroll" | "gold" | "food" | "misc";

export interface ItemDef {
  /** Immutable template id, referenced by stateful ItemInstance.defId. */
  id: string;
  name: string;
  description: string;
  type: ItemType;
  /** SPD equipment tier. Used by upgrade scaling; defaults to 1 for equipment. */
  tier?: number;
  /** Render-layer sprite id/key. Kept as data only; core never loads images. */
  sprite?: string;
  /** Weapon: minimum damage contributed when equipped. */
  damageMin?: number;
  /** Weapon: maximum damage contributed when equipped. */
  damageMax?: number;
  /** Weapon: attack action multiplier. 1 = normal, below 1 faster, above 1 slower. */
  attackDelay?: number;
  /** Equipment: strength needed to avoid encumbrance penalties. */
  strengthRequired?: number;
  /** Armor: damage-reduction ceiling contributed when equipped. */
  defense?: number;
  /** Potion: hit points restored when consumed. */
  heal?: number;
  /** Potion: permanent strength gain when consumed. */
  strengthBonus?: number;
  /** Potion/scroll effect registry id. */
  effectId?: string;
  /** Generic effect magnitude; meaning depends on effectId. */
  potency?: number;
  /** Generic effect duration in hero turns; meaning depends on effectId. */
  duration?: number;
  /** Any other type-specific fields preserved from JSON. */
  [key: string]: unknown;
}

export interface HeroDef {
  id: string;
  name: string;
  /** Starting max/current HP. Always >= 1. */
  maxHealth: number;
  /** Starting base strength. Always >= 0. */
  strength: number;
  /** Render-layer sprite id, kept as plain data for the composition root. */
  sprite: string;
  /** Item ids granted at run start. */
  startingItems: string[];
  description: string;
}
