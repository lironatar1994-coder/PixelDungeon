/**
 * Data-driven potion effects.
 *
 * ItemDef remains immutable JSON content; the registry maps an item's effectId
 * to pure core mutations. Rendering, sounds, and telemetry listen to the world
 * callback emitted after a successful quaff.
 */
import type { CombatStats } from "@/core/combat/CombatStats";
import type { InventoryItem } from "@/core/items/Inventory";

export interface WorldTimedEffect {
  id: string;
  turns: number;
}

export interface PotionEffectContext {
  item: InventoryItem;
  heroStats: CombatStats;
  refreshEquipmentModifiers: () => void;
  addWorldEffect: (effect: WorldTimedEffect) => void;
  log: (line: string) => void;
}

export interface PotionEffect {
  id: string;
  onQuaff: (ctx: PotionEffectContext) => void;
  onShatter?: (ctx: PotionEffectContext) => void;
}

export interface PotionQuaffResult {
  effectId: string;
}

const DEFAULT_HASTE_TURNS = 12;
const DEFAULT_MIND_VISION_TURNS = 20;

function positiveInt(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(typeof value === "number" ? value : fallback));
}

function potionPotency(item: InventoryItem, fallback: number): number {
  return positiveInt(item.def.potency, fallback);
}

function potionDuration(item: InventoryItem, fallback: number): number {
  return positiveInt(item.def.duration, fallback);
}

function turnsAfterQuaffAction(item: InventoryItem, fallback: number): number {
  // Hero.act ticks timed modifiers at action start. Adding one turn prevents a
  // potion from losing a full duration tick on the quaff action itself.
  return potionDuration(item, fallback) + 1;
}

export function potionEffectId(item: InventoryItem): string | null {
  if (item.type !== "potion") return null;
  if (typeof item.def.effectId === "string" && item.def.effectId.length > 0) {
    return item.def.effectId;
  }
  // Backward compatibility for older saves/configs while the JSON migration
  // lands. New potions should always declare effectId.
  if (typeof item.def.strengthBonus === "number" && item.def.strengthBonus > 0) {
    return "strength";
  }
  if (typeof item.def.heal === "number" && item.def.heal > 0) {
    return "healing";
  }
  return null;
}

export const POTION_EFFECTS: Record<string, PotionEffect> = {
  healing: {
    id: "healing",
    onQuaff: ({ item, heroStats, log }) => {
      const amount = potionPotency(item, Number(item.def.heal ?? 0));
      const healed = heroStats.heal(amount);
      log(`You quaff ${item.name} (+${healed} HP).`);
    },
    onShatter: () => {},
  },

  strength: {
    id: "strength",
    onQuaff: ({ item, heroStats, refreshEquipmentModifiers, log }) => {
      const amount = potionPotency(item, Number(item.def.strengthBonus ?? 1));
      heroStats.increaseBase("strength", amount);
      refreshEquipmentModifiers();
      log(`You quaff ${item.name} (+${amount} STR).`);
    },
    onShatter: () => {},
  },

  haste: {
    id: "haste",
    onQuaff: ({ item, heroStats, log }) => {
      const amount = potionPotency(item, 1);
      heroStats.removeModifiers("potion:haste");
      heroStats.addModifier({
        id: "potion:haste",
        stat: "speed",
        amount,
        turns: turnsAfterQuaffAction(item, DEFAULT_HASTE_TURNS),
      });
      log(`You feel yourself moving faster.`);
    },
    onShatter: () => {},
  },

  mind_vision: {
    id: "mind_vision",
    onQuaff: ({ item, addWorldEffect, log }) => {
      addWorldEffect({
        id: "mind_vision",
        turns: turnsAfterQuaffAction(item, DEFAULT_MIND_VISION_TURNS),
      });
      log(`You sense nearby minds.`);
    },
    onShatter: () => {},
  },
};

export function quaffPotion(ctx: PotionEffectContext): PotionQuaffResult | null {
  const effectId = potionEffectId(ctx.item);
  if (effectId === null) return null;
  const effect = POTION_EFFECTS[effectId];
  if (effect === undefined) return null;
  effect.onQuaff(ctx);
  return { effectId };
}
