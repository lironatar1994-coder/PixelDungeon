import "./mainMenu.css";
import type { HeroDef } from "@/core/data/types";
import type { RunHistoryRecord } from "@/core/save/HistoryManager";

export interface MainMenuActions {
  newGame(heroId: string): void;
  continueGame(): void;
}

type MenuView = "title" | "heroes" | "history" | "about";

const GAME_ICON_URL = `${import.meta.env.BASE_URL}assets/icon_game.png`;

const VERSION_LABEL = "v0.1 · Codex Build";

/** Number of hero buttons shown in the select dock. Slots past the available
 *  heroes render as locked "Soon" placeholders. */
const HERO_SLOTS = 4;
/** Pixel scale for the cropped class portrait drawn on each hero button. */
const HERO_PORTRAIT_SCALE = 4;
/** Class sprite sheets are 256×128; the portrait crop mirrors AssetLoader. */
const HERO_SHEET_W = 256;
const HERO_SHEET_H = 128;
const HERO_PORTRAIT_RECT = { x: 1, y: 0, w: 12, h: 15 } as const;
/** Full-screen backdrop art per hero id. Heroes without an entry fall back to
 *  the plain dark dungeon backdrop. Pure presentation — no engine state. */
const HERO_BG_URLS: Record<string, string> = {
  warrior: `${import.meta.env.BASE_URL}assets/warrior_full_bg.png`,
};

/** Inline style that crops a class portrait out of its 256×128 sprite sheet. */
function heroPortraitStyle(sprite: string, scale: number): string {
  const url = `${import.meta.env.BASE_URL}assets/${sprite}.png`;
  const r = HERO_PORTRAIT_RECT;
  return [
    `background-image:url("${url}")`,
    `background-size:${HERO_SHEET_W * scale}px ${HERO_SHEET_H * scale}px`,
    `background-position:-${r.x * scale}px -${r.y * scale}px`,
    `width:${r.w * scale}px`,
    `height:${r.h * scale}px`,
  ].join(";");
}

/**
 * MainMenu — the title screen (DOM only; reads no live game state).
 *
 * A clean, Shattered-Pixel-Dungeon-style menu: a subtly animated dungeon
 * backdrop, a glowing stacked logo, a primary "Enter the Dungeon" action and a
 * grid of secondary commands. Sub-screens (hero select, run history, about)
 * swap in over the same backdrop. It only invokes the injected actions; it
 * never touches the engine (Pillar 1).
 */
