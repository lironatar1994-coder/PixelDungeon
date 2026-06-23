import { Terrain } from "@/core/grid/terrain";
import type { EnemyState } from "@/core/actors/Enemy";

export type SpriteSheetKey =
  | "tiles"
  | "tilesPrison"
  | "tilesCaves"
  | "tilesCity"
  | "tilesHalls"
  | "warrior"
  | "mage"
  | "rat"
  | "undead"
  | "items"
  | "itemIcons"
  | "textIcons"
  | "toolbar"
  | "interfaceIcons"
  | "banners";

export type SpriteKey =
  | "floor"
  | "floorDeco"
  | "grass"
  | "water"
  | "wallTop"
  | "wallFront"
  | "wallFrontOpenRight"
  | "wallFrontOpenLeft"
  | "wallFrontOpenBoth"
  | "doorFlat"
  | "doorFlatOpen"
  | "doorFront"
  | "doorFrontOpen"
  | "hero"
  | "mageHero"
  | "rat"
  | "zombie"
  | "heroPortrait"
  | "magePortrait"
  | "entrance"
  | "exit"
  | "shortSword"
  | "quarterstaff"
  | "leatherArmor"
  | "healingPotion"
  | "strengthPotion"
  | "ration"
  | "uiInventory"
  | "uiWait"
  | "uiSearch"
  | "uiQuickslot"
  | "uiHeroStats"
  | "uiControls"
  | "uiEnter"
  | "uiPrefs"
  | "gameOverBanner"
  | "textPhysDamage";

