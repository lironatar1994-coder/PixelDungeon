import type { GeneratedTrapMetadata } from "@/core/procgen/regular/types";
import type { RNG } from "@/core/rng/Mulberry32";

export type SewerTrapKind =
  | "chilling"
  | "shocking"
  | "toxic"
  | "wornDart"
  | "alarm"
  | "ooze"
  | "confusion"
  | "flock"
  | "summoning"
  | "teleportation"
  | "gateway";

export interface TrapDefinition {
  kind: SewerTrapKind;
  name: string;
  weight: number;
  canBeHidden: boolean;
  canBeSearched: boolean;
  avoidsHallways: boolean;
  disarmedByActivation: boolean;
}

export type HydratedTrapMetadata = GeneratedTrapMetadata & Required<
  Pick<
    GeneratedTrapMetadata,
    "canBeHidden" | "canBeSearched" | "avoidsHallways" | "disarmedByActivation"
  >
>;

const BASE_TRAP_FLAGS = {
  canBeHidden: true,
  canBeSearched: true,
  avoidsHallways: false,
  disarmedByActivation: true,
} as const;

export const SEWER_TRAPS: readonly TrapDefinition[] = [
  { ...BASE_TRAP_FLAGS, kind: "chilling", name: "chilling trap", weight: 4 },
  { ...BASE_TRAP_FLAGS, kind: "shocking", name: "shocking trap", weight: 4 },
  { ...BASE_TRAP_FLAGS, kind: "toxic", name: "toxic trap", weight: 4 },
  { ...BASE_TRAP_FLAGS, kind: "wornDart", name: "worn dart trap", weight: 4, canBeHidden: false, avoidsHallways: true },
  { ...BASE_TRAP_FLAGS, kind: "alarm", name: "alarm trap", weight: 2 },
  { ...BASE_TRAP_FLAGS, kind: "ooze", name: "ooze trap", weight: 2 },
  { ...BASE_TRAP_FLAGS, kind: "confusion", name: "confusion trap", weight: 1 },
  { ...BASE_TRAP_FLAGS, kind: "flock", name: "flock trap", weight: 1 },
  { ...BASE_TRAP_FLAGS, kind: "summoning", name: "summoning trap", weight: 1 },
  { ...BASE_TRAP_FLAGS, kind: "teleportation", name: "teleportation trap", weight: 1 },
  { ...BASE_TRAP_FLAGS, kind: "gateway", name: "gateway trap", weight: 1, disarmedByActivation: false, avoidsHallways: true },
] as const;

const WORN_DART = SEWER_TRAPS.find((trap) => trap.kind === "wornDart")!;
const WORN_DART_ONLY = [{ ...WORN_DART, weight: 1 }] as const;

export function sewerTrapsForDepth(depth: number): readonly TrapDefinition[] {
  return depth === 1 ? WORN_DART_ONLY : SEWER_TRAPS;
}

export function trapDefinition(kind: string): TrapDefinition {
  return SEWER_TRAPS.find((trap) => trap.kind === kind) ?? WORN_DART;
}

export function weightedTrapKind(kinds: readonly string[], chances: readonly number[], rng: RNG): string {
  const total = chances.reduce((sum, chance) => sum + Math.max(0, chance), 0);
  if (total <= 0) return kinds[0] ?? "wornDart";
  let roll = rng.next() * total;
  for (let i = 0; i < kinds.length; i++) {
    roll -= Math.max(0, chances[i] ?? 0);
    if (roll < 0) return kinds[i] ?? "wornDart";
  }
  return kinds.at(-1) ?? "wornDart";
}

export function hydrateTrap(trap: GeneratedTrapMetadata): HydratedTrapMetadata {
  const definition = trapDefinition(trap.kind);
  return {
    ...trap,
    canBeHidden: trap.canBeHidden ?? definition.canBeHidden,
    canBeSearched: trap.canBeSearched ?? definition.canBeSearched,
    avoidsHallways: trap.avoidsHallways ?? definition.avoidsHallways,
    disarmedByActivation: trap.disarmedByActivation ?? definition.disarmedByActivation,
  };
}

export function applyTrapDefaults(trap: GeneratedTrapMetadata): void {
  const hydrated = hydrateTrap(trap);
  trap.canBeHidden = hydrated.canBeHidden;
  trap.canBeSearched = hydrated.canBeSearched;
  trap.avoidsHallways = hydrated.avoidsHallways;
  trap.disarmedByActivation = hydrated.disarmedByActivation;
}
