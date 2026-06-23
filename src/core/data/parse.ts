/**
 * parse.ts — the defensive layer between raw JSON and game logic (pure).
 *
 * Raw config files are untrusted: a property may be missing, the wrong type,
 * or nonsense (a negative speed, a string where a number belongs). This module
 * coerces every field to a safe value with sensible defaults and clamps, and
 * rejects structurally broken entries (no id) outright. The contract it
 * guarantees: a malformed JSON property can NEVER produce a NaN/undefined that
 * reaches the turn-queue math — e.g. `speed` always comes out a finite number
 * strictly greater than zero, so `TICK / speed` is always well defined.
 *
 * It is pure (no fetch, no DOM), so the corruption-handling is unit-tested
 * directly with plain objects.
 */
import type { EnemyDef, HeroDef, ItemDef } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(rec: Record<string, unknown>, key: string, fallback: string): string {
  const v = rec[key];
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}

interface NumOpts {
  int?: boolean;
  min?: number;
  max?: number;
}

function num(
  rec: Record<string, unknown>,
  key: string,
  fallback: number,
  opts: NumOpts = {},
): number {
  const raw = rec[key];
  let n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) n = fallback;
  if (opts.int) n = Math.round(n);
  if (opts.min !== undefined) n = Math.max(opts.min, n);
  if (opts.max !== undefined) n = Math.min(opts.max, n);
  return n;
}

export function parseEnemy(raw: unknown): EnemyDef | null {
  const rec = asRecord(raw);
  if (!rec) {
    console.warn("[content] ignoring non-object enemy entry:", raw);
    return null;
  }
  const id = str(rec, "id", "");
  if (id === "") {
    console.warn("[content] ignoring enemy entry with missing id:", raw);
    return null;
  }
  const damageMin = num(rec, "damageMin", 1, { int: true, min: 0 });
  
  let deathCauses: import("./types").EnemyDeathCauses | undefined;
  if ("deathCauses" in rec) {
    const rawCauses = asRecord(rec.deathCauses);
    if (rawCauses) {
      deathCauses = {};
      if (Array.isArray(rawCauses.normal)) {
        deathCauses.normal = rawCauses.normal.filter(s => typeof s === "string");
      }
      if (Array.isArray(rawCauses.crit)) {
        deathCauses.crit = rawCauses.crit.filter(s => typeof s === "string");
      }
      if (rawCauses.skills) {
        const rawSkills = asRecord(rawCauses.skills);
        if (rawSkills) {
          deathCauses.skills = {};
          for (const [k, v] of Object.entries(rawSkills)) {
            if (Array.isArray(v)) {
              deathCauses.skills[k] = v.filter(s => typeof s === "string");
            }
          }
        }
      }
    }
  }

  return {
    id,
    name: str(rec, "name", id),
    maxHealth: num(rec, "maxHealth", 10, { int: true, min: 1 }),
    // min 0.1 is the critical guard: speed must never be 0 (TICK/0 = Infinity).
    speed: num(rec, "speed", 1, { min: 0.1, max: 10 }),
    vision: num(rec, "vision", 6, { int: true, min: 0, max: 20 }),
    accuracy: num(rec, "accuracy", 10, { int: true, min: 0 }),
    evasion: num(rec, "evasion", 5, { int: true, min: 0 }),
    damageMin,
    // damageMax can never fall below damageMin (keeps the damage range valid).
    damageMax: num(rec, "damageMax", Math.max(3, damageMin), { int: true, min: damageMin }),
    armor: num(rec, "armor", 0, { int: true, min: 0 }),
    spawnWeight: num(rec, "spawnWeight", 1, { min: 0 }),
    minDepth: num(rec, "minDepth", 1, { int: true, min: 1 }),
    expReward: num(rec, "expReward", 1, { int: true, min: 0 }),
    maxLevelCap: num(rec, "maxLevelCap", 30, { int: true, min: 0 }),
    description: str(rec, "description", ""),
    deathCauses,
  };
}

export function parseEnemies(raw: unknown): EnemyDef[] {
  if (!Array.isArray(raw)) {
    if (raw != null) console.warn("[content] enemies config is not an array:", raw);
    return [];
  }
  const out: EnemyDef[] = [];
  for (const entry of raw) {
    const def = parseEnemy(entry);
    if (def) out.push(def);
  }
  return out;
}

export function parseItem(raw: unknown): ItemDef | null {
  const rec = asRecord(raw);
  if (!rec) {
    console.warn("[content] ignoring non-object item entry:", raw);
    return null;
  }
  const id = str(rec, "id", "");
  if (id === "") {
    console.warn("[content] ignoring item entry with missing id:", raw);
    return null;
  }
  // Preserve type-specific fields, but guarantee the core three are clean and
  // coerce the known combat numbers (so the inventory can trust them).
  const item: ItemDef = { ...rec, id, name: str(rec, "name", id), type: str(rec, "type", "misc") };
  for (const key of ["damageMin", "damageMax", "defense", "heal", "strengthBonus"] as const) {
    if (key in rec) item[key] = num(rec, key, 0, { int: true, min: 0 });
  }
  if ("strengthRequired" in rec) {
    item.strengthRequired = num(rec, "strengthRequired", 0, { int: true, min: 0 });
  }
  if ("attackDelay" in rec) {
    item.attackDelay = num(rec, "attackDelay", 1, { min: 0.1, max: 10 });
  }
  return item;
}

export function parseItems(raw: unknown): ItemDef[] {
  if (!Array.isArray(raw)) {
    if (raw != null) console.warn("[content] items config is not an array:", raw);
    return [];
  }
  const out: ItemDef[] = [];
  for (const entry of raw) {
    const def = parseItem(entry);
    if (def) out.push(def);
  }
  return out;
}

export function parseHero(raw: unknown): HeroDef | null {
  const rec = asRecord(raw);
  if (!rec) {
    console.warn("[content] ignoring non-object hero entry:", raw);
    return null;
  }
  const id = str(rec, "id", "");
  if (id === "") {
    console.warn("[content] ignoring hero entry with missing id:", raw);
    return null;
  }
  const rawItems = Array.isArray(rec.startingItems) ? rec.startingItems : [];
  return {
    id,
    name: str(rec, "name", id),
    maxHealth: num(rec, "maxHealth", 20, { int: true, min: 1 }),
    strength: num(rec, "strength", 15, { int: true, min: 0 }),
    sprite: str(rec, "sprite", id),
    startingItems: rawItems.filter((item): item is string => (
      typeof item === "string" && item.trim() !== ""
    )),
    description: str(rec, "description", ""),
  };
}

export function parseHeroes(raw: unknown): HeroDef[] {
  if (!Array.isArray(raw)) {
    if (raw != null) console.warn("[content] heroes config is not an array:", raw);
    return [];
  }
  const out: HeroDef[] = [];
  for (const entry of raw) {
    const def = parseHero(entry);
    if (def) out.push(def);
  }
  return out;
}
