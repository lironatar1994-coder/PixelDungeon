import "./mainMenu.css";
import type { HeroDef } from "@/core/data/types";
import type { RunHistoryRecord } from "@/core/save/HistoryManager";

export interface MainMenuActions {
  newGame(heroId: string): void;
  continueGame(): void;
}

type MenuView = "title" | "heroes" | "history" | "about";

const VERSION_LABEL = "v0.1 · Codex Build";

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

    this.views.set("title", this.buildTitleView());
    this.views.set("heroes", this.buildHeroPanel());
    this.views.set("history", this.buildHistoryPanel());
    this.views.set("about", this.buildAboutPanel());
    for (const view of this.views.values()) this.scene.append(view);

    this.root.append(this.scene, this.buildFooter());
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
    logo.setAttribute("aria-label", "Dungeon Pixel — Swords and Magic");
    logo.innerHTML = `
      <span class="mm-logo-glow" aria-hidden="true"></span>
      <span class="mm-logo-line">DUNGEON</span>
      <span class="mm-logo-line">PIXEL</span>
      <span class="mm-logo-sub">Swords &amp; Magic</span>
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
  private buildHeroPanel(): HTMLElement {
    const panel = this.window("Choose Your Hero", "Each class begins the descent differently.");

    const list = document.createElement("div");
    list.className = "mm-hero-list";
    for (const hero of this.heroes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "mm-hero-card";
      card.innerHTML = `
        <span class="mm-hero-portrait" aria-hidden="true"></span>
        <span class="mm-hero-copy">
          <strong>${escapeText(hero.name)}</strong>
          <span class="mm-hero-stats">HP ${hero.maxHealth} · STR ${hero.strength}</span>
          <small>${escapeText(hero.description || `Starts with ${hero.startingItems.join(", ")}`)}</small>
        </span>
        <span class="mm-hero-go" aria-hidden="true">▶</span>
      `;
      card.addEventListener("click", () => this.actions.newGame(hero.id));
      list.append(card);
    }
    panel.append(list);
    return panel;
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
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mm-button mm-button-${tone.replace(/\s+/g, " mm-button-")}`;
    button.append(document.createTextNode(label));
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

function tag(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "mm-tag";
  span.textContent = text;
  return span;
}

function escapeText(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}
