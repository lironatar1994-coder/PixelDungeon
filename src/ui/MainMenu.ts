import type { HeroDef } from "@/core/data/types";
import type { RunHistoryRecord } from "@/core/save/HistoryManager";

export interface MainMenuActions {
  newGame(heroId: string): void;
  continueGame(): void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly titleBlock: HTMLDivElement;
  private readonly actionsBox: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly classPanel: HTMLDivElement;
  private readonly historyPanel: HTMLDivElement;
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

    const panel = document.createElement("section");
    panel.className = "main-menu-panel";

    this.titleBlock = document.createElement("div");
    this.titleBlock.className = "main-menu-title";

    const kicker = document.createElement("div");
    kicker.className = "main-menu-kicker";
    kicker.textContent = "Turn-Based Roguelike";

    const title = document.createElement("h1");
    title.textContent = "Pixel Dungeon";

    const subtitle = document.createElement("p");
    subtitle.textContent = "Descend, survive, and keep what the dungeon allows.";

    this.titleBlock.append(kicker, title, subtitle);

    this.actionsBox = document.createElement("div");
    this.actionsBox.className = "main-menu-actions";

    if (canContinue) {
      const continueButton = document.createElement("button");
      continueButton.type = "button";
      continueButton.className = "menu-button menu-button-primary";
      continueButton.textContent = "Continue";
      continueButton.addEventListener("click", () => actions.continueGame());
      this.actionsBox.append(continueButton);
    }

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = canContinue ? "menu-button" : "menu-button menu-button-primary";
    newButton.textContent = "New Game";
    newButton.addEventListener("click", () => this.showClassSelection());
    this.actionsBox.append(newButton);

    const historyButton = document.createElement("button");
    historyButton.type = "button";
    historyButton.className = "menu-button";
    historyButton.textContent = "History";
    historyButton.addEventListener("click", () => this.showHistory());
    this.actionsBox.append(historyButton);

    this.note = document.createElement("p");
    this.note.className = "main-menu-note";
    this.note.textContent = canContinue
      ? "Continue restores the last living run. New Game wipes it."
      : "No living save found.";

    this.classPanel = document.createElement("div");
    this.classPanel.className = "class-select-panel";
    this.classPanel.hidden = true;
    this.classPanel.style.borderTop = "none";

    this.historyPanel = document.createElement("div");
    this.historyPanel.className = "history-panel";
    this.historyPanel.hidden = true;
    this.historyPanel.style.borderTop = "none";

    panel.append(this.titleBlock, this.actionsBox, this.classPanel, this.historyPanel, this.note);
    this.root.append(panel);
    document.body.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  private showMainView(): void {
    this.titleBlock.hidden = false;
    this.actionsBox.hidden = false;
    this.note.hidden = false;
    this.classPanel.hidden = true;
    this.historyPanel.hidden = true;
  }

  private showClassSelection(): void {
    this.titleBlock.hidden = true;
    this.actionsBox.hidden = true;
    this.note.hidden = true;
    this.historyPanel.hidden = true;
    this.classPanel.hidden = false;
    this.classPanel.replaceChildren();

    const headerBox = document.createElement("div");
    headerBox.style.display = "flex";
    headerBox.style.justifyContent = "space-between";
    headerBox.style.alignItems = "center";
    headerBox.style.marginBottom = "16px";

    const title = document.createElement("h2");
    title.textContent = "Choose Hero";
    title.style.margin = "0";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "menu-button";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => this.showMainView());

    headerBox.append(title, backBtn);
    this.classPanel.append(headerBox);

    const grid = document.createElement("div");
    grid.className = "class-select-grid";
    for (const hero of this.heroes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "class-card";
      card.innerHTML = `
        <strong>${escapeText(hero.name)}</strong>
        <span>HP ${hero.maxHealth} - STR ${hero.strength}</span>
        <small>${escapeText(hero.description || hero.startingItems.join(", "))}</small>
      `;
      card.addEventListener("click", () => this.actions.newGame(hero.id));
      grid.append(card);
    }
    this.classPanel.append(grid);
  }

  private showHistory(): void {
    this.titleBlock.hidden = true;
    this.actionsBox.hidden = true;
    this.note.hidden = true;
    this.classPanel.hidden = true;
    this.historyPanel.hidden = false;
    this.historyPanel.replaceChildren();

    const headerBox = document.createElement("div");
    headerBox.style.display = "flex";
    headerBox.style.justifyContent = "space-between";
    headerBox.style.alignItems = "center";
    headerBox.style.marginBottom = "16px";

    const title = document.createElement("h2");
    title.textContent = "Run History";
    title.style.margin = "0";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "menu-button";
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => this.showMainView());

    headerBox.append(title, backBtn);
    this.historyPanel.append(headerBox);

    if (this.history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "No fallen heroes yet.";
      this.historyPanel.append(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "history-list";
    for (const run of this.history) {
      const row = document.createElement("article");
      row.className = "history-row";
      const inventory = run.inventoryItemIds.length > 0
        ? run.inventoryItemIds.join(", ")
        : "empty pack";
      row.innerHTML = `
        <strong>${escapeText(run.class)} - L${run.heroLevel} - D${run.depthReached}</strong>
        <span>Fell to ${escapeText(run.killerName)}</span>
        <small>${escapeText(inventory)}</small>
      `;
      list.append(row);
    }
    this.historyPanel.append(list);
  }
}

function escapeText(text: string): string {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}
