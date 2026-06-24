import type { Rect } from "@/core/grid/Rect";

export type RegularRegion = "sewer";
export type LevelFeeling = "none" | "water" | "grass" | "large" | "secrets";
export type BuilderKind = "loop" | "figureEight";
export type RoomRole = "entrance" | "exit" | "standard" | "special" | "secret" | "connection" | "shop";
export type RoomFamily =
  | "empty"
  | "sewerPipe"
  | "ring"
  | "waterBridge"
  | "regionDecoPatch"
  | "circleBasin"
  | "safeSpecial"
  | "safeSecret"
  | "connection"
  | "bossEntrance"
  | "bossExit"
  | "gooDiamond"
  | "gooWalled"
  | "gooThinPillars"
  | "gooThickPillars"
  | "ratKing";
export type SizeCategory = "normal" | "large" | "giant";
export type RegularLevelKind = "sewerRegular" | "sewerBoss";

export interface RegularRoomSpec {
  id: string;
  role: RoomRole;
  family: RoomFamily;
  sizeCategory: SizeCategory;
  className?: string;
  forcedNormal?: boolean;
}

export interface RegularBuilderConfig {
  kind: BuilderKind;
  curveExponent: number;
  curveIntensity: number;
  curveOffset: number;
  pathVariance: number;
  pathLength: number;
  pathLenJitterChances: readonly number[];
  pathTunnelChances: readonly number[];
  branchTunnelChances: readonly number[];
  extraConnectionChance: number;
}

export interface RegularPainterConfig {
  waterFill: number;
  waterSmoothness: number;
  grassFill: number;
  grassSmoothness: number;
  trapCount: number;
  trapKinds: readonly string[];
}

export interface RegularLevelPlan {
  kind: "regular";
  levelKind?: RegularLevelKind;
  depth: number;
  region: RegularRegion;
  feeling: LevelFeeling;
  standardRoomBudget: number;
  specialRoomBudget: number;
  secretRoomCount: number;
  builder: RegularBuilderConfig;
  painter: RegularPainterConfig;
  rooms: readonly RegularRoomSpec[];
}

export interface GeneratedRoomMetadata {
  id: string;
  role: RoomRole;
  family: RoomFamily;
  sizeCategory: SizeCategory;
  rect: { x: number; y: number; w: number; h: number };
  connections: string[];
  className?: string;
  markers?: string[];
}

export interface GeneratedTrapMetadata {
  cell: number;
  kind: string;
  visible: boolean;
  active: boolean;
}

export interface BuiltRegularLevel {
  rooms: RegularRoomLike[];
  entrance: RegularRoomLike;
  exit: RegularRoomLike;
  builderKind: BuilderKind;
}

export interface RegularRoomLike {
  readonly id: string;
  readonly role: RoomRole;
  readonly family: RoomFamily;
  readonly sizeCategory: SizeCategory;
  readonly className?: string;
  rect: Rect | null;
  readonly connectedRooms: RegularRoomLike[];
}
