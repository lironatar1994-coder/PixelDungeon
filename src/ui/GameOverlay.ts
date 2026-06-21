import type { EventBus } from "@/events/EventBus";
import type { ItemDef } from "@/core/data/types";
import type { SpriteKey, SpriteSheetAssets } from "@/render/AssetLoader";

export interface OverlayState {
  seed: string;
  depth: number;
  enemiesInSight: Array<{ name: string; hp: number; maxHealth: number; state: string }>;
  hero: {
    hp: number;
    maxHealth: number;
    accuracy: number;
    evasion: number;
    damageMin: number;
    damageMax: number;
    armor: number;
    weaponName: string;
    armorName: string;
    alive: boolean;
  };
  inventory: {
    capacity: number;
    items: readonly ItemDef[];
    equippedWeaponId: string | null;
    equippedArmorId: string | null;
  };
  log: readonly string[];
}

export interface OverlayActions {
  equip(itemId: string): boolean;
  consume(itemId: string): boolean;
  drop(itemId: string): boolean;
  wait(): boolean;
  quickslot(): void;
  restart(): void;
}

export class GameOverlay {
  private readonly root: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly utilityBar: HTMLDivElement;
  private readonly actionBar: HTMLDivElement;
  private readonly logBox: HTMLDivElement;
  private readonly inventoryPanel: HTMLDivElement;
  private readonly heroPanel: HTMLDivElement;
  private readonly helpPanel: HTMLDivElement;
  private readonly quickslotPanel: HTMLDivElement;
  private readonly gameOverPanel: HTMLDivElement;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly getState: () => OverlayState;
  private readonly actions: OverlayActions;
  private readonly assets?: SpriteSheetAssets;
  private inventoryOpen = false;
  private heroOpen = false;
  private helpOpen = false;
  private quickslotOpen = false;
  private actionBarRendered = false;
  private utilityBarRendered = false;
  private logLines: string[] = [];

  constructor(
    bus: EventBus,
    getState: () => OverlayState,
    actions: OverlayActions,
    assets?: SpriteSheetAssets,
  ) {
    this.getState = getState;
    this.actions = actions;
    this.assets = assets;
    this.root = document.createElement("div");
    this.root.id = "ui-overlay";
    this.root.innerHTML = `
      <section class="ui-hud ui-panel" data-ui-panel></section>
      <nav class="utility-bar" data-ui-panel aria-label="Hero and help"></nav>
      <section class="ui-log" data-ui-panel aria-live="polite"></section>
      <nav class="action-bar" data-ui-panel aria-label="Game actions"></nav>
      <section class="inventory-modal ui-panel" data-ui-panel hidden></section>
      <section class="hero-modal" data-ui-panel hidden></section>
      <section class="help-modal" data-ui-panel hidden></section>
      <section class="quickslot-popover ui-panel" data-ui-panel hidden></section>
      <section class="game-over-modal" data-ui-panel hidden></section>
    `;
    document.body.append(this.root);

    this.hud = this.mustQuery<HTMLDivElement>(".ui-hud");
    this.utilityBar = this.mustQuery<HTMLDivElement>(".utility-bar");
    this.actionBar = this.mustQuery<HTMLDivElement>(".action-bar");
    this.logBox = this.mustQuery<HTMLDivElement>(".ui-log");
    this.inventoryPanel = this.mustQuery<HTMLDivElement>(".inventory-modal");
    this.heroPanel = this.mustQuery<HTMLDivElement>(".hero-modal");
    this.helpPanel = this.mustQuery<HTMLDivElement>(".help-modal");
    this.quickslotPanel = this.mustQuery<HTMLDivElement>(".quickslot-popover");
    this.gameOverPanel = this.mustQuery<HTMLDivElement>(".game-over-modal");

    for (const panel of this.root.querySelectorAll<HTMLElement>("[data-ui-panel]")) {
      panel.addEventListener("pointerdown", (e) => e.stopPropagation());
      panel.addEventListener("click", (e) => e.stopPropagation());
    }

    this.unsubscribers.push(
      bus.on("loop:frame", () => this.render()),
      bus.on("combat:log", ({ line }) => {
        this.logLines.push(line);
        if (this.logLines.length > 80) this.logLines.shift();
        this.renderLog();
      }),
    );

    this.logLines = getState().log.slice(-80);
    this.render();
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.root.remove();
  }

