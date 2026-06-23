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

export interface SewerPlanOverrides {
  feeling?: LevelFeeling;
  builderKind?: BuilderKind;
  secretRoomCount?: number;
}

const DEFAULT_PATH_LEN_JITTER = [0, 0, 0, 1] as const;
const DEFAULT_PATH_TUNNELS = [2, 2, 1] as const;
const DEFAULT_BRANCH_TUNNELS = [1, 1, 0] as const;

const SEWER_STANDARD_POOL: Array<{ family: RoomFamily; weightByDepth: readonly number[] }> = [
  { family: "sewerPipe", weightByDepth: [0, 16, 16, 16, 16, 16] },
  { family: "ring", weightByDepth: [0, 8, 8, 8, 8, 8] },
  { family: "waterBridge", weightByDepth: [0, 8, 8, 8, 8, 8] },
  { family: "regionDecoPatch", weightByDepth: [0, 4, 4, 4, 4, 4] },
  { family: "circleBasin", weightByDepth: [0, 4, 4, 4, 4, 0] },
  { family: "empty", weightByDepth: [0, 1, 1, 1, 1, 1] },
];

const SAFE_SPECIALS: readonly RoomFamily[] = [
  "safeSpecial",
  "regionDecoPatch",
  "waterBridge",
  "circleBasin",
];

const SAFE_SECRETS: readonly RoomFamily[] = [
  "safeSecret",
  "regionDecoPatch",
  "empty",
];

export function buildDungeonGenerationPlans(seed: string, depthCount: number): Array<RegularLevelPlan | null> {
  const plans: Array<RegularLevelPlan | null> = new Array(depthCount + 1).fill(null);
  const sewerSecrets = chooseSewerSecretDepths(seed);
  for (let depth = 1; depth <= Math.min(5, depthCount); depth++) {
    plans[depth] = createSewerRegularLevelPlan(
      depth,
      new RNG(`${seed}:regular:${depth}`),
      { secretRoomCount: sewerSecrets.has(depth) ? 1 : 0 },
    );
  }
  return plans;
}

export function createSewerRegularLevelPlan(
  depth: number,
  rng: RNG,
  overrides: SewerPlanOverrides = {},
): RegularLevelPlan {
  const feeling = overrides.feeling ?? chooseFeeling(rng);
  const builderKind = overrides.builderKind ?? (rng.bool() ? "loop" : "figureEight");
  const standardRoomBudget = feeling === "large" ? 6 : 4 + weightedIndex(rng, [1, 3, 1]);
  const specialRoomBudget = feeling === "large" ? 2 : 1 + weightedIndex(rng, [1, 4]);
  const secretRoomCount = overrides.secretRoomCount ?? (depth === 1 ? 0 : rng.chance(0.25) ? 1 : 0);
  const rooms = createSewerRooms(depth, rng, standardRoomBudget, specialRoomBudget, secretRoomCount);

  return {
    kind: "regular",
    depth,
    region: "sewer",
    feeling,
    standardRoomBudget,
    specialRoomBudget,
    secretRoomCount,
    builder: createBuilderConfig(builderKind, rng),
    painter: createSewerPainterConfig(depth, feeling, rng),
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
  const rooms: RegularRoomSpec[] = [
    spec("entrance", "entrance", chooseEntranceFamily(depth, rng), "normal"),
    spec("exit", "exit", chooseExitFamily(depth, rng), "normal"),
  ];

  let spent = 0;
  let standardIndex = 0;
  while (spent < standardRoomBudget) {
    const family = chooseSewerStandardFamily(depth, rng);
    const sizeCategory = chooseStandardSize(rng, standardRoomBudget - spent);
    rooms.push(spec(`standard:${standardIndex++}`, "standard", family, sizeCategory));
    spent += sizeValue(sizeCategory);
  }

  for (let i = 0; i < specialRoomBudget; i++) {
    rooms.push(spec(`special:${i}`, "special", rng.pick(SAFE_SPECIALS), "normal"));
  }
  for (let i = 0; i < secretRoomCount; i++) {
    rooms.push(spec(`secret:${i}`, "secret", rng.pick(SAFE_SECRETS), "normal"));
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
    pathLenJitterChances: DEFAULT_PATH_LEN_JITTER,
    pathTunnelChances: DEFAULT_PATH_TUNNELS,
    branchTunnelChances: DEFAULT_BRANCH_TUNNELS,
    extraConnectionChance: 0.3,
  };
}

function createSewerPainterConfig(depth: number, feeling: LevelFeeling, rng: RNG): RegularPainterConfig {
  return {
    waterFill: feeling === "water" ? 0.85 : 0.3,
    waterSmoothness: 5,
    grassFill: feeling === "grass" ? 0.8 : 0.2,
    grassSmoothness: 4,
    trapCount: rng.range(2, 3 + Math.floor(depth / 5)),
    trapKinds: depth === 1
      ? ["wornDart"]
      : ["chilling", "shocking", "toxic", "wornDart", "alarm", "ooze"],
  };
}

function chooseFeeling(rng: RNG): LevelFeeling {
  return rng.pick([
    "none",
    "none",
    "none",
    "water",
    "grass",
    "large",
    "secrets",
  ] as const);
}

function chooseEntranceFamily(depth: number, rng: RNG): RoomFamily {
  return depth <= 2
    ? weightedPick(rng, ["waterBridge", "regionDecoPatch"], [4, 3])
    : weightedPick(rng, ["waterBridge", "regionDecoPatch", "ring", "circleBasin"], [4, 3, 2, 1]);
}

function chooseExitFamily(depth: number, rng: RNG): RoomFamily {
  return depth <= 1
    ? weightedPick(rng, ["waterBridge", "regionDecoPatch"], [4, 3])
    : weightedPick(rng, ["waterBridge", "regionDecoPatch", "ring", "circleBasin"], [4, 3, 2, 1]);
}

function chooseSewerStandardFamily(depth: number, rng: RNG): RoomFamily {
  const clampedDepth = Math.max(1, Math.min(5, depth));
  return weightedPick(
    rng,
    SEWER_STANDARD_POOL.map((entry) => entry.family),
    SEWER_STANDARD_POOL.map((entry) => entry.weightByDepth[clampedDepth] ?? 0),
  );
}

function chooseStandardSize(rng: RNG, remainingBudget: number): SizeCategory {
  if (remainingBudget >= 3 && rng.chance(0.08)) return "giant";
  if (remainingBudget >= 2 && rng.chance(0.22)) return "large";
  return "normal";
}

function sizeValue(size: SizeCategory): number {
  if (size === "giant") return 3;
  if (size === "large") return 2;
  return 1;
}

function chooseSewerSecretDepths(seed: string): Set<number> {
  const depths = [2, 3, 4, 5];
  new RNG(`${seed}:regular-secrets`).shuffle(depths);
  return new Set(depths.slice(0, 2));
}

function spec(id: string, role: RoomRole, family: RoomFamily, sizeCategory: SizeCategory): RegularRoomSpec {
  return { id, role, family, sizeCategory };
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

function weightedPick<T>(rng: RNG, values: readonly T[], weights: readonly number[]): T {
  const index = weightedIndex(rng, weights);
  if (index < 0) return rng.pick(values);
  return values[index]!;
}
