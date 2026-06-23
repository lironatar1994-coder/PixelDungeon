/**
 * Stateless SPD-inspired item scaling.
 *
 * These helpers combine an immutable ItemDef template with a stateful
 * ItemInstance. They never mutate either object, which keeps save/load,
 * inventory UI, and combat modifiers deterministic and easy to test.
 */
import type { ItemDef } from "@/core/data/types";
import type { ItemInstance } from "./ItemInstance";

export interface WeaponScaling {
  damageMin: number;
  damageMax: number;
  strengthRequired: number;
}

export interface ArmorScaling {
  drMin: number;
  drMax: number;
  strengthRequired: number;
}

export interface EquipmentScaling {
  level: number;
  tier: number;
  strengthRequired: number;
  weapon?: WeaponScaling;
  armor?: ArmorScaling;
}

function effectiveLevel(instance: Pick<ItemInstance, "level">): number {
  return Math.trunc(instance.level);
}

function equipmentTier(def: ItemDef): number {
  return Math.max(1, Math.trunc(def.tier ?? 1));
}

function isQuarterstaff(def: ItemDef): boolean {
  const id = def.id.toLowerCase();
  const name = def.name.toLowerCase();
  return id === "quarterstaff" || name === "quarterstaff";
}

/**
 * SPD strength requirements drop at triangular upgrade levels:
 * +1, +3, +6, +10, ...
 *
 * Algebraically this is floor((sqrt(8*level + 1) - 1) / 2), clamped at +0
 * for negative/degraded levels so a cursed low-level item never gets easier.
 */
export function triangularReduction(level: number): number {
  const lvl = Math.max(0, Math.trunc(level));
  return Math.floor((Math.sqrt(8 * lvl + 1) - 1) / 2);
}

export function strengthRequirement(def: ItemDef, instance: ItemInstance): number {
  const tier = equipmentTier(def);
  return Math.max(0, 8 + tier * 2 - triangularReduction(effectiveLevel(instance)));
}

export function meleeWeaponDamage(def: ItemDef, instance: ItemInstance): WeaponScaling {
  const level = effectiveLevel(instance);
  const tier = equipmentTier(def);
  const damageMin = tier + level;
  const baseMaxMultiplier = isQuarterstaff(def) ? 4 : 5;
  const damageMax = baseMaxMultiplier * (tier + 1) + level * (tier + 1);

  return {
    damageMin: Math.max(0, damageMin),
    damageMax: Math.max(0, damageMax),
    strengthRequired: strengthRequirement(def, instance),
  };
}

export function armorDamageReduction(def: ItemDef, instance: ItemInstance): ArmorScaling {
  const level = effectiveLevel(instance);
  const tier = equipmentTier(def);
  return {
    drMin: Math.max(0, level),
    drMax: Math.max(0, tier * (2 + level)),
    strengthRequired: strengthRequirement(def, instance),
  };
}

export function equipmentScaling(def: ItemDef, instance: ItemInstance): EquipmentScaling {
  const level = effectiveLevel(instance);
  const tier = equipmentTier(def);
  const strengthRequired = strengthRequirement(def, instance);

  if (def.type === "weapon") {
    return {
      level,
      tier,
      strengthRequired,
      weapon: meleeWeaponDamage(def, instance),
    };
  }

  if (def.type === "armor") {
    return {
      level,
      tier,
      strengthRequired,
      armor: armorDamageReduction(def, instance),
    };
  }

  return { level, tier, strengthRequired };
}

