/**
 * viewport.ts - pure screen<->tile math shared by the renderer and input.
 *
 * The map is drawn through a hero-centered camera. Both MapScene (drawing) and
 * main.ts (tap-to-cell conversion) use the same camera viewport so pan/zoom
 * cannot drift between rendering and input.
 */
import type { Grid } from "@/core/grid/Grid";

/** Top strip that should keep swallowing taps for the floating HP/depth HUD. */
export const MAP_TOP_INSET = 88;
const BASE_TILE_SIZE = 16;
const MIN_READABLE_TILE_SIZE = 32;
const MAX_TILE_SIZE = 56;
const TARGET_VISIBLE_TILES_PORTRAIT = 11;
const TARGET_VISIBLE_TILES_LANDSCAPE = 15;
export const MIN_ZOOM_MULTIPLIER = 0.5;
export const MAX_ZOOM_MULTIPLIER = 3;

export interface Viewport {
  tileSize: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface CameraPan {
  x: number;
  y: number;
}

export interface CameraViewportOptions {
  allowOutOfBounds?: boolean;
}

/**
 * Create a hero-centered camera. Offsets are clamped so map edges do not drift
 * away from the viewport when the hero is near a boundary.
 */
export function computeCameraViewport(
  viewW: number,
  viewH: number,
  grid: Grid,
  focusCell: number,
  zoomMultiplier = 1,
  pan: CameraPan = { x: 0, y: 0 },
  opts: CameraViewportOptions = {},
): Viewport {
  const metrics = cameraMetrics(viewW, viewH, grid, focusCell, zoomMultiplier);
  const appliedPan = opts.allowOutOfBounds
    ? finitePan(pan)
    : clampPan(metrics, viewW, viewH, pan);
  const rawOffsetX = metrics.idealX + appliedPan.x;
  const rawOffsetY = metrics.idealY + appliedPan.y;
  const offsetX = opts.allowOutOfBounds
    ? rawOffsetX
    : clampOffset(rawOffsetX, viewW, metrics.mapW);
  const offsetY = opts.allowOutOfBounds
    ? rawOffsetY
    : clampOffset(rawOffsetY, viewH, metrics.mapH);

  return { tileSize: metrics.tileSize, offsetX, offsetY, scale: metrics.scale };
}

export function clampCameraPan(
  viewW: number,
  viewH: number,
  grid: Grid,
  focusCell: number,
  zoomMultiplier = 1,
  pan: CameraPan = { x: 0, y: 0 },
): CameraPan {
  return clampPan(cameraMetrics(viewW, viewH, grid, focusCell, zoomMultiplier), viewW, viewH, pan);
}

export function clampZoomMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_ZOOM_MULTIPLIER, Math.min(MAX_ZOOM_MULTIPLIER, value));
}

/** Convert a pixel position into a grid cell, or null if it's off the map. */
export function pixelToCell(
  vp: Viewport,
  grid: Grid,
  px: number,
  py: number,
): number | null {
  const x = Math.floor((px - vp.offsetX) / vp.tileSize);
  const y = Math.floor((py - vp.offsetY) / vp.tileSize);
  if (!grid.inBounds(x, y)) return null;
  return grid.cell(x, y);
}

function clampOffset(offset: number, viewSize: number, mapSize: number): number {
  if (mapSize <= viewSize) return Math.floor((viewSize - mapSize) / 2);
  return Math.max(viewSize - mapSize, Math.min(0, offset));
}

function cameraMetrics(
  viewW: number,
  viewH: number,
  grid: Grid,
  focusCell: number,
  zoomMultiplier: number,
): {
  tileSize: number;
  scale: number;
  idealX: number;
  idealY: number;
  mapW: number;
  mapH: number;
} {
  const zoom = clampZoomMultiplier(zoomMultiplier);
  const targetTiles =
    viewW >= viewH ? TARGET_VISIBLE_TILES_LANDSCAPE : TARGET_VISIBLE_TILES_PORTRAIT;
  const baseTileSize = Math.max(
    MIN_READABLE_TILE_SIZE,
    Math.min(MAX_TILE_SIZE, Math.floor(Math.min(viewW, viewH) / targetTiles)),
  );
  const tileSize = Math.max(1, Math.floor(baseTileSize * zoom));
  const scale = tileSize / BASE_TILE_SIZE;
  const focusX = grid.xOf(focusCell) + 0.5;
  const focusY = grid.yOf(focusCell) + 0.5;
  const mapW = grid.width * tileSize;
  const mapH = grid.height * tileSize;
  const idealX = Math.floor(viewW / 2 - focusX * tileSize);
  const idealY = Math.floor(viewH / 2 - focusY * tileSize);
  return { tileSize, scale, idealX, idealY, mapW, mapH };
}

function clampPan(
  metrics: ReturnType<typeof cameraMetrics>,
  viewW: number,
  viewH: number,
  pan: CameraPan,
): CameraPan {
  return {
    x: clampPanAxis(pan.x, metrics.idealX, viewW, metrics.mapW),
    y: clampPanAxis(pan.y, metrics.idealY, viewH, metrics.mapH),
  };
}

function finitePan(pan: CameraPan): CameraPan {
  return {
    x: Number.isFinite(pan.x) ? Math.round(pan.x) : 0,
    y: Number.isFinite(pan.y) ? Math.round(pan.y) : 0,
  };
}

function clampPanAxis(pan: number, idealOffset: number, viewSize: number, mapSize: number): number {
  if (mapSize <= viewSize) return 0;
  const min = viewSize - mapSize - idealOffset;
  const max = -idealOffset;
  if (!Number.isFinite(pan)) return 0;
  return Math.max(min, Math.min(max, Math.round(pan)));
}
