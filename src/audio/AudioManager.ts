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
  hit_slash: { file: "hit_slash.mp3", volume: 0.44 },
  hit_stab: { file: "hit_stab.mp3", volume: 0.42 },
  hit_crush: { file: "hit_crush.mp3", volume: 0.46 },
  hit_strong: { file: "hit_strong.mp3", volume: 0.5 },
  miss: { file: "miss.mp3", volume: 0.35 },
  death: { file: "death.mp3", volume: 0.55 },
  drink: { file: "drink.mp3", volume: 0.45 },
  eat: { file: "eat.mp3", volume: 0.4 },
  descend: { file: "descend.mp3", volume: 0.5 },
  door: { file: "door_open.mp3", volume: 0.35 },
  equip: { file: "sturdy.mp3", volume: 0.35 },
  drop: { file: "item.mp3", volume: 0.36 },
  pickup: { file: "item.mp3", volume: 0.45 },
  step: { file: "step.mp3", volume: 0.24 },
  unlock: { file: "unlock.mp3", volume: 0.38 },
  gold: { file: "gold.mp3", volume: 0.42 },
  secret: { file: "secret.mp3", volume: 0.44 },
  trap: { file: "trap.mp3", volume: 0.46 },
  shatter: { file: "shatter.mp3", volume: 0.45 },
  zap: { file: "zap.mp3", volume: 0.42 },
  read: { file: "read.mp3", volume: 0.42 },
  badge: { file: "badge.mp3", volume: 0.42 },
  dewdrop: { file: "dewdrop.mp3", volume: 0.38 },
  water: { file: "water.mp3", volume: 0.34 },
  grass: { file: "grass.mp3", volume: 0.32 },
  trample: { file: "trample.mp3", volume: 0.38 },
  alert: { file: "alert.mp3", volume: 0.4 },
  puff: { file: "puff.mp3", volume: 0.36 },
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
      bus.on("combat:strike", ({ attackerId, hit, damage }) => {
        if (!hit) {
          this.play("miss");
          return;
        }
        if (damage >= 8) {
          this.play("hit_strong");
        } else {
          this.play(attackerId === "hero" ? "hit_slash" : "hit");
        }
      }),
      bus.on("actor:move", ({ actorId }) => {
        if (actorId === "hero") this.play("step");
      }),
      bus.on("hero:levelup", () => this.play("levelup")),
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
