/**
 * resolveAttack — the two-pass SPD combat resolution (pure, seeded).
 *
 * Translated from Shattered Pixel Dungeon's Char.hit / damage application,
 * using our deterministic Mulberry32 RNG so a fixed seed always produces the
 * exact same exchange (Directive 4).
 *
 *   Pass 1 (to-hit):  Random(0..accuracy) >= Random(0..evasion)
 *   Pass 2 (damage):  max(0, Random(min..max) - Random(0..armor))
 *
 * It only reads CombatStats and the RNG — it never mutates anything, so the
 * caller decides how to apply the result. The fixed order of RNG draws
 * (acuRoll, evaRoll, damageRoll, armorRoll) is what makes exchanges
 * reproducible; do not reorder it.
 */
import type { RNG } from "@/core/rng/Mulberry32";
import type { CombatStats } from "./CombatStats";

export interface AttackResult {
  hit: boolean;
  /** Final damage dealt (0 on a miss or a fully-absorbed hit). */
  damage: number;
  acuRoll: number;
  evaRoll: number;
  /** Raw damage before armor (only meaningful on a hit). */
  rawDamage: number;
  /** Damage absorbed by armor (only meaningful on a hit). */
  blocked: number;
}

export function resolveAttack(
  attacker: CombatStats,
  defender: CombatStats,
  rng: RNG,
): AttackResult {
  // Pass 1 — to-hit.
  const acuRoll = rng.range(0, attacker.accuracy);
  const evaRoll = rng.range(0, defender.evasion);
  const hit = acuRoll >= evaRoll;

  if (!hit) {
    return { hit: false, damage: 0, acuRoll, evaRoll, rawDamage: 0, blocked: 0 };
  }

  // Pass 2 — damage.
  const rawDamage = rng.range(attacker.damageMin, attacker.damageMax);
  const blocked = rng.range(0, defender.armor);
  const damage = Math.max(0, rawDamage - blocked);

  return { hit: true, damage, acuRoll, evaRoll, rawDamage, blocked };
}
