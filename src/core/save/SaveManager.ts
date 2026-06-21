import { GameWorld, type GameWorldSnapshot, type WorldOptions } from "@/core/game/GameWorld";
import type { ContentDatabase } from "@/core/data/ContentDatabase";

export const SAVE_VERSION = 1;
export const DEFAULT_SAVE_KEY = "pixel-dungeon.save.v1";

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveManager {
  readonly key: string;
  private readonly storage: SaveStorage;

  constructor(storage: SaveStorage, key = DEFAULT_SAVE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  save(world: GameWorld): boolean {
    try {
      if (!world.heroAlive) {
        this.clear();
        return true;
      }
      this.storage.setItem(this.key, SaveManager.stringify(world));
      return true;
    } catch (err) {
      console.warn("[save] failed to persist game:", err);
      return false;
    }
  }

  load(
    content: ContentDatabase,
    opts: Pick<WorldOptions, "onChange" | "onLog" | "onHeroDamaged"> = {},
  ): GameWorld | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const world = SaveManager.parse(raw, content, opts);
      if (!world.heroAlive) {
        this.clear();
        return null;
      }
      return world;
    } catch (err) {
      console.warn("[save] ignoring invalid save file:", err);
      return null;
    }
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }

  hasValidRun(content: ContentDatabase): boolean {
    const raw = this.storage.getItem(this.key);
    if (!raw) return false;
    try {
      const world = SaveManager.parse(raw, content);
      if (!world.heroAlive) {
        this.clear();
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[save] ignoring invalid save file:", err);
      this.clear();
      return false;
    }
  }

  static stringify(world: GameWorld): string {
    return JSON.stringify(world.snapshot());
  }

  static parse(
    raw: string,
    content: ContentDatabase,
    opts: Pick<WorldOptions, "onChange" | "onLog" | "onHeroDamaged"> = {},
  ): GameWorld {
    const snapshot = JSON.parse(raw) as GameWorldSnapshot;
    if (snapshot.version !== SAVE_VERSION) {
      throw new Error(`Unsupported save version: ${String(snapshot.version)}`);
    }
    return GameWorld.fromSnapshot(snapshot, content, opts);
  }
}
