import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import {
  clampCameraPan,
  computeCameraViewport,
  MAX_ZOOM_MULTIPLIER,
  MIN_ZOOM_MULTIPLIER,
  pixelToCell,
} from "@/render/viewport";

describe("camera viewport", () => {
  it("centers the camera on the focus cell when away from edges", () => {
    const grid = new Grid(60, 60);
    const focus = grid.cell(30, 30);
    const vp = computeCameraViewport(800, 600, grid, focus);

    // The focus tile's center should land within a tile of the screen center...
    const cx = vp.offsetX + (30 + 0.5) * vp.tileSize;
    const cy = vp.offsetY + (30 + 0.5) * vp.tileSize;
    expect(Math.abs(cx - 400)).toBeLessThanOrEqual(vp.tileSize);
    expect(Math.abs(cy - 300)).toBeLessThanOrEqual(vp.tileSize);

    // ...and a tap on the screen center selects the focus cell.
    expect(pixelToCell(vp, grid, 400, 300)).toBe(focus);
  });

  it("round-trips tile centers back through zoom + pan offsets", () => {
    const grid = new Grid(60, 60);
    const vp = computeCameraViewport(1000, 800, grid, grid.cell(40, 25));
    for (const [tx, ty] of [
      [40, 25],
      [38, 23],
      [42, 27],
    ] as const) {
      const px = vp.offsetX + tx * vp.tileSize + vp.tileSize / 2;
      const py = vp.offsetY + ty * vp.tileSize + vp.tileSize / 2;
      expect(pixelToCell(vp, grid, px, py)).toBe(grid.cell(tx, ty));
    }
  });

  it("clamps the camera so it never pans past a map edge", () => {
    const grid = new Grid(60, 60);
    // Focus in the corner: offsets clamp to 0 so no off-map void is shown.
    const vp = computeCameraViewport(800, 600, grid, grid.cell(0, 0));
    expect(vp.offsetX).toBeLessThanOrEqual(0);
    expect(vp.offsetY).toBeLessThanOrEqual(0);

    // The round-trip still holds under clamped pan.
    const px = vp.offsetX + 1 * vp.tileSize + vp.tileSize / 2;
    const py = vp.offsetY + 1 * vp.tileSize + vp.tileSize / 2;
    expect(pixelToCell(vp, grid, px, py)).toBe(grid.cell(1, 1));
  });

  it("returns null for taps outside the map", () => {
    const grid = new Grid(60, 60);
    const vp = computeCameraViewport(800, 600, grid, grid.cell(0, 0));
    expect(pixelToCell(vp, grid, vp.offsetX - 50, vp.offsetY - 50)).toBeNull();
  });

  it("applies a clamped zoom multiplier while preserving screen-to-grid math", () => {
    const grid = new Grid(60, 60);
    const focus = grid.cell(30, 30);
    const base = computeCameraViewport(800, 600, grid, focus);
    const zoomed = computeCameraViewport(800, 600, grid, focus, 2);
    const min = computeCameraViewport(800, 600, grid, focus, -10);
    const max = computeCameraViewport(800, 600, grid, focus, 99);

    expect(zoomed.tileSize).toBe(base.tileSize * 2);
    expect(min.tileSize).toBe(Math.floor(base.tileSize * MIN_ZOOM_MULTIPLIER));
    expect(max.tileSize).toBe(base.tileSize * MAX_ZOOM_MULTIPLIER);
    expect(pixelToCell(zoomed, grid, 400, 300)).toBe(focus);
  });

  it("applies camera pan to both rendering offsets and tap conversion", () => {
    const grid = new Grid(60, 60);
    const focus = grid.cell(30, 30);
    const pan = clampCameraPan(800, 600, grid, focus, 1, { x: -96, y: 64 });
    const vp = computeCameraViewport(800, 600, grid, focus, 1, pan);

    const target = grid.cell(34, 27);
    const px = vp.offsetX + 34 * vp.tileSize + vp.tileSize / 2;
    const py = vp.offsetY + 27 * vp.tileSize + vp.tileSize / 2;

    expect(pan).toEqual({ x: -96, y: 64 });
    expect(pixelToCell(vp, grid, px, py)).toBe(target);
    expect(pixelToCell(vp, grid, 400, 300)).not.toBe(focus);
  });
});