  private mustQuery<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`Missing overlay element ${selector}`);
    return el;
  }

  private render(): void {
    const state = this.getState();
    this.renderHud(state);
    if (!this.utilityBarRendered) this.renderUtilityBar();
    if (!this.actionBarRendered) this.renderActionBar();
    this.renderLog();
    if (this.inventoryOpen) this.renderInventory(state);
    if (this.heroOpen) this.renderHero(state);
    if (this.helpOpen) this.renderHelp();
    if (this.quickslotOpen) this.renderQuickslot();
    this.renderGameOver(state);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      if (this.helpOpen || this.inventoryOpen || this.heroOpen || this.quickslotOpen) {
        e.preventDefault();
        this.closeModals();
        return true;
      }
      return false;
    }

    if (e.key === "Enter" && !this.getState().hero.alive) {
      e.preventDefault();
      this.restartRun();
      return true;
    }

    return (
      this.helpOpen ||
      this.inventoryOpen ||
      this.heroOpen ||
      this.quickslotOpen ||
      !this.getState().hero.alive
    );
  }

  private renderHud(state: OverlayState): void {
    const hpPct = state.hero.maxHealth > 0 ? Math.max(0, state.hero.hp / state.hero.maxHealth) : 0;
    this.hud.replaceChildren();

    const portrait = document.createElement("div");
    portrait.className = "hud-portrait";
    const portraitSprite = document.createElement("span");
    portraitSprite.className = "hud-portrait-sprite";
    const portraitStyle = this.assets?.cssStyleForSprite("heroPortrait", 3);
    if (portraitStyle) {
      Object.assign(portraitSprite.style, portraitStyle);
    } else {
      portraitSprite.textContent = "@";
    }
    portrait.append(portraitSprite);

    const vitals = document.createElement("div");
    vitals.className = "hud-vitals";
    const depth = document.createElement("div");
    depth.className = "depth-pill";
    depth.textContent = `Depth ${state.depth}`;

    const hp = document.createElement("div");
    hp.className = "hp-track";
    hp.setAttribute("aria-label", `Health ${state.hero.hp} of ${state.hero.maxHealth}`);
    hp.innerHTML = `<div class="hp-fill" style="width:${Math.round(hpPct * 100)}%"></div>`;

    vitals.append(depth, hp);
    this.hud.append(portrait, vitals);
  }

  private renderActionBar(): void {
    const left = document.createElement("div");
    left.className = "action-group action-group-left";
    left.append(this.actionButton("Wait", "uiWait", () => this.actions.wait()));

    const right = document.createElement("div");
    right.className = "action-group action-group-right";
    right.append(
      this.actionButton("Quickslot", "uiQuickslot", () => this.toggleQuickslot()),
      this.actionButton("Inventory", "uiInventory", () => this.toggleInventory()),
    );

    this.actionBar.replaceChildren(left, right);
    this.actionBarRendered = true;
  }

  private renderUtilityBar(): void {
    this.utilityBar.replaceChildren(
      this.actionButton("Hero", "uiHeroStats", () => this.toggleHero()),
      this.actionButton("Controls", "uiControls", () => this.toggleHelp()),
    );
    this.utilityBarRendered = true;
  }

  private renderLog(): void {
    const lines = this.logLines.slice(-8);
    this.logBox.replaceChildren();
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "log-line";
      row.textContent = line;
      this.logBox.append(row);
    }
  }

  private renderInventory(state: OverlayState): void {
    this.inventoryPanel.hidden = false;
    this.inventoryPanel.replaceChildren();

    const header = document.createElement("div");
    header.className = "inventory-header";
    header.innerHTML = `
      <div>
        <h2>Inventory</h2>
        <p>${state.inventory.items.length}/${state.inventory.capacity} carried</p>
      </div>
    `;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button";
    close.textContent = "X";
    close.addEventListener("click", () => {
      this.inventoryOpen = false;
      this.inventoryPanel.hidden = true;
    });
    header.append(close);

    const list = document.createElement("div");
    list.className = "inventory-list";

    if (state.inventory.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-inventory";
      empty.textContent = "Empty";
      list.append(empty);
    }

    for (const item of state.inventory.items) {
      list.append(this.renderItem(item, state));
    }

    this.inventoryPanel.append(header, list);
  }

  private renderHero(state: OverlayState): void {
    this.heroPanel.hidden = false;
    this.heroPanel.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "hero-frame";

    const header = document.createElement("div");
    header.className = "hero-header";
    header.innerHTML = `
      <div>
        <h2>Hero</h2>
        <p>Depth ${state.depth}</p>
      </div>
    `;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button";
    close.textContent = "X";
    close.addEventListener("click", () => {
      this.heroOpen = false;
      this.heroPanel.hidden = true;
    });
    header.append(close);

    const stats = document.createElement("div");
    stats.className = "hero-stat-grid";
    for (const [label, value] of [
      ["HP", `${state.hero.hp}/${state.hero.maxHealth}`],
      ["Accuracy", String(state.hero.accuracy)],
      ["Evasion", String(state.hero.evasion)],
      ["Damage", `${state.hero.damageMin}-${state.hero.damageMax}`],
      ["Armor", String(state.hero.armor)],
      ["Weapon", state.hero.weaponName],
      ["Armor Slot", state.hero.armorName],
    ] as const) {
      const row = document.createElement("div");
      row.className = "hero-stat-row";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("strong");
      val.textContent = value;
      row.append(key, val);
      stats.append(row);
    }

    frame.append(header, stats);
    this.heroPanel.append(frame);
  }

  private renderHelp(): void {
    this.helpPanel.hidden = false;
    this.helpPanel.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "help-frame";

    const header = document.createElement("div");
    header.className = "help-header";
    header.innerHTML = `
      <div>
        <h2>Controls</h2>
        <p>Keyboard commands for the current run</p>
      </div>
    `;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button";
    close.textContent = "X";
    close.addEventListener("click", () => {
      this.helpOpen = false;
      this.helpPanel.hidden = true;
    });
    header.append(close);

    const list = document.createElement("dl");
    list.className = "controls-list";
    for (const [key, action] of [
      ["WASD / Arrow Keys", "Move one tile, or bump an adjacent enemy to attack."],
      ["Q", "Quaff the first healing potion in your inventory."],
      ["> or .", "Descend stairs when standing on the exit."],
      ["< or ,", "Ascend stairs when standing on the entrance."],
      ["Inventory", "Equip, consume, or drop carried items."],
      ["Escape", "Close Inventory or Controls."],
      ["Enter", "Restart from the Game Over screen."],
    ] as const) {
      const term = document.createElement("dt");
      term.textContent = key;
      const detail = document.createElement("dd");
      detail.textContent = action;
      list.append(term, detail);
    }

    frame.append(header, list);
    this.helpPanel.append(frame);
  }

  private renderQuickslot(): void {
    this.quickslotPanel.hidden = false;
    this.quickslotPanel.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "quickslot-frame";

    const icon = document.createElement("span");
    icon.className = "quickslot-icon";
    const iconStyle = this.assets?.cssStyleForSprite("uiQuickslot", 2);
    if (iconStyle) {
      Object.assign(icon.style, iconStyle);
    } else {
      icon.textContent = "*";
    }

    const body = document.createElement("div");
    body.className = "quickslot-copy";
    const title = document.createElement("strong");
    title.textContent = "Quickslot";
    const detail = document.createElement("span");
    detail.textContent = "No item assigned";
    body.append(title, detail);

    frame.append(icon, body);
    this.quickslotPanel.append(frame);
  }

  private renderGameOver(state: OverlayState): void {
    if (state.hero.alive) {
      this.gameOverPanel.hidden = true;
      return;
    }

    this.inventoryOpen = false;
    this.quickslotOpen = false;
    this.inventoryPanel.hidden = true;
    this.quickslotPanel.hidden = true;
    this.gameOverPanel.hidden = false;
    this.gameOverPanel.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "game-over-frame";

    const title = document.createElement("h2");
    title.textContent = "Game Over";

    const meta = document.createElement("p");
    meta.textContent = `Depth reached: ${state.depth}`;

    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "restart-button";
    restart.textContent = "Restart Run";
    restart.addEventListener("click", () => this.restartRun());

    frame.append(title, meta, restart);
    this.gameOverPanel.append(frame);
  }

  private closeModals(): void {
    this.inventoryOpen = false;
    this.heroOpen = false;
    this.helpOpen = false;
    this.quickslotOpen = false;
    this.inventoryPanel.hidden = true;
    this.heroPanel.hidden = true;
    this.helpPanel.hidden = true;
    this.quickslotPanel.hidden = true;
  }

  private toggleInventory(): void {
    if (this.inventoryOpen) {
      this.closeModals();
      return;
    }
    this.closeModals();
    this.inventoryOpen = true;
    this.renderInventory(this.getState());
  }

  private toggleHero(): void {
    if (this.heroOpen) {
      this.closeModals();
      return;
    }
    this.closeModals();
    this.heroOpen = true;
    this.renderHero(this.getState());
  }

  private toggleHelp(): void {
    if (this.helpOpen) {
      this.closeModals();
      return;
    }
    this.closeModals();
    this.helpOpen = true;
    this.renderHelp();
  }

  private toggleQuickslot(): void {
    this.actions.quickslot();
    if (this.quickslotOpen) {
      this.closeModals();
      return;
    }
    this.closeModals();
    this.quickslotOpen = true;
    this.renderQuickslot();
  }

  private actionButton(
    label: string,
    sprite: SpriteKey,
    action: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = "action-icon";
    const iconStyle = this.assets?.cssStyleForSprite(sprite, 2);
    if (iconStyle) {
      Object.assign(icon.style, iconStyle);
    } else {
      icon.textContent = label.slice(0, 1);
    }
    const text = document.createElement("span");
    text.className = "action-label";
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener("click", action);
    return button;
  }

  private restartRun(): void {
    this.actions.restart();
    this.logLines = this.getState().log.slice(-80);
    this.gameOverPanel.hidden = true;
    this.closeModals();
    this.render();
  }

  private renderItem(item: ItemDef, state: OverlayState): HTMLElement {
    const row = document.createElement("article");
    row.className = "inventory-item";
    const equipped =
      item.id === state.inventory.equippedWeaponId || item.id === state.inventory.equippedArmorId;

    const icon = document.createElement("div");
    icon.className = "item-icon";
    const sprite = this.assets?.spriteForItem(item.id) ?? null;
    const iconStyle = sprite ? this.assets?.cssStyleForSprite(sprite, sprite === "healingPotion" ? 3 : 2) : null;
    if (iconStyle) {
      const spriteNode = document.createElement("div");
      spriteNode.className = "item-sprite";
      Object.assign(spriteNode.style, iconStyle);
      icon.append(spriteNode);
    } else {
      icon.textContent = item.name.slice(0, 1).toUpperCase();
    }

    const title = document.createElement("div");
    title.className = "item-title";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const type = document.createElement("span");
    type.textContent = equipped ? `${item.type} equipped` : item.type;
    title.append(name, type);

    const detail = document.createElement("div");
    detail.className = "item-detail";
    detail.textContent = itemDescription(item);

    const controls = document.createElement("div");
    controls.className = "item-controls";
    if (item.type === "weapon" || item.type === "armor") {
      controls.append(this.itemButton("Equip", () => this.actions.equip(item.id)));
    }
    if (item.type === "potion" || item.type === "food") {
      controls.append(this.itemButton("Consume", () => this.actions.consume(item.id)));
    }
    controls.append(this.itemButton("Drop", () => this.actions.drop(item.id)));

    row.append(icon, title, detail, controls);
    return row;
  }

  private itemButton(label: string, action: () => boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (action()) this.render();
    });
    return button;
  }
}

function itemDescription(item: ItemDef): string {
  if (item.type === "weapon") return `Damage +${item.damageMin ?? 0}-${item.damageMax ?? 0}`;
  if (item.type === "armor") return `Armor +${item.defense ?? 0}`;
  if (item.type === "potion") return `Heals ${item.heal ?? 0}`;
  if (item.type === "food") return "Ration";
  return "Miscellaneous";
}
