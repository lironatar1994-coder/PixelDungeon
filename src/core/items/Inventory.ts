/**
 * Inventory — the player's item storage + equipment (pure logic).
 *
 * Items are the validated `ItemDef`s loaded from items.json. The bag is a
 * bounded array (capacity-limited) and there are two equipment slots, Weapon
 * and Armor. Equipping does NOT bake numbers into the entity: it registers
 * removable stat modifiers on the owner's CombatStats (tagged by slot), so
 * unequipping cleanly reverses the effect and the base stats are never touched.
 */
import type { ItemDef } from "@/core/data/types";
import type { CombatStats } from "@/core/combat/CombatStats";

export type EquipSlot = "weapon" | "armor";

export interface InventorySnapshot {
  capacity: number;
  itemIds: string[];
  equipped: Record<EquipSlot, string | null>;
}

/** Map an item's `type` to the slot it occupies, or null if not equippable. */
function slotFor(item: ItemDef): EquipSlot | null {
  if (item.type === "weapon") return "weapon";
  if (item.type === "armor") return "armor";
  return null;
}

export class Inventory {
  readonly capacity: number;
  private readonly stats: CombatStats;
  private readonly items: ItemDef[] = [];
  private readonly slots: Record<EquipSlot, ItemDef | null> = {
    weapon: null,
    armor: null,
  };

  constructor(stats: CombatStats, capacity = 20) {
    this.stats = stats;
    this.capacity = capacity;
  }

  get all(): readonly ItemDef[] {
    return this.items;
  }
  get count(): number {
    return this.items.length;
  }
  isFull(): boolean {
    return this.items.length >= this.capacity;
  }
  equippedIn(slot: EquipSlot): ItemDef | null {
    return this.slots[slot];
  }

  snapshot(): InventorySnapshot {
    return {
      capacity: this.capacity,
      itemIds: this.items.map((item) => item.id),
      equipped: {
        weapon: this.slots.weapon?.id ?? null,
        armor: this.slots.armor?.id ?? null,
      },
    };
  }

  static fromSnapshot(
    snapshot: InventorySnapshot,
    stats: CombatStats,
    resolveItem: (id: string) => ItemDef | undefined,
  ): Inventory {
    const inv = new Inventory(stats, snapshot.capacity);
    for (const id of snapshot.itemIds) {
      const item = resolveItem(id);
      if (item) inv.add(item);
    }
    for (const slot of ["weapon", "armor"] as const) {
      const equippedId = snapshot.equipped[slot];
      if (equippedId === null) continue;
      const item = inv.items.find((candidate) => candidate.id === equippedId);
      if (item && slotFor(item) === slot) {
        inv.slots[slot] = item;
      }
    }
    return inv;
  }

  /** Add an item. Returns false if the bag is full (boundary protection). */
  add(item: ItemDef): boolean {
    if (this.isFull()) return false;
    this.items.push(item);
    return true;
  }

  /** Remove a specific item instance. Returns false if not present. */
  remove(item: ItemDef): boolean {
    const i = this.items.indexOf(item);
    if (i < 0) return false;
    // Removing an equipped item also unequips it (drops its modifiers).
    for (const slot of ["weapon", "armor"] as const) {
      if (this.slots[slot] === item) this.unequip(slot);
    }
    this.items.splice(i, 1);
    return true;
  }

  /**
   * Equip an item from the bag into its slot, applying its stat modifiers.
   * Returns false if the item isn't equippable or isn't in the inventory.
   */
  equip(item: ItemDef): boolean {
    const slot = slotFor(item);
    if (slot === null || !this.items.includes(item)) return false;

    if (this.slots[slot] !== null) this.unequip(slot);
    this.slots[slot] = item;
    this.applyModifiers(slot, item);
    return true;
  }

  /** Unequip whatever is in a slot, removing its modifiers. */
  unequip(slot: EquipSlot): void {
    if (this.slots[slot] === null) return;
    this.stats.removeModifiers(`equip:${slot}`);
    this.slots[slot] = null;
  }

  private applyModifiers(slot: EquipSlot, item: ItemDef): void {
    const source = `equip:${slot}`;
    if (slot === "weapon") {
      this.stats.addModifier({ id: source, stat: "damageMin", amount: item.damageMin ?? 0 });
      this.stats.addModifier({ id: source, stat: "damageMax", amount: item.damageMax ?? 0 });
    } else {
      this.stats.addModifier({ id: source, stat: "armor", amount: item.defense ?? 0 });
    }
  }
}
