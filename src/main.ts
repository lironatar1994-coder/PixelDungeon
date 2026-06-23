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
  cameraFocusX,
  cameraFocusY,
  clearCombatAnimations,
  computeMapSceneViewport,
  detachMapCameraBy,
  drawMapScene,
  queueActorMoveAnimation,
  queueActorDeathAnimation,
  queueCombatStrikeAnimation,
  queueItemPickupAnimation,
  snapMapCameraToHero,
  type MapView,
} from "@/render/MapScene";
import { AssetLoader, type SpriteKey } from "@/render/AssetLoader";
import {
  clampZoomMultiplier,
  pixelToCell,
  MAP_TOP_INSET,
  type Viewport,
} from "@/render/viewport";
import {
  GameWorld,
  type ActorMoveInfo,
  type ActorDeathInfo,
  type CombatStrikeInfo,
  type HeroLevelUpInfo,
  type HeroDamagedInfo,
  type ItemPickupInfo,
} from "@/core/game/GameWorld";
import type { Enemy } from "@/core/actors/Enemy";
import { loadContentDatabase } from "@/core/data/loadContent";
import { SaveManager } from "@/core/save/SaveManager";
import { HistoryManager } from "@/core/save/HistoryManager";
import { DistanceMap } from "@/core/pathfinding/DistanceMap";
import { Terrain } from "@/core/grid/terrain";
import { planTap } from "@/input/tapPlan";
import { InputManager } from "@/input/InputManager";
import { rectLayer } from "@/input/PointerRouter";
import { GameOverlay, type OverlayState } from "@/ui/GameOverlay";
import { MainMenu } from "@/ui/MainMenu";

