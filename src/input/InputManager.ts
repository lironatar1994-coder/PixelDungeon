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
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
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
    return { 
      x: e.clientX - rect.left, 
      y: e.clientY - rect.top 
    };
  }

  private pointerDownPos: Point | null = null;
  private lastPointerPos: Point | null = null;
  private activePointerId: number | null = null;
  private pointerDragged = false;
  private readonly activePointers = new Set<number>();

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointers.add(e.pointerId);
    if (e.pointerType === "touch" && (!e.isPrimary || this.activePointers.size > 1)) {
      this.resetPointerGesture();
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
    this.lastPointerPos = point;
    this.activePointerId = e.pointerId;
    this.pointerDragged = false;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (
      this.activePointerId !== e.pointerId ||
      !this.pointerDownPos ||
      !this.lastPointerPos ||
      (e.pointerType === "touch" && this.activePointers.size > 1)
    ) {
      return;
    }

    const point = this.toLocal(e);
    const totalDx = point.x - this.pointerDownPos.x;
    const totalDy = point.y - this.pointerDownPos.y;
    const dx = point.x - this.lastPointerPos.x;
    const dy = point.y - this.lastPointerPos.y;
    this.lastPointerPos = point;

    if (Math.hypot(totalDx, totalDy) <= 4) return;

    this.pointerDragged = true;
    e.preventDefault();
    this.bus.emit("input:world-pan", { x: point.x, y: point.y, dx, dy });
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (e.pointerType === "touch" && !e.isPrimary) {
      e.preventDefault();
      return;
    }
    
    if (!this.pointerDownPos) return;

    const upPoint = this.toLocal(e);
    const dx = upPoint.x - this.pointerDownPos.x;
    const dy = upPoint.y - this.pointerDownPos.y;
    const dragged = this.pointerDragged;
    this.resetPointerGesture();

    if (dragged || Math.hypot(dx, dy) > 10) return;

    // No UI claimed it: it belongs to the game world.
    e.preventDefault();
    this.bus.emit("input:world", { x: upPoint.x, y: upPoint.y });
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    this.resetPointerGesture();
  };

  private onContextMenu = (e: MouseEvent): void => {
    // The game uses right-click itself; never show the browser menu.
    e.preventDefault();
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  private resetPointerGesture(): void {
    this.pointerDownPos = null;
    this.lastPointerPos = null;
    this.activePointerId = null;
    this.pointerDragged = false;
  }
}
