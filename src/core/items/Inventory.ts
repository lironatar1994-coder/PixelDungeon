/**
 * Inventory - the player's item storage + equipment (pure logic).
 *
 * Static item data lives in ItemDef. The inventory stores ItemInstances so two
 * copies of the same item id can have different upgrade levels, curse states,
 * and save identities. Equipment still applies removable CombatStats modifiers;
 * unequipping never mutates base stats.
 */
import type { ItemDef } from "@/core/data/types";
import type { CombatStats } from "@/core/combat/CombatStats";
import {
  armorDamageReduction,
  meleeWeaponDamage,
  strengthRequirement,
} from "@/core/items/itemScaling";
import type { ItemInstance, ItemInstanceSnapshot } from "./ItemInstance";

export type EquipSlot = "weapon" | "armor";

export interface InventoryItem extends ItemInstance {
  /** Immutable flyweight template for this physical item. Not serialized. */
  def: ItemDef;
  /** Convenience alias for def.id; useful for render/UI asset lookups. */
  itemId: string;
  name: string;
  type: ItemDef["type"];
  description: string;
}
export interface InventorySnapshot {
  capacity: number;
  /** New compact save format: only per-instance state, never duplicated ItemDef data. */
  items?: ItemInstanceSnapshot[];
  equipped: Record<EquipSlot, string | null>;
  /** Legacy Phase 5-18 save format. Rehydrated as +0 known instances. */
  itemIds?: string[];
}

let fallbackUidCounter = 0;

function fallbackUid(defId: string): string {
  fallbackUidCounter += 1;
  return `inv_${defId}_${fallbackUidCounter.toString(36)}`;
}

function defaultInstance(def: ItemDef): ItemInstance {
  return {
    uid: fallbackUid(def.id),
    defId: def.id,
    level: 0,
    levelKnown: def.type !== "weapon" && def.type !== "armor",
    cursed: false,
    cursedKnown: false,
  };
}

function legacyInstance(defId: string, index: number): ItemInstance {
  return {
    uid: `legacy_inv_${index}_${defId}`,
    defId,
    level: 0,
    levelKnown: true,
    cursed: false,
    cursedKnown: false,
  };
}

function snapshotOf(item: InventoryItem): ItemInstanceSnapshot {
  const snapshot: ItemInstanceSnapshot = {
    uid: item.uid,
    defId: item.defId,
    level: item.level,
    levelKnown: item.levelKnown,
    cursed: item.cursed,
    cursedKnown: item.cursedKnown,
  };
  if (item.quantity !== undefined) snapshot.quantity = item.quantity;
  return snapshot;
}

function materialize(def: ItemDef, instance: ItemInstance): InventoryItem {
  return {
    ...instance,
    def,
    itemId: def.id,
    name: def.name,
    type: def.type,
    description: def.description,
  };
}

/** Map an item's `type` to the slot it occupies, or null if not equippable. */
function slotFor(item: InventoryItem): EquipSlot | null {
  if (item.type === "weapon") return "weapon";
  if (item.type === "armor") return "armor";
  return null;
}

export class Inventory {
  readonly capacity: number;
  private readonly stats: CombatStats;
  private readonly items: InventoryItem[] = [];
  private readonly slots: Record<EquipSlot, InventoryItem | null> = {
    weapon: null,
    armor: null,
  };

  constructor(stats: CombatStats, capacity = 20) {
    this.stats = stats;
    this.capacity = capacity;
  }

  get all(): readonly InventoryItem[] {
    return this.items;
  }
  get count(): number {
    return this.items.length;
  }
  isFull(): boolean {
    return this.items.length >= this.capacity;
  }
  equippedIn(slot: EquipSlot): InventoryItem | null {
    return this.slots[slot];
  }

  findByUid(uid: string): InventoryItem | null {
    return this.items.find((item) => item.uid === uid) ?? null;
  }

  findByDefId(defId: string): InventoryItem | null {
    return this.items.find((item) => item.defId === defId) ?? null;
  }

  snapshot(): InventorySnapshot {
    return {
      capacity: this.capacity,
      items: this.items.map(snapshotOf),
      equipped: {
        weapon: this.slots.weapon?.uid ?? null,
        armor: this.slots.armor?.uid ?? null,
      },
    };
  }