type AppState = "MainMenu" | "Playing";
type TargetingMode = "ranged" | "look";
type AutoWalkIntent = "travel" | "pickup" | "door";
const AUTO_WALK_STEP_SECONDS = 0.18;
const WHEEL_ZOOM_STEP = 0.0015;
const PINCH_ZOOM_SENSITIVITY = 1;
const CARDINAL_AND_DIAGONAL_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  w: [0, -1],
  ArrowDown: [0, 1],
  s: [0, 1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
  Home: [-1, -1],
  y: [-1, -1],
  PageUp: [1, -1],
  u: [1, -1],
  End: [-1, 1],
  b: [-1, 1],
  PageDown: [1, 1],
  n: [1, 1],
};
const NUMPAD_MOVES: Record<string, [number, number]> = {
  Numpad8: [0, -1],
  Numpad2: [0, 1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad7: [-1, -1],
  Numpad9: [1, -1],
  Numpad1: [-1, 1],
  Numpad3: [1, 1],
};

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
  const emitActorMove = (info: ActorMoveInfo) => bus.emit("actor:move", info);
  const emitActorDeath = (info: ActorDeathInfo) => bus.emit("actor:death", info);
  const emitItemPickup = (info: ItemPickupInfo) => bus.emit("item:pickup", info);
  const emitHeroLevelUp = (info: HeroLevelUpInfo) => bus.emit("hero:levelup", info);
  // One shared callback set so every GameWorld (new / loaded / restarted) is
  // wired to the same EventBus bridges.
  const worldCallbacks = {
    onChange: autoSave,
    onLog: publishLog,
    onHeroDamaged: emitHeroDamaged,
    onCombatStrike: emitCombatStrike,
    onActorMove: emitActorMove,
    onActorDeath: emitActorDeath,
    onItemPickup: emitItemPickup,
    onHeroLevelUp: emitHeroLevelUp,
  };

  let appState: AppState = "MainMenu";
  let world: GameWorld | null = null;
  let seed = "";
  let selectedCell: number | null = null;
  let targetingMode: TargetingMode | null = null;
  let autoPath: number[] = [];
  let autoPathTarget: number | null = null;
  let autoPathIntent: AutoWalkIntent = "travel";
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
      groundItems: current.level.groundItems.map((ground) => ({
        cell: ground.cell,
        itemId: ground.item.defId,
        type: content.getItem(ground.item.defId)?.type,
      })),
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
      attackTarget: attackTargetForOverlay(current),
      pickupTarget: pickupTargetForOverlay(current),
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
        sprite: heroSpriteKey(current.heroSprite),
        alive: current.heroAlive,
        causeOfDeath: current.deathReason,
      },
      inventory: {
        capacity: current.inventory.capacity,
        items: current.inventory.all,
        equippedWeaponId: current.inventory.equippedIn("weapon")?.uid ?? null,
        equippedArmorId: current.inventory.equippedIn("armor")?.uid ?? null,
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
    snapMapCameraToHero(true);
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
        equip: (itemUid) => {
          const ok = requireWorld(world).equipItem(itemUid);
          if (ok) playSfx("equip");
          return ok;
        },
        consume: (itemUid) => {
          const current = requireWorld(world);
          const item = current.inventory.findByUid(itemUid);
          const ok = current.consumeItem(itemUid);
          if (ok) playSfx(item?.type === "food" ? "eat" : "drink");
          return ok;
        },
        drop: (itemUid) => {
          const ok = requireWorld(world).dropItem(itemUid);
          if (ok) playSfx("drop");
          return ok;
        },
        wait: () => {
          const ok = requireWorld(world).waitTurn();
          if (ok) playSfx("ui_click");
          return ok;
        },
        quickAttack: () => {
          if (!world) return false;
          targetingMode = null;
          selectedCell = null;
          snapMapCameraToHero();
          const current = world;
          const target = adjacentAttackTarget(current);
          if (!target) {
            const ok = current.tryPickUpItem();
            if (ok) playSfx("pickup");
            return ok;
          }
          const ok = attackAdjacent(target);
          if (ok) playSfx("ui_click");
          return ok;
        },
        quickslot: () => {
          playSfx("ui_click");
          bus.emit("ui:quickslot", {});
        },
        look: () => {
          playSfx("ui_click");
          bus.emit("ui:look", {});
        },
        restart: restartRun,
        mainMenu: () => {
          playSfx("ui_click");
          showMainMenu();
        },
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
    return chebyshevDistance(current, current.heroPos, cell);
  }

  function cancelAutoWalk(): void {
    autoPath = [];
    autoPathTarget = null;
    autoPathIntent = "travel";
    autoTarget = null;
    autoWalkKnownHostileIds.clear();
    autoWalkElapsed = 0;
  }

  /** Bump-attack an adjacent enemy by moving onto its tile (one intent). */
  function attackAdjacent(enemy: Enemy): boolean {
    if (!world) return false;
    const current = world;
    const dx = Math.sign(current.grid.xOf(enemy.pos) - current.grid.xOf(current.heroPos));
    const dy = Math.sign(current.grid.yOf(enemy.pos) - current.grid.yOf(current.heroPos));
    return current.tryMoveHero(dx, dy); // enemy on the target cell -> bump combat
  }

  function adjacentAttackTarget(current: GameWorld): Enemy | null {
    return current.enemies.find((enemy) =>
      enemy.stats.alive &&
      current.fov.visible.has(enemy.pos) &&
      chebyshevDistance(current, current.heroPos, enemy.pos) === 1,
    ) ?? null;
  }

  function attackTargetForOverlay(current: GameWorld): { name: string; sprite: SpriteKey } | null {
    const target = adjacentAttackTarget(current);
    if (!target) return null;
    return {
      name: target.name,
      sprite: assets.spriteForEnemy(target),
    };
  }

  function pickupTargetForOverlay(current: GameWorld): { name: string; sprite: SpriteKey } | null {
    if (adjacentAttackTarget(current)) return null;
    const groundItem = current.level.itemAt(current.heroPos);
    if (groundItem === null) return null;
    const item = content.getItem(groundItem.defId);
    if (!item) return { name: "item", sprite: "ration" };
    return {
      name: item.name,
      sprite: assets.spriteForItem(item.id) ?? assets.spriteForItemType(item.type),
    };
  }

  function startAutoWalk(target: number, intent: AutoWalkIntent = "travel"): void {
    if (!world) return;
    const current = world;
    if (target === current.heroPos || !current.grid.isWalkable(target)) return;

    const path = findHeroPath(current, target);
    if (!path || path.length < 2) return; // no route, or already standing there

    autoPath = path.slice(1); // drop the hero's own cell; keep the steps ahead
    autoPathTarget = target;
    autoPathIntent = intent;
    autoTarget = null;
    autoWalkKnownHostileIds = new Set(visibleHostiles().map(hostileId));
    autoWalkElapsed = AUTO_WALK_STEP_SECONDS; // take the first step next frame
  }

  function handleTravelTap(target: number, intent: AutoWalkIntent = "travel"): void {
    if (!world) return;
    const resolvedTarget = resolveTravelTarget(world, target);
    if (resolvedTarget !== null) startAutoWalk(resolvedTarget, intent);
  }

  function resolveTravelTarget(current: GameWorld, target: number): number | null {
    if (target === current.heroPos) return target;
    if (isAvailableTravelCell(current, target)) return target;
    return nearestReachableTravelCell(current, target);
  }

  function nearestReachableTravelCell(current: GameWorld, target: number): number | null {
    const grid = current.grid;
    const targetX = grid.xOf(target);
    const targetY = grid.yOf(target);
    let best: { cell: number; distance: number; turns: number } | null = null;
    const reachable = DistanceMap.build(grid, current.heroPos, {
      passable: (cell) =>
        cell === current.heroPos ||
        (grid.isWalkable(cell) && !current.isOccupied(cell)),
    });

    for (let cell = 0; cell < grid.length; cell++) {
      if (!isAvailableTravelCell(current, cell) || cell === current.heroPos) continue;
      if (!reachable.isReachable(cell)) continue;

      const dx = grid.xOf(cell) - targetX;
      const dy = grid.yOf(cell) - targetY;
      const distance = Math.hypot(dx, dy);
      const turns = reachable.getDistance(cell);
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && turns < best.turns)
      ) {
        best = { cell, distance, turns };
      }
    }

    return best?.cell ?? null;
  }

  function isAvailableTravelCell(current: GameWorld, cell: number): boolean {
    return current.grid.isWalkable(cell) && !current.isOccupied(cell);
  }

  function findHeroPath(current: GameWorld, target: number): number[] | null {
    const route = DistanceMap.build(current.grid, target, {
      passable: (cell) =>
        current.grid.isWalkable(cell) &&
        (cell === current.heroPos || cell === target || !current.isOccupied(cell)),
    });
    return route.pathFrom(current.heroPos);
  }

  function refreshAutoPath(current: GameWorld): boolean {
    if (autoPathTarget === null) return false;
    const path = findHeroPath(current, autoPathTarget);
    if (!path || path.length < 2) {
      cancelAutoWalk();
      return false;
    }
    autoPath = path.slice(1);
    return true;
  }

  function isAutoTargetStillValid(current: GameWorld): boolean {
    if (autoPathTarget === null) return false;
    if (!current.grid.inBoundsCell(autoPathTarget)) return false;
    if (autoPathIntent === "pickup" && !current.hasGroundItem(autoPathTarget)) return false;
    return current.grid.isWalkable(autoPathTarget);
  }

  function finishAutoWalk(current: GameWorld): void {
    const intent = autoPathIntent;
    const target = autoPathTarget;
    cancelAutoWalk();
    if (target === null || current.heroPos !== target) return;
    if (intent === "pickup") {
      if (current.tryPickUpItem()) playSfx("pickup");
    }
  }

  function chebyshevDistance(current: GameWorld, from: number, to: number): number {
    return Math.max(
      Math.abs(current.grid.xOf(from) - current.grid.xOf(to)),
      Math.abs(current.grid.yOf(from) - current.grid.yOf(to)),
    );
  }

  function startTargetingMode(mode: TargetingMode): void {
    if (appState !== "Playing" || !world?.heroAlive) return;
    cancelAutoWalk();
    targetingMode = mode;
    selectedCell = null;
    bus.emit("combat:log", { line: mode === "look" ? "Select a cell." : "Select a target." });
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
    if (autoPathTarget === null) return;
    if (!isAutoTargetStillValid(current)) {
      cancelAutoWalk();
      return;
    }
    if (autoPath.length === 0) {
      finishAutoWalk(current);
      return;
    }
    if (newVisibleHostileExists()) {
      cancelAutoWalk();
      return;
    }
    let next = autoPath[0]!;
    if (
      !current.grid.isWalkable(next) ||
      (next !== autoPathTarget && current.isOccupied(next))
    ) {
      if (!refreshAutoPath(current)) return;
      next = autoPath[0]!;
    }
    const wasClosedDoor = current.isClosedDoor(next);
    const dx = current.grid.xOf(next) - current.grid.xOf(current.heroPos);
    const dy = current.grid.yOf(next) - current.grid.yOf(current.heroPos);
    const moved = current.tryMoveHero(dx, dy);

    // A `hero:damaged` event during the turn may have already cancelled us.
    if (!autoWalkActive()) return;
    if (!moved || current.heroPos !== next || !current.heroAlive || newVisibleHostileExists()) {
      cancelAutoWalk();
      return;
    }
    if (wasClosedDoor) playSfx("door");
    autoPath.shift();
    if (autoPath.length === 0) finishAutoWalk(current);
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
    const route = DistanceMap.build(current.grid, target.pos, {
      passable: (cell) =>
        current.grid.isWalkable(cell) &&
        (cell === current.heroPos || cell === target.pos || !current.isOccupied(cell)),
    });
    const path = route.pathFrom(current.heroPos);
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

  function currentViewport(current: GameWorld) {
    const cx = cameraFocusX !== null ? cameraFocusX : current.grid.xOf(current.heroPos) + 0.5;
    const cy = cameraFocusY !== null ? cameraFocusY : current.grid.yOf(current.heroPos) + 0.5;
    return computeMapSceneViewport(
      window.innerWidth,
      window.innerHeight,
      current.grid,
      { x: cx, y: cy },
      zoomMultiplier,
    );
  }

  function actorCellAtScreen(current: GameWorld, vp: Viewport, px: number, py: number): number | null {
    const worldX = (px - vp.offsetX) / vp.tileSize;
    const worldY = (py - vp.offsetY) / vp.tileSize;
    const candidates: Array<{ cell: number; priority: number; distance: number }> = [];
    const addCandidate = (cell: number, priority: number): void => {
      const centerX = current.grid.xOf(cell) + 0.5;
      const centerY = current.grid.yOf(cell) + 0.5;
      const dx = Math.abs(worldX - centerX);
      const dy = Math.abs(worldY - centerY);
      // SPD's CellSelector prioritizes sprites, but rejects clicks more than
      // 12px from the tile center on a 16px tile. The slightly taller Y band
      // accounts for bottom-anchored sprites whose heads live above the tile.
      if (dx > 0.75 || dy > 1.05) return;
      candidates.push({ cell, priority, distance: dx * dx + dy * dy });
    };

    for (const enemy of current.enemies) {
      if (enemy.stats.alive && current.fov.visible.has(enemy.pos)) {
        addCandidate(enemy.pos, 0);
      }
    }
    addCandidate(current.heroPos, 1);

    candidates.sort((a, b) => a.distance - b.distance || a.priority - b.priority);
    return candidates[0]?.cell ?? null;
  }

  const input = new InputManager(canvas, bus, {
    onWorldPan: (dx, dy) => {
      if (appState === "Playing" && targetingMode !== "ranged") {
        detachMapCameraBy(dx, dy);
      }
    },
    onWorldTap: () => {
      if (appState === "Playing") snapMapCameraToHero();
    },
  });
  input.registerUI(rectLayer("hud", { x: 0, y: 0, w: 1e6, h: MAP_TOP_INSET }, 10));

  bus.on("input:world", ({ x, y }) => {
    if (appState !== "Playing" || !world) return;
    const current = world;
    cancelAutoWalk(); // a tap always interrupts whatever travel was happening
    const vp = currentViewport(current);
    const cell = actorCellAtScreen(current, vp, x, y) ?? pixelToCell(vp, current.grid, x, y);
    selectedCell = cell;

    if (targetingMode !== null) {
      const mode = targetingMode;
      if (mode === "ranged") {
        targetingMode = null;
        if (cell !== null) current.rangedAttack(cell);
      } else if (mode === "look") {
        targetingMode = null;
        if (cell !== null) {
          selectedCell = cell;
          bus.emit("combat:log", { line: describeLookCell(current, cell) });
        }
      }
      return;
    }

    if (cell === current.heroPos) {
      if (current.tryPickUpItem()) playSfx("pickup");
      return;
    }

    if (
      cell !== null &&
      current.isOpenDoor(cell) &&
      current.grid.neighbours4(current.heroPos).includes(cell)
    ) {
      if (current.tryCloseDoor(cell)) playSfx("door");
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
        isClosedDoor: (c) => current.isClosedDoor(c),
        hasGroundItem: (c) => current.hasGroundItem(c),
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
      case "openDoor":
        handleTravelTap(plan.cell, "door");
        break;
      case "pickUp":
        handleTravelTap(plan.cell, "pickup");
        break;
      case "travel":
        handleTravelTap(plan.cell);
        break;
      case "none":
        if (cell !== null && cell !== current.heroPos) {
          const fallback = resolveTravelTarget(current, cell);
          if (fallback !== null && fallback !== current.heroPos) {
            selectedCell = fallback;
            startAutoWalk(fallback);
          }
        }
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
    bus.emit("actor:death", {
      actorId: "hero",
      cell: world.heroPos,
      name: world.heroSprite,
    });
    const inventory = world.inventory.all.map((item) => item.defId);
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

  bus.on("ui:look", () => {
    startTargetingMode("look");
  });

  bus.on("combat:strike", (event) => {
    queueCombatStrikeAnimation(event);
  });

  bus.on("actor:move", (event) => {
    queueActorMoveAnimation(event);
  });

  bus.on("actor:death", (event) => {
    queueActorDeathAnimation(event);
  });

  bus.on("item:pickup", (event) => {
    queueItemPickupAnimation(event);
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

    const normalizedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = CARDINAL_AND_DIAGONAL_KEYS[normalizedKey] ?? NUMPAD_MOVES[e.code];
    if (move) {
      e.preventDefault();
      snapMapCameraToHero();
      world.tryMoveHero(move[0], move[1]);
      return;
    }
    if (e.key === ">" || e.key === ".") {
      const before = world.depth;
      world.descend();
      if (world.depth !== before) playSfx("descend");
      selectedCell = null;
      snapMapCameraToHero(world.depth !== before);
    } else if (e.key === "<" || e.key === ",") {
      const before = world.depth;
      world.ascend();
      if (world.depth !== before) playSfx("descend");
      selectedCell = null;
      snapMapCameraToHero(world.depth !== before);
    } else if (e.key === "q") {
      e.preventDefault();
      if (world.quaffHealing()) playSfx("drink");
    } else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      if (world.tryCloseDoor()) playSfx("door");
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

function describeLookCell(world: GameWorld, cell: number): string {
  const enemy = world.enemies.find((candidate) => candidate.pos === cell);
  if (enemy && world.fov.visible.has(cell)) {
    return `${enemy.name}: ${enemy.hp}/${enemy.maxHealth} HP.`;
  }

  const item = world.level.groundItems.find((ground) => ground.cell === cell);
  if (item && world.fov.visible.has(cell)) {
    return `You see ${item.item.defId.replaceAll("_", " ")}.`;
  }

  const terrain = world.grid.get(cell);
  if (terrain === Terrain.DOOR) {
    return world.isOpenDoor(cell) ? "An open dungeon door." : "A closed dungeon door.";
  }
  if (terrain === Terrain.WALL) return "A stone wall.";
  if (terrain === Terrain.FLOOR) return "A worn dungeon floor.";
  return "Darkness.";
}

void boot();
