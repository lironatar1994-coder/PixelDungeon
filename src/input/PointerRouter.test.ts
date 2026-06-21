import { describe, it, expect } from "vitest";
import { PointerRouter, rectLayer } from "@/input/PointerRouter";

describe("PointerRouter (input multiplexer)", () => {
  it("REQUIRED: a click on a UI layer is consumed and does NOT reach the world", () => {
    const router = new PointerRouter();
    // A HUD bar across the top 48px.
    router.addLayer(rectLayer("hud", { x: 0, y: 0, w: 800, h: 48 }));

    // Inside the HUD -> consumed by "hud", world never sees it.
    expect(router.route({ x: 100, y: 20 })).toBe("hud");
    // Below the HUD -> falls through to the world (null).
    expect(router.route({ x: 100, y: 200 })).toBe(null);
  });

  it("tests higher-z layers first", () => {
    const router = new PointerRouter();
    router.addLayer(rectLayer("background-panel", { x: 0, y: 0, w: 100, h: 100 }, 1));
    router.addLayer(rectLayer("modal-on-top", { x: 0, y: 0, w: 100, h: 100 }, 10));
    // Overlapping region: the top (higher z) layer wins.
    expect(router.route({ x: 50, y: 50 })).toBe("modal-on-top");
  });

  it("skips disabled layers", () => {
    const router = new PointerRouter();
    router.addLayer(rectLayer("closed-modal", { x: 0, y: 0, w: 100, h: 100 }));
    router.setEnabled("closed-modal", false);
    // Disabled -> the click passes through to the world.
    expect(router.route({ x: 50, y: 50 })).toBe(null);
  });

  it("removes layers", () => {
    const router = new PointerRouter();
    router.addLayer(rectLayer("temp", { x: 0, y: 0, w: 100, h: 100 }));
    expect(router.route({ x: 10, y: 10 })).toBe("temp");
    router.removeLayer("temp");
    expect(router.route({ x: 10, y: 10 })).toBe(null);
  });
});
