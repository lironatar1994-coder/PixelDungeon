/**
 * main.ts - the browser composition root.
 *
 * This is the ONE place where browser-facing pieces and core systems meet. The
 * app has two states:
 *   - MainMenu: DOM-only title screen, no live GameWorld.
 *   - Playing: headless GameWorld + canvas map + DOM overlay.
 *
 * The canvas, renderer, input manager, asset loader, and loop are mounted once.
 * DOM screens are swapped at the app boundary without pushing UI state into the
 * core engine.
 */
import "./style.css";
import { EventBus } from "@/events/EventBus";
import { initializeTelemetry } from "@/events/TelemetryManager";
import { AudioManager } from "@/audio/AudioManager";
import { GameLoop } from "@/core/GameLoop";
import { Renderer } from "@/render/Renderer";
import {
  clearCombatAnimations,
  drawMapScene,
  queueCombatStrikeAnimation,
  type MapView,
} from "@/render/MapScene";
import { AssetLoader, type SpriteKey } from "@/render/AssetLoader";
import {
  clampZoomMultiplier,
  computeCameraViewport,
  pixelToCell,
  MAP_TOP_INSET,
} from "@/render/viewport";
import {
  GameWorld,
  type CombatStrikeInfo,
  type HeroDamagedInfo,
} from "@/core/game/GameWorld";
import type { Enemy } from "@/core/actors/Enemy";
import { loadContentDatabase } from "@/core/data/loadContent";
import { SaveManager } from "@/core/save/SaveManager";
import { HistoryManager } from "@/core/save/HistoryManager";
import { findPath } from "@/core/pathfinding/AStar";
import { planTap } from "@/input/tapPlan";
import { InputManager } from "@/input/InputManager";
import { rectLayer } from "@/input/PointerRouter";
import { GameOverlay, type OverlayState } from "@/ui/GameOverlay";
import { MainMenu } from "@/ui/MainMenu";

type AppState = "MainMenu" | "Playing";
type TargetingMode = "ranged";
const AUTO_WALK_STEP_SECONDS = 0.08;
const WHEEL_ZOOM_STEP = 0.0015;
const PINCH_ZOOM_SENSITIVITY = 1;

