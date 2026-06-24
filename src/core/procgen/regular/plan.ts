import { RNG } from "@/core/rng/Mulberry32";
import type {
  BuilderKind,
  LevelFeeling,
  RegularBuilderConfig,
  RegularLevelPlan,
  RegularPainterConfig,
  RegularRoomSpec,
  RoomFamily,
  RoomRole,
  SizeCategory,
} from "./types";
import { chooseSizeCategoryForFamily } from "./rooms";
import { sewerTrapsForDepth } from "@/core/traps/registry";

export interface SewerPlanOverrides {
  feeling?: LevelFeeling;
  builderKind?: BuilderKind;
  secretRoomCount?: number;
}

const PATH_LEN_JITTER = [0, 0, 0, 1] as const;
const PATH_TUNNELS = [2, 2, 1] as const;
const BRANCH_TUNNELS = [1, 1, 0] as const;

const REGULAR_SEWER_STANDARD: Array<{ family: RoomFamily; weightByDepth: readonly number[]; className: string }> = [
  { family: "sewerPipe", weightByDepth: [0, 16, 16, 16, 16, 16], className: "SewerPipeRoom" },
  { family: "ring", weightByDepth: [0, 8, 8, 8, 8, 8], className: "RingRoom" },
  { family: "waterBridge", weightByDepth: [0, 8, 8, 8, 8, 8], className: "WaterBridgeRoom" },
  { family: "regionDecoPatch", weightByDepth: [0, 4, 4, 4, 4, 4], className: "RegionDecoPatchRoom" },
  { family: "circleBasin", weightByDepth: [0, 4, 4, 4, 4, 0], className: "CircleBasinRoom" },
  { family: "empty", weightByDepth: [0, 4, 10, 10, 10, 0], className: "EmptyRoom" },
];

const ENTRANCE_POOL: Array<{ family: RoomFamily; className: string }> = [
  { family: "waterBridge", className: "WaterBridgeEntranceRoom" },
  { family: "regionDecoPatch", className: "RegionDecoPatchEntranceRoom" },
  { family: "ring", className: "RingEntranceRoom" },
  { family: "circleBasin", className: "CircleBasinEntranceRoom" },
];

const EXIT_POOL: Array<{ family: RoomFamily; className: string }> = [
  { family: "waterBridge", className: "WaterBridgeExitRoom" },
  { family: "regionDecoPatch", className: "RegionDecoPatchExitRoom" },
  { family: "ring", className: "RingExitRoom" },
  { family: "circleBasin", className: "CircleBasinExitRoom" },
];

const GOO_ROOMS: Array<{ family: RoomFamily; className: string }> = [
  { family: "gooDiamond", className: "DiamondGooRoom" },
  { family: "gooWalled", className: "WalledGooRoom" },
  { family: "gooThinPillars", className: "ThinPillarsGooRoom" },
  { family: "gooThickPillars", className: "ThickPillarsGooRoom" },
];

export function buildDungeonGenerationPlans(seed: string, depthCount: number): Array<RegularLevelPlan | null> {
  const plans: Array<RegularLevelPlan | null> = new Array(depthCount + 1).fill(null);
  const sewerSecrets = chooseSewerSecretDepths(seed);
  for (let depth = 1; depth <= Math.min(4, depthCount); depth++) {
    plans[depth] = createSewerRegularLevelPlan(
      depth,
      new RNG(`${seed}:regular:${depth}`),
      { secretRoomCount: sewerSecrets.has(depth) ? 1 : 0 },
    );
  }
  if (depthCount >= 5) plans[5] = createSewerBossLevelPlan(new RNG(`${seed}:boss:5`));
  return plans;
}

export function createSewerRegularLevelPlan(
  depth: number,
  rng: RNG,
  overrides: SewerPlanOverrides = {},
): RegularLevelPlan {
  const feeling = overrides.feeling ?? chooseFeeling(depth, rng);
  const builderKind = overrides.builderKind ?? (rng.nextInt(2) === 0 ? "loop" : "figureEight");
  const baseStandards = feeling === "large" ? 6 : 4 + weightedIndex(rng, [1, 3, 1]);
  const standardRoomBudget = feeling === "large" ? Math.ceil(baseStandards * 1.5) : baseStandards;
  const baseSpecials = feeling === "large" ? 2 : 1 + weightedIndex(rng, [1, 4]);
  const specialRoomBudget = feeling === "large" ? baseSpecials + 1 : baseSpecials;
  const secretRoomCount = overrides.secretRoomCount ?? (depth === 1 ? 0 : rng.chance(0.25) ? 1 : 0);

  return {
    kind: "regular",
    levelKind: "sewerRegular",
    depth,
    region: "sewer",
    feeling,
    standardRoomBudget,
    specialRoomBudget,
    secretRoomCount,
    builder: createBuilderConfig(builderKind, rng),
    painter: createSewerPainterConfig(depth, feeling, rng),
    rooms: createSewerRooms(depth, rng, standardRoomBudget, specialRoomBudget, secretRoomCount),
  };
}

