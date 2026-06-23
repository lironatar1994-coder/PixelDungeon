import { describe, it, expect } from "vitest";
import { Grid } from "@/core/grid/Grid";
import { Terrain } from "@/core/grid/terrain";
import {
  computeCameraViewport,
  pixelToCell,
} from "@/render/viewport";

describe("computeCameraViewport", () => {
  it("centers perfectly on target", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 20.5, y: 20.5 };
    const vp = computeCameraViewport(800, 600, grid, focus);

    expect(vp.tileSize).toBeGreaterThan(0);
    const focusPxX = focus.x * vp.tileSize;
    const focusPxY = focus.y * vp.tileSize;
    const screenCenterX = vp.offsetX + focusPxX;
    const screenCenterY = vp.offsetY + focusPxY;
    expect(screenCenterX).toBeCloseTo(400);
    expect(screenCenterY).toBeCloseTo(300);
  });

  it("clamps offset at right/bottom edges", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 40.5, y: 25.5 };
    const vp = computeCameraViewport(1000, 800, grid, focus);
    expect(vp.offsetX).toBeLessThanOrEqual(0);
    expect(vp.offsetY).toBeLessThanOrEqual(0);

    const maxMapX = grid.width * vp.tileSize;
    const maxMapY = grid.height * vp.tileSize;
    expect(vp.offsetX + maxMapX).toBeGreaterThanOrEqual(1000);
    expect(vp.offsetY + maxMapY).toBeGreaterThanOrEqual(800);
  });

  it("clamps offset at top/left edges", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 0.5, y: 0.5 };
    const vp = computeCameraViewport(800, 600, grid, focus);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it("centers map if view is larger than map", () => {
    const grid = new Grid(10, 10, Terrain.WALL);
    const focus = { x: 0.5, y: 0.5 };
    const vp = computeCameraViewport(800, 600, grid, focus);
    expect(vp.offsetX).toBeGreaterThan(0);
    expect(vp.offsetY).toBeGreaterThan(0);
  });

  it("applies zoom constraints", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 20.5, y: 20.5 };
    const base = computeCameraViewport(800, 600, grid, focus);
    const zoomed = computeCameraViewport(800, 600, grid, focus, 2);
    const min = computeCameraViewport(800, 600, grid, focus, -10);
    const max = computeCameraViewport(800, 600, grid, focus, 99);

    expect(zoomed.tileSize).toBeGreaterThan(base.tileSize);
    expect(min.tileSize).toBeLessThan(base.tileSize);
    expect(max.tileSize).toBeGreaterThan(zoomed.tileSize);
  });
});

describe("Camera Pan", () => {
  it("allows panning within clamp bounds", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 20.5, y: 20.5 };
    const pan = { x: -100, y: -50 };
    const vp = computeCameraViewport(800, 600, grid, focus, 1, pan);

    const focusPxX = focus.x * vp.tileSize;
    const focusPxY = focus.y * vp.tileSize;
    const screenCenterX = vp.offsetX + focusPxX;
    const screenCenterY = vp.offsetY + focusPxY;
    expect(screenCenterX).toBeCloseTo(400 - 100);
    expect(screenCenterY).toBeCloseTo(300 - 50);
  });

  it("allows detached mode to pan beyond edges", () => {
    const grid = new Grid(80, 50, Terrain.WALL);
    const focus = { x: 0.5, y: 0.5 };
    const clamped = computeCameraViewport(800, 600, grid, focus, 1, { x: 500, y: 500 });
    const detached = computeCameraViewport(
      800,
      600,
      grid,
      focus,
      1,
      { x: 500, y: 500 },
      { allowOutOfBounds: true },
    );

    expect(clamped.offsetX).toBeLessThanOrEqual(0);
    expect(clamped.offsetY).toBeLessThanOrEqual(0);
    expect(detached.offsetX).toBeGreaterThan(0);
    expect(detached.offsetY).toBeGreaterThan(0);
    expect(pixelToCell(detached, grid, 0, 0)).toBeNull();
  });
});