export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly scene: HTMLDivElement;
  private readonly views = new Map<MenuView, HTMLElement>();
  private readonly heroes: readonly HeroDef[];
  private readonly history: readonly RunHistoryRecord[];
  private readonly actions: MainMenuActions;
  private readonly canContinue: boolean;
  private statusEl: HTMLParagraphElement | null = null;
  private statusTimer = 0;
  private selectedHeroId: string | null = null;
  private heroBgEl: HTMLDivElement | null = null;
  private heroNameEl: HTMLHeadingElement | null = null;
  private heroStatsEl: HTMLParagraphElement | null = null;
  private heroBlurbEl: HTMLParagraphElement | null = null;
  private readonly heroPicks = new Map<string, HTMLButtonElement>();

  constructor(
    canContinue: boolean,
    heroes: readonly HeroDef[],
    history: readonly RunHistoryRecord[],
    actions: MainMenuActions,
  ) {
    this.canContinue = canContinue;
    this.heroes = heroes;
    this.history = history;
    this.actions = actions;

    this.root = document.createElement("div");
    this.root.id = "main-menu";
    // High-specificity hook so this menu's styles win over any leftover rules.
    this.root.className = "mm-root";
    this.root.setAttribute("role", "application");
    this.root.setAttribute("aria-label", "Main menu");
    // Decorative drifting dungeon backdrop (pure CSS, behind everything).
    this.root.innerHTML = `<div class="mm-bg" aria-hidden="true"></div>`;

    this.scene = document.createElement("div");
    this.scene.className = "mm-scene";

    const heroSelect = this.buildHeroPanel();
    this.views.set("title", this.buildTitleView());
    this.views.set("heroes", heroSelect);
    this.views.set("history", this.buildHistoryPanel());
    this.views.set("about", this.buildAboutPanel());
    // The hero-select is full-bleed, so it lives in the root's stacking context
    // (a sibling of the scene/footer) instead of inside the centered scene.
    for (const [key, view] of this.views) {
      if (key !== "heroes") this.scene.append(view);
    }

    this.root.append(this.scene, heroSelect, this.buildFooter());
    document.body.append(this.root);
    this.show("title");
  }

  destroy(): void {
    window.clearTimeout(this.statusTimer);
    this.root.remove();
  }

  private show(view: MenuView): void {
    this.root.dataset.view = view;
    for (const [key, element] of this.views) element.hidden = key !== view;
  }

  // --- title ---------------------------------------------------------------
  private buildTitleView(): HTMLDivElement {
    const view = document.createElement("div");
    view.className = "mm-title-view";

    const logo = document.createElement("div");
    logo.className = "mm-logo";
    logo.setAttribute("aria-label", "Blood and Steel");
    logo.innerHTML = `
      <span class="mm-logo-glow" aria-hidden="true"></span>
      <img class="mm-game-icon" src="${GAME_ICON_URL}" alt="" aria-hidden="true" />
      <span class="mm-logo-title"><span class="mm-logo-blood">Blood</span> <span class="mm-logo-and">and</span> <span class="mm-logo-steel">Steel</span></span>
      <span class="mm-logo-sub">iron - blood - cold stone</span>
    `;

    const nav = document.createElement("nav");
    nav.className = "mm-actions";
    nav.setAttribute("aria-label", "Main actions");

    if (this.canContinue) {
      nav.append(this.button("Enter the Dungeon", "primary", () => this.actions.continueGame()));
      nav.append(this.button("New Game", "wide", () => this.show("heroes")));
    } else {
      nav.append(this.button("Enter the Dungeon", "primary", () => this.show("heroes")));
    }

    const grid = document.createElement("div");
    grid.className = "mm-grid";
    grid.append(
      this.button("Run History", "tile", () => this.show("history")),
      this.button("About", "tile", () => this.show("about")),
    );

    const settings = this.button("Settings", "tile disabled", () =>
      this.flash("Settings are coming in a later build."),
    );
    settings.append(tag("soon"));

    this.statusEl = document.createElement("p");
    this.statusEl.className = "mm-status";
    this.statusEl.textContent = this.canContinue
      ? "A living run is waiting below."
      : "Choose a hero to begin your descent.";

    nav.append(grid, settings, this.statusEl);
    view.append(logo, nav);
    return view;
  }

  // --- hero select ---------------------------------------------------------
  // A full-bleed picker: the selected hero's art fills the screen, four hero
  // buttons sit in a dock at the bottom, and "Enter the Dungeon" embarks with
  // whoever is selected. Selecting only swaps the backdrop/preview; the run
  // starts on embark (UI expresses intent only — Pillar 1).
  private buildHeroPanel(): HTMLElement {
    const view = document.createElement("section");
    view.className = "mm-heroselect";
    view.setAttribute("aria-label", "Choose your hero");

    const bg = document.createElement("div");
    bg.className = "mm-hero-bg";
    bg.setAttribute("aria-hidden", "true");
    this.heroBgEl = bg;

    const scrim = document.createElement("div");
    scrim.className = "mm-hero-scrim";
    scrim.setAttribute("aria-hidden", "true");

    const top = document.createElement("div");
    top.className = "mm-hero-top";
    const back = this.button("Back", "tile", () => this.show("title"));
    back.classList.add("mm-back", "mm-hero-backbtn");
    const heading = document.createElement("div");
    heading.className = "mm-hero-heading";
    this.heroNameEl = document.createElement("h2");
    this.heroStatsEl = document.createElement("p");
    this.heroStatsEl.className = "mm-hero-statline";
    heading.append(this.heroNameEl, this.heroStatsEl);
    top.append(back, heading);

    const foot = document.createElement("div");
    foot.className = "mm-hero-foot";
    this.heroBlurbEl = document.createElement("p");
    this.heroBlurbEl.className = "mm-hero-blurb";
    const embark = this.button("Enter the Dungeon", "primary", () => {
      if (this.selectedHeroId) this.actions.newGame(this.selectedHeroId);
    });
    embark.classList.add("mm-hero-embark");

    const dock = document.createElement("div");
    dock.className = "mm-hero-dock";
    for (let slot = 0; slot < HERO_SLOTS; slot++) {
      const hero = this.heroes[slot];
      dock.append(hero ? this.buildHeroPick(hero) : this.buildLockedPick());
    }

    foot.append(this.heroBlurbEl, embark, dock);
    view.append(bg, scrim, top, foot);

    if (this.heroes[0]) this.selectHero(this.heroes[0]);
    return view;
  }

  private buildHeroPick(hero: HeroDef): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mm-hero-pick";
    button.dataset.hero = hero.id;
    button.setAttribute("aria-label", hero.name);

    const portrait = document.createElement("span");
    portrait.className = "mm-hero-pick-portrait";
    portrait.setAttribute("aria-hidden", "true");
    portrait.setAttribute("style", heroPortraitStyle(hero.sprite, HERO_PORTRAIT_SCALE));

    const label = document.createElement("span");
    label.className = "mm-hero-pick-label";
    label.textContent = hero.name;

    button.append(portrait, label);
    button.addEventListener("click", () => this.selectHero(hero));
    this.heroPicks.set(hero.id, button);
    return button;
  }

  private buildLockedPick(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mm-hero-pick mm-hero-pick-locked";
    button.disabled = true;
    button.setAttribute("aria-label", "Locked hero");
    button.innerHTML = `
      <span class="mm-hero-pick-portrait mm-hero-pick-q" aria-hidden="true">?</span>
      <span class="mm-hero-pick-label">Soon</span>
    `;
    return button;
  }

  private selectHero(hero: HeroDef): void {
    this.selectedHeroId = hero.id;

    const bgUrl = HERO_BG_URLS[hero.id];
    if (this.heroBgEl) {
      this.heroBgEl.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : "";
      this.heroBgEl.classList.toggle("is-empty", !bgUrl);
    }
    if (this.heroNameEl) this.heroNameEl.textContent = hero.name;
    if (this.heroStatsEl) {
      this.heroStatsEl.textContent = `HP ${hero.maxHealth} · STR ${hero.strength}`;
    }
    if (this.heroBlurbEl) {
      this.heroBlurbEl.textContent =
        hero.description || `Starts with ${hero.startingItems.join(", ")}`;
    }
    for (const [id, pick] of this.heroPicks) {
      const selected = id === hero.id;
      pick.classList.toggle("is-selected", selected);
      pick.setAttribute("aria-pressed", String(selected));
    }
  }

  // --- run history ---------------------------------------------------------
  private buildHistoryPanel(): HTMLElement {
    const panel = this.window("Run History", "Fallen heroes are remembered here.");

    if (this.history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "mm-empty";
      empty.textContent = "No fallen heroes yet. Make your mark.";
      panel.append(empty);
      return panel;
    }

    const list = document.createElement("div");
    list.className = "mm-history-list";
    this.history.forEach((run, index) => {
      const row = document.createElement("article");
      row.className = "mm-history-row";
      const pack =
        run.inventoryItemIds.length > 0 ? run.inventoryItemIds.join(", ") : "empty pack";
      row.innerHTML = `
        <strong>#${index + 1} · ${escapeText(run.class)} · L${run.heroLevel}</strong>
        <span>Reached depth ${run.depthReached} — slain by ${escapeText(run.killerName)}</span>
        <small>${escapeText(pack)}</small>
      `;
      list.append(row);
    });
    panel.append(list);
    return panel;
  }

  // --- about ---------------------------------------------------------------
  private buildAboutPanel(): HTMLElement {
    const panel = this.window("About", VERSION_LABEL);
    const body = document.createElement("div");
    body.className = "mm-about";
    body.innerHTML = `
      <p>A web-native, turn-based roguelike — a clean TypeScript translation of
      the open-source game <em>Shattered Pixel Dungeon</em>.</p>
      <p>Deterministic, seed-driven dungeons. Everything in the browser, no
      install required.</p>
      <p class="mm-about-credit">Built with Vite + TypeScript · rendered on HTML5 Canvas.</p>
    `;
    panel.append(body);
    return panel;
  }

  // --- shared building blocks ---------------------------------------------
  private window(titleText: string, subtitleText: string): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "mm-window";

    const header = document.createElement("header");
    header.className = "mm-window-header";

    const heading = document.createElement("div");
    heading.className = "mm-window-heading";
    heading.innerHTML = `<h2>${escapeText(titleText)}</h2><p>${escapeText(subtitleText)}</p>`;

    const back = this.button("Back", "tile", () => this.show("title"));
    back.classList.add("mm-back");

    header.append(heading, back);
    panel.append(header);
    return panel;
  }

  private button(
    label: string,
    tone: string,
    onClick: () => void,
    iconHtml?: string
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mm-button mm-button-${tone.replace(/\s+/g, " mm-button-")}`;
    
    const iconDiv = document.createElement("div");
    iconDiv.className = "mm-button-icon";
    const iconClass = iconClassForLabel(label);
    if (iconClass) iconDiv.classList.add(`mm-icon-${iconClass}`);
    if (iconHtml) iconDiv.innerHTML = iconHtml;

    const labelDiv = document.createElement("div");
    labelDiv.className = "mm-button-label";
    labelDiv.textContent = label;

    button.append(iconDiv, labelDiv);
    button.addEventListener("click", onClick);
    return button;
  }

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement("div");
    footer.className = "mm-footer";
    footer.textContent = VERSION_LABEL;
    return footer;
  }

  private flash(message: string): void {
    if (!this.statusEl) return;
    const status = this.statusEl;
    status.textContent = message;
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      if (status.isConnected) {
        status.textContent = this.canContinue
          ? "A living run is waiting below."
          : "Choose a hero to begin your descent.";
      }
    }, 1600);
  }
}

function escapeText(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

function iconClassForLabel(label: string): string {
  switch (label) {
    case "Enter the Dungeon":
    case "New Game":
      return "enter";
    case "Run History":
    case "Rankings":
      return "rankings";
    case "Settings":
      return "prefs";
    case "About":
      return "shpx";
    case "Back":
      return "back";
    default:
      return "";
  }
}

function tag(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "mm-tag";
  span.textContent = text;
  return span;
}
