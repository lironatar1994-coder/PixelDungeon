import { describe, it, expect } from "vitest";
import { CombatStats } from "@/core/combat/CombatStats";
import { Inventory } from "@/core/items/Inventory";
import type { ItemDef } from "@/core/data/types";

const sword: ItemDef = { id: "sword", name: "Short Sword", type: "weapon", damageMin: 2, damageMax: 6 };
const axe: ItemDef = { id: "axe", name: "War Axe", type: "weapon", damageMin: 4, damageMax: 10 };
const armor: ItemDef = { id: "armor", name: "Leather Armor", type: "armor", defense: 3 };
const potion: ItemDef = { id: "potion", name: "Potion", type: "potion", heal: 10 };

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

describe("Inventory", () => {
  it("stores items in an array up to its capacity", () => {
    const inv = new Inventory(freshStats(), 3);
    expect(inv.add(sword)).toBe(true);
    expect(inv.add(armor)).toBe(true);
    expect(inv.count).toBe(2);
    expect(inv.all).toContain(sword);
  });

  it("REQUIRED: refuses to overflow past the capacity limit", () => {
    const inv = new Inventory(freshStats(), 2);
    expect(inv.add({ id: "a", name: "A", type: "misc" })).toBe(true);
    expect(inv.add({ id: "b", name: "B", type: "misc" })).toBe(true);
    expect(inv.isFull()).toBe(true);
    // Third add must fail and must NOT grow the array.
    expect(inv.add({ id: "c", name: "C", type: "misc" })).toBe(false);
    expect(inv.count).toBe(2);
  });

  it("equips a weapon, applying its damage to the owner's stats", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    expect(inv.equip(sword)).toBe(true);
    expect(inv.equippedIn("weapon")).toBe(sword);
    // base 1-3 + sword 2-6 = 3-9
    expect(stats.damageMin).toBe(3);
    expect(stats.damageMax).toBe(9);
  });

  it("unequipping cleanly reverses the stat changes", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(armor);
    inv.equip(armor);
    expect(stats.armor).toBe(3);
    inv.unequip("armor");
    expect(stats.armor).toBe(0);
    expect(inv.equippedIn("armor")).toBeNull();
    // The item is still in the bag, just not worn.
    expect(inv.all).toContain(armor);
  });

  it("swapping weapons removes the old one's modifiers", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    inv.add(axe);
    inv.equip(sword);
    expect(stats.damageMax).toBe(9); // 3 + 6
    inv.equip(axe); // replaces sword
    expect(stats.damageMax).toBe(13); // 3 + 10, NOT 3 + 6 + 10
    expect(inv.equippedIn("weapon")).toBe(axe);
  });

  it("removing an equipped item also unequips it", () => {
    const stats = freshStats();
    const inv = new Inventory(stats, 10);
    inv.add(sword);
    inv.equip(sword);
    inv.remove(sword);
    expect(stats.damageMax).toBe(3); // back to base
    expect(inv.equippedIn("weapon")).toBeNull();
    expect(inv.count).toBe(0);
  });

  it("rejects equipping a non-equippable or absent item", () => {
    const inv = new Inventory(freshStats(), 10);
    inv.add(potion);
    expect(inv.equip(potion)).toBe(false); // potions aren't equipment
    expect(inv.equip(sword)).toBe(false); // not in the bag
  });
});
