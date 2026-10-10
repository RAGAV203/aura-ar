import { clamp, clamp01, createRandom, damp, isFiniteNumber, mapRange } from "@/lib/math";
import { SILENT_TARGETS } from "@/features/audio/audioMath";
import type {
  AudioNoteEvent,
  AudioTargets,
  ControlInput,
  InstrumentEngine,
  InstrumentParameters,
  QualityLevel,
} from "@/types/instruments";

export interface Orb {
  x: number;
  y: number;
  z: number;
  hue: number;
  size: number;
}

export const MAX_ORBS = 48;

export function sanitizeOrbs(value: unknown): Orb[] {
  if (!Array.isArray(value)) return [];
  const orbs: Orb[] = [];
  for (const item of value.slice(0, MAX_ORBS)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (![o.x, o.y, o.z, o.hue, o.size].every(isFiniteNumber)) continue;
    orbs.push({
      x: clamp(o.x as number, -10, 10),
      y: clamp(o.y as number, -10, 10),
      z: clamp(o.z as number, -10, 10),
      hue: ((o.hue as number) % 360 + 360) % 360,
      size: clamp(o.size as number, 0.05, 1),
    });
  }
  return orbs;
}

/**
 * Cosmic Garden simulation state. Rendering lives in CosmicGardenScene (React
 * Three Fiber), which reads this model inside useFrame; nothing here causes
 * React renders.
 */
export class CosmicGardenModel implements InstrumentEngine {
  readonly id = "cosmic-garden" as const;
  params: InstrumentParameters;
  quality: QualityLevel = "balanced";
  reducedMotion = false;
  yaw = 0;
  pitch = 0;
  scale = 1;
  pulse = 0;
  phase = 0;
  time = 0;
  orbs: Orb[] = [];
  /** Incremented when orbs change so the scene can refresh instance buffers. */
  orbsVersion = 0;
  readonly seed: number;
  private random: () => number;
  private targets: AudioTargets = { ...SILENT_TARGETS };
  private notes: AudioNoteEvent[] = [];
  private movement = 0;

  constructor(parameters: InstrumentParameters, seed: number) {
    this.params = { ...parameters };
    this.seed = seed;
    this.random = createRandom(seed);
  }

  resize(): void {}

  setParameters(parameters: InstrumentParameters): void {
    this.params = { ...this.params, ...parameters };
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  frame(dt: number, input: ControlInput): void {
    const step = Math.min(dt, 1 / 20) * (this.reducedMotion ? 0.4 : 1);
    this.time += step;
    const primary = input.points.find((p) => !p.lifted);
    let targetYaw = Math.sin(this.time * 0.05) * 0.25;
    let targetPitch = 0;
    if (primary) {
      targetYaw = (primary.position.x - 0.5) * 1.8;
      targetPitch = (primary.position.y - 0.5) * 0.9;
    }
    const prevYaw = this.yaw;
    this.yaw = damp(this.yaw, targetYaw, primary ? 3 : 0.5, step);
    this.pitch = damp(this.pitch, targetPitch, primary ? 3 : 0.5, step);
    this.movement = damp(this.movement, clamp01(Math.abs(this.yaw - prevYaw) / Math.max(step, 1e-3)), 4, step);

    let scaleTarget = this.params.scale ?? 1;
    if (input.spread !== null) scaleTarget *= mapRange(input.spread, 0.08, 0.8, 0.6, 1.8);
    this.scale = damp(this.scale, scaleTarget, 3, step);

    for (const event of input.events) {
      if (event.type === "accent") {
        this.pulse = 1;
        this.emit({ kind: "swell", degree: 0, velocity: 0.8, pan: 0.5 });
      } else {
        this.plant(event.position.x, event.position.y);
      }
    }
    this.pulse = damp(this.pulse, 0, 1.6, step);
    this.phase += step * (0.1 + (this.params.drift ?? 0.35) * 0.9);

    this.targets = {
      level: 0.35 + this.movement * 0.25 + this.pulse * 0.2,
      brightness: clamp01(0.35 - this.pitch * 0.5 + this.pulse * 0.3),
      pitch: Math.round(mapRange(this.scale, 0.6, 1.8, 2, -5)),
      pan: clamp01(0.5 + this.yaw * 0.4),
      texture: clamp01(this.orbs.length / MAX_ORBS + this.pulse * 0.4),
    };
  }

  /** Places an orb under the given screen position, compensating for the current viewpoint. */
  plant(screenX: number, screenY: number): void {
    const localX = (screenX - 0.5) * 9 / this.scale;
    const localY = (0.5 - screenY) * 6 / this.scale;
    const localZ = (this.random() - 0.5) * 4;
    const cos = Math.cos(-this.yaw);
    const sin = Math.sin(-this.yaw);
    const orb: Orb = {
      x: localX * cos + localZ * sin,
      y: localY,
      z: -localX * sin + localZ * cos,
      hue: ((this.params.hue ?? 220) + (this.random() - 0.5) * 120 + 360) % 360,
      size: 0.15 + this.random() * 0.25,
    };
    this.orbs.push(orb);
    if (this.orbs.length > MAX_ORBS) this.orbs.shift();
    this.orbsVersion++;
    this.emit({ kind: "pluck", degree: (this.orbs.length % 7) + Math.round((1 - screenY) * 4), velocity: 0.55, pan: screenX });
  }

  audioTargets(): AudioTargets {
    return this.targets;
  }

  drainNotes(): AudioNoteEvent[] {
    if (this.notes.length === 0) return this.notes;
    const notes = this.notes;
    this.notes = [];
    return notes;
  }

  reset(): void {
    this.orbs = [];
    this.orbsVersion++;
    this.pulse = 0;
    this.random = createRandom(this.seed);
  }

  serializeState(): Record<string, unknown> {
    return { orbs: this.orbs.map((o) => ({ ...o })) };
  }

  restoreState(state: Record<string, unknown>): void {
    this.orbs = sanitizeOrbs(state.orbs);
    this.orbsVersion++;
  }

  dispose(): void {
    this.notes = [];
  }

  private emit(note: AudioNoteEvent): void {
    if (this.notes.length < 8) this.notes.push(note);
  }
}