  static fromSnapshot(
    snapshot: InventorySnapshot,
    stats: CombatStats,
    resolveItem: (id: string) => ItemDef | undefined,
  ): Inventory {
    const inv = new Inventory(stats, snapshot.capacity);

    if (snapshot.items) {
      for (const instance of snapshot.items) {
        const def = resolveItem(instance.defId);
        if (def) inv.addInstance(instance, def);
      }
    } else {
      for (const [index, id] of (snapshot.itemIds ?? []).entries()) {
        const def = resolveItem(id);
        if (def) inv.addInstance(legacyInstance(id, index), def);
      }
    }

    for (const slot of ["weapon", "armor"] as const) {
      const equippedUidOrLegacyId = snapshot.equipped[slot];
      if (equippedUidOrLegacyId === null) continue;
      const item =
        inv.items.find((candidate) => candidate.uid === equippedUidOrLegacyId) ??
        inv.items.find((candidate) => candidate.defId === equippedUidOrLegacyId);
      if (item && slotFor(item) === slot) {
        inv.slots[slot] = item;
      }
    }
    inv.refreshEquipmentModifiers();
    return inv;
  }

  /** Compatibility helper for tests/old code. Prefer addInstance for new code. */
  add(def: ItemDef): boolean {
    return this.addInstance(defaultInstance(def), def);
  }

  /** Add one physical item instance. Returns false if the bag is full. */
  addInstance(instance: ItemInstance, def: ItemDef): boolean {
    if (this.isFull()) return false;
    if (this.items.some((item) => item.uid === instance.uid)) return false;
    this.items.push(materialize(def, instance));
    return true;
  }

  /** Remove a specific physical item. Returns false if not present. */
  remove(item: InventoryItem): boolean {
    const i = this.items.indexOf(item);
    if (i < 0) return false;
    for (const slot of ["weapon", "armor"] as const) {
      if (this.slots[slot] === item) this.unequip(slot);
    }
    this.items.splice(i, 1);
    return true;
  }

  removeByUid(uid: string): InventoryItem | null {
    const item = this.findByUid(uid);
    if (!item || !this.remove(item)) return null;
    return item;
  }

  /**
   * Equip an item from the bag into its slot, applying its stat modifiers.
   * Returns false if the item isn't equippable or isn't in the inventory.
   */
  equip(item: InventoryItem): boolean {
    const slot = slotFor(item);
    if (slot === null || !this.items.includes(item)) return false;

    if (this.slots[slot] !== null) this.unequip(slot);
    this.slots[slot] = item;
    this.refreshEquipmentModifiers();
    return true;
  }

  equipByUid(uid: string): boolean {
    const item = this.findByUid(uid);
    return item ? this.equip(item) : false;
  }

  /** Unequip whatever is in a slot, removing its modifiers. */
  unequip(slot: EquipSlot): void {
    if (this.slots[slot] === null) return;
    this.stats.removeModifiers(`equip:${slot}`);
    this.slots[slot] = null;
  }

  /** Rebuild equipment modifiers after equipment or base strength changes. */
  refreshEquipmentModifiers(): void {
    for (const slot of ["weapon", "armor"] as const) {
      this.stats.removeModifiers(`equip:${slot}`);
      const item = this.slots[slot];
      if (item) this.applyModifiers(slot, item);
    }
  }

  private applyModifiers(slot: EquipSlot, item: InventoryItem): void {
    const source = `equip:${slot}`;
    const req = strengthRequirement(item.def, item);
    const encumbrance = Math.max(0, req - this.stats.strength);

    if (slot === "weapon") {
      const damage = meleeWeaponDamage(item.def, item);
      this.stats.addModifier({ id: source, stat: "damageMin", amount: damage.damageMin });
      this.stats.addModifier({ id: source, stat: "damageMax", amount: damage.damageMax });
      if (typeof item.def.defense === "number") {
        this.stats.addModifier({ id: source, stat: "armor", amount: item.def.defense });
      }
      const baseDelay = item.def.attackDelay ?? 1;
      const encumberedDelay = baseDelay * Math.pow(1.2, encumbrance);
      this.stats.addModifier({ id: source, stat: "attackDelay", amount: encumberedDelay - 1 });
    } else {
      const armor = armorDamageReduction(item.def, item);
      this.stats.addModifier({ id: source, stat: "armor", amount: armor.drMax });
      if (encumbrance > 0) {
        const speedFactor = 1 / Math.pow(1.2, encumbrance);
        this.stats.addModifier({ id: source, stat: "speed", amount: speedFactor - 1 });
      }
    }
  }
}
