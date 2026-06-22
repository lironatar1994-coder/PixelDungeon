import posthog from "posthog-js";
import type { EventBus } from "@/events/EventBus";

let initialized = false;

export function initializeTelemetry(bus: EventBus): () => void {
  if (!initialized) {
    posthog.init("YOUR_API_KEY_HERE", {
      api_host: "https://eu.i.posthog.com",
    });
    initialized = true;
  }

  const unsubscribers = [
    bus.on("game:start", () => {
      posthog.capture("Game Started");
    }),
    bus.on("hero:damaged", ({ amount, source }) => {
      posthog.capture("Hero Damaged", { amount, source });
    }),
    bus.on("game:over", (event) => {
      posthog.capture("Hero Died", {
        class: event.class,
        hero_level: event.hero_level,
        depth: event.depth,
        killer: event.killer,
        inventory: event.inventory,
      });
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
