/**
 * Content type definitions (Directive 5: data-driven content).
 *
 * These are the *validated, in-game* shapes — after the raw JSON has passed
 * through the parser, which guarantees every numeric field is a finite, sane
 * number. Game code only ever sees these, never the raw JSON, so it can trust
 * the values completely.
 */

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
  description: string;
}

export interface ItemDef {
  id: string;
  name: string;
  type: string;
  /** Weapon: minimum damage contributed when equipped. */
  damageMin?: number;
  /** Weapon: maximum damage contributed when equipped. */
  damageMax?: number;
  /** Armor: damage-reduction ceiling contributed when equipped. */
  defense?: number;
  /** Potion: hit points restored when consumed. */
  heal?: number;
  /** Any other type-specific fields preserved from JSON. */
  [key: string]: unknown;
}
