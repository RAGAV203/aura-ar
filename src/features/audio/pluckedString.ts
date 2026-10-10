import { clamp, clamp01, midiToFrequency } from "@/lib/math";
import type { PluckedKind } from "@/types/instruments";
import { AUDIO_LIMITS } from "./audioMath";
import type { SustainedVoice } from "./sustainedVoices";

/**
 * Karplus–Strong plucked-string model.
 *
 * A short burst of filtered noise circulates in a delay line one period long;
 * each pass averages neighbouring samples (a gentle low-pass, so high
 * harmonics die first, exactly like a real string) and loses a little energy.
 * An all-pass filter supplies the fractional part of the period so high notes
 * stay in tune. Sitar/veena "jawari" buzz comes from a soft non-linearity in
 * the loop that keeps regenerating upper harmonics.
 *
 * Notes are rendered once per (timbre, pitch) into an AudioBuffer (≈1 ms of
 * work) and cached, then played with a buffer source whose playbackRate
 * provides pitch bends (meend, slides) while the string rings.
 */

interface StringModel {
  /** 0..1 brightness of the pluck (excitation low-pass). */
  brightness: number;
  /** Ring time (seconds to −60 dB) at MIDI 40; shortens with pitch. */
  ring: number;
  /** Pick position along the string, 0..0.5 (closer to the end = brighter, thinner). */
  pick: number;
  /** In-loop non-linearity for jawari buzz. */
  buzz: number;
  /** Mild overdrive for electric guitar. */
  drive: number;
  /** Peaking filters modelling the body / resonator: [Hz, dB, Q]. */
  body: Array<[number, number, number]>;
  level: number;
}

const MODELS: Record<PluckedKind, StringModel> = {
  guitar: { brightness: 0.7, ring: 5, pick: 0.18, buzz: 0, drive: 0, body: [[105, 5, 1.2], [210, 3, 1.4], [3200, 2, 1]], level: 1 },
  nylon: { brightness: 0.42, ring: 3.6, pick: 0.22, buzz: 0, drive: 0, body: [[100, 6, 1.1], [240, 3, 1.3]], level: 1.05 },
  electric: { brightness: 0.85, ring: 6, pick: 0.12, buzz: 0, drive: 1.8, body: [[1800, 3, 0.9]], level: 0.75 },
  ukulele: { brightness: 0.75, ring: 1.6, pick: 0.2, buzz: 0, drive: 0, body: [[300, 5, 1.2], [1200, 2, 1]], level: 1 },
  veena: { brightness: 0.6, ring: 6.5, pick: 0.1, buzz: 0.28, drive: 0, body: [[220, 5, 1.1], [900, 2, 1.2]], level: 0.95 },
  sitar: { brightness: 0.82, ring: 5, pick: 0.08, buzz: 0.62, drive: 0, body: [[400, 3, 1.2], [2600, 5, 1.4]], level: 0.85 },
};

export const PLUCKED_KINDS: readonly PluckedKind[] = ["guitar", "nylon", "electric", "ukulele", "veena", "sitar"];

export function isPluckedKind(kind: string): kind is PluckedKind {
  return (PLUCKED_KINDS as readonly string[]).includes(kind);
}

/** Ring time for a pitch: low strings ring longer. */
export function ringSeconds(kind: PluckedKind, midi: number): number {
  return clamp(MODELS[kind].ring * 2 ** (-(midi - 40) / 24), 0.6, 8);
}

/**
 * Renders one plucked note into a Float32Array. Pure and deterministic for a
 * given seed (so it can be unit-tested and cached).
 */
