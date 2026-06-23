import "./gameOverlay.css";
import type { EventBus } from "@/events/EventBus";
import type { InventoryItem } from "@/core/items/Inventory";
import {
  armorDamageReduction,
  meleeWeaponDamage,
  strengthRequirement,
} from "@/core/items/itemScaling";
import type { SpriteKey, SpriteSheetAssets } from "@/render/AssetLoader";

type InventoryTab = "all" | "equipment" | "consumables";
type LogTone = "neutral" | "positive" | "negative" | "warning" | "highlight";

export interface OverlayState {
  seed: string;
  depth: number;
  enemiesInSight: Array<{ name: string; hp: number; maxHealth: number; state: string }>;
  attackTarget: { name: string; sprite: SpriteKey } | null;
  pickupTarget: { name: string; sprite: SpriteKey } | null;
  hero: {
    hp: number;
    maxHealth: number;
    accuracy: number;
    evasion: number;
    damageMin: number;
    damageMax: number;
    armor: number;
    strength: number;
    level: number;
    experience: number;
    maxExperience: number;
    weaponName: string;
    armorName: string;
    sprite: SpriteKey;
    alive: boolean;
    causeOfDeath?: string;
  };
  inventory: {
    capacity: number;
    items: readonly InventoryItem[];
    equippedWeaponId: string | null;
    equippedArmorId: string | null;
  };
  log: readonly string[];
}

export interface OverlayActions {
  equip(itemUid: string): boolean;
  consume(itemUid: string): boolean;
  drop(itemUid: string): boolean;
  wait(): boolean;
  quickAttack(): boolean;
  quickslot(): void;
  look(): void;
  restart(): void;
  mainMenu(): void;
}

