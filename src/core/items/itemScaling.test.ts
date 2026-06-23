import { describe, expect, it } from "vitest";
import type { ItemDef } from "@/core/data/types";
import type { ItemInstance } from "./ItemInstance";
import {
  armorDamageReduction,
  meleeWeaponDamage,
  strengthRequirement,
  triangularReduction,
} from "./itemScaling";

const shortSword: ItemDef = {
  id: "short_sword",
  name: "Short Sword",
  type: "weapon",
  tier: 2,
  description: "",
};

const quarterstaff: ItemDef = {
  id: "quarterstaff",
  name: "Quarterstaff",
  type: "weapon",
  tier: 2,
  description: "",
};

const leatherArmor: ItemDef = {
  id: "leather_armor",
  name: "Leather Armor",
  type: "armor",
  tier: 2,
  description: "",
};

function instance(level: number): ItemInstance {
  return {
    uid: `item_${level}`,
    defId: "x",
    level,
    levelKnown: true,
    cursed: false,
    cursedKnown: false,
  };
}

describe("itemScaling", () => {
  it("calculates SPD triangular strength reductions", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9, 10].map(triangularReduction)).toEqual([
      0, 1, 1, 2, 2, 2, 3, 3, 4,
    ]);
  });

  it("scales normal melee weapon damage by tier and level", () => {
    expect(meleeWeaponDamage(shortSword, instance(0))).toMatchObject({
      damageMin: 2,
      damageMax: 15,
    });
    expect(meleeWeaponDamage(shortSword, instance(3))).toMatchObject({
      damageMin: 5,
      damageMax: 24,
    });
  });

  it("uses the quarterstaff max damage override", () => {
    expect(meleeWeaponDamage(quarterstaff, instance(0))).toMatchObject({
      damageMin: 2,
      damageMax: 12,
    });
    expect(meleeWeaponDamage(quarterstaff, instance(2))).toMatchObject({
      damageMin: 4,
      damageMax: 18,
    });
  });

  it("scales armor DR and strength requirement like SPD", () => {
    expect(armorDamageReduction(leatherArmor, instance(0))).toMatchObject({
      drMin: 0,
      drMax: 4,
      strengthRequired: 12,
    });
    expect(armorDamageReduction(leatherArmor, instance(6))).toMatchObject({
      drMin: 6,
      drMax: 16,
      strengthRequired: 9,
    });
  });

  it("clamps strength requirement at zero for extreme upgraded items", () => {
    expect(strengthRequirement(leatherArmor, instance(999))).toBe(0);
  });
});

