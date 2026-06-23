import { describe, it, expect } from "vitest";
import { CombatStats } from "@/core/combat/CombatStats";
import { Inventory } from "@/core/items/Inventory";
import type { ItemDef } from "@/core/data/types";

const sword: ItemDef = {
  id: "sword",
  name: "Short Sword",
  type: "weapon",
  tier: 2,
  description: "",
};
const dagger: ItemDef = {
  id: "dagger",
  name: "Quick Dagger",
  type: "weapon",
  tier: 1,
  attackDelay: 0.5,
  description: "",
};
const axe: ItemDef = {
  id: "axe",
  name: "War Axe",
  type: "weapon",
  tier: 3,
  description: "",
};
const armor: ItemDef = {
  id: "armor",
  name: "Leather Armor",
  type: "armor",
  tier: 2,
  description: "",
};
const heavySword: ItemDef = {
  id: "heavy_sword",
  name: "Heavy Sword",
  type: "weapon",
  tier: 5,
  description: "",
};
const heavyArmor: ItemDef = {
  id: "heavy_armor",
  name: "Heavy Armor",
  type: "armor",
  tier: 5,
  description: "",
};
const potion: ItemDef = {
  id: "potion",
  name: "Potion",
  type: "potion",
  heal: 10,
  description: "",
};

function freshStats(): CombatStats {
  return new CombatStats({
    maxHealth: 20,
    accuracy: 10,
    evasion: 5,
    damageMin: 1,
    damageMax: 3,
    armor: 0,
  });
}

function item(inv: Inventory, defId: string) {
  const found = inv.all.find((entry) => entry.defId === defId);
  if (!found) throw new Error(`Missing inventory item ${defId}`);
  return found;
}

describe("Inventory", () => {
  it("stores item instances in an array up to its capacity", () => {
    const inv = new Inventory(freshStats(), 3);
    expect(inv.add(sword)).toBe(true);
    expect(inv.add(armor)).toBe(true);
    expect(inv.count).toBe(2);
    expect(inv.all[0]?.def).toBe(sword);
    expect(inv.all[0]?.uid).toMatch(/^inv_sword_/);
  });

  it("REQUIRED: refuses to overflow past the capacity limit", () => {
    const inv = new Inventory(freshStats(), 2);
    expect(inv.add({ id: "a", name: "A", type: "misc", description: "" })).toBe(true);
    expect(inv.add({ id: "b", name: "B", type: "misc", description: "" })).toBe(true);
    expect(inv.isFull()).toBe(true);
    expect(inv.add({ id: "c", name: "C", type: "misc", description: "" })).toBe(false);
    expect(inv.count).toBe(2);
  });

  it("equips a weapon, applying SPD-scaled damage to the owner's stats", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    const swordItem = item(inv, "sword");

    expect(inv.equip(swordItem)).toBe(true);
    expect(inv.equippedIn("weapon")).toBe(swordItem);
    // base 1-3 + tier-2 +0 sword 2-15 = 3-18
    expect(stats.damageMin).toBe(3);
    expect(stats.damageMax).toBe(18);
  });

  it("unequipping cleanly reverses the stat changes", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(armor);
    const armorItem = item(inv, "armor");

    inv.equip(armorItem);
    expect(stats.armor).toBe(4); // tier 2 * (2 + level 0)
    inv.unequip("armor");
    expect(stats.armor).toBe(0);
    expect(inv.equippedIn("armor")).toBeNull();
    expect(inv.all).toContain(armorItem);
  });

  it("swapping weapons removes the old one's modifiers", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    inv.add(axe);

    inv.equip(item(inv, "sword"));
    expect(stats.damageMax).toBe(18); // 3 + 15
    const axeItem = item(inv, "axe");
    inv.equip(axeItem);
    expect(stats.damageMax).toBe(23); // 3 + tier-3 max 20, not stacked
    expect(inv.equippedIn("weapon")).toBe(axeItem);
  });

  it("equips weapon attack delay without mutating the base stat", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(dagger);

    expect(inv.equip(item(inv, "dagger"))).toBe(true);
    expect(stats.attackDelay).toBe(0.5);
    expect(stats.baseOf("attackDelay")).toBe(1);

    inv.unequip("weapon");
    expect(stats.attackDelay).toBe(1);
  });

  it("penalizes under-strength weapons with SPD-style attack delay encumbrance", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(heavySword);

    expect(inv.equip(item(inv, "heavy_sword"))).toBe(true);
    expect(stats.attackDelay).toBeCloseTo(Math.pow(1.2, 3)); // STR req 18 vs STR 15

    stats.increaseBase("strength", 3);
    inv.refreshEquipmentModifiers();
    expect(stats.attackDelay).toBe(1);
  });

  it("penalizes under-strength armor by slowing all actions", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(heavyArmor);

    expect(inv.equip(item(inv, "heavy_armor"))).toBe(true);
    expect(stats.speed).toBeCloseTo(1 / Math.pow(1.2, 3));

    stats.increaseBase("strength", 3);
    inv.refreshEquipmentModifiers();
    expect(stats.speed).toBe(1);
  });

  it("removing an equipped item also unequips it", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    const swordItem = item(inv, "sword");
    inv.equip(swordItem);
    inv.remove(swordItem);
    expect(stats.damageMax).toBe(3);
    expect(inv.equippedIn("weapon")).toBeNull();
    expect(inv.count).toBe(0);
  });

  it("rejects equipping a non-equippable or absent item", () => {
    const inv = new Inventory(freshStats(), 10);
    inv.add(potion);
    expect(inv.equip(item(inv, "potion"))).toBe(false);
    expect(inv.equipByUid("missing")).toBe(false);
  });
});
