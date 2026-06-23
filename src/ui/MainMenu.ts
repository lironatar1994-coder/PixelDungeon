import type { HeroDef } from "@/core/data/types";
import type { RunHistoryRecord } from "@/core/save/HistoryManager";

export interface MainMenuActions {
  newGame(heroId: string): void;
  continueGame(): void;
}

type MenuView = "title" | "heroes" | "history";

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly scene: HTMLDivElement;
  private readonly titleView: HTMLDivElement;
  private readonly classPanel: HTMLElement;
  private readonly historyPanel: HTMLElement;
  private readonly heroes: readonly HeroDef[];
  private readonly history: readonly RunHistoryRecord[];
  private readonly actions: MainMenuActions;

  constructor(
    canContinue: boolean,
    heroes: readonly HeroDef[],
    history: readonly RunHistoryRecord[],
    actions: MainMenuActions,
  ) {
    this.heroes = heroes;
    this.history = history;
    this.actions = actions;

    this.root = document.createElement("div");
    this.root.id = "main-menu";
    this.root.setAttribute("role", "application");
    this.root.setAttribute("aria-label", "Main menu");

    this.scene = document.createElement("div");
    this.scene.className = "main-menu-scene";

    this.titleView = this.buildTitleView(canContinue);
    this.classPanel = this.buildClassPanel();
    this.historyPanel = this.buildHistoryPanel();

    this.scene.append(this.titleView, this.classPanel, this.historyPanel);
    this.root.append(this.scene, this.footer());
    document.body.append(this.root);
    this.show("title");
  }

  destroy(): void {
    this.root.remove();
  }

  private show(view: MenuView): void {
    this.root.dataset.view = view;
    this.titleView.hidden = view !== "title";
    this.classPanel.hidden = view !== "heroes";
    this.historyPanel.hidden = view !== "history";
  }

  private buildTitleView(canContinue: boolean): HTMLDivElement {
    const view = document.createElement("div");
    view.className = "main-title-view";

    const header = document.createElement("header");
    header.className = "main-title-header";

    const logo = document.createElement("div");
    logo.className = "main-logo";
    logo.setAttribute("aria-label", "Pixel Dungeon");
    logo.innerHTML = `
      <span>PIXEL</span>
      <span>DUNGEON</span>
    `;

    const glow = document.createElement("div");
    glow.className = "main-logo-glow";

    const torches = document.createElement("div");
    torches.className = "main-torches";
    torches.innerHTML = `<i></i><i></i>`;

    header.append(glow, logo, torches);

    const menu = document.createElement("nav");
    menu.className = "main-menu-buttons";
    menu.setAttribute("aria-label", "Main actions");

    if (canContinue) {
      menu.append(this.menuButton("ENTER THE DUNGEON", "primary", () => this.actions.continueGame()));
      menu.append(this.menuButton("NEW GAME", "secondary", () => this.show("heroes")));
    } else {
      menu.append(this.menuButton("ENTER THE DUNGEON", "primary", () => this.show("heroes")));
    }

    const paired = document.createElement("div");
    paired.className = "main-menu-button-row";
    paired.append(
      this.menuButton("RANKINGS", "secondary", () => this.show("history")),
      this.menuButton("HEROES", "secondary", () => this.show("heroes")),
    );

    const lower = document.createElement("div");
    lower.className = "main-menu-button-row";
    lower.append(
      this.menuButton("SETTINGS", "muted", () => this.flashUnavailable("Settings are not wired yet.")),
      this.menuButton("ABOUT", "muted", () => this.flashUnavailable("Browser roguelike prototype.")),
    );

    const status = document.createElement("p");
    status.className = "main-menu-status";
    status.textContent = canContinue ? "A living run is waiting." : "No living save found.";

    menu.append(paired, lower, status);
    view.append(header, menu);
    return view;
  }

  private buildClassPanel(): HTMLElement {
    const panel = this.windowPanel("Choose Your Hero", "Select a starting class.", () => this.show("title"));

    const list = document.createElement("div");
    list.className = "hero-select-list";

    for (const hero of this.heroes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `hero-select-card hero-${cssIdent(hero.id)}`;
      card.addEventListener("click", () => this.actions.newGame(hero.id));

      const portrait = document.createElement("span");
      portrait.className = "hero-select-portrait";
      portrait.setAttribute("aria-hidden", "true");

      const copy = document.createElement("span");
      copy.className = "hero-select-copy";

      const name = document.createElement("strong");
      name.textContent = hero.name;

      const stats = document.createElement("span");
      stats.textContent = `HP ${hero.maxHealth}  STR ${hero.strength}`;

      const detail = document.createElement("small");
      detail.textContent = hero.description || `Starts with ${hero.startingItems.join(", ")}`;

      copy.append(name, stats, detail);
      card.append(portrait, copy);
      list.append(card);
    }

    panel.append(list);
    return panel;
  }

  private buildHistoryPanel(): HTMLElement {
    const panel = this.windowPanel("Rankings", "Fallen heroes are remembered here.", () => this.show("title"));

    if (this.history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "No fallen heroes yet.";
      panel.append(empty);
      return panel;
    }

    const list = document.createElement("div");
    list.className = "history-list";
    this.history.forEach((run, index) => {
      const row = document.createElement("article");
      row.className = "history-row";

      const rank = document.createElement("strong");
      rank.textContent = `#${index + 1} ${run.class}  L${run.heroLevel}`;

      const cause = document.createElement("span");
      cause.textContent = `Depth ${run.depthReached} - slain by ${run.killerName}`;

      const inventory = document.createElement("small");
      inventory.textContent = run.inventoryItemIds.length > 0
        ? run.inventoryItemIds.join(", ")
        : "empty pack";

      row.append(rank, cause, inventory);
      list.append(row);
    });

    panel.append(list);
    return panel;
  }

  private windowPanel(titleText: string, subtitleText: string, onBack: () => void): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "main-subwindow";

    const header = document.createElement("header");
    header.className = "main-subwindow-header";

    const title = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = titleText;
    const subtitle = document.createElement("p");
    subtitle.textContent = subtitleText;
    title.append(heading, subtitle);

    const back = this.menuButton("BACK", "secondary", onBack);
    back.classList.add("main-back-button");

    header.append(title, back);
    panel.append(header);
    return panel;
  }

  private menuButton(
    label: string,
    tone: "primary" | "secondary" | "muted",
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `menu-button menu-button-${tone}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private footer(): HTMLDivElement {
    const footer = document.createElement("div");
    footer.className = "main-menu-footer";
    footer.innerHTML = `<span>v0.1</span><span>Codex Build</span>`;
    return footer;
  }

  private flashUnavailable(message: string): void {
    const status = this.titleView.querySelector<HTMLParagraphElement>(".main-menu-status");
    if (!status) return;
    status.textContent = message;
    window.setTimeout(() => {
      if (status.isConnected) status.textContent = "Select a command.";
    }, 1400);
  }
}

function cssIdent(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
}