export class GameOverlay {
  private readonly root: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly utilityBar: HTMLDivElement;
  private readonly attackIndicator: HTMLButtonElement;
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
  private selectedInventoryItemId: string | null = null;
  private inventoryTab: InventoryTab = "all";
  private actionBarRendered = false;
  private utilityBarRendered = false;
  private quickslotGroup!: HTMLDivElement;
  private quickslotSig = "";
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
      <button class="attack-indicator" data-ui-panel type="button" aria-label="Attack" title="Attack" hidden></button>
      <section class="ui-log" aria-live="polite"></section>
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
    this.attackIndicator = this.mustQuery<HTMLButtonElement>(".attack-indicator");
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
    this.attackIndicator.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.actions.quickAttack();
      this.renderAttackIndicator(this.getState());
    });

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
    this.renderAttackIndicator(state);
    if (!this.utilityBarRendered) this.renderUtilityBar();
    if (!this.actionBarRendered) this.renderActionBar();
    this.renderQuickslots(state);
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
    const expPct = state.hero.maxExperience > 0
      ? Math.max(0, Math.min(1, state.hero.experience / state.hero.maxExperience))
      : 0;
    this.hud.replaceChildren();

    const level = document.createElement("div");
    level.className = "hud-level-badge";
    level.textContent = String(state.hero.level);

    const portrait = document.createElement("div");
    portrait.className = "hud-portrait";
    const portraitSprite = document.createElement("span");
    portraitSprite.className = "hud-portrait-sprite";
    const portraitStyle = this.assets?.cssStyleForSprite(portraitForHero(state.hero.sprite), 3);
    if (portraitStyle) {
      Object.assign(portraitSprite.style, portraitStyle);
    } else {
      portraitSprite.textContent = "@";
    }
    portrait.append(portraitSprite);

    const vitals = document.createElement("div");
    vitals.className = "hud-vitals";

    const topRow = document.createElement("div");
    topRow.className = "hud-top-row";
    const depth = document.createElement("div");
    depth.className = "depth-pill";
    depth.textContent = String(state.depth);
    topRow.append(depth);

    const inSight = state.enemiesInSight.length;
    if (inSight > 0) {
      const hunting = state.enemiesInSight.filter((e) => e.state === "hunt").length;
      const threat = document.createElement("div");
      threat.className = hunting > 0 ? "threat-chip threat-chip-active" : "threat-chip";
      threat.textContent = `${inSight} foe${inSight > 1 ? "s" : ""}`;
      threat.title = `${inSight} in sight${hunting > 0 ? `, ${hunting} hunting you` : ""}`;
      topRow.append(threat);
    }

    const hp = document.createElement("div");
    hp.className = "hp-track";
    hp.setAttribute("aria-label", `Health ${state.hero.hp} of ${state.hero.maxHealth}`);
    hp.innerHTML = `
      <div class="hp-fill" style="width:${Math.round(hpPct * 100)}%"></div>
      <span class="hp-text">${state.hero.hp}/${state.hero.maxHealth}</span>
    `;

    const exp = document.createElement("div");
    exp.className = "exp-track";
    exp.setAttribute("aria-label", `Experience ${state.hero.experience} of ${state.hero.maxExperience}`);
    exp.innerHTML = `
      <div class="exp-fill" style="width:${Math.round(expPct * 100)}%"></div>
      <span class="exp-text">${state.hero.experience}/${state.hero.maxExperience}</span>
    `;

    vitals.append(topRow, hp, exp);
    this.hud.append(portrait, level, vitals);
  }

  private renderActionBar(): void {
    const left = document.createElement("div");
    left.className = "action-group action-group-left";
    left.append(this.actionButton("Wait", "uiWait", () => this.actions.wait()));

    const center = document.createElement("div");
    center.className = "action-group action-group-center quickslot-bar";
    this.quickslotGroup = center;

    const right = document.createElement("div");
    right.className = "action-group action-group-right";
    right.append(
      this.actionButton("Look", "uiSearch", () => this.actions.look()),
      this.actionButton("Inventory", "uiInventory", () => this.toggleInventory()),
    );

    this.actionBar.replaceChildren(left, center, right);
    this.actionBarRendered = true;
    this.quickslotSig = "";
    this.renderQuickslots(this.getState());
  }

  /**
   * Quickslots: tappable shortcuts for the consumables in the bag (potions,
   * food), grouped by id with a count. Re-rendered only when the consumable
   * set changes so the bar doesn't thrash every frame. Tapping issues the
   * `consume` intent — no state mutation here (Pillar 1).
   */
  private renderQuickslots(state: OverlayState): void {
    if (!this.quickslotGroup) return;

    const grouped = new Map<string, { item: InventoryItem; count: number }>();
    for (const item of state.inventory.items) {
      if (item.type !== "potion" && item.type !== "food") continue;
      const entry = grouped.get(item.defId);
      if (entry) entry.count += item.quantity ?? 1;
      else grouped.set(item.defId, { item, count: item.quantity ?? 1 });
    }
    const slots = [...grouped.values()].slice(0, 6);
    const sig = slots.map((s) => `${s.item.defId}x${s.count}`).join(",");
    if (sig === this.quickslotSig) return;
    this.quickslotSig = sig;

    this.quickslotGroup.replaceChildren();
    const slotCount = 6;
    for (let i = 0; i < slotCount; i++) {
      const slot = slots[i];
      const button = document.createElement("button");
      button.type = "button";
      button.className = slot ? "quickslot-slot" : "quickslot-slot quickslot-empty";
      button.classList.add(
        i === 0 ? "quickslot-slot-first" : i === slotCount - 1 ? "quickslot-slot-last" : "quickslot-slot-middle",
      );
      if (!slot) {
        button.disabled = true;
        button.setAttribute("aria-hidden", "true");
        this.quickslotGroup.append(button);
        continue;
      }

      button.title = slot.item.name;
      button.setAttribute("aria-label", `Use ${slot.item.name}`);
      const sprite = this.assets?.spriteForItem(slot.item.defId) ?? null;
      const iconStyle = sprite
        ? this.assets?.cssStyleForSprite(
            sprite,
            sprite === "healingPotion" || sprite === "strengthPotion" ? 3 : 2,
          )
        : null;
      if (iconStyle) {
        const node = document.createElement("span");
        node.className = "quickslot-sprite";
        Object.assign(node.style, iconStyle);
        button.append(node);
      } else {
        button.textContent = slot.item.name.slice(0, 1).toUpperCase();
      }
      if (slot.count > 1) {
        const count = document.createElement("span");
        count.className = "quickslot-count";
        count.textContent = String(slot.count);
        button.append(count);
      }

      const id = slot.item.uid;
      button.addEventListener("click", () => {
        if (this.actions.consume(id)) this.render();
      });
      this.quickslotGroup.append(button);
    }
  }

  private renderAttackIndicator(state: OverlayState): void {
    const target = state.attackTarget ?? state.pickupTarget;
    const isPickup = state.attackTarget === null && state.pickupTarget !== null;
    this.attackIndicator.hidden = target === null || !state.hero.alive;
    this.attackIndicator.classList.toggle("attack-indicator-pickup", isPickup);
    this.attackIndicator.setAttribute("aria-label", isPickup ? "Pick up" : "Attack");
    this.attackIndicator.title = target
      ? isPickup
        ? `Pick up ${target.name}`
        : `Attack ${target.name}`
      : "Action";
    this.attackIndicator.replaceChildren();
    if (!target || !state.hero.alive) return;

    const sprite = document.createElement("span");
    sprite.className = "attack-indicator-sprite";
    const style = this.assets?.cssStyleForSprite(target.sprite, 2);
    if (style) {
      Object.assign(sprite.style, style);
    } else {
      sprite.textContent = "!";
    }
    this.attackIndicator.append(sprite);
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
      const parsed = parseLogLine(line);
      const row = document.createElement("div");
      row.className = `log-line log-line-${parsed.tone}`;
      row.textContent = parsed.text;
      this.logBox.append(row);
    }
  }

  private renderInventory(state: OverlayState): void {
    this.inventoryPanel.hidden = false;
    this.inventoryPanel.replaceChildren();

    const selectedItem = this.selectedInventoryItemId
      ? state.inventory.items.find((item) => item.uid === this.selectedInventoryItemId) ?? null
      : null;
    if (!selectedItem) this.selectedInventoryItemId = null;

    const header = document.createElement("div");
    header.className = "inventory-header";
    const title = document.createElement("div");
    title.className = "inventory-title";
    const heading = document.createElement("h2");
    heading.textContent = "Backpack";
    title.append(heading);

    const purse = document.createElement("div");
    purse.className = "inventory-purse";
    purse.innerHTML = `<strong>0</strong><span class="coin-dot" aria-hidden="true"></span>`;
    header.append(title, purse);

    const weapon = state.inventory.equippedWeaponId
      ? state.inventory.items.find((item) => item.uid === state.inventory.equippedWeaponId) ?? null
      : null;
    const armor = state.inventory.equippedArmorId
      ? state.inventory.items.find((item) => item.uid === state.inventory.equippedArmorId) ?? null
      : null;

    const list = document.createElement("div");
    list.className = "inventory-grid";
    list.append(
      this.renderInventorySlot({
        label: "Weapon",
        item: weapon,
        placeholder: "shortSword",
        equipped: weapon !== null,
        selected: selectedItem?.uid === weapon?.uid,
      }),
      this.renderInventorySlot({
        label: "Armor",
        item: armor,
        placeholder: "leatherArmor",
        equipped: armor !== null,
        selected: selectedItem?.uid === armor?.uid,
      }),
      this.renderInventorySlot({ label: "Artifact", item: null, placeholder: "strengthPotion", muted: true }),
      this.renderInventorySlot({ label: "Ring", item: null, placeholder: "healingPotion", muted: true }),
      this.renderInventorySlot({ label: "Misc", item: null, placeholder: "ration", muted: true }),
    );

    const visibleItems = groupedInventoryItems(state, this.inventoryTab);
    for (const entry of visibleItems) {
      list.append(this.renderInventorySlot({
        label: entry.item.name,
        item: entry.item,
        count: entry.count,
        equipped: entry.item.uid === state.inventory.equippedWeaponId || entry.item.uid === state.inventory.equippedArmorId,
        selected: selectedItem?.uid === entry.item.uid,
      }));
    }
    for (let i = visibleItems.length; i < state.inventory.capacity; i++) {
      list.append(this.renderInventorySlot({ label: "Empty", item: null }));
    }

    const tabs = document.createElement("nav");
    tabs.className = "bag-tabs";
    tabs.setAttribute("aria-label", "Inventory filters");
    for (const [tab, label, sprite] of [
      ["all", "Backpack", "uiInventory"],
      ["equipment", "Equipment", "shortSword"],
      ["consumables", "Consumables", "healingPotion"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = tab === this.inventoryTab ? "bag-tab bag-tab-active" : "bag-tab";
      button.title = label;
      button.setAttribute("aria-label", label);
      const style = this.assets?.cssStyleForSprite(sprite, 2);
      if (style) {
        const icon = document.createElement("span");
        icon.className = "bag-tab-icon";
        Object.assign(icon.style, style);
        button.append(icon);
      } else {
        button.textContent = label.slice(0, 1);
      }
      button.addEventListener("click", () => {
        this.inventoryTab = tab;
        this.renderInventory(this.getState());
      });
      tabs.append(button);
    }

    this.inventoryPanel.append(header, list, tabs);
    if (selectedItem) {
      this.inventoryPanel.append(this.renderItemActionCard(selectedItem, state));
    }
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
      ["Level", String(state.hero.level)],
      ["EXP", `${state.hero.experience}/${state.hero.maxExperience}`],
      ["Strength", String(state.hero.strength)],
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
    detail.textContent = "Tap a target to fire";
    body.append(title, detail);

    frame.append(icon, body);
    this.quickslotPanel.append(frame);
  }

  private renderGameOver(state: OverlayState): void {
    if (state.hero.alive) {
      this.gameOverPanel.hidden = true;
      return;
    }

    if (!this.gameOverPanel.hidden) {
      return; // Already rendered!
    }

    this.inventoryOpen = false;
    this.quickslotOpen = false;
    this.inventoryPanel.hidden = true;
    this.quickslotPanel.hidden = true;
    this.gameOverPanel.hidden = false;
    this.gameOverPanel.replaceChildren();

    const frame = document.createElement("div");
    frame.className = "go-frame";

    const banner = document.createElement("div");
    banner.className = "go-banner go-banner-fallback";
    const bannerScale = Math.min(4, Math.max(2.25, (this.root.clientWidth - 48) / 128));
    const bannerStyle = this.assets?.cssStyleForSprite("gameOverBanner", bannerScale);
    if (bannerStyle) {
      banner.classList.remove("go-banner-fallback");
      Object.assign(banner.style, bannerStyle);
      banner.setAttribute("aria-label", "Game Over");
    } else {
      banner.textContent = "Game Over";
    }
    frame.append(banner);

    if (state.hero.causeOfDeath) {
      const cause = document.createElement("p");
      cause.className = "go-cause";
      cause.textContent = state.hero.causeOfDeath;
      frame.append(cause);
    }

    const buttons = document.createElement("div");
    buttons.className = "go-buttons";
    const newGame = this.goButton("New Game", "go-button-primary", "uiEnter", () => this.restartRun());
    const menu = this.goButton("Menu", "go-button", "uiPrefs", () => this.actions.mainMenu());
    buttons.append(newGame, menu);

    frame.append(buttons);
    this.gameOverPanel.append(frame);
  }

  private goButton(label: string, tone: string, iconSprite: "uiEnter" | "uiPrefs", onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `go-button ${tone}`;

    const iconBox = document.createElement("span");
    iconBox.className = "go-button-icon-box";
    const icon = document.createElement("span");
    icon.className = "go-button-icon";
    const iconStyle = this.assets?.cssStyleForSprite(iconSprite, 2);
    if (iconStyle) {
      Object.assign(icon.style, iconStyle);
    } else {
      icon.textContent = iconSprite === "uiEnter" ? ">" : "*";
    }
    iconBox.append(icon);

    const text = document.createElement("span");
    text.className = "go-button-label";
    text.textContent = label;

    button.append(iconBox, text);
    button.addEventListener("click", onClick);
    return button;
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

  private actionButton(
    label: string,
    sprite: SpriteKey,
    action: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button action-button-${sprite}`;
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

  private renderInventorySlot(opts: {
    label: string;
    item: InventoryItem | null;
    placeholder?: SpriteKey;
    count?: number;
    equipped?: boolean;
    selected?: boolean;
    muted?: boolean;
  }): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-slot";
    button.classList.toggle("inventory-slot-equipped", opts.equipped === true);
    button.classList.toggle("inventory-slot-selected", opts.selected === true);
    button.classList.toggle("inventory-slot-muted", opts.muted === true);
    button.title = opts.item?.name ?? opts.label;
    button.setAttribute("aria-label", opts.item?.name ?? opts.label);

    const sprite = opts.item
      ? this.assets?.spriteForItem(opts.item.defId) ?? this.assets?.spriteForItemType(opts.item.type)
      : opts.placeholder ?? null;
    const scale = sprite === "healingPotion" || sprite === "strengthPotion" ? 3 : 2;
    const style = sprite ? this.assets?.cssStyleForSprite(sprite, scale) : null;
    if (style) {
      const icon = document.createElement("span");
      icon.className = "inventory-slot-sprite";
      Object.assign(icon.style, style);
      button.append(icon);
    } else if (opts.item) {
      button.textContent = opts.item.name.slice(0, 1).toUpperCase();
    }

    if (opts.item) {
      const top = inventoryTopBadge(opts.item, opts.count ?? 1);
      if (top) {
        const badge = document.createElement("span");
        badge.className = "slot-badge slot-badge-top";
        badge.textContent = top;
        button.append(badge);
      }
      const bottom = inventoryBottomBadge(opts.item);
      if (bottom) {
        const badge = document.createElement("span");
        badge.className = "slot-badge slot-badge-bottom";
        badge.textContent = bottom;
        button.append(badge);
      }
      button.addEventListener("click", () => {
        this.selectedInventoryItemId =
          this.selectedInventoryItemId === opts.item!.uid ? null : opts.item!.uid;
        this.renderInventory(this.getState());
      });
    } else {
      button.disabled = true;
    }

    return button;
  }

  private renderItemActionCard(item: InventoryItem, state: OverlayState): HTMLElement {
    const card = document.createElement("article");
    card.className = "item-action-card";

    const icon = document.createElement("div");
    icon.className = "item-action-icon";
    const sprite = this.assets
      ? this.assets.spriteForItem(item.defId) ?? this.assets.spriteForItemType(item.type)
      : null;
    const style = sprite
      ? this.assets?.cssStyleForSprite(
          sprite,
          sprite === "healingPotion" || sprite === "strengthPotion" ? 4 : 3,
        )
      : null;
    if (style) {
      const node = document.createElement("span");
      node.className = "item-sprite";
      Object.assign(node.style, style);
      icon.append(node);
    } else {
      icon.textContent = item.name.slice(0, 1).toUpperCase();
    }

    const copy = document.createElement("div");
    copy.className = "item-action-copy";
    const title = document.createElement("h3");
    title.textContent = item.name;
    const detail = document.createElement("p");
    detail.textContent = itemLongDescription(item);
    copy.append(title, detail);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "item-card-close";
    close.textContent = "X";
    close.setAttribute("aria-label", "Close item actions");
    close.addEventListener("click", () => {
      this.selectedInventoryItemId = null;
      this.renderInventory(this.getState());
    });

    const controls = document.createElement("div");
    controls.className = "item-action-controls";
    const equipped = item.uid === state.inventory.equippedWeaponId || item.uid === state.inventory.equippedArmorId;
    if ((item.type === "weapon" || item.type === "armor") && !equipped) {
      controls.append(this.itemButton("Equip", () => this.actions.equip(item.uid)));
    }
    if (item.type === "potion") {
      controls.append(this.itemButton("Quaff", () => this.actions.consume(item.uid)));
    } else if (item.type === "food") {
      controls.append(this.itemButton("Eat", () => this.actions.consume(item.uid)));
    }
    controls.append(this.itemButton("Drop", () => this.actions.drop(item.uid)));

    card.append(icon, copy, close, controls);
    return card;
  }

  private itemButton(label: string, action: () => boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-action-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (action()) {
        this.selectedInventoryItemId = null;
        this.render();
      }
    });
    return button;
  }
}

function groupedInventoryItems(
  state: OverlayState,
  tab: InventoryTab,
): Array<{ item: InventoryItem; count: number }> {
  const equippedIds = new Set(
    [state.inventory.equippedWeaponId, state.inventory.equippedArmorId].filter(
      (id): id is string => id !== null,
    ),
  );
  const grouped = new Map<string, { item: InventoryItem; count: number }>();
  for (const item of state.inventory.items) {
    if (equippedIds.has(item.uid)) continue;
    if (tab === "equipment" && item.type !== "weapon" && item.type !== "armor") continue;
    if (tab === "consumables" && item.type !== "potion" && item.type !== "food") continue;
    const existing = grouped.get(item.defId);
    if (existing) existing.count += item.quantity ?? 1;
    else grouped.set(item.defId, { item, count: item.quantity ?? 1 });
  }
  return [...grouped.values()];
}

function inventoryTopBadge(item: InventoryItem, count: number): string {
  if (count > 1) return String(count);
  if (item.type === "weapon" || item.type === "armor") {
    return `:${strengthRequirement(item.def, item)}`;
  }
  if (item.type === "potion" && typeof item.def.heal === "number") return `${item.def.heal}`;
  return "";
}

function inventoryBottomBadge(item: InventoryItem): string {
  if (item.type === "weapon") return `+${meleeWeaponDamage(item.def, item).damageMax}`;
  if (item.type === "armor") return `+${armorDamageReduction(item.def, item).drMax}`;
  if (item.type === "potion" && typeof item.def.strengthBonus === "number") return `+${item.def.strengthBonus}`;
  return "";
}

function itemDescription(item: InventoryItem): string {
  const level = item.levelKnown ? `+${item.level}` : "unidentified";
  const strength = item.type === "weapon" || item.type === "armor"
    ? `, STR ${strengthRequirement(item.def, item)}`
    : "";
  if (item.type === "weapon") {
    const damage = meleeWeaponDamage(item.def, item);
    return `Damage ${damage.damageMin}-${damage.damageMax}, ${level}${strength}`;
  }
  if (item.type === "armor") {
    const armor = armorDamageReduction(item.def, item);
    return `Armor ${armor.drMin}-${armor.drMax}, ${level}${strength}`;
  }
  if (item.type === "potion" && typeof item.def.strengthBonus === "number") {
    return `Strength +${item.def.strengthBonus}`;
  }
  if (item.type === "potion") return `Heals ${item.def.heal ?? 0}`;
  if (item.type === "food") return "Ration";
  return "Miscellaneous";
}

function itemLongDescription(item: InventoryItem): string {
  const description = typeof item.def.description === "string" ? item.def.description : "";
  const mechanics = itemDescription(item);
  return description ? `${description} ${mechanics}.` : mechanics;
}

function portraitForHero(sprite: SpriteKey): SpriteKey {
  return sprite === "mageHero" ? "magePortrait" : "heroPortrait";
}

function parseLogLine(line: string): { text: string; tone: LogTone } {
  const prefix = line.slice(0, 2);
  const text = line.slice(2).trimStart();
  if (prefix === "++") return { text, tone: "positive" };
  if (prefix === "--") return { text, tone: "negative" };
  if (prefix === "**") return { text, tone: "warning" };
  if (prefix === "@@") return { text, tone: "highlight" };
  return { text: line, tone: "neutral" };
}
