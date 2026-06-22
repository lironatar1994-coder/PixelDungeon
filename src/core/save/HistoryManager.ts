import type { SaveStorage } from "@/core/save/SaveManager";

export const DEFAULT_HISTORY_KEY = "pixel_dungeon_history";
const MAX_HISTORY_RECORDS = 50;

export interface RunHistoryRecord {
  id: string;
  endedAt: string;
  class: string;
  heroLevel: number;
  depthReached: number;
  killerName: string;
  inventoryItemIds: string[];
}

export class HistoryManager {
  readonly key: string;
  private readonly storage: SaveStorage;

  constructor(storage: SaveStorage, key = DEFAULT_HISTORY_KEY) {
    this.storage = storage;
    this.key = key;
  }

  list(): RunHistoryRecord[] {
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(parseRecord).filter((record): record is RunHistoryRecord => record !== null);
    } catch (err) {
      console.warn("[history] ignoring invalid run history:", err);
      return [];
    }
  }

  add(record: Omit<RunHistoryRecord, "id" | "endedAt">): boolean {
    try {
      const next: RunHistoryRecord = {
        ...record,
        id: makeHistoryId(record),
        endedAt: new Date().toISOString(),
        inventoryItemIds: record.inventoryItemIds.slice(),
      };
      const records = [next, ...this.list()].slice(0, MAX_HISTORY_RECORDS);
      this.storage.setItem(this.key, JSON.stringify(records));
      return true;
    } catch (err) {
      console.warn("[history] failed to persist run history:", err);
      return false;
    }
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

function parseRecord(raw: unknown): RunHistoryRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const inventory = Array.isArray(rec.inventoryItemIds)
    ? rec.inventoryItemIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    id: stringField(rec.id, "unknown"),
    endedAt: stringField(rec.endedAt, ""),
    class: stringField(rec.class, "Unknown"),
    heroLevel: numberField(rec.heroLevel, 1),
    depthReached: numberField(rec.depthReached, 1),
    killerName: stringField(rec.killerName, "Unknown"),
    inventoryItemIds: inventory,
  };
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function makeHistoryId(record: Omit<RunHistoryRecord, "id" | "endedAt">): string {
  return [
    Date.now().toString(36),
    record.class.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    record.depthReached,
    record.heroLevel,
  ].join("-");
}
