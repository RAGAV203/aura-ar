import { clamp01, midiToFrequency } from "@/lib/math";
import type { VoiceKind } from "@/types/instruments";
import { AUDIO_LIMITS } from "./audioMath";

/**
 * A held note built from native nodes. Created on note-on, adjusted with
 * setTargetAtTime while held (no per-frame allocation) and released with an
 * envelope on note-off, after which its nodes are stopped and disconnected.
 */
export interface SustainedVoice {
  readonly kind: VoiceKind;
  readonly startedAt: number;
  setPitch(midi: number, glideSeconds: number): void;
  setExpression(expression: number): void;
  setPan(pan: number): void;
  release(seconds?: number): void;
}

interface Partial {
  type: OscillatorType;
  ratio: number;
  gain: number;
  detune?: number;
}

interface Timbre {
  partials: Partial[];
  attack: number;
  /** Natural decay while held (piano); 0 = sustains. */
  decay: number;
  release: number;
  filterBase: number;
  /** Extra cutoff per unit of velocity × expression. */
  filterRange: number;
  /** Momentary cutoff boost at the attack (brass "blat"). */
  filterBurst: number;
  vibratoRate: number;
  vibratoDepth: number;
  vibratoDelay: number;
  /** Start this fraction below pitch and scoop up (trumpet). */
  scoop: number;
  breath: number;
  hammer: boolean;
  level: number;
}

const TIMBRES: Record<VoiceKind, Timbre> = {
  piano: {
    partials: [
      { type: "triangle", ratio: 1, gain: 0.6 },
      { type: "sine", ratio: 2.003, gain: 0.28 },
      { type: "sine", ratio: 3.01, gain: 0.12 },
      { type: "sine", ratio: 4.02, gain: 0.05 },
    ],
    attack: 0.004,
    decay: 3.2,
    release: 0.12,
    filterBase: 1400,
    filterRange: 5200,
    filterBurst: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0,
    scoop: 0,
    breath: 0,
    hammer: true,
    level: 1,
  },
  flute: {
    partials: [
      { type: "sine", ratio: 1, gain: 0.75 },
      { type: "sine", ratio: 2, gain: 0.14 },
      { type: "sine", ratio: 3, gain: 0.05 },
    ],
    attack: 0.08,
    decay: 0,
    release: 0.18,
    filterBase: 1800,
    filterRange: 3000,
    filterBurst: 0,
    vibratoRate: 5.2,
    vibratoDepth: 0.0045,
    vibratoDelay: 0.3,
    scoop: 0,
    breath: 0.09,
    hammer: false,
    level: 0.9,
  },
  trumpet: {
    partials: [
      { type: "sawtooth", ratio: 1, gain: 0.55 },
      { type: "square", ratio: 1, gain: 0.18, detune: 4 },
    ],
    attack: 0.025,
    decay: 0,
    release: 0.12,
    filterBase: 700,
    filterRange: 4200,
    filterBurst: 2200,
    vibratoRate: 5.6,
    vibratoDepth: 0.003,
    vibratoDelay: 0.25,
    scoop: 0.05,
    breath: 0.02,
    hammer: false,
    level: 0.75,
  },
  strings: {
    partials: [
      { type: "sawtooth", ratio: 1, gain: 0.32, detune: -7 },
      { type: "sawtooth", ratio: 1, gain: 0.32, detune: 7 },
      { type: "sawtooth", ratio: 2, gain: 0.1, detune: 3 },
    ],
    attack: 0.35,
    decay: 0,
    release: 0.6,
    filterBase: 900,
    filterRange: 2600,
    filterBurst: 0,
    vibratoRate: 5,
    vibratoDepth: 0.0025,
    vibratoDelay: 0.4,
    scoop: 0,
    breath: 0,
    hammer: false,
    level: 0.55,
  },
  brass: {
    partials: [
      { type: "sawtooth", ratio: 1, gain: 0.5 },
      { type: "sawtooth", ratio: 0.5, gain: 0.2, detune: -3 },
    ],
    attack: 0.12,
    decay: 0,
    release: 0.35,
    filterBase: 500,
    filterRange: 2400,
    filterBurst: 900,
    vibratoRate: 4.8,
    vibratoDepth: 0.0015,
    vibratoDelay: 0.5,
    scoop: 0.02,
    breath: 0,
    hammer: false,
    level: 0.6,
  },
  woodwind: {
    partials: [
      { type: "square", ratio: 1, gain: 0.35 },
      { type: "sine", ratio: 1, gain: 0.4 },
    ],
    attack: 0.05,
    decay: 0,
    release: 0.15,
    filterBase: 1000,
    filterRange: 1800,
    filterBurst: 0,
    vibratoRate: 5.4,
    vibratoDepth: 0.003,
    vibratoDelay: 0.3,
    scoop: 0,
    breath: 0.03,
    hammer: false,
    level: 0.7,
  },
};

const SMOOTH = 0.05;

export function createSustainedVoice(
  context: BaseAudioContext,
  output: AudioNode,
  noise: AudioBuffer,
  kind: VoiceKind,
  midi: number,
  velocity: number,
  pan: number,
  onEnded: () => void,
): SustainedVoice {
  const t = TIMBRES[kind];
  const now = context.currentTime + 0.003;
  const v = clamp01(velocity);
  const peak = AUDIO_LIMITS.maxNoteGain * t.level * (0.35 + 0.65 * v);
  let expression = 1;

  const env = context.createGain();
  env.gain.value = 0;
  const expressionGain = context.createGain();
  expressionGain.gain.value = 1;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.8;
  const panner = context.createStereoPanner();
  panner.pan.value = (clamp01(pan) - 0.5) * 1.4;
  filter.connect(env).connect(expressionGain).connect(panner).connect(output);

  const baseFrequency = midiToFrequency(midi);
  const oscillators: OscillatorNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  for (const partial of t.partials) {
    const osc = context.createOscillator();
    osc.type = partial.type;
    osc.detune.value = partial.detune ?? 0;
    const g = context.createGain();
    g.gain.value = partial.gain;
    osc.connect(g).connect(filter);
    oscillators.push(osc);
    sources.push(osc);
  }

  const setFrequencies = (frequency: number, at: number, glide: number) => {
    oscillators.forEach((osc, i) => {
      const target = frequency * (t.partials[i]?.ratio ?? 1);
      if (glide <= 0) osc.frequency.setValueAtTime(target, at);
      else osc.frequency.setTargetAtTime(target, at, glide / 3);
    });
  };
  if (t.scoop > 0) {
    setFrequencies(baseFrequency * (1 - t.scoop), now, 0);
    setFrequencies(baseFrequency, now + 0.005, 0.06);
  } else {
    setFrequencies(baseFrequency, now, 0);
  }

  // Vibrato fades in after the attack.
  if (t.vibratoDepth > 0) {
    const lfo = context.createOscillator();
    lfo.frequency.value = t.vibratoRate;
    const depth = context.createGain();
    depth.gain.setValueAtTime(0, now);
    depth.gain.linearRampToValueAtTime(t.vibratoDepth * 1200, now + t.vibratoDelay + 0.3); // cents
    lfo.connect(depth);
    oscillators.forEach((osc) => depth.connect(osc.detune));
    sources.push(lfo);
  }

  // Breath noise for winds.
  let breathGain: GainNode | null = null;
  if (t.breath > 0) {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = Math.min(9000, baseFrequency * 2.5);
    band.Q.value = 1.5;
    breathGain = context.createGain();
    breathGain.gain.setValueAtTime(t.breath * 2, now);
    breathGain.gain.exponentialRampToValueAtTime(t.breath, now + 0.15);
    source.connect(band).connect(breathGain).connect(env);
    sources.push(source);
  }

  // Felt hammer thump for piano.
  if (t.hammer) {
    const hammer = context.createBufferSource();
    hammer.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 1;
    const g = context.createGain();
    g.gain.setValueAtTime(0.25 * v, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    hammer.connect(band).connect(g).connect(env);
    hammer.start(now);
    hammer.stop(now + 0.05);
  }

  const cutoff = () => t.filterBase + t.filterRange * v * expression;
  filter.frequency.setValueAtTime(cutoff() + t.filterBurst, now);
  filter.frequency.setTargetAtTime(cutoff(), now + t.attack, 0.08);

  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + t.attack);
  if (t.decay > 0) {
    // Lower piano notes ring longer.
    const decay = t.decay * (1 + Math.max(0, 60 - midi) / 30);
    env.gain.setTargetAtTime(peak * 0.0001, now + t.attack, decay / 4);
    filter.frequency.setTargetAtTime(t.filterBase, now + t.attack, decay / 3);
  }

  sources.forEach((s) => s.start(now));
  let released = false;
  const primary = oscillators[0];
  if (primary) primary.onended = () => {
    panner.disconnect();
    onEnded();
  };

  return {
    kind,
    startedAt: now,
    setPitch(nextMidi, glideSeconds) {
      if (released) return;
      setFrequencies(midiToFrequency(nextMidi), context.currentTime, glideSeconds);
    },
    setExpression(next) {
      if (released) return;
      expression = clamp01(next);
      expressionGain.gain.setTargetAtTime(0.25 + 0.75 * expression, context.currentTime, SMOOTH);
      if (t.decay === 0) filter.frequency.setTargetAtTime(cutoff(), context.currentTime, SMOOTH);
      if (breathGain) breathGain.gain.setTargetAtTime(t.breath * (0.5 + expression), context.currentTime, SMOOTH);
    },
    setPan(next) {
      if (released) return;
      panner.pan.setTargetAtTime((clamp01(next) - 0.5) * 1.4, context.currentTime, SMOOTH);
    },
    release(seconds) {
      if (released) return;
      released = true;
      const at = context.currentTime;
      const length = seconds ?? t.release;
      env.gain.cancelScheduledValues(at);
      env.gain.setValueAtTime(env.gain.value, at);
      env.gain.setTargetAtTime(0, at, Math.max(0.01, length / 4));
      const end = at + length + 0.1;
      sources.forEach((s) => {
        try {
          s.stop(end);
        } catch {
          /* already stopped */
        }
      });
    },
  };
}
