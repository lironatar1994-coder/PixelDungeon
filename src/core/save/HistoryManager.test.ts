import { describe, expect, it } from "vitest";
import { HistoryManager } from "@/core/save/HistoryManager";
import type { SaveStorage } from "@/core/save/SaveManager";

class MemoryStorage implements SaveStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe("HistoryManager", () => {
  it("persists fallen-run records newest first", () => {
    const history = new HistoryManager(new MemoryStorage(), "history-test");

    expect(history.add({
      class: "Mage",
      heroLevel: 3,
      depthReached: 4,
      killerName: "Sewer Rat",
      inventoryItemIds: ["quarterstaff", "ration"],
    })).toBe(true);

    const records = history.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      class: "Mage",
      heroLevel: 3,
      depthReached: 4,
      killerName: "Sewer Rat",
      inventoryItemIds: ["quarterstaff", "ration"],
    });
    expect(records[0]!.id).not.toBe("");
    expect(records[0]!.endedAt).not.toBe("");
  });

  it("ignores malformed stored records", () => {
    const storage = new MemoryStorage();
    storage.setItem("history-test", JSON.stringify([null, { class: "Warrior" }]));
    const history = new HistoryManager(storage, "history-test");

    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]!.class).toBe("Warrior");
  });
});
