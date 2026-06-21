# Architecture — Browser Roguelike

> **Living memory (Directive 2).** Read this file before starting any task.
> After completing each phase, append a 2–3 sentence summary of the new
> systems, the files that control them, and how they interact.

## Guiding Principles (from `ai-guide.md`)
1. **Lego Brick / Modularity** — core game logic is fully decoupled from
   rendering. `src/core/` and `src/events/` never import the DOM or canvas.
2. **Headless-testable logic** — logic is written so it can run under Vitest
   in a `node` environment, with browser APIs (clock, RAF) injected.
3. **Deterministic RNG** — every run will be seeded (Mulberry32, Phase 1).
4. **Data-driven content** — stats/spawns load from JSON in `public/configs/`.
5. **Event-driven** — subsystems communicate over the `EventBus`; logic never
   calls audio/render/UI directly.

> **Reference repo:** the original Shattered Pixel Dungeon Java source lives at
> `C:\Users\liron\shattered-pixel-dungeon-master` (outside this project so it
> never enters our git/build). Used as a math/logic blueprint only.

## Directory Layout
```
.
├── ai-guide.md              # The master spec (rules, directives, roadmap)
├── architecture.md          # This file — living memory
├── index.html               # Hosts the single full-window <canvas id="game">
├── package.json             # Scripts: dev / build / test
├── tsconfig.json            # Strict TypeScript, "@/*" -> src/* path alias
├── vite.config.ts           # Vite dev server + Vitest (node) config in one
├── public/
│   └── configs/             # Data-driven content (Directive 5)
│       ├── enemies.json     #   Rat / Zombie / Gnoll stat profiles
│       └── items.json       #   Weapon / armor / potion / food defs (for Phase 4)
└── src/
    ├── main.ts              # Composition root: async-loads content, wires all
    ├── style.css            # Full-viewport canvas reset (+ touch-action:none)
    ├── vite-env.d.ts        # Vite client type reference
    ├── core/                # Pure, headless game logic (NO browser imports)
    │   ├── GameLoop.ts      # Master clock; emits "loop:frame" with dt
    │   ├── data/
    │   │   ├── types.ts        # EnemyDef / ItemDef (validated shapes)
    │   │   ├── parse.ts        # Defensive parser: defaults + clamps + rejects
    │   │   ├── ContentDatabase.ts # Indexed defs + weighted depth spawn + fallback
    │   │   └── loadContent.ts  # Async fetch boundary (never throws -> defaults)
    │   ├── rng/
    │   │   └── Mulberry32.ts   # Seeded PRNG (RNG class) + string hashSeed()
    │   ├── grid/
    │   │   ├── terrain.ts      # Terrain enum + solid/walkable/transparent table
    │   │   ├── Grid.ts         # Flat 1D map (cell = x + y*width) + cell math
    │   │   └── Rect.ts         # Tile-space rectangle (partitions & rooms)
    │   ├── pathfinding/
    │   │   └── AStar.ts        # Generic A* (min-heap + Manhattan heuristic)
    │   ├── procgen/
    │   │   ├── BSP.ts          # Binary Space Partition tree + connection plan
    │   │   └── LevelGenerator.ts # BSP rooms + A* corridors + doors + stairs
    │   ├── fov/
    │   │   ├── ShadowCaster.ts # Recursive shadowcasting -> visible cell set
    │   │   ├── lineOfSight.ts  # Single Bresenham ray (enemy "can I see you?")
    │   │   └── FieldOfView.ts  # 3-state fog: visible / explored / unseen
    │   ├── turn/
    │   │   ├── Actor.ts        # Actor base: time/spend/actPriority (TICK=1)
    │   │   └── TurnQueue.ts    # Deterministic scheduler; lowest time acts next
    │   ├── actors/
    │   │   ├── Hero.ts         # Player Actor; yields queue until input buffered
    │   │   └── Enemy.ts        # Wander/Hunt state machine (LOS + A* chase)
    │   ├── game/
    │   │   └── GameWorld.ts    # Orchestrator: dungeon+queue+hero+enemies+FOV
    │   └── dungeon/
    │       ├── Level.ts        # One floor: grid + rooms + stairs + explored mem
    │       └── DungeonManager.ts # 26 lazy, cached, per-depth-seeded floors
    ├── events/
    │   └── EventBus.ts      # Type-safe pub/sub hub (Directive 6 backbone)
    ├── input/              # Pointer multiplexer (Directive 7)
    │   ├── PointerRouter.ts   # PURE headless UI-vs-world routing logic
    │   └── InputManager.ts    # DOM glue: canvas pointer events -> bus
    └── render/             # The ONLY place that touches the canvas
        ├── Renderer.ts        # DPR-aware resize/scaling; draws active scene
        ├── viewport.ts        # PURE screen<->tile math (shared w/ input)
        └── MapScene.ts        # Draws the floor as colored blocks (Phase 2)
```
(Each `core/` and `input/` logic file has a co-located `*.test.ts`.)

