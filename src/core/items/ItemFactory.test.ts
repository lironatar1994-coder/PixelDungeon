import { describe, expect, it } from "vitest";
import type { ItemDef } from "@/core/data/types";
import { ItemFactory, type RandomSource } from "./ItemFactory";

const defs: ItemDef[] = [
  {
    id: "short_sword",
    name: "Short Sword",
    type: "weapon",
    tier: 2,
    description: "",
  },
  {
    id: "leather_armor",
    name: "Leather Armor",
    type: "armor",
    tier: 2,
    description: "",
  },
  {
    id: "potion_healing",
    name: "Potion of Healing",
    type: "potion",
    description: "",
  },
  {
    id: "gold",
    name: "Gold",
    type: "gold",
    description: "",
  },
];

function rng(value: number): RandomSource {
  return { next: () => value };
}

describe("ItemFactory", () => {
  it("creates distinct stateful instances for the same immutable definition", () => {
    let i = 0;
    const factory = new ItemFactory(defs, {
      rng: rng(0.1),
      createUid: () => `uid_${++i}`,
    });

    const a = factory.create("short_sword");
    const b = factory.create("short_sword");

    expect(a.defId).toBe("short_sword");
    expect(b.defId).toBe("short_sword");
    expect(a.uid).not.toBe(b.uid);
    expect(a.quantity).toBeUndefined();
  });

  it("uses SPD equipment spawn weights for starting level", () => {
    expect(new ItemFactory(defs, { rng: rng(0.00), createUid: () => "a" }).create("short_sword").level).toBe(0);
    expect(new ItemFactory(defs, { rng: rng(0.74), createUid: () => "b" }).create("short_sword").level).toBe(0);
    expect(new ItemFactory(defs, { rng: rng(0.75), createUid: () => "c" }).create("short_sword").level).toBe(1);
    expect(new ItemFactory(defs, { rng: rng(0.94), createUid: () => "d" }).create("short_sword").level).toBe(1);
    expect(new ItemFactory(defs, { rng: rng(0.95), createUid: () => "e" }).create("short_sword").level).toBe(2);
  });

  it("does not roll upgrade levels for stackable items and normalizes quantity", () => {
    const factory = new ItemFactory(defs, {
      rng: rng(0.99),
      createUid: () => "potion_1",
    });

    expect(factory.create("potion_healing", 3)).toMatchObject({
      uid: "potion_1",
      defId: "potion_healing",
      level: 0,
      levelKnown: true,
      quantity: 3,
    });
    expect(factory.create("potion_healing", 0).quantity).toBe(1);
  });

  it("supports the requested static create facade after configuration", () => {
    ItemFactory.configure(defs, {
      rng: rng(0.99),
      createUid: () => "static_uid",
    });

    expect(ItemFactory.create("leather_armor")).toMatchObject({
      uid: "static_uid",
      defId: "leather_armor",
      level: 2,
      levelKnown: false,
    });
  });

  it("throws clearly for missing definitions", () => {
    const factory = new ItemFactory(defs, { createUid: () => "x" });
    expect(() => factory.create("missing")).toThrow(/Unknown item definition/);
  });
});

