/**
 * CombatStats — a modular stat component (pure logic, Directive 1).
 *
 * This is the "C" in our lightweight ECS: a living entity's combat attributes
 * live here, completely independent of any AI state machine or rendering. Both
 * the Hero and every Enemy *own* one of these; the AI (Wander/Hunt) is a
 * separate concern on the Enemy.
 *
 * Crucially, base stats are immutable. Temporary effects (a buff potion,
 * equipping a sword, a debuff) are layered on as removable **modifiers**; the
 * effective value is `base + sum(modifiers)`. Nothing ever writes the base, so
 * when a modifier expires or an item is unequipped the entity snaps back to its
 * true stats with zero risk of drift or corruption.
 */

export type StatKey =
  | "maxHealth"
  | "accuracy"
  | "evasion"
  | "damageMin"
  | "damageMax"
  | "armor"
  | "speed"
  | "attackDelay";

export interface BaseStats {
  maxHealth: number;
  accuracy: number;
  evasion: number;
  damageMin: number;
  damageMax: number;
  armor: number;
  speed?: number;
  /** Attack action multiplier. 1 = normal, 0.5 = twice as fast, 2 = twice as slow. */
  attackDelay?: number;
}

export interface StatModifier {
  /** Source tag; all modifiers sharing an id are removed together. */
  id: string;
  stat: StatKey;
  amount: number;
  /** Remaining turns; omit for a permanent modifier (e.g. equipment). */
  turns?: number;
}

export interface CombatStatsSnapshot {
  base: BaseStats;
  hp: number;
  modifiers: StatModifier[];
}

export class CombatStats {
  /** The true, untouched values this entity was created with. */
  private readonly base: BaseStats;
  private modifiers: StatModifier[] = [];

  /** Current hit points (mutable; the rest are derived). */
  hp: number;

  constructor(base: BaseStats) {
    this.base = { ...base };
    this.hp = base.maxHealth;
  }

  snapshot(): CombatStatsSnapshot {
    return {
      base: { ...this.base },
      hp: this.hp,
      modifiers: this.modifiers.map((m) => ({ ...m })),
    };
  }

  static fromSnapshot(snapshot: CombatStatsSnapshot): CombatStats {
    const stats = new CombatStats(snapshot.base);
    stats.restore(snapshot);
    return stats;
  }

  restore(snapshot: CombatStatsSnapshot): void {
    this.modifiers = snapshot.modifiers.map((m) => ({ ...m }));
    this.hp = Math.round(snapshot.hp);
    this.clampHp();
  }

  /** The original base value of a stat, ignoring all modifiers. */
  baseOf(stat: StatKey): number {
    return this.baseValue(stat);
  }

  /** The effective value: base plus every active modifier (never negative). */
  effective(stat: StatKey): number {
    let total = this.baseValue(stat);
    for (const m of this.modifiers) {
      if (m.stat === stat) total += m.amount;
    }
    return Math.max(0, total);
  }

  get maxHealth(): number {
    return this.effective("maxHealth");
  }
  get accuracy(): number {
    return this.effective("accuracy");
  }
  get evasion(): number {
    return this.effective("evasion");
  }
  get damageMin(): number {
    return this.effective("damageMin");
  }
  get damageMax(): number {
    return Math.max(this.damageMin, this.effective("damageMax"));
  }
  get armor(): number {
    return this.effective("armor");
  }
  get speed(): number {
    return Math.max(0.0001, this.effective("speed"));
  }
  get attackDelay(): number {
    return Math.max(0.0001, this.effective("attackDelay"));
  }

  // --- modifiers ---

  addModifier(modifier: StatModifier): void {
    this.modifiers.push({ ...modifier });
    this.clampHp();
  }

  /** Remove every modifier from a given source id (e.g. on unequip). */
  removeModifiers(id: string): void {
    this.modifiers = this.modifiers.filter((m) => m.id !== id);
    this.clampHp();
  }

  activeModifiers(): readonly StatModifier[] {
    return this.modifiers;
  }

  /** Advance one turn: count down timed modifiers and drop expired ones. */
  tick(): void {
    let changed = false;
    for (const m of this.modifiers) {
      if (m.turns !== undefined) {
        m.turns -= 1;
        if (m.turns <= 0) changed = true;
      }
    }
    if (changed) {
      this.modifiers = this.modifiers.filter(
        (m) => m.turns === undefined || m.turns > 0,
      );
      this.clampHp();
    }
  }

  // --- health ---

  get alive(): boolean {
    return this.hp > 0;
  }

  /** Apply damage; returns the amount actually lost. */
  takeDamage(amount: number): number {
    const dealt = Math.max(0, Math.min(this.hp, Math.round(amount)));
    this.hp -= dealt;
    return dealt;
  }

  /** Restore health up to maxHealth; returns the amount actually healed. */
  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHealth, this.hp + Math.max(0, Math.round(amount)));
    return this.hp - before;
  }

  /** Keep current hp within [0, maxHealth] after a maxHealth modifier change. */
  private clampHp(): void {
    if (this.hp > this.maxHealth) this.hp = this.maxHealth;
    if (this.hp < 0) this.hp = 0;
  }

  private baseValue(stat: StatKey): number {
    if (stat === "speed") return this.base.speed ?? 1;
    if (stat === "attackDelay") return this.base.attackDelay ?? 1;
    return this.base[stat];
  }
}
