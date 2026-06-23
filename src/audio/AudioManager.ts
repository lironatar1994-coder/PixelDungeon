import type { EventBus, GameEvents } from "@/events/EventBus";

type AudioCue = GameEvents["audio:sfx"]["cue"];

type CueConfig = {
  file: string;
  volume?: number;
};

const BASE = import.meta.env.BASE_URL;

const CUES: Record<AudioCue, CueConfig> = {
  ui_click: { file: "click.mp3", volume: 0.32 },
  hit: { file: "hit.mp3", volume: 0.42 },
  miss: { file: "miss.mp3", volume: 0.35 },
  death: { file: "death.mp3", volume: 0.55 },
  drink: { file: "drink.mp3", volume: 0.45 },
  eat: { file: "eat.mp3", volume: 0.4 },
  descend: { file: "descend.mp3", volume: 0.5 },
  door: { file: "door_open.mp3", volume: 0.35 },
  pickup: { file: "item.mp3", volume: 0.45 },
  step: { file: "step.mp3", volume: 0.24 },
  health_warn: { file: "health_warn.mp3", volume: 0.36 },
  health_critical: { file: "health_critical.mp3", volume: 0.42 },
  levelup: { file: "levelup.mp3", volume: 0.48 },
};

/**
 * Browser-only audio adapter. It listens to EventBus signals and never owns
 * gameplay decisions, keeping sound effects outside the deterministic core.
 */
export class AudioManager {
  private readonly sounds = new Map<AudioCue, HTMLAudioElement>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly unlockHandlers: Array<() => void> = [];
  private unlocked = false;

  constructor(bus: EventBus) {
    this.preload();
    this.installUnlockHandlers();
    this.unsubscribers.push(
      bus.on("audio:sfx", ({ cue }) => this.play(cue)),
      bus.on("combat:strike", ({ hit }) => this.play(hit ? "hit" : "miss")),
      bus.on("actor:move", ({ actorId }) => {
        if (actorId === "hero") this.play("step");
      }),
      bus.on("hero:damaged", ({ hp }) => {
        if (hp <= 0) return;
        this.play(hp <= 5 ? "health_critical" : "health_warn");
      }),
      bus.on("game:over", () => this.play("death")),
    );
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    for (const remove of this.unlockHandlers) remove();
    this.sounds.clear();
  }

  private preload(): void {
    for (const [cue, config] of Object.entries(CUES) as Array<[AudioCue, CueConfig]>) {
      const audio = new Audio(`${BASE}assets/${config.file}`);
      audio.preload = "auto";
      audio.volume = config.volume ?? 0.5;
      this.sounds.set(cue, audio);
    }
  }

  private installUnlockHandlers(): void {
    const unlock = (): void => {
      if (this.unlocked) return;
      this.unlocked = true;
      for (const audio of this.sounds.values()) {
        audio.load();
      }
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    this.unlockHandlers.push(
      () => window.removeEventListener("pointerdown", unlock),
      () => window.removeEventListener("keydown", unlock),
    );
  }

  private play(cue: AudioCue): void {
    const source = this.sounds.get(cue);
    if (!source || !this.unlocked) return;

    const audio = source.cloneNode(true) as HTMLAudioElement;
    audio.volume = source.volume;
    audio.play().catch(() => {
      // Browsers may still reject playback under their own media policies.
    });
  }
}