export function createSewerBossLevelPlan(rng: RNG): RegularLevelPlan {
  const goo = rng.pick(GOO_ROOMS);
  const rooms: RegularRoomSpec[] = [
    spec("entrance", "entrance", "bossEntrance", "normal", "SewerBossEntranceRoom"),
    spec("exit", "exit", "bossExit", "normal", "SewerBossExitRoom"),
  ];
  for (let i = 0; i < 3; i++) {
    const standard = chooseSewerStandardFamily(5, rng);
    rooms.push(spec(`standard:${i}`, "standard", standard.family, "normal", standard.className, true));
  }
  rooms.push(spec("goo", "standard", goo.family, "large", goo.className));
  rooms.push(spec("rat-king", "special", "ratKing", "normal", "RatKingRoom"));

  return {
    kind: "regular",
    levelKind: "sewerBoss",
    depth: 5,
    region: "sewer",
    feeling: "none",
    standardRoomBudget: 3,
    specialRoomBudget: 0,
    secretRoomCount: 0,
    builder: {
      kind: "figureEight",
      curveExponent: 2,
      curveIntensity: 0.3 + rng.next() * 0.5,
      curveOffset: 0,
      pathVariance: 45,
      pathLength: 1,
      pathLenJitterChances: [1],
      pathTunnelChances: [1, 2],
      branchTunnelChances: [1],
      extraConnectionChance: 0.3,
    },
    painter: {
      waterFill: 0.5,
      waterSmoothness: 5,
      grassFill: 0.2,
      grassSmoothness: 4,
      trapCount: 0,
      trapKinds: [],
      trapChances: [],
    },
    rooms,
  };
}

function createSewerRooms(
  depth: number,
  rng: RNG,
  standardRoomBudget: number,
  specialRoomBudget: number,
  secretRoomCount: number,
): RegularRoomSpec[] {
  const entrance = chooseEntrance(depth, rng);
  const exit = chooseExit(depth, rng);
  const rooms: RegularRoomSpec[] = [
    spec("entrance", "entrance", entrance.family, "normal", entrance.className),
    spec("exit", "exit", exit.family, "normal", exit.className),
  ];

  let spent = 0;
  let index = 0;
  while (spent < standardRoomBudget) {
    const standard = chooseSewerStandardFamily(depth, rng);
    const allowedBudget = standardRoomBudget - spent;
    const sizeCategory = chooseSizeCategoryForFamily(
      standard.family,
      rng,
      (["normal", "large", "giant"] as const).filter((cat) => sizeValue(cat) <= allowedBudget),
    );
    rooms.push(spec(`standard:${index++}`, "standard", standard.family, sizeCategory, standard.className));
    spent += sizeValue(sizeCategory);
  }

  for (let i = 0; i < specialRoomBudget; i++) {
    rooms.push(spec(`special:${i}`, "special", "safeSpecial", "normal", "SafeSpecialRoom"));
  }
  for (let i = 0; i < secretRoomCount; i++) {
    rooms.push(spec(`secret:${i}`, "secret", "safeSecret", "normal", "SafeSecretRoom"));
  }
  return rooms;
}

function createBuilderConfig(kind: BuilderKind, rng: RNG): RegularBuilderConfig {
  return {
    kind,
    curveExponent: 2,
    curveIntensity: kind === "loop" ? rng.next() * 0.65 : 0.3 + rng.next() * 0.5,
    curveOffset: kind === "loop" ? rng.next() * 0.5 : 0,
    pathVariance: 45,
    pathLength: 0.25,
    pathLenJitterChances: PATH_LEN_JITTER,
    pathTunnelChances: PATH_TUNNELS,
    branchTunnelChances: BRANCH_TUNNELS,
    extraConnectionChance: 0.3,
  };
}

function createSewerPainterConfig(depth: number, feeling: LevelFeeling, rng: RNG): RegularPainterConfig {
  const traps = sewerTrapsForDepth(depth);
  return {
    waterFill: feeling === "water" ? 0.85 : 0.3,
    waterSmoothness: 5,
    grassFill: feeling === "grass" ? 0.8 : 0.2,
    grassSmoothness: 4,
    trapCount: normalIntRange(rng, 2, 3 + Math.floor(depth / 5)),
    trapKinds: traps.map((trap) => trap.kind),
    trapChances: traps.map((trap) => trap.weight),
  };
}

function chooseFeeling(depth: number, rng: RNG): LevelFeeling {
  if (depth <= 1) return "none";
  switch (rng.nextInt(14)) {
    case 1: return "water";
    case 2: return "grass";
    case 4: return "large";
    case 5: return "traps";
    case 6: return "secrets";
    default: return "none";
  }
}

function chooseEntrance(depth: number, rng: RNG): { family: RoomFamily; className: string } {
  const weights = depth <= 2 ? [4, 3, 0, 0] : [4, 3, 2, 1];
  return ENTRANCE_POOL[Math.max(0, weightedIndex(rng, weights))]!;
}

function chooseExit(depth: number, rng: RNG): { family: RoomFamily; className: string } {
  const weights = depth <= 1 ? [4, 3, 0, 0] : [4, 3, 2, 1];
  return EXIT_POOL[Math.max(0, weightedIndex(rng, weights))]!;
}

function chooseSewerStandardFamily(depth: number, rng: RNG): { family: RoomFamily; className: string } {
  const clampedDepth = Math.max(1, Math.min(5, depth));
  return REGULAR_SEWER_STANDARD[Math.max(0, weightedIndex(
    rng,
    REGULAR_SEWER_STANDARD.map((entry) => entry.weightByDepth[clampedDepth] ?? 0),
  ))]!;
}

function sizeValue(size: SizeCategory): number {
  if (size === "giant") return 3;
  if (size === "large") return 2;
  return 1;
}

function chooseSewerSecretDepths(seed: string): Set<number> {
  const depths = [2, 3, 4];
  new RNG(`${seed}:regular-secrets`).shuffle(depths);
  return new Set(depths.slice(0, 1));
}

function spec(
  id: string,
  role: RoomRole,
  family: RoomFamily,
  sizeCategory: SizeCategory,
  className: string,
  forcedNormal = false,
): RegularRoomSpec {
  return { id, role, family, sizeCategory, className, forcedNormal };
}

export function weightedIndex(rng: RNG, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return -1;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= Math.max(0, weights[i] ?? 0);
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

function normalIntRange(rng: RNG, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor((rng.next() + rng.next()) * (max - min + 1) / 2);
}
