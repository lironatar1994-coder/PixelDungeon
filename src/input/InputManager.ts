/**
 * InputManager — the browser glue for the input multiplexer (Directive 7).
 *
 * It listens to raw pointer events on the canvas, converts screen coordinates
 * into canvas-logical coordinates, and asks the PointerRouter who owns the
 * tap. UI hits are announced as "input:ui" and stop there; everything else is
 * announced as "input:world". Because routing is decided BEFORE anything
 * reacts, a tap on a button can never "click through" to the grid beneath it.
 *
 * This is the only input file that touches the DOM; the routing logic it uses
 * (PointerRouter) stays pure and headless-testable.
 */
import type { EventBus } from "@/events/EventBus";
import { PointerRouter, type InputLayer, type Point } from "./PointerRouter";

export class InputManager {
  readonly router = new PointerRouter();
  private readonly canvas: HTMLCanvasElement;
  private readonly bus: EventBus;

  constructor(canvas: HTMLCanvasElement, bus: EventBus) {
    this.canvas = canvas;
    this.bus = bus;
    // Stop the browser turning touches into scroll/zoom/synthetic clicks.
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  /** Register a UI region that should intercept taps before the world. */
  registerUI(layer: InputLayer): void {
    this.router.addLayer(layer);
  }

  unregisterUI(id: string): void {
    this.router.removeLayer(id);
  }

  /** Translate a DOM pointer event into canvas-logical (CSS-pixel) coords. */
  private toLocal(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { 
      x: (e.clientX - rect.left) * scaleX, 
      y: (e.clientY - rect.top) * scaleY 
    };
  }

  private pointerDownPos: Point | null = null;

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && !e.isPrimary) {
      e.preventDefault();
      return;
    }

    const point = this.toLocal(e);
    const consumedBy = this.router.route(point);

    if (consumedBy !== null) {
      // A UI layer owns this tap. Swallow it so nothing else reacts.
      e.preventDefault();
      e.stopPropagation();
      this.bus.emit("input:ui", { layer: consumedBy, x: point.x, y: point.y });
      this.pointerDownPos = null;
      return;
    }

    this.pointerDownPos = point;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch" && !e.isPrimary) {
      e.preventDefault();
      return;
    }
    
    if (!this.pointerDownPos) return;

    const upPoint = this.toLocal(e);
    const dx = upPoint.x - this.pointerDownPos.x;
    const dy = upPoint.y - this.pointerDownPos.y;
    this.pointerDownPos = null;

    if (Math.hypot(dx, dy) > 10) return;

    // No UI claimed it: it belongs to the game world.
    e.preventDefault();
    this.bus.emit("input:world", { x: upPoint.x, y: upPoint.y });
  };

  private onContextMenu = (e: MouseEvent): void => {
    // The game uses right-click itself; never show the browser menu.
    e.preventDefault();
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }
}
