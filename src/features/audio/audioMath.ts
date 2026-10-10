import { clamp, clamp01, isFiniteNumber, midiToFrequency } from "@/lib/math";
import type { AudioNoteEvent, AudioTargets, VoiceCommand } from "@/types/instruments";

/** Hard safety limits applied to everything sent to the audio graph. */
export const AUDIO_LIMITS = {
  maxMasterGain: 0.9,
  maxLayerGain: 0.22,
  maxNoteGain: 0.18,
  minFilterHz: 180,
  maxFilterHz: 6000,
  /** Enough for a harp strum to ring out; each voice is short-lived. */
  maxPolyphony: 14,
  /** Held notes (piano chords, orchestra sections); the oldest is released when exceeded. */
  maxSustainedVoices: 24,
  minMidi: 24,
  maxMidi: 108,
  /** Minimum time between two discrete notes (a fast strum is ~40 ms per string). */
  minNoteIntervalMs: 30,
  maxPitchSemitones: 12,
} as const;

export const SILENT_TARGETS: AudioTargets = { level: 0, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };

const safe = (value: number, fallback: number): number => (isFiniteNumber(value) ? value : fallback);

export function clampAudioTargets(targets: AudioTargets): AudioTargets {
  return {
    level: clamp01(safe(targets.level, 0)),
    brightness: clamp01(safe(targets.brightness, 0.3)),
    pitch: clamp(safe(targets.pitch, 0), -AUDIO_LIMITS.maxPitchSemitones, AUDIO_LIMITS.maxPitchSemitones),
    pan: clamp01(safe(targets.pan, 0.5)),
    texture: clamp01(safe(targets.texture, 0)),
  };
}

export function clampNote(note: AudioNoteEvent): AudioNoteEvent {
  return {
    kind: note.kind,
    degree: Math.round(clamp(safe(note.degree, 0), -14, 21)),
    velocity: clamp01(safe(note.velocity, 0)),
    pan: clamp01(safe(note.pan, 0.5)),
  };
}

export function clampVoiceCommand(command: VoiceCommand): VoiceCommand {
  switch (command.type) {
    case "on":
      return {
        ...command,
        midi: clamp(safe(command.midi, 60), AUDIO_LIMITS.minMidi, AUDIO_LIMITS.maxMidi),
        velocity: clamp01(safe(command.velocity, 0.6)),
        pan: clamp01(safe(command.pan, 0.5)),
      };
    case "update":
      return {
        ...command,
        midi: command.midi === undefined ? undefined : clamp(safe(command.midi, 60), AUDIO_LIMITS.minMidi, AUDIO_LIMITS.maxMidi),
        expression: command.expression === undefined ? undefined : clamp01(safe(command.expression, 1)),
        pan: command.pan === undefined ? undefined : clamp01(safe(command.pan, 0.5)),
        glideMs: command.glideMs === undefined ? undefined : clamp(safe(command.glideMs, 0), 0, 2000),
      };
    case "off":
      return { ...command, releaseSeconds: command.releaseSeconds === undefined ? undefined : clamp(safe(command.releaseSeconds, 0.2), 0.01, 4) };
    default:
      return command;
  }
}

/** Resolves a (possibly negative or out-of-range) scale degree to a MIDI note. */
export function degreeToMidi(rootNote: number, scale: readonly number[], degree: number): number {
  if (scale.length === 0) return rootNote;
  const octave = Math.floor(degree / scale.length);
  const index = ((degree % scale.length) + scale.length) % scale.length;
  return rootNote + octave * 12 + (scale[index] ?? 0);
}

export const degreeToFrequency = (rootNote: number, scale: readonly number[], degree: number): number =>
  midiToFrequency(degreeToMidi(rootNote, scale, degree));

/** Maps 0..1 brightness to a filter cutoff on a perceptual (exponential) curve. */
export function brightnessToCutoff(brightness: number): number {
  const b = clamp01(brightness);
  return AUDIO_LIMITS.minFilterHz * (AUDIO_LIMITS.maxFilterHz / AUDIO_LIMITS.minFilterHz) ** b;
}

/** Converts 0..1 volume slider to gain with a gentle perceptual curve. */
export function volumeToGain(volume: number, muted: boolean): number {
  if (muted) return 0;
  return clamp01(volume) ** 2 * AUDIO_LIMITS.maxMasterGain;
}

/** Simple token-bucket style limiter for discrete notes. */
export class NoteRateLimiter {
  private last = -Infinity;
  constructor(private readonly minIntervalMs: number = AUDIO_LIMITS.minNoteIntervalMs) {}
  allow(nowMs: number): boolean {
    if (nowMs - this.last < this.minIntervalMs) return false;
    this.last = nowMs;
    return true;
  }
}
