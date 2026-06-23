/**
 * Stateful item wrapper.
 *
 * ItemDef is the immutable flyweight template loaded from JSON. ItemInstance
 * is the per-run/per-object state: two short swords can share one ItemDef but
 * have different uids, upgrade levels, curse knowledge, and stack quantities.
 */
export interface ItemInstance {
  /** Unique physical item id used by inventory slots, quickslots, and saves. */
  uid: string;
  /** Foreign key into ContentDatabase/ItemDef templates. */
  defId: string;
  /** True persistent upgrade level. SPD starts normal equipment at +0. */
  level: number;
  /** Whether the player knows the true level; false displays as +0/unknown. */
  levelKnown: boolean;
  cursed: boolean;
  cursedKnown: boolean;
  /** Stack count for potions, scrolls, food, gold, etc. Omitted for equipment. */
  quantity?: number;
}

export interface ItemInstanceSnapshot extends ItemInstance {}

