export interface MainMenuActions {
  newGame(): void;
  continueGame(): void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;

  constructor(canContinue: boolean, actions: MainMenuActions) {
    this.root = document.createElement("div");
    this.root.id = "main-menu";

    const panel = document.createElement("section");
    panel.className = "main-menu-panel";

    const titleBlock = document.createElement("div");
    titleBlock.className = "main-menu-title";

    const kicker = document.createElement("div");
    kicker.className = "main-menu-kicker";
    kicker.textContent = "Turn-Based Roguelike";

    const title = document.createElement("h1");
    title.textContent = "Pixel Dungeon";

    const subtitle = document.createElement("p");
    subtitle.textContent = "Descend, survive, and keep what the dungeon allows.";

    titleBlock.append(kicker, title, subtitle);

    const actionsBox = document.createElement("div");
    actionsBox.className = "main-menu-actions";

    if (canContinue) {
      const continueButton = document.createElement("button");
      continueButton.type = "button";
      continueButton.className = "menu-button menu-button-primary";
      continueButton.textContent = "Continue";
      continueButton.addEventListener("click", () => actions.continueGame());
      actionsBox.append(continueButton);
    }

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = canContinue ? "menu-button" : "menu-button menu-button-primary";
    newButton.textContent = "New Game";
    newButton.addEventListener("click", () => actions.newGame());
    actionsBox.append(newButton);

    const note = document.createElement("p");
    note.className = "main-menu-note";
    note.textContent = canContinue
      ? "Continue restores the last living run. New Game wipes it."
      : "No living save found.";

    panel.append(titleBlock, actionsBox, note);
    this.root.append(panel);
    document.body.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