## Phase Log

### Phase 0 — Workspace & State Initialization ✅
Scaffolded a clean Vite + TypeScript workspace with Vitest wired for headless
logic tests. The architecture is built around an **`EventBus`**
([src/events/EventBus.ts](src/events/EventBus.ts)) so subsystems stay decoupled:
the **`GameLoop`** ([src/core/GameLoop.ts](src/core/GameLoop.ts)) owns time only
and emits a `loop:frame` event each tick (its clock/scheduler are injectable, so
it is unit-tested with a fake clock), while the **`Renderer`**
([src/render/Renderer.ts](src/render/Renderer.ts)) is the sole canvas owner —
it subscribes to `loop:frame`, keeps the drawing buffer matched to the window
size × device-pixel-ratio on resize, and draws a placeholder pulse.
[src/main.ts](src/main.ts) is the composition root that assembles these bricks.

**Next:** Phase 1 — `DungeonManager` (26 levels), the 2D grid with cell
properties (Solid/Transparent/Walkable), and the deterministic tick-based
turn queue.

### Phase 1 — Dungeon State & Input Management ✅
Built the deterministic core, translated from the SPD reference. The
**`RNG`** ([src/core/rng/Mulberry32.ts](src/core/rng/Mulberry32.ts)) is a
seeded Mulberry32 PRNG; a string `GameSeed` is hashed to its 32-bit state, so
identical seeds reproduce identical runs. The **`Grid`**
([src/core/grid/Grid.ts](src/core/grid/Grid.ts)) is a flat 1D map
(`cell = x + y*width`) deriving Solid/Walkable/Transparent from a terrain
table ([src/core/grid/terrain.ts](src/core/grid/terrain.ts)). The
**`TurnQueue`** ([src/core/turn/TurnQueue.ts](src/core/turn/TurnQueue.ts))
schedules **`Actor`**s ([src/core/turn/Actor.ts](src/core/turn/Actor.ts)) by
lowest `time`; acting "spends" time (fast = spends less = acts sooner), with
`(time, priority, seq)` ordering for full determinism (an improvement over
SPD's HashSet). The **`DungeonManager`**
([src/core/dungeon/DungeonManager.ts](src/core/dungeon/DungeonManager.ts))
holds 26 `Level`s, generated lazily and cached so stair travel preserves
floor state, each seeded per-depth via SPD's lookahead. Input is multiplexed
(Directive 7): the pure **`PointerRouter`**
([src/input/PointerRouter.ts](src/input/PointerRouter.ts)) gives UI layers
first refusal so taps never "click through" to the world, with
**`InputManager`** ([src/input/InputManager.ts](src/input/InputManager.ts))
as the DOM glue emitting `input:ui` / `input:world`. Floor generation
([src/core/dungeon/scaffold.ts](src/core/dungeon/scaffold.ts)) is a seeded
**placeholder** to be replaced by Phase 2 BSP. 34 headless tests pass,
including the required fast-vs-slow turn proof and floor-persistence proof.

**Next:** Phase 2 — translate SPD's seed-based BSP room/corridor carving into
`scaffold.ts`'s replacement, and add a Phase 2 map scene to the Renderer
(gray walls / white floors) for the visual check.

### Phase 2 — Procedural Generation (ProcGen) ✅
Replaced the Phase 1 placeholder with real seeded generation. **`BSP`**
([src/core/procgen/BSP.ts](src/core/procgen/BSP.ts)) recursively slices the
interior into partitions and carves one padded, distinct room per leaf, then
`planConnections` builds a spanning tree of room pairs. **`generateLevel`**
([src/core/procgen/LevelGenerator.ts](src/core/procgen/LevelGenerator.ts))
paints those rooms as FLOOR, digs 1-tile corridors between connected pairs
using **`findPath`** ([src/core/pathfinding/AStar.ts](src/core/pathfinding/AStar.ts),
a generic min-heap A* reused later for monster hunting), marks corridor/room
junctions as DOOR, and places the up/down stairs in the two farthest rooms —
all driven by the per-depth RNG, so a seed reproduces the floor exactly.
`DungeonManager` now calls this generator; `Level` gained a `rooms: Rect[]`
([src/core/grid/Rect.ts](src/core/grid/Rect.ts)) for future mob/loot placement.
Rendering: **`MapScene`** ([src/render/MapScene.ts](src/render/MapScene.ts))
draws the floor as native canvas blocks (cream floor / gray wall / brown door
+ green/red stairs, no assets per Directive 5), and **`viewport.ts`**
([src/render/viewport.ts](src/render/viewport.ts)) holds the pure screen<->tile
math shared by the renderer and the input multiplexer (a world tap selects the
tile beneath it; ↑/↓ travel floors). 53 headless tests pass, including BSP
determinism, non-overlapping rooms, and a flood-fill connectivity proof that
every room is reachable. Verified visually (9 rooms on floor 1, 12 on floor 5).

**Next:** Phase 3 — shadowcasting FOV + fog-of-war memory, and an `Enemy`
state machine (Wander / Hunt via the existing A*).

### Phase 3 — Field of View & Basic AI ✅
Added true line-of-sight and monster AI, all turn-based. **`computeFOV`**
([src/core/fov/ShadowCaster.ts](src/core/fov/ShadowCaster.ts)) is recursive
shadowcasting (8 octants, slope-tracked) translated from SPD; **`FieldOfView`**
([src/core/fov/FieldOfView.ts](src/core/fov/FieldOfView.ts)) tracks the 3-state
fog (visible/explored/unseen) with `explored` memory stored per-floor on
`Level` so it persists across stair travel. **`Enemy`**
([src/core/actors/Enemy.ts](src/core/actors/Enemy.ts)) is an Actor with a
Wander↔Hunt state machine: each turn it checks **`hasLineOfSight`**
([src/core/fov/lineOfSight.ts](src/core/fov/lineOfSight.ts)) to the hero,
switches to Hunt and chases via the existing A*, stopping adjacent, and spends
`TICK/speed` so fast monsters get proportionally more turns. **`Hero`**
([src/core/actors/Hero.ts](src/core/actors/Hero.ts)) yields the queue until
input is buffered. **`GameWorld`**
([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts)) ties it together:
`tryMoveHero` buffers a move, runs the queue until the hero yields (enemies get
their ticks), then recomputes FOV **once** — never per frame, satisfying the
optimization rule. Rendering: **`MapScene`**
([src/render/MapScene.ts](src/render/MapScene.ts)) shades each tile by fog
state and draws the hero (cyan) + visible enemies (amber wander / red hunt).
**`main.ts`** maps WASD/arrows to moves and `<`/`>` to stairs. 74 headless
tests pass, including the required Wander→Hunt-on-LOS and tick-cost proofs;
verified visually (an enemy detected the hero and chased it down a corridor).

**Next:** Phase 3.5 — JSON data pipeline (`public/configs/enemies.json` etc.),
moving hard-coded enemy speed/vision into data (Directive 5).

### Phase 3.5 — JSON Data Loading & Content Pipelines ✅
Made enemy content fully data-driven (Directive 5). Two configs live in
`public/configs/` (`enemies.json`: Sewer Rat / Rotting Zombie / Gnoll Scout;
`items.json`: weapon/armor/potion/food for Phase 4). The new `src/core/data/`
layer: **`parse.ts`** ([src/core/data/parse.ts](src/core/data/parse.ts)) is a
defensive parser that coerces every field with defaults + clamps and rejects
entries with no id — guaranteeing e.g. `speed > 0` so turn-queue math never
sees NaN/Infinity; **`ContentDatabase`**
([src/core/data/ContentDatabase.ts](src/core/data/ContentDatabase.ts)) indexes
the validated defs, does weighted depth-aware spawn selection, and falls back
to a built-in `DEFAULT_ENEMY` if a config is empty; **`loadContent.ts`**
([src/core/data/loadContent.ts](src/core/data/loadContent.ts)) is the async
fetch boundary that never throws (a failed file → defaults). `Enemy`
([src/core/actors/Enemy.ts](src/core/actors/Enemy.ts)) now takes an `EnemyDef`
(name/maxHealth/speed/vision all from JSON; no hard-coded stats), and
`GameWorld` ([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts)) spawns
via `randomEnemyForDepth` instead of hard-coded speed/vision. The HUD/labels in
`MapScene` show each visible enemy's loaded name + max health, proving the pipe
is live. The Phase 1 turn-queue math is unchanged. 88 headless tests pass,
including corruption-guard tests (missing id rejected, bad speed never ≤ 0,
non-array configs → empty, missing files → default enemy).

**Next:** Phase 4 — Entity Component System & Combat (decoupled stat
components, seed-based damage rolls, hero inventory).

### Phase 4 - Entity Component System & Combat COMPLETE
Added the lightweight ECS layer for combat: **`CombatStats`**
([src/core/combat/CombatStats.ts](src/core/combat/CombatStats.ts)) owns health,
accuracy, evasion, damage, armor, and removable modifiers; **`resolveAttack`**
([src/core/combat/resolveAttack.ts](src/core/combat/resolveAttack.ts)) performs
seeded hit/dodge/damage rolls; and **`Inventory`**
([src/core/items/Inventory.ts](src/core/items/Inventory.ts)) owns the hero's
bag and weapon/armor slots using loaded `items.json` data. **`GameWorld`**
([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts)) is the only combat
authority: bumping an enemy buffers a hero attack, monsters attack through the
same resolver, dead enemies leave the turn queue, healing potions are consumed
with `q` as a real hero turn, and rendering receives only a read-only view via
**`main.ts`** and **`MapScene`**.

The non-destructive stat modifier system works like stacking transparent
sheets over a character sheet: the base stats are copied once and never edited,
while equipment or timed effects add small tagged modifiers such as
`equip:weapon +2 damageMin`. Effective stats are calculated as `base + active
modifiers`, so unequipping armor or expiring a buff simply removes its tag and
the original numbers reappear without cumulative drift, double-apply bugs, or
manual rollback math. Production fallback enemy content was also upgraded with
Phase 4 combat fields so corrupt or missing JSON still produces a valid
headless game. 109 headless tests pass and `npm run build` is clean.

**Next:** Phase 5 - Serialization (save/load `DungeonManager`, hero state,
inventory, and turn queue into `localStorage`).

### Phase 5 - Serialization (Save / Load) COMPLETE
Added explicit snapshot/restore serialization so JSON never has to preserve
class prototypes. **`SaveManager`** ([src/core/save/SaveManager.ts](src/core/save/SaveManager.ts))
serializes a plain `GameWorldSnapshot` into a `Storage`-shaped adapter
(`localStorage` in the browser, mocks in tests), while **`GameWorld`**
([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts)) rehydrates fresh
`DungeonManager`, `Level`, `Grid`, `Hero`, `Enemy`, `Inventory`, and `TurnQueue`
instances from IDs, numbers, arrays, and component snapshots. The save schema
captures generated floors, terrain, explored memory, hero health/stats,
inventory/equipment, active enemies, queue timing/sequence, combat RNG state,
and enemy AI RNG state; it intentionally avoids closures and references such
as enemy senses/world callbacks so `JSON.stringify` stays circular-safe.
`main.ts` auto-loads saves on refresh unless `?seed=` requests a fresh
reproducible run, and auto-saves after turn resolution and stair travel.

### Phase 6 - UI & Asset Hookup COMPLETE
Moved complex HUD, combat log, and inventory UI out of canvas text and into a
DOM overlay. **`GameOverlay`** ([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts))
subscribes to the **`EventBus`** combat log event and frame ticks, renders
hero stats/equipment, a scrolling log, and an inventory modal, and calls
world-owned `equipItem`, `consumeItem`, and `dropItem` actions so UI clicks
never own game rules. **`style.css`** ([src/style.css](src/style.css)) fixes
the overlay to the viewport above the full-window canvas: the overlay root uses
`pointer-events: none`, while actual UI panels use `pointer-events: auto`, so
HTML controls intercept clicks without leaking dungeon clicks underneath.
**`AssetLoader`** ([src/render/AssetLoader.ts](src/render/AssetLoader.ts))
now loads the Shattered Pixel Dungeon sheets copied into `public/assets/`:
`tiles_sewers.png`, `warrior.png`, `rat.png`, `undead.png`, `items.png`, and
`item_icons.png`. It stores source rectangles per sprite key and checks each
sheet independently, so a missing mob sheet only falls back for that mob while
loaded terrain/items continue to render. **`MapScene`**
([src/render/MapScene.ts](src/render/MapScene.ts)) still paints the geometric
fallback first, then overlays sprites only when the specific sheet decoded.
The current SPD mappings are: floor `(0,0,16,16)`, flat wall `(0,48,16,16)`,
flat door `(128,48,16,16)`, entrance `(0,16,16,16)`, exit `(16,16,16,16)`,
warrior idle `(0,0,12,15)`, rat idle `(0,0,16,15)`, undead/zombie idle
`(0,0,12,16)`, short sword `(128,96,13,13)`, leather armor
`(16,176,14,13)`, ration `(80,432,16,12)`, and the exact healing-potion icon
from `item_icons.png` `(8,40,6,7)`. Direct TypeScript verification passes
under the current sandbox; the full npm/Vite CLI path is blocked here by
sandbox access to the user's NVM parent directory, but the local preview and
all asset URLs respond at `http://127.0.0.1:5173/`.

### Phase 6.1 - Game Over & Restart Loop COMPLETE
Closed the final combat-loop gap after hero death. **`GameOverlay`**
([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts)) now renders a blocking DOM
Game Over modal only when `hero.alive` is false, showing the depth reached and
a `Restart Run` button. The modal lives inside the same pointer-safe overlay
layer as the HUD, so clicks do not leak through to the dungeon canvas.
**`SaveManager`** ([src/core/save/SaveManager.ts](src/core/save/SaveManager.ts))
now treats dead worlds as unsaveable: `save()` clears storage instead of
persisting a dead snapshot, and `load()` refuses stale dead snapshots and wipes
them before returning `null`. **`main.ts`** ([src/main.ts](src/main.ts))
owns the browser reset boundary: restart clears the save, removes a fixed
`?seed=` URL if present, generates a fresh random run seed, creates a new
`GameWorld`, resets selection/log UI state, and keeps the existing canvas,
renderer, input handlers, asset loader, and overlay mounted.

### Phase 6.2 - App State Router & Main Menu COMPLETE
Packaged the browser shell into two explicit app states: `MainMenu` and
`Playing`. **`main.ts`** ([src/main.ts](src/main.ts)) now mounts the canvas,
renderer, input manager, asset loader, and loop once, then swaps DOM screens at
the browser boundary. `MainMenu` has no live `GameWorld`; `Playing` owns a
headless `GameWorld`, the canvas map scene, and the DOM HUD overlay. The new
**`MainMenu`** component ([src/ui/MainMenu.ts](src/ui/MainMenu.ts)) renders a
full-screen title screen with `New Game` and a conditional `Continue` button.
`New Game` clears existing saves before creating a fresh run, while `Continue`
appears only when **`SaveManager.hasValidRun`**
([src/core/save/SaveManager.ts](src/core/save/SaveManager.ts)) can rehydrate a
living, supported save snapshot; corrupt or dead saves are wiped and hidden.
The in-game **`GameOverlay`** now includes a toggleable Controls modal and
centralized keyboard UI hooks: `Escape` closes Inventory/Controls, modal state
swallows game-input keys, and `Enter` triggers the Game Over restart button.

### Phase 6.3 - Mobile Floating HUD COMPLETE
Refactored the browser UI to match a mobile roguelike layout without touching
core math or canvas rendering. **`style.css`** ([src/style.css](src/style.css))
now fixes the canvas to the full viewport and keeps `#ui-overlay` floating
above it with `pointer-events: none`; only interactive controls opt back into
pointer handling. **`GameOverlay`** ([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts))
now renders a minimal top-left status island with HP and depth only, a bottom
thumb-zone action bar for `Inventory`, `Hero`, and `Controls`, and a floating
semi-transparent combat log above the action bar. Raw stats and equipment names
were removed from the main HUD and moved into the new Hero modal.

### Phase 6.5 - Camera & Auto-walk COMPLETE
Added a hero-centered camera and tap-to-travel, all without touching core math.
**`viewport.ts`** ([src/render/viewport.ts](src/render/viewport.ts)) now exports
`computeCameraViewport` (focus-cell-centered, zoom from a target visible-tile
count, pan clamped so map edges never drift past the screen) and a matching
`pixelToCell` that is its exact inverse — `MapScene` and the input handler call
the same function, so screen↔grid translation can't drift across zoom/pan.
**`main.ts`** ([src/main.ts](src/main.ts)) orchestrates auto-walk: a tap routes
through `findPath` and then issues one `tryMoveHero` intent per ~0.08s step
(Pillar 1 — never mutating core directly). Travel cancels on any of: a hostile
in the hero's FOV (checked before start, each frame, and after each step), the
hero taking damage, the hero dying, or the player tapping again.

The damage-cancel is event-driven rather than polled: `GameWorld` fires an
injected **`onHeroDamaged`** callback ([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts))
from its single hero-damage chokepoint; `main.ts` bridges that to a typed
**`hero:damaged`** EventBus event ([src/events/EventBus.ts](src/events/EventBus.ts))
and subscribes to cancel auto-walk. Core stays free of any EventBus/DOM import —
the bridge lives only in the composition root, matching the existing
`onLog`→`combat:log` pattern. `SaveManager` forwards the new callback through
`load`/`parse`. 119 headless tests pass, including a combat-driven test that the
event fires with the correct `{ amount, source, hp }` payload.

### Phase 6.6 - Touch-to-Attack COMPLETE
Taps now mean attack as well as travel. The decision is a pure, generic
function **`planTap`** ([src/input/tapPlan.ts](src/input/tapPlan.ts)) that, given
the grid/hero/enemies/visibility, returns one of `attack` (a visible enemy is
orthogonally adjacent), `approach` (a visible enemy is out of melee range),
`travel` (an empty reachable tile), or `none`. `main.ts` executes the plan with
intents only (Pillar 1): `attack` issues a bump `tryMoveHero` toward the foe;
`approach` enters an auto-walk "approach mode" (`autoTarget`) that re-paths to
the enemy's live cell each step and stops the instant the hero is adjacent;
`travel` is the existing A* walk. Cancellation is mode-aware: plain travel aborts
on ANY visible hostile, while approach aborts only on a hostile *other* than the
target (`visibleHostileExists(except)`), so the tapped enemy doesn't cancel its
own pursuit; both still abort on damage (the `hero:damaged` event), death, or a
new tap. 128 headless tests pass (9 new `planTap` tests); verified live in the
browser (tapped an adjacent Sewer Rat → "You hit ... for 4" → kill).

### Phase 6.7 - Mobile UI Polish & Quickslots COMPLETE
Finished the mobile control pass with authentic sprite-backed DOM controls.
**`AssetLoader`** ([src/render/AssetLoader.ts](src/render/AssetLoader.ts)) now
loads the Shattered Pixel Dungeon interface sheets `toolbar.png` and `icons.png`
alongside the existing game sprites, with mapped UI rectangles for Inventory
`(160,0,16,16)`, Wait `(176,0,16,16)`, Quickslot frame `(86,0,20,24)`, Hero
Stats `(128,16,16,13)`, Controls `(112,16,15,12)`, and the base warrior
portrait `(1,0,12,15)`. Missing UI sheets still fail soft through the same
per-sprite fallback path as map assets.

**`GameOverlay`** ([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts)) now mounts a
stable icon-driven thumb-zone action bar instead of recreating buttons every
frame, renders a compact portrait + graphical HP bar HUD, and adds a Quickslot
popover shell that fires a UI command for future item assignment/use logic.
The DOM layer remains read-only: it receives overlay state, calls injected
actions, and emits/bridges events only through the browser composition root.
**`GameWorld.waitTurn()`** remains the single world-owned wait intent, while
**`Hero`** ([src/core/actors/Hero.ts](src/core/actors/Hero.ts)) now spends
`TICK / hero.stats.speed` for hero actions. **`CombatStats`**
([src/core/combat/CombatStats.ts](src/core/combat/CombatStats.ts)) gained a
modifier-compatible `speed` stat with a default of `1`, so haste/slow effects
can change turn timing without mutating base stats.

Verified with `npm test` (129 passing tests), `npm run build`, and a local
browser smoke test at `http://127.0.0.1:5173/`: the full-screen canvas stays
fixed, the overlay mounts cleanly, the action icons resolve from `toolbar.png`
and `icons.png`, the hero portrait resolves from `warrior.png`, Quickslot opens
its shell, and the browser console reports no errors.

### Phase 7.1 - Typography & Window Textures COMPLETE
Moved the DOM overlay closer to Shattered Pixel Dungeon's native UI without
touching `src/core/`. The authentic `pixel_font.ttf` and `chrome.png` were
copied from the SPD reference assets into `public/assets/`; tiny derived chrome
patches (`chrome_window.png`, `chrome_button_toast.png`,
`chrome_button_grey.png`, `chrome_button_red.png`) come from the exact
`Chrome.java` nine-patch rectangles: Window `(0,0,20,20, margin 6)`, Toast
button `(20,0,9,9, margin 4)`, Grey button `(38,6,6,6, margin 2)`, and Red
button `(38,0,6,6, margin 2)`.

**`style.css`** ([src/style.css](src/style.css)) now declares the pixel font
with `@font-face`, applies it to `#ui-overlay`/main menu text, and adds the
1px black text shadow used for readable pixel text over the dungeon. Window-like
DOM panels and buttons now use CSS `border-image` frames from the derived
chrome patches instead of flat CSS borders/backgrounds. The combat log was
reduced to transparent floating text with opacity tiers for older messages,
leaving the dungeon view unobstructed.

Verified with `npm test` (129 passing tests), `npm run build`, and a local
browser style check at `http://127.0.0.1:5173/`: `SPD Pixel` reports loaded,
panel/button border images resolve from chrome assets, the log background is
transparent, and the browser console reports no errors.

### Phase 7.2 - Mobile Responsive Overhaul COMPLETE
Refined the mobile overlay without touching `src/core/`. **`index.html`**
([index.html](index.html)) now uses the strict mobile viewport tag with
`maximum-scale=1.0`, `user-scalable=no`, and `viewport-fit=cover` so browser
zoom and notches do not distort the fixed canvas.

**`GameOverlay`** ([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts)) now splits
the bottom combat controls into two DOM flex groups: Wait on the left, and
Quickslot + Inventory on the right. Hero and Controls moved into a compact
top-right utility strip so the bottom thumb-zone no longer has to fit five
buttons on narrow screens. **`style.css`** ([src/style.css](src/style.css))
anchors the action bar flush to `bottom: 0`, uses safe-area padding, shrinks
button variables under 620px/400px, keeps the HUD in a bounded top-left flex
box, and leaves the combat log as transparent yellow/white floating text above
the action bar.

Verified with `tsc --noEmit` using the bundled Node runtime. Full `npm test`
and Vite build are currently blocked by the managed sandbox because the local
Node/NVM path and esbuild parent-directory probing are outside the permitted
filesystem roots; no TypeScript errors were reported.

### Phase 7.3 - Viewport Zoom & Idle Animations COMPLETE
Added independent dungeon zoom and real-time idle animation without touching
`src/core/`. **`viewport.ts`** ([src/render/viewport.ts](src/render/viewport.ts))
now accepts a clamped `zoomMultiplier` (`0.5x` to `3x`) in
`computeCameraViewport`; both `MapScene` drawing and `main.ts` tap-to-cell
conversion use that same multiplier, so zoomed rendering and input coordinates
stay aligned.

**`main.ts`** ([src/main.ts](src/main.ts)) owns the browser gesture state:
mouse wheel changes the camera multiplier on desktop, and two-finger
`touchstart`/`touchmove` adjusts it for pinch zoom on mobile. The DOM overlay is
not scaled. **`MapScene`** ([src/render/MapScene.ts](src/render/MapScene.ts))
uses render-frame elapsed time for actor idles, but only after the world has
been truly still for a short delay; movement, attacks, damage, depth changes,
selection changes, and log updates reset the idle timer. Hero and mob idles mix
subtle bob/squash motion with occasional alternate sprite frames so actors do
not all shift in lockstep.

Verified with `tsc --noEmit` using the bundled Node runtime. The managed
sandbox still blocks full Vite/Vitest execution because esbuild attempts to
inspect parent directories outside the permitted filesystem roots.

### Phase 8.1 - AI Adjacency Priority & Fleeing UX COMPLETE
Fixed the mob hunting decision tree in **`Enemy`**
([src/core/actors/Enemy.ts](src/core/actors/Enemy.ts)). A hunting mob now checks
Chebyshev distance to the hero before asking A* for a path. If the hero is in
melee range (`distance === 1`, including diagonals), the mob issues
`attackHero`; only non-adjacent targets go through pathfinding. This prevents
the parallel "copy the hero" step when a mob is already next to the player.

Added a focused headless regression in **`Enemy.test`**
([src/core/actors/Enemy.test.ts](src/core/actors/Enemy.test.ts)) proving a
diagonally adjacent hunter attacks immediately and does not move.

Updated the auto-walk orchestrator in **`main.ts`** ([src/main.ts](src/main.ts))
for fleeing UX. Starting travel now snapshots the deterministic `Enemy.seq` IDs
of all enemies already visible in the hero FOV. The travel loop continues past
those known threats, but cancels immediately if a newly visible hostile ID
appears, if movement fails, if the hero dies, or if the existing
`hero:damaged` event fires.

Verified with `tsc --noEmit` using the bundled Node runtime. A focused Vitest
run for `Enemy.test.ts` is currently blocked by the managed sandbox before tests
load because esbuild cannot read the parent directory while resolving
`vite.config.ts`; no TypeScript errors were reported.

**Next:** Manually smoke test mobile fleeing: with an already-visible chasing
mob, tap a safe floor tile and confirm auto-walk continues until damage, death,
blocked movement, or a newly revealed enemy appears.

### Phase 8.2 - Attack Speed Verification COMPLETE
Verified and corrected hero attack timing in the core turn queue. **`Hero`**
([src/core/actors/Hero.ts](src/core/actors/Hero.ts)) now computes action cost
per intent: movement/wait uses `TICK / hero.stats.speed`, while bump-attacks
use `(TICK * hero.stats.attackDelay) / hero.stats.speed`. This keeps hero haste
and weapon attack delay multiplicative instead of hardcoding every hero action
to one tick.

**`CombatStats`** ([src/core/combat/CombatStats.ts](src/core/combat/CombatStats.ts))
now exposes `attackDelay` as a modifier-backed stat with a safe default of `1`.
**`Inventory`** ([src/core/items/Inventory.ts](src/core/items/Inventory.ts))
applies an equipped weapon's optional `attackDelay` as an `equip:weapon`
modifier, so unequipping or swapping weapons cleanly restores the base delay.
**`parseItem`** ([src/core/data/parse.ts](src/core/data/parse.ts)) accepts and
clamps optional weapon `attackDelay` values from JSON content.

Added headless coverage for the stat layer, inventory equip/unequip behavior,
item parsing, and a `GameWorld` bump-attack regression that proves a
`0.5`-delay weapon with hero speed `2` schedules the hero's next turn at `0.25`.

Verified with `tsc --noEmit` using the bundled Node runtime. Vitest remains
blocked by the managed sandbox before tests load because esbuild cannot read the
parent directory while resolving `vite.config.ts`; no TypeScript errors were
reported.

### Phase 9.1 - Ranged Combat & Targeting Foundation COMPLETE
Added the first ranged-combat path while preserving the core/UI firewall.
**`lineOfFire`** ([src/core/fov/lineOfFire.ts](src/core/fov/lineOfFire.ts)) is
a pure Bresenham projectile ray utility. It returns the cells from shooter to
target and stops early when an intermediate cell is solid or when an injected
entity-blocker predicate reports a non-target actor in the way. Dedicated tests
cover clear rays, wall interruption, and intermediate entity blockers.

**`GameWorld.rangedAttack(targetCell)`** ([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts))
is now the single world-owned ranged intent. It refuses dead/out-of-bounds/no
target shots, checks `lineOfFire` against walls and intervening enemies, then
buffers a hero `rangedAttack` action through the normal turn queue. The actual
hit/damage calculation reuses the hero's current `CombatStats`, so equipped
weapon damage and attack-delay modifiers apply exactly like bump combat.

**`Hero`** ([src/core/actors/Hero.ts](src/core/actors/Hero.ts)) now treats
`rangedAttack` as an attack-speed action, spending
`(TICK * hero.stats.attackDelay) / hero.stats.speed`. Added headless
`GameWorld` coverage for a clear ranged shot killing a target and a blocked
shot refusing to spend a turn.

**`main.ts`** ([src/main.ts](src/main.ts)) owns the browser targeting state via
`TargetingMode`. Opening Quickslot activates ranged targeting; the next world
tap captures the screen-to-grid target cell, exits targeting mode, and calls
`world.rangedAttack(cell)` instead of running touch-to-walk/touch-to-attack.
Escape cancels targeting. **`GameOverlay`** ([src/ui/GameOverlay.ts](src/ui/GameOverlay.ts))
now fires the Quickslot action only when opening the quickslot shell, preventing
an accidental retarget when closing it.

Verified with `tsc --noEmit` using the bundled Node runtime. A focused Vitest
run for `lineOfFire.test.ts` and `GameWorld.test.ts` is still blocked by the
managed sandbox before tests load because esbuild cannot read the parent
directory while resolving `vite.config.ts`; no TypeScript errors were reported.

### Phase 9.2 - Visual Combat Feedback COMPLETE
Added combat punch without moving any game rules out of the pure core. The
requested direct `EventBus` emission from `resolveAttack.ts` was intentionally
implemented through the existing callback bridge instead: `resolveAttack`
remains a deterministic, side-effect-free math function, while **`GameWorld`**
([src/core/game/GameWorld.ts](src/core/game/GameWorld.ts)) raises
`onCombatStrike` after each resolved attack with attacker ID, defender ID,
source cell, target cell, hit/miss, and damage. **`main.ts`**
([src/main.ts](src/main.ts)) bridges that pure callback to the typed
`combat:strike` EventBus event.

**`EventBus`** ([src/events/EventBus.ts](src/events/EventBus.ts)) now includes
the `combat:strike` payload. **`MapScene`** ([src/render/MapScene.ts](src/render/MapScene.ts))
subscribes through the composition root via `queueCombatStrikeAnimation`, stores
render-only animation records, and computes temporary `pixelOffsetX` /
`pixelOffsetY` values at draw time. Actor grid coordinates never change. The
attacker lunges toward the defender direction for about `150ms` using an
ease-out/ease-back tween, then returns to zero offset.

`MapScene` also draws render-only floating combat text over the defender cell:
yellow damage numbers for hits and pale `MISS` text for misses. These popups
drift upward and fade over roughly `700ms`; they are not saved and do not touch
core state.

Verified with `tsc --noEmit` using the bundled Node runtime. A focused Vitest
run for `GameWorld.test.ts` remains blocked by the managed sandbox before tests
load because esbuild cannot read the parent directory while resolving
`vite.config.ts`; no TypeScript errors were reported.