function createRunSeed(): string {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  return `RUN-${Date.now().toString(36).toUpperCase()}-${random[0]!.toString(36).toUpperCase()}${random[1]!.toString(36).toUpperCase()}`;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) {
    throw new Error('Missing <canvas id="game"> in index.html');
  }

  const bus = new EventBus();
  const teardownTelemetry = initializeTelemetry(bus);
  const audio = new AudioManager(bus);
  const content = await loadContentDatabase(`${import.meta.env.BASE_URL}configs`);
  console.info(
    `[content] loaded ${content.allEnemies.length} enemy types, ${content.allItems.length} item types`,
  );
  console.info(
    `[content] heroes: ${content.allHeroes.map((h) => h.name).join(", ")}`,
  );
  console.info(
    `[content] enemies: ${content.allEnemies
      .map((e) => `${e.name}(${e.maxHealth}hp,spd${e.speed})`)
      .join(", ")}`,
  );

  let requestedSeed = new URLSearchParams(location.search).get("seed");
  const saveManager = new SaveManager(window.localStorage);
  const historyManager = new HistoryManager(window.localStorage);
  const publishLog = (line: string) => bus.emit("combat:log", { line });
  const playSfx = (cue: Parameters<typeof bus.emit<"audio:sfx">>[1]["cue"]) =>
    bus.emit("audio:sfx", { cue });
  const autoSave = (changedWorld: GameWorld) => saveManager.save(changedWorld);
  const emitHeroDamaged = (info: HeroDamagedInfo) => bus.emit("hero:damaged", info);
  const emitCombatStrike = (info: CombatStrikeInfo) => bus.emit("combat:strike", info);
  // One shared callback set so every GameWorld (new / loaded / restarted) is
  // wired to the same EventBus bridges.
  const worldCallbacks = {
    onChange: autoSave,
    onLog: publishLog,
    onHeroDamaged: emitHeroDamaged,
    onCombatStrike: emitCombatStrike,
  };

  let appState: AppState = "MainMenu";
  let world: GameWorld | null = null;
  let seed = "";
  let selectedCell: number | null = null;
  let targetingMode: TargetingMode | null = null;
  let autoPath: number[] = [];
  // When set, travel is in "approach an enemy" mode and stops once adjacent;
  // when null, travel follows `autoPath` to an empty tile.
  let autoTarget: Enemy | null = null;
  let autoWalkKnownHostileIds = new Set<number>();
  let autoWalkElapsed = 0;
  let zoomMultiplier = 1;
  let pinchDistance: number | null = null;
  let gameOverReported = false;
  let menu: MainMenu | null = null;
  let overlay: GameOverlay | null = null;

  const assets = new AssetLoader();
  void assets.loadDefaultSheets();

  const view = (): MapView => {
    const current = requireWorld(world);
    return {
      grid: current.grid,
      seed,
      depth: current.depth,
      roomCount: current.level.rooms.length,
      entrance: current.level.entrance,
      exit: current.level.exit,
      heroPos: current.heroPos,
      enemies: current.enemies.map((e) => ({
        id: `enemy:${e.seq}`,
        pos: e.pos,
        state: e.state,
        name: e.name,
        hp: e.hp,
        maxHealth: e.maxHealth,
      })),
      groundItems: current.level.groundItems,
      openDoors: current.level.openDoors,
      floorVariants: current.level.floorVariants,
      visible: current.fov.visible,
      explored: current.fov.exploredMemory,
      selectedCell,
      hero: {
        hp: current.heroStats.hp,
        maxHealth: current.heroStats.maxHealth,
        accuracy: current.heroStats.accuracy,
        evasion: current.heroStats.evasion,
        damageMin: current.heroStats.damageMin,
        damageMax: current.heroStats.damageMax,
        armor: current.heroStats.armor,
        weaponName: current.inventory.equippedIn("weapon")?.name ?? "(none)",
        armorName: current.inventory.equippedIn("armor")?.name ?? "(none)",
        sprite: heroSpriteKey(current.heroSprite),
        alive: current.heroAlive,
      },
      log: current.log,
    };
  };

  const overlayState = (): OverlayState => {
    const current = requireWorld(world);
    return {
      seed,
      depth: current.depth,
      enemiesInSight: current.enemies
        .filter((enemy) => current.fov.visible.has(enemy.pos))
        .map((enemy) => ({
          name: enemy.name,
          hp: enemy.hp,
          maxHealth: enemy.maxHealth,
          state: enemy.state,
        })),
      hero: {
        hp: current.heroStats.hp,
        maxHealth: current.heroStats.maxHealth,
        accuracy: current.heroStats.accuracy,
        evasion: current.heroStats.evasion,
        damageMin: current.heroStats.damageMin,
        damageMax: current.heroStats.damageMax,
        armor: current.heroStats.armor,
        strength: current.heroStats.strength,
        level: current.heroLevel,
        experience: current.heroExperience,
        maxExperience: current.heroMaxExperience,
        weaponName: current.inventory.equippedIn("weapon")?.name ?? "Unarmed",
        armorName: current.inventory.equippedIn("armor")?.name ?? "Unarmored",
        alive: current.heroAlive,
      },
      inventory: {
        capacity: current.inventory.capacity,
        items: current.inventory.all,
        equippedWeaponId: current.inventory.equippedIn("weapon")?.id ?? null,
        equippedArmorId: current.inventory.equippedIn("armor")?.id ?? null,
      },
      log: current.log,
    };
  };

  const clearSeedParam = (): void => {
    if (requestedSeed === null) return;
    const url = new URL(location.href);
    url.searchParams.delete("seed");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    requestedSeed = null;
  };

  const mountPlaying = (nextWorld: GameWorld, nextSeed: string): void => {
    appState = "Playing";
    world = nextWorld;
    seed = nextSeed;
    selectedCell = null;
    targetingMode = null;
    gameOverReported = false;
    clearCombatAnimations();
    cancelAutoWalk();

    menu?.destroy();
    menu = null;
    overlay?.destroy();
    overlay = new GameOverlay(
      bus,
      overlayState,
      {
        equip: (itemId) => {
          const ok = requireWorld(world).equipItem(itemId);
          if (ok) playSfx("ui_click");
          return ok;
        },
        consume: (itemId) => {
          const current = requireWorld(world);
          const item = current.inventory.all.find((candidate) => candidate.id === itemId);
          const ok = current.consumeItem(itemId);
          if (ok) playSfx(item?.type === "food" ? "eat" : "drink");
          return ok;
        },
        drop: (itemId) => {
          const ok = requireWorld(world).dropItem(itemId);
          if (ok) playSfx("ui_click");
          return ok;
        },
        wait: () => {
          const ok = requireWorld(world).waitTurn();
          if (ok) playSfx("ui_click");
          return ok;
        },
        quickslot: () => {
          playSfx("ui_click");
          bus.emit("ui:quickslot", {});
        },
        restart: restartRun,
      },
      assets,
    );
    bus.emit("game:start", {});
  };

  const startNewRun = (heroId: string): void => {
    playSfx("ui_click");
    saveManager.clear();
    const nextSeed = requestedSeed ?? createRunSeed();
    const nextWorld = new GameWorld(nextSeed, content, {
      ...worldCallbacks,
      heroId,
    });
    saveManager.save(nextWorld);
    mountPlaying(nextWorld, nextSeed);
    console.info(`[boot] New ${nextWorld.heroClassName} run seed="${nextSeed}".`);
  };

  const continueRun = (): void => {
    playSfx("ui_click");
    clearSeedParam();
    const loadedWorld = saveManager.load(content, worldCallbacks);
    if (!loadedWorld) {
      showMainMenu();
      return;
    }
    mountPlaying(loadedWorld, loadedWorld.seed);
    console.info(`[boot] Loaded save seed="${loadedWorld.seed}".`);
  };

  function restartRun(): void {
    playSfx("ui_click");
    saveManager.clear();
    clearSeedParam();
    const nextSeed = createRunSeed();
    const heroId = world?.heroProfileId ?? content.defaultHero.id;
    const nextWorld = new GameWorld(nextSeed, content, {
      ...worldCallbacks,
      heroId,
    });
    saveManager.save(nextWorld);
    mountPlaying(nextWorld, nextSeed);
    console.info(`[boot] Restarted run seed="${nextSeed}".`);
  }

  function showMainMenu(): void {
    appState = "MainMenu";
    world = null;
    seed = "";
    selectedCell = null;
    targetingMode = null;
    cancelAutoWalk();
    overlay?.destroy();
    overlay = null;
    menu?.destroy();
    menu = new MainMenu(saveManager.hasValidRun(content), content.allHeroes, historyManager.list(), {
      newGame: startNewRun,
      continueGame: continueRun,
    });
  }

  // --- auto-walk / touch-to-attack orchestration ---------------------------
  // Travel is a convenience layer over the same turn-based intent API the
  // player drives by hand: it issues exactly one `tryMoveHero` per step (never
  // mutating core state directly — Pillar 1). Two modes:
  //   - travel:  follow `autoPath` to an empty tile. Enemies already visible
  //              when travel starts are treated as known threats, so the player
  //              can flee across a room; a newly revealed hostile still aborts.
  //   - approach: chase `autoTarget` and stop once adjacent; only a DIFFERENT
  //               visible hostile aborts (so the target you tapped doesn't
  //               cancel its own approach).
  // Both also abort on the hero taking damage, the hero dying, or a new tap.

  function autoWalkActive(): boolean {
    return autoTarget !== null || autoPath.length > 0;
  }

  /** Any visible enemy other than `except` (the deliberately-targeted one). */
  function visibleHostileExists(except: Enemy | null = null): boolean {
    if (!world) return false;
    const current = world;
    return current.enemies.some(
      (enemy) => enemy !== except && current.fov.visible.has(enemy.pos),
    );
  }

  function visibleHostiles(except: Enemy | null = null): Enemy[] {
    if (!world) return [];
    const current = world;
    return current.enemies.filter(
      (enemy) => enemy !== except && current.fov.visible.has(enemy.pos),
    );
  }

  function hostileId(enemy: Enemy): number {
    return enemy.seq;
  }

  function newVisibleHostileExists(): boolean {
    return visibleHostiles().some(
      (enemy) => !autoWalkKnownHostileIds.has(hostileId(enemy)),
    );
  }

  function heroDistanceTo(cell: number): number {
    const current = world!;
    return (
      Math.abs(current.grid.xOf(current.heroPos) - current.grid.xOf(cell)) +
      Math.abs(current.grid.yOf(current.heroPos) - current.grid.yOf(cell))
    );
  }

  function cancelAutoWalk(): void {
    autoPath = [];
    autoTarget = null;
    autoWalkKnownHostileIds.clear();
    autoWalkElapsed = 0;
  }

  /** Bump-attack an adjacent enemy by moving onto its tile (one intent). */
  function attackAdjacent(enemy: Enemy): void {
    if (!world) return;
    const current = world;
    const dx = Math.sign(current.grid.xOf(enemy.pos) - current.grid.xOf(current.heroPos));
    const dy = Math.sign(current.grid.yOf(enemy.pos) - current.grid.yOf(current.heroPos));
    current.tryMoveHero(dx, dy); // enemy on the target cell -> bump combat
  }

  function startAutoWalk(target: number): void {
    if (!world) return;
    const current = world;
    if (target === current.heroPos || !current.grid.isWalkable(target)) return;

    const path = findPath(current.grid, current.heroPos, target, {
      passable: (cell) =>
        current.grid.isWalkable(cell) && (cell === target || !current.isOccupied(cell)),
    });
    if (!path || path.length < 2) return; // no route, or already standing there

    autoPath = path.slice(1); // drop the hero's own cell; keep the steps ahead
    autoWalkKnownHostileIds = new Set(visibleHostiles().map(hostileId));
    autoWalkElapsed = AUTO_WALK_STEP_SECONDS; // take the first step next frame
  }

  function handleTravelTap(target: number): void {
    startAutoWalk(target);
  }

  function startTargetingMode(mode: TargetingMode): void {
    if (appState !== "Playing" || !world?.heroAlive) return;
    cancelAutoWalk();
    targetingMode = mode;
    selectedCell = null;
    bus.emit("combat:log", { line: "Select a target." });
  }

  /** Begin approaching a targeted enemy; the per-step logic stops adjacent. */
  function startAttackWalk(enemy: Enemy): void {
    if (!world) return;
    // Don't start if another, different hostile is already in view (it would
    // abort on the first step anyway — and engaging amid a crowd is unsafe).
    if (visibleHostileExists(enemy)) return;
    autoTarget = enemy;
    autoWalkElapsed = AUTO_WALK_STEP_SECONDS;
  }

  function stepAutoWalk(): void {
    if (!world) return;
    if (autoTarget) {
      stepApproach(world, autoTarget);
    } else {
      stepTravel(world);
    }
  }

  function stepTravel(current: GameWorld): void {
    if (autoPath.length === 0) return;
    if (newVisibleHostileExists()) {
      cancelAutoWalk();
      return;
    }
    const next = autoPath[0]!;
    const dx = current.grid.xOf(next) - current.grid.xOf(current.heroPos);
    const dy = current.grid.yOf(next) - current.grid.yOf(current.heroPos);
    const moved = current.tryMoveHero(dx, dy);

    // A `hero:damaged` event during the turn may have already cancelled us.
    if (!autoWalkActive()) return;
    if (!moved || current.heroPos !== next || !current.heroAlive || newVisibleHostileExists()) {
      cancelAutoWalk();
      return;
    }
    autoPath.shift();
    if (autoPath.length === 0) cancelAutoWalk();
  }

  function stepApproach(current: GameWorld, target: Enemy): void {
    // Stop if the target is gone (killed), the hero can't continue, or a
    // DIFFERENT hostile appeared (safety rule).
    if (!current.enemies.includes(target) || !current.heroAlive) {
      cancelAutoWalk();
      return;
    }
    if (visibleHostileExists(target)) {
      cancelAutoWalk();
      return;
    }
    // Already adjacent -> stop here (the player taps again to strike).
    if (heroDistanceTo(target.pos) === 1) {
      cancelAutoWalk();
      return;
    }

    // Re-path toward the target's CURRENT cell each step (it may have moved).
    const path = findPath(current.grid, current.heroPos, target.pos, {
      passable: (cell) =>
        current.grid.isWalkable(cell) && (cell === target.pos || !current.isOccupied(cell)),
    });
    if (!path || path.length < 2) {
      cancelAutoWalk();
      return;
    }
    const next = path[1]!;
    if (next === target.pos) {
      // The only step left would enter the enemy; we're effectively adjacent.
      cancelAutoWalk();
      return;
    }
    const dx = current.grid.xOf(next) - current.grid.xOf(current.heroPos);
    const dy = current.grid.yOf(next) - current.grid.yOf(current.heroPos);
    const moved = current.tryMoveHero(dx, dy);

    if (!autoWalkActive()) return; // cancelled by hero:damaged mid-step
    if (!moved || current.heroPos !== next || !current.heroAlive || visibleHostileExists(target)) {
      cancelAutoWalk();
      return;
    }
    if (heroDistanceTo(target.pos) === 1) cancelAutoWalk(); // reached melee range
  }

  const input = new InputManager(canvas, bus);
  input.registerUI(rectLayer("hud", { x: 0, y: 0, w: 1e6, h: MAP_TOP_INSET }, 10));

  bus.on("input:world", ({ x, y }) => {
    if (appState !== "Playing" || !world) return;
    const current = world;
    cancelAutoWalk(); // a tap always interrupts whatever travel was happening
    const vp = computeCameraViewport(
      window.innerWidth,
      window.innerHeight,
      current.grid,
      current.heroPos,
      zoomMultiplier,
    );
    const cell = pixelToCell(vp, current.grid, x, y);
    selectedCell = cell;

    if (targetingMode !== null) {
      const mode = targetingMode;
      targetingMode = null;
      if (cell !== null && mode === "ranged") {
        current.rangedAttack(cell);
      }
      return;
    }

    if (cell === current.heroPos) {
      if (current.tryPickUpItem()) playSfx("pickup");
      return;
    }

    // Decide what the tap means (pure), then execute via intents only.
    const plan = planTap(
      {
        grid: current.grid,
        heroPos: current.heroPos,
        enemies: current.enemies,
        isAlive: (enemy) => enemy.stats.alive,
        isVisible: (c) => current.fov.visible.has(c),
      },
      cell,
    );
    switch (plan.kind) {
      case "attack":
        attackAdjacent(plan.enemy);
        break;
      case "approach":
        startAttackWalk(plan.enemy);
        break;
      case "travel":
        handleTravelTap(plan.cell);
        break;
      case "none":
        break;
    }
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (appState !== "Playing") return;
      e.preventDefault();
      const delta = -e.deltaY * WHEEL_ZOOM_STEP;
      zoomMultiplier = clampZoomMultiplier(zoomMultiplier * (1 + delta));
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        pinchDistance = touchDistance(e.touches[0]!, e.touches[1]!);
      } else {
        pinchDistance = null;
      }
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (appState !== "Playing" || e.touches.length !== 2) return;
      e.preventDefault();
      const nextDistance = touchDistance(e.touches[0]!, e.touches[1]!);
      if (pinchDistance !== null && pinchDistance > 0) {
        const ratio = nextDistance / pinchDistance;
        zoomMultiplier = clampZoomMultiplier(
          zoomMultiplier * (1 + (ratio - 1) * PINCH_ZOOM_SENSITIVITY),
        );
      }
      pinchDistance = nextDistance;
    },
    { passive: false },
  );

  canvas.addEventListener("touchend", (e) => {
    pinchDistance = e.touches.length === 2
      ? touchDistance(e.touches[0]!, e.touches[1]!)
      : null;
  });

  // The hero taking a hit interrupts travel immediately (event-driven, so the
  // orchestrator no longer has to poll HP each step).
  bus.on("hero:damaged", () => {
    if (appState === "Playing") cancelAutoWalk();
  });

  bus.on("hero:damaged", ({ source, hp }) => {
    if (appState !== "Playing" || !world || hp > 0 || gameOverReported) {
      return;
    }
    gameOverReported = true;
    const inventory = world.inventory.all.map((item) => item.id);
    historyManager.add({
      class: world.heroClassName,
      heroLevel: world.heroLevel,
      depthReached: world.depth,
      killerName: source,
      inventoryItemIds: inventory,
    });
    bus.emit("game:over", {
      class: world.heroClassName,
      hero_level: world.heroLevel,
      killer: source,
      depth: world.depth,
      inventory,
      turns: Math.round(world.snapshot().queue.now),
    });
  });

  bus.on("ui:quickslot", () => {
    startTargetingMode("ranged");
  });

  bus.on("combat:strike", (event) => {
    queueCombatStrikeAnimation(event);
  });

  bus.on("loop:frame", ({ dt }) => {
    if (appState !== "Playing" || !world || !autoWalkActive()) return;
    // Per-frame safety so cancellation feels instant even between steps:
    // travel aborts only on newly visible hostiles; approach aborts only on a
    // hostile OTHER than the target.
    if (
      !world.heroAlive ||
      (autoTarget ? visibleHostileExists(autoTarget) : newVisibleHostileExists())
    ) {
      cancelAutoWalk();
      return;
    }
    autoWalkElapsed += dt;
    if (autoWalkElapsed < AUTO_WALK_STEP_SECONDS) return;
    autoWalkElapsed = 0;
    stepAutoWalk();
  });

  const MOVES: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    w: [0, -1],
    ArrowDown: [0, 1],
    s: [0, 1],
    ArrowLeft: [-1, 0],
    a: [-1, 0],
    ArrowRight: [1, 0],
    d: [1, 0],
  };

  window.addEventListener("keydown", (e) => {
    if (appState !== "Playing" || !world) return;
    if (targetingMode !== null && e.key === "Escape") {
      e.preventDefault();
      targetingMode = null;
      selectedCell = null;
      bus.emit("combat:log", { line: "Targeting cancelled." });
      return;
    }
    if (overlay?.handleKeyDown(e)) return;

    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      world.tryMoveHero(move[0], move[1]);
      return;
    }
    if (e.key === ">" || e.key === ".") {
      const before = world.depth;
      world.descend();
      if (world.depth !== before) playSfx("descend");
      selectedCell = null;
    } else if (e.key === "<" || e.key === ",") {
      const before = world.depth;
      world.ascend();
      if (world.depth !== before) playSfx("descend");
      selectedCell = null;
    } else if (e.key === "q") {
      e.preventDefault();
      if (world.quaffHealing()) playSfx("drink");
    }
  });

  window.addEventListener(
    "beforeunload",
    () => {
      teardownTelemetry();
      audio.destroy();
      overlay?.destroy();
      menu?.destroy();
    },
    { once: true },
  );

  const renderer = new Renderer(canvas, bus);
  renderer.setScene((ctx, frame) => {
    if (appState !== "Playing" || !world) {
      ctx.fillStyle = "#06080a";
      ctx.fillRect(0, 0, frame.width, frame.height);
      return;
    }
    drawMapScene(ctx, frame, view(), assets, zoomMultiplier);
  });

  const loop = new GameLoop({ bus });
  loop.start();
  showMainMenu();
  console.info("[boot] Main menu online.");
}

function requireWorld(world: GameWorld | null): GameWorld {
  if (!world) throw new Error("GameWorld is not mounted.");
  return world;
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function heroSpriteKey(sprite: string): SpriteKey {
  if (sprite === "mage") return "mageHero";
  return "hero";
}

void boot();
