/**
 * Renderer — the ONLY module allowed to touch the canvas (Directive 1).
 *
 * Responsibilities:
 *  - Own the <canvas> and its 2D context.
 *  - Keep the drawing buffer matched to the window size AND device pixel ratio
 *    (DPR) so the picture is sharp and re-scales on every window resize.
 *  - Each clock tick: clear the screen and hand the context to the active
 *    "scene" to paint. The Renderer itself knows nothing about dungeons or
 *    HUDs — scenes (also in render/) own what gets drawn, so we can swap the
 *    Phase 1 debug view for the real map renderer in Phase 2 without touching
 *    this file.
 */
import type { EventBus } from "@/events/EventBus";

/** Everything a scene needs to paint one frame, in CSS-pixel coordinates. */
export interface FrameInfo {
  width: number;
  height: number;
  dpr: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Total seconds since the loop started. */
  elapsed: number;
}

/** A scene paints one frame onto the provided context. */
export type Scene = (ctx: CanvasRenderingContext2D, frame: FrameInfo) => void;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bus: EventBus;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private scene: Scene | null = null;

  constructor(canvas: HTMLCanvasElement, bus: EventBus) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context is not available in this browser.");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.bus = bus;

    window.addEventListener("resize", this.resize);
    this.resize();

    this.bus.on("loop:frame", ({ dt, elapsed }) => this.draw(dt, elapsed));
  }

  /** Install the active scene. Pass null to fall back to the placeholder. */
  setScene(scene: Scene | null): void {
    this.scene = scene;
  }

  /**
   * Resize the backing buffer to window size * DPR, then scale the context so
   * scenes can draw using simple CSS-pixel coordinates regardless of density.
   */
  private resize = (): void => {
    this.dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.bus.emit("render:resize", { width: this.width, height: this.height });
  };

  private draw(dt: number, elapsed: number): void {
    const { ctx, width, height, dpr } = this;

    // Clear the world to the background colour.
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, width, height);

    const frame: FrameInfo = { width, height, dpr, dt, elapsed };

    if (this.scene) {
      this.scene(ctx, frame);
    } else {
      this.drawPlaceholder(frame);
    }
  }

  /** Default view when no scene is installed (the Phase 0 pulse). */
  private drawPlaceholder(frame: FrameInfo): void {
    const { ctx } = this;
    const { width, height, elapsed } = frame;
    const pulse = (Math.sin(elapsed * 2) + 1) / 2;
    const size = 40 + pulse * 20;
    ctx.fillStyle = "#5ad1c9";
    ctx.fillRect(width / 2 - size / 2, height / 2 - size / 2, size, size);
  }
}
