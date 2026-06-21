# AI Development Master Guide: Browser-Based Roguelike 

## 1. Project Mission & Tech Stack
We are building a deterministic, turn-based roguelike game inspired by the mechanics and depth of Shattered Pixel Dungeon. 
- **Language:** TypeScript
- **Environment:** Web Browser (Zero client-side installation for the user)
- **Framework:** HTML5 Canvas API (with Vite for hot-reloading)
- **Reference Material:** The original Shattered Pixel Dungeon Java repository is available locally. Use it strictly as a mathematical and logical blueprint. Translate its dungeon generation, formulas, and turn-queue logic into clean, modular TypeScript.

## 2. Core Directives for AI Agent (STRICT)
You are acting as the lead software engineer. The user is the product manager and does not write code. You must adhere to these absolute rules:

1. **The Lego Brick Strategy (Modularity):** Every class, module, or function must have a single responsibility. Decouple core game logic (grid math, combat formulas, turn state) entirely from rendering code (Canvas drawing, UI display).
2. **Living Memory (`architecture.md`):** You must maintain a file named `architecture.md` in the root directory. Every time a phase is completed, update it with a 2-3 sentence summary of the new systems, what files control them, and how they interact. **Read `architecture.md` before beginning any new task.**
3. **Logic Testing First:** Before rendering any core logic (grid math, FOV, turn queues) to the Canvas, write simple headless unit tests (e.g., using Vitest) or isolated console log validations. Ensure the math works perfectly before adding visuals.
4. **Deterministic RNG (Seeds):**固定 Implement a seeded pseudo-random number generator (PRNG) like Mulberry32. Every run must be tied to a master `GameSeed` string so the user can easily report specific seeds for bug replication.
5. **Data-Driven Content:** Do not hardcode enemy stats, item properties, spawn rates, or map size rules into TypeScript files. All game content must be loaded from external JSON configuration files so the user can balance the game easily.
6. **Event-Driven Audio:** Never trigger sound playback directly inside core math or combat calculation files. Use an Event Bus/Observer pattern. Logic classes emit an event (e.g., `Event.ENEMY_HIT`), and an isolated audio module handles the sound safely without breaking headless testing environments.
7. **Input Multiplexing:** Ensure the user interface (UI) layers intercept touch/mouse clicks completely so clicking a button does not accidentally trigger an auto-walk action on the game grid beneath it.
8. **Communication Protocol:** Present your work step-by-step. Explain what the code does in plain English. Provide the local Vite development URL and ask for explicit user approval before moving to the next file or phase.
9. **Strict Lifecycle Teardown (No Memory Leaks):** Every object that registers listeners on the `EventBus` or links to a global state manager must implement a explicit `.destroy()` or `.dispose()` method to completely unbind all references when a level changes.
10. **Pathfinding Optimization (Dijkstra/Scent Maps):** To prevent performance degradation when multiple enemies are tracking the player, do not run independent A* paths for every entity on every tick. Use cached path routing or single-source Dijkstra flow fields updated only when the player changes tiles.

---

## 3. The Roadmap

### Phase 0: Workspace & State Initialization
- **Action:** Scaffold a clean Vite + TypeScript project (`npm create vite@latest`).
- **Action:** Create the `architecture.md` file.
- **Action:** Set up a basic full-window HTML5 `<canvas>` element and a main game loop that scales dynamically to the browser window.

### Phase 1: Dungeon State & Input Management
- **The Dungeon:** Architect a `DungeonManager` class holding an array of 26 separate `Level` objects to support multi-floor state persistence (stairs going up and down must preserve floor states).
- **The Grid:** Build the 2D mathematical array representing the current map. Define core cell properties (Solid, Transparent, Walkable).
- **The Turn Queue:** Build a deterministic Priority Queue system where actions cost "ticks". The entity with the lowest tick count acts next.

### Phase 2: Procedural Generation (ProcGen)
- Translate the reference repository's Seed-based Binary Space Partitioning (BSP) and room-connection algorithms into TypeScript to carve rooms and corridors.
- *Visual Check:* Draw simple colored rectangles on the Canvas (e.g., Gray = Walls, White = Floors) to allow the user to visually confirm the map layouts.

### Phase 3: Field of View (FOV) & Basic AI
- Implement shadowcasting or raycasting for true line-of-sight calculation. Ensure vision does not leak through diagonal wall configurations.
- Implement a "Fog of War" memory state for previously explored tiles.
- Create an `Enemy` class with a basic state machine: Wander randomly, or Hunt (using optimized scent mapping) if the player is within their active FOV.

### Phase 3.5: JSON Data Loading & Content Pipelines
- Create a data-loading engine to ingest external configuration files.
- Create a `public/configs/` folder containing `enemies.json` and `items.json`.
- Refactor the `Enemy` and `Hero` creation logic to pull their maximum health, speed, and attributes exclusively from these JSON files.

### Phase 4: Entity Component System & Combat
- Decouple stats (Health, Evasion, Accuracy) into modular components.
- Write combat resolution logic using seed-based RNG dice rolls for damage.
- Create a modular inventory system array attached to the Player entity.

### Phase 5: Serialization (Save / Load)
- Implement `localStorage` serialization. Serialize the `DungeonManager` array, `Player` state, `Inventory`, and `Turn Queue` into a structured JSON string.
- Verify that refreshing the web page automatically reloads the exact floor, tile state, and health metrics.

### Phase 6: UI & Asset Hookup
- Build the HUD overlay (Health bars, combat log text, inventory modal) using clean HTML/CSS overlaid on top of the Canvas.
- Replace the placeholder Canvas colored blocks with actual sprite assets or spreadsheet-based tile regions.