export function renderPluck(sampleRate: number, kind: PluckedKind, midi: number, seed = 1): Float32Array {
  const model = MODELS[kind];
  const frequency = midiToFrequency(midi);
  const period = sampleRate / frequency;
  // Loop delay = L − 0.5 (averaging the samples L and L−1 ago) + the all-pass delay,
  // so L + frac = period + 0.5. Keep the all-pass part in a stable range.
  let length = Math.floor(period + 0.5);
  let frac = period + 0.5 - length;
  if (frac < 0.15) {
    length -= 1;
    frac += 1;
  }
  length = Math.max(2, length);
  const c = (1 - frac) / (1 + frac);

  const ring = ringSeconds(kind, midi);
  const seconds = Math.min(ring * 1.05, 4.5);
  const total = Math.max(1, Math.floor(sampleRate * seconds));
  // Energy loss per pass so the note falls 60 dB over `ring` seconds.
  const lossPerPass = 10 ** (-3 / (ring * frequency));

  // Excitation: low-passed noise, combed at the pick position.
  let state = (seed * 2654435761) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const line = new Float32Array(length);
  let lp = 0;
  const a = 0.08 + 0.85 * model.brightness;
  for (let i = 0; i < length; i++) {
    lp += a * (random() * 2 - 1 - lp);
    line[i] = lp;
  }
  const pickOffset = Math.max(1, Math.round(model.pick * length));
  const combed = new Float32Array(length);
  for (let i = 0; i < length; i++) combed[i] = (line[i] ?? 0) - (line[(i - pickOffset + length) % length] ?? 0);
  let mean = 0;
  for (let i = 0; i < length; i++) mean += combed[i] ?? 0;
  mean /= length;
  let peak = 1e-6;
  for (let i = 0; i < length; i++) {
    const v = (combed[i] ?? 0) - mean;
    combed[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < length; i++) combed[i] = (combed[i] ?? 0) / peak;

  const out = new Float32Array(total);
  let ptr = 0;
  let apX = 0;
  let apY = 0;
  const buzz = model.buzz * 0.4;
  for (let n = 0; n < total; n++) {
    const current = combed[ptr] ?? 0;
    const next = combed[(ptr + 1) % length] ?? 0;
    out[n] = current;
    let value = lossPerPass * 0.5 * (current + next);
    if (buzz > 0) value -= buzz * value * value * value; // jawari: soft bridge contact keeps the buzz alive
    // Fractional delay (first-order all-pass).
    const y = c * value + apX - c * apY;
    apX = value;
    apY = y;
    combed[ptr] = y;
    ptr = (ptr + 1) % length;
  }

  // Post: drive (electric), buzz brilliance, and a short fade to avoid a click at the end.
  let prev = 0;
  const drive = model.drive;
  const norm = drive > 0 ? Math.tanh(drive) : 1;
  for (let n = 0; n < total; n++) {
    let v = out[n] ?? 0;
    if (drive > 0) v = Math.tanh(v * drive) / norm;
    if (model.buzz > 0) {
      const edge = v - prev;
      prev = out[n] ?? 0;
      v += model.buzz * 0.35 * edge;
    }
    out[n] = v;
  }
  const fade = Math.min(total, Math.floor(sampleRate * 0.05));
  for (let i = 0; i < fade; i++) out[total - 1 - i] = (out[total - 1 - i] ?? 0) * (i / fade);
  return out;
}

/* ---------- Buffer cache ---------- */

const CACHE_LIMIT = 32;
const cache = new Map<string, AudioBuffer>();

function bufferFor(context: BaseAudioContext, kind: PluckedKind, midi: number): AudioBuffer {
  const rounded = Math.round(midi);
  const key = `${kind}:${rounded}:${context.sampleRate}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const data = renderPluck(context.sampleRate, kind, rounded, rounded * 31 + kind.length);
  const buffer = context.createBuffer(1, data.length, context.sampleRate);
  buffer.getChannelData(0).set(data);
  cache.set(key, buffer);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return buffer;
}

/* ---------- Voice ---------- */

/**
 * A ringing string. setPitch bends it (meend / slide) by changing the
 * playback rate relative to the note it was plucked at; release damps it.
 */
export function createPluckedVoice(
  context: BaseAudioContext,
  output: AudioNode,
  kind: PluckedKind,
  midi: number,
  velocity: number,
  pan: number,
  onEnded: () => void,
): SustainedVoice {
  const model = MODELS[kind];
  const now = context.currentTime + 0.002;
  const base = Math.round(midi);
  const source = context.createBufferSource();
  source.buffer = bufferFor(context, kind, base);
  source.playbackRate.value = 2 ** ((midi - base) / 12);

  // Softer plucks are darker: velocity drives a low-pass.
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1200 + clamp01(velocity) ** 1.2 * 9000;
  let node: AudioNode = source.connect(tone);
  for (const [frequency, gain, q] of model.body) {
    const peak = context.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = frequency;
    peak.gain.value = gain;
    peak.Q.value = q;
    node = node.connect(peak);
  }
  const env = context.createGain();
  const level = AUDIO_LIMITS.maxNoteGain * model.level * (0.3 + 0.7 * clamp01(velocity)) * 1.6;
  env.gain.value = level;
  const panner = context.createStereoPanner();
  panner.pan.value = (clamp01(pan) - 0.5) * 1.4;
  node.connect(env).connect(panner).connect(output);

  let released = false;
  source.onended = () => {
    panner.disconnect();
    onEnded();
  };
  source.start(now);

  return {
    kind,
    startedAt: now,
    setPitch(nextMidi, glideSeconds) {
      if (released) return;
      const rate = 2 ** ((nextMidi - base) / 12);
      if (glideSeconds <= 0) source.playbackRate.setValueAtTime(rate, context.currentTime);
      else source.playbackRate.setTargetAtTime(rate, context.currentTime, glideSeconds / 3);
    },
    setExpression(expression) {
      if (released) return;
      env.gain.setTargetAtTime(level * (0.2 + 0.8 * clamp01(expression)), context.currentTime, 0.03);
    },
    setPan(next) {
      if (released) return;
      panner.pan.setTargetAtTime((clamp01(next) - 0.5) * 1.4, context.currentTime, 0.05);
    },
    release(seconds) {
      if (released) return;
      released = true;
      const at = context.currentTime;
      const length = seconds ?? 0.12;
      env.gain.cancelScheduledValues(at);
      env.gain.setValueAtTime(env.gain.value, at);
      env.gain.setTargetAtTime(0, at, Math.max(0.008, length / 4));
      try {
        source.stop(at + length + 0.08);
      } catch {
        /* already stopped */
      }
    },
  };
}