export interface SpriteRect {
  sheet: SpriteSheetKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteCssStyle {
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
  width: string;
  height: string;
}

export interface SpriteSheetAssets {
  readonly ready: boolean;
  readonly tileSize: number;
  canDraw(key: SpriteKey): boolean;
  imageFor(key: SpriteKey, depth?: number): HTMLImageElement | null;
  spriteForTerrain(terrain: Terrain, depth?: number): SpriteKey;
  spriteForEnemy(enemy: { name: string; state: EnemyState }): SpriteKey;
  spriteForItem(itemId: string): SpriteKey | null;
  spriteForItemType(type: string): SpriteKey;
  sourceRect(key: SpriteKey, depth?: number): SpriteRect;
  cssStyleForSprite(key: SpriteKey, scale?: number): SpriteCssStyle | null;
}

const BASE = import.meta.env.BASE_URL;

const SHEET_URLS: Record<SpriteSheetKey, string> = {
  tiles: `${BASE}assets/tiles_sewers.png`,
  tilesPrison: `${BASE}assets/tiles_prison.png`,
  tilesCaves: `${BASE}assets/tiles_caves.png`,
  tilesCity: `${BASE}assets/tiles_city.png`,
  tilesHalls: `${BASE}assets/tiles_halls.png`,
  warrior: `${BASE}assets/warrior.png`,
  mage: `${BASE}assets/mage.png`,
  rat: `${BASE}assets/rat.png`,
  undead: `${BASE}assets/undead.png`,
  items: `${BASE}assets/items.png`,
  itemIcons: `${BASE}assets/item_icons.png`,
  textIcons: `${BASE}assets/text_icons.png`,
  toolbar: `${BASE}assets/toolbar.png`,
  interfaceIcons: `${BASE}assets/icons.png`,
  banners: `${BASE}assets/banners.png`,
};

function xy(x: number, y: number, width = 16): number {
  return x - 1 + (y - 1) * width;
}

function sheetRect(sheet: SpriteSheetKey, index: number, tileSize: number, w = tileSize, h = tileSize): SpriteRect {
  const columns = sheet === "itemIcons" ? 16 : 16;
  return {
    sheet,
    x: (index % columns) * tileSize,
    y: Math.floor(index / columns) * tileSize,
    w,
    h,
  };
}

const SPRITES: Record<SpriteKey, SpriteRect> = {
  floor: { sheet: "tiles", x: 0, y: 0, w: 16, h: 16 },
  floorDeco: { sheet: "tiles", x: 16, y: 0, w: 16, h: 16 },
  grass: { sheet: "tiles", x: 32, y: 0, w: 16, h: 16 },
  water: { sheet: "tiles", x: 0, y: 32, w: 16, h: 16 },
  entrance: sheetRect("tiles", xy(1, 1) + 16, 16),
  exit: sheetRect("tiles", xy(1, 1) + 17, 16),

  // Walls & Doors (explicit coordinates)
  wallTop: { sheet: "tiles", x: 0, y: 48, w: 16, h: 16 },
  wallFront: { sheet: "tiles", x: 0, y: 80, w: 16, h: 16 },
  wallFrontOpenRight: { sheet: "tiles", x: 16, y: 80, w: 16, h: 16 },
  wallFrontOpenLeft: { sheet: "tiles", x: 32, y: 80, w: 16, h: 16 },
  wallFrontOpenBoth: { sheet: "tiles", x: 48, y: 80, w: 16, h: 16 },
  doorFlat: { sheet: "tiles", x: 128, y: 48, w: 16, h: 16 },
  doorFlatOpen: { sheet: "tiles", x: 144, y: 48, w: 16, h: 16 },
  doorFront: { sheet: "tiles", x: 0, y: 112, w: 16, h: 16 },
  doorFrontOpen: { sheet: "tiles", x: 16, y: 112, w: 16, h: 16 },

  // HeroSprite.java / RatSprite.java / UndeadSprite.java idle frame zero.
  hero: { sheet: "warrior", x: 0, y: 0, w: 12, h: 15 },
  mageHero: { sheet: "mage", x: 0, y: 0, w: 12, h: 15 },
  // HeroSprite.avatar(...) crops the class sheet at x=1,y=0,w=12,h=15 for the base portrait.
  heroPortrait: { sheet: "warrior", x: 1, y: 0, w: 12, h: 15 },
  magePortrait: { sheet: "mage", x: 1, y: 0, w: 12, h: 15 },
  rat: { sheet: "rat", x: 0, y: 0, w: 16, h: 15 },
  zombie: { sheet: "undead", x: 0, y: 0, w: 12, h: 16 },

  // ItemSpriteSheet.java atlas coordinates.
  shortSword: sheetRect("items", xy(9, 7), 16, 13, 13),
  quarterstaff: sheetRect("items", xy(9, 7) + 3, 16, 16, 16),
  leatherArmor: sheetRect("items", xy(1, 12) + 1, 16, 14, 13),
  ration: sheetRect("items", xy(1, 28) + 5, 16, 16, 12),

  // PotionOfHealing.java uses ItemSpriteSheet.Icons.POTION_HEALING.
  strengthPotion: sheetRect("itemIcons", xy(1, 6), 8, 7, 7),
  healingPotion: sheetRect("itemIcons", xy(1, 6) + 1, 8, 6, 7),

  // Toolbar.java: btnInventory.icon(160,0,16,16), btnWait.icon(176,0,16,16).
  uiInventory: { sheet: "toolbar", x: 160, y: 0, w: 16, h: 16 },
  uiWait: { sheet: "toolbar", x: 176, y: 0, w: 16, h: 16 },
  // Toolbar.java: btnSearch.icon(192,0,16,16).
  uiSearch: { sheet: "toolbar", x: 192, y: 0, w: 16, h: 16 },
  // Toolbar.java quickslot frame: left slot frame(86,0,20,24); item assignment arrives later.
  uiQuickslot: { sheet: "toolbar", x: 86, y: 0, w: 20, h: 24 },

  // Icons.java: STATS=(128,16,16,13), KEYBOARD=(112,16,15,12).
  uiHeroStats: { sheet: "interfaceIcons", x: 128, y: 16, w: 16, h: 13 },
  uiControls: { sheet: "interfaceIcons", x: 112, y: 16, w: 15, h: 12 },
  // Icons.java: ENTER=(0,0,16,16), PREFS=(102,0,14,14).
  uiEnter: { sheet: "interfaceIcons", x: 0, y: 0, w: 16, h: 16 },
  uiPrefs: { sheet: "interfaceIcons", x: 102, y: 0, w: 14, h: 14 },

  // BannerSprites.java: GAME_OVER crop from interfaces/banners.png.
  gameOverBanner: { sheet: "banners", x: 128, y: 157, w: 128, h: 35 },

  // FloatingText.java: TEXT_ICONS film is 7x8, PHYS_DMG is index 0.
  textPhysDamage: { sheet: "textIcons", x: 0, y: 0, w: 7, h: 8 },
};

const ITEM_SPRITES: Record<string, SpriteKey> = {
  short_sword: "shortSword",
  quarterstaff: "quarterstaff",
  leather_armor: "leatherArmor",
  potion_healing: "healingPotion",
  potion_strength: "strengthPotion",
  ration: "ration",
};

export class AssetLoader implements SpriteSheetAssets {
  readonly tileSize = 16;
  private readonly images = new Map<SpriteSheetKey, HTMLImageElement>();

  get ready(): boolean {
    return this.images.size > 0;
  }

  async loadDefaultSheets(): Promise<boolean> {
    const results = await Promise.all(
      Object.entries(SHEET_URLS).map(async ([sheet, url]) => [
        sheet as SpriteSheetKey,
        await this.loadSheet(sheet as SpriteSheetKey, url),
      ]),
    );
    return results.some(([, loaded]) => loaded);
  }

  async loadSheet(sheet: SpriteSheetKey, url: string): Promise<boolean> {
    const image = new Image();
    image.decoding = "async";
    image.src = url;

    try {
      await image.decode();
      this.images.set(sheet, image);
      return true;
    } catch (err) {
      console.warn(`[assets] ${sheet} sheet unavailable at ${url}; using fallback for those sprites.`, err);
      this.images.delete(sheet);
      return false;
    }
  }

  canDraw(key: SpriteKey): boolean {
    return this.images.has(SPRITES[key].sheet);
  }

  imageFor(key: SpriteKey, depth = 1): HTMLImageElement | null {
    return this.images.get(this.sourceRect(key, depth).sheet) ?? null;
  }

  spriteForTerrain(terrain: Terrain, _depth = 1): SpriteKey {
    if (terrain === Terrain.FLOOR) return "floor";
    if (terrain === Terrain.GRASS) return "grass";
    if (terrain === Terrain.WATER) return "water";
    if (terrain === Terrain.DOOR) return "doorFlat";
    return "wallTop";
  }

  spriteForEnemy(enemy: { name: string; state: EnemyState }): SpriteKey {
    const name = enemy.name.toLowerCase();
    if (name.includes("zombie") || name.includes("undead")) return "zombie";
    return "rat";
  }

  spriteForItem(itemId: string): SpriteKey | null {
    return ITEM_SPRITES[itemId] ?? null;
  }

  /** A representative sprite for an item's category, so an item with an
   *  unmapped id still draws real art instead of a placeholder. */
  spriteForItemType(type: string): SpriteKey {
    switch (type) {
      case "weapon":
        return "shortSword";
      case "armor":
        return "leatherArmor";
      case "potion":
        return "healingPotion";
      case "food":
        return "ration";
      default:
        return "ration";
    }
  }

  sourceRect(key: SpriteKey, depth = 1): SpriteRect {
    const rect = SPRITES[key];
    if (isTerrainSprite(key)) {
      return { ...rect, sheet: tileSheetForDepth(depth) };
    }
    return rect;
  }

  cssStyleForSprite(key: SpriteKey, scale = 2): SpriteCssStyle | null {
    const image = this.imageFor(key);
    if (!image) return null;
    const src = this.sourceRect(key);
    return {
      backgroundImage: `url("${image.src}")`,
      backgroundPosition: `-${src.x * scale}px -${src.y * scale}px`,
      backgroundSize: `${image.naturalWidth * scale}px ${image.naturalHeight * scale}px`,
      width: `${src.w * scale}px`,
      height: `${src.h * scale}px`,
    };
  }
}

function isTerrainSprite(key: SpriteKey): boolean {
  return key === "floor" || key === "floorDeco" || key === "grass" || key === "water" || 
         key === "wallTop" || key === "wallFront" ||
         key === "wallFrontOpenRight" || key === "wallFrontOpenLeft" || key === "wallFrontOpenBoth" ||
         key === "doorFlat" || key === "doorFlatOpen" ||
         key === "doorFront" || key === "doorFrontOpen" ||
         key === "entrance" || key === "exit";
}

function tileSheetForDepth(depth: number): SpriteSheetKey {
  if (depth >= 21) return "tilesHalls";
  if (depth >= 16) return "tilesCity";
  if (depth >= 11) return "tilesCaves";
  if (depth >= 6) return "tilesPrison";
  return "tiles";
}
