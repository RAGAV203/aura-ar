import { clamp, midiToFrequency } from "@/lib/math";
import type { AudioConfig, AudioNoteEvent, AudioTargets, DrumKind } from "@/types/instruments";
import { AUDIO_LIMITS, brightnessToCutoff, degreeToFrequency } from "./audioMath";

/** Time constant for parameter smoothing — long enough to avoid zipper noise and clicks. */
const SMOOTH = 0.08;

export interface ContinuousLayer {
  update(targets: AudioTargets, time: number): void;
  stop(time: number): void;
}

/**
 * Continuous layer built once per instrument from native nodes. Updates only
 * move AudioParams with setTargetAtTime — nothing is allocated per frame.
 */
export function createContinuousLayer(context: BaseAudioContext, output: AudioNode, config: AudioConfig, noise: AudioBuffer): ContinuousLayer {
  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.value = 0;
  const panner = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;
  filter.Q.value = 0.7;
  filter.connect(gain).connect(panner).connect(output);

  const oscillators: OscillatorNode[] = [];
  const baseFrequencies: number[] = [];
  const addOsc = (type: OscillatorType, midi: number, detune: number, level: number) => {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = detune;
    const oscGain = context.createGain();
    oscGain.gain.value = level;
    osc.connect(oscGain).connect(filter);
    osc.start(now);
    oscillators.push(osc);
    baseFrequencies.push(midiToFrequency(midi));
  };

  const root = config.rootNote;
  switch (config.palette) {
    case "ambient-pad":
      addOsc("sawtooth", root, -7, 0.18);
      addOsc("sawtooth", root + 7, 6, 0.14);
      addOsc("triangle", root + 12, 3, 0.2);
      addOsc("sine", root - 12, 0, 0.35);
      break;
    case "drone":
      addOsc("sine", root - 12, 0, 0.5);
      addOsc("triangle", root, 4, 0.22);
      addOsc("sine", root + 7, -5, 0.16);
      addOsc("sine", root + 16, 2, 0.06);
      break;
    case "texture":
      addOsc("sine", root + 12, 0, 0.12);
      addOsc("sine", root + 19, 8, 0.08);
      break;
    case "pluck":
    case "soft-percussion":
      addOsc("sine", root - 12, 0, 0.3);
      addOsc("triangle", root + 7, 5, 0.08);
      break;
    case "harp":
      // A quiet open-fifth bed so the plucked strings sit in a key.
      addOsc("sine", root - 12, 0, 0.22);
      addOsc("sine", root - 5, 3, 0.1);
      break;
    case "water":
      // Mostly filtered noise (the "wash"), with a low hum underneath.
      addOsc("sine", root - 24, 0, 0.25);
      break;
    case "chime":
      addOsc("sine", root + 12, -4, 0.12);
      addOsc("sine", root + 19, 6, 0.09);
      addOsc("triangle", root, 0, 0.12);
      break;
    // Melodic instruments carry their own notes; the layer is only a faint room tone.
    case "piano-room":
    case "flute-air":
    case "brass-hall":
    case "orchestra-hall":
    case "veena-tanpura":
    case "sitar-tanpura":
    case "tabla-tanpura":
      // Tanpura drone: Sa–Pa–Sa'–Sa with a buzzy (jawari) edge from the noise band.
      addOsc("sawtooth", root - 12, -3, 0.16);
      addOsc("sawtooth", root - 5, 4, 0.12);
      addOsc("sawtooth", root, 2, 0.12);
      addOsc("sine", root - 24, 0, 0.18);
      break;
    case "guitar-room":
    case "bowed-hall":
    case "theremin-air":
    case "handpan-air":
    case "marimba-hall":
    case "kalimba-air":
    case "drum-room":
    case "drum-loop":
      addOsc("sine", root - 24, 0, 0.08);
      break;
  }

  // Filtered noise adds air / texture; level follows `texture`.
  const noiseSource = context.createBufferSource();
  noiseSource.buffer = noise;
  noiseSource.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 2400;
  noiseFilter.Q.value = 0.9;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0;
  noiseSource.connect(noiseFilter).connect(noiseGain).connect(gain);
  noiseSource.start(now);

  // Slow LFO breathing on the filter keeps the layer alive when idle.
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 120;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start(now);

  const noiseScale = config.palette === "texture" || config.palette === "water" ? 1 : config.palette === "flute-air" ? 0.6 : 0.35;

  return {
    update(targets, time) {
      gain.gain.setTargetAtTime(targets.level * AUDIO_LIMITS.maxLayerGain, time, SMOOTH * 2);
      filter.frequency.setTargetAtTime(brightnessToCutoff(targets.brightness), time, SMOOTH);
      panner.pan.setTargetAtTime((targets.pan - 0.5) * 1.2, time, SMOOTH);
      noiseGain.gain.setTargetAtTime(targets.texture * 0.5 * noiseScale, time, SMOOTH);
      noiseFilter.frequency.setTargetAtTime(1200 + targets.brightness * 3600, time, SMOOTH);
      const ratio = 2 ** (targets.pitch / 12);
      oscillators.forEach((osc, i) => osc.frequency.setTargetAtTime((baseFrequencies[i] ?? 220) * ratio, time, SMOOTH * 3));
    },
    stop(time) {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setTargetAtTime(0, time, 0.05);
      const end = time + 0.4;
      [...oscillators, lfo, noiseSource].forEach((node) => {
        try {
          node.stop(end);
        } catch {
          /* already stopped */
        }
      });
      setTimeout(() => panner.disconnect(), 600);
    },
  };
}

/**
 * Plays a short one-shot note. One-shot oscillators are the Web Audio idiom
 * for discrete notes; the caller enforces polyphony and rate limits.
 */
export function playNote(
  context: BaseAudioContext,
  output: AudioNode,
  config: AudioConfig,
  note: AudioNoteEvent,
  noise: AudioBuffer,
  onEnded: () => void,
): void {
  const time = context.currentTime + 0.005;
  const env = context.createGain();
  env.gain.value = 0;
  const panner = context.createStereoPanner();
  panner.pan.value = (note.pan - 0.5) * 1.4;
  env.connect(panner).connect(output);
  const peak = note.velocity * AUDIO_LIMITS.maxNoteGain;

  let source: AudioScheduledSourceNode;
  let duration: number;

  if (isDrum(note.kind)) {
    duration = playDrum(context, env, noise, note.kind, note.degree, peak, time, config.rootNote);
    source = drumSource(context, env);
  } else if (note.kind === "bell") {
    // Two-operator FM bell: a bright, inharmonic attack that mellows as the modulation decays.
    const frequency = degreeToFrequency(config.rootNote + 12, config.scale, note.degree);
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modGain = context.createGain();
    carrier.frequency.value = frequency;
    modulator.frequency.value = frequency * 3.5;
    duration = 2.6;
    modGain.gain.setValueAtTime(frequency * 2.2, time);
    modGain.gain.exponentialRampToValueAtTime(1, time + duration);
    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(env);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak * 0.9, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    modulator.start(time);
    modulator.stop(time + duration + 0.05);
    source = carrier;
  } else if (note.kind === "drop") {
    // Water droplet: a sine that glides down quickly.
    const frequency = degreeToFrequency(config.rootNote + 24, config.scale, note.degree);
    const osc = context.createOscillator();
    osc.type = "sine";
    duration = 0.32;
    osc.frequency.setValueAtTime(frequency * 1.9, time);
    osc.frequency.exponentialRampToValueAtTime(frequency, time + 0.09);
    osc.connect(env);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source = osc;
  } else if (note.kind === "harp") {
    // Plucked string: triangle fundamental plus a quieter octave, brightness closing like a real string.
    const frequency = degreeToFrequency(config.rootNote + 12, config.scale, note.degree);
    const osc = context.createOscillator();
    const octave = context.createOscillator();
    const octaveGain = context.createGain();
    const filter = context.createBiquadFilter();
    osc.type = "triangle";
    octave.type = "sine";
    osc.frequency.value = frequency;
    octave.frequency.value = frequency * 2;
    octaveGain.gain.value = 0.35;
    filter.type = "lowpass";
    duration = 2.4;
    filter.frequency.setValueAtTime(5000, time);
    filter.frequency.exponentialRampToValueAtTime(700, time + 1.2);
    osc.connect(filter);
    octave.connect(octaveGain).connect(filter);
    filter.connect(env);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    octave.start(time);
    octave.stop(time + duration + 0.05);
    source = osc;
  } else if (note.kind === "percussion") {
    const buffer = context.createBufferSource();
    buffer.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = degreeToFrequency(config.rootNote + 24, config.scale, note.degree);
    band.Q.value = 6;
    buffer.connect(band).connect(env);
    duration = 0.22;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak * 1.4, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source = buffer;
  } else {
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    osc.frequency.value = degreeToFrequency(config.rootNote + 12, config.scale, note.degree);
    osc.connect(filter).connect(env);
    if (note.kind === "pluck") {
      osc.type = "triangle";
      duration = 1.1;
      filter.frequency.setValueAtTime(4200, time);
      filter.frequency.exponentialRampToValueAtTime(500, time + 0.6);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(peak, time + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    } else {
      osc.type = "sine";
      duration = 2.4;
      filter.frequency.value = 2400;
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(peak * 0.8, time + 0.9);
      env.gain.linearRampToValueAtTime(0, time + duration);
    }
    source = osc;
  }

  source.onended = () => {
    panner.disconnect();
    onEnded();
  };
  source.start(time);
  source.stop(time + duration + 0.05);
}

export function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buffer;
}

const DRUMS: readonly string[] = [
  "kick",
  "snare",
  "hat",
  "hat-open",
  "tom",
  "crash",
  "ride",
  "timpani",
  "marimba",
  "handpan",
  "kalimba",
  "tabla-na",
  "tabla-tin",
  "tabla-te",
  "tabla-ka",
];

function isDrum(kind: AudioNoteEvent["kind"]): kind is DrumKind {
  return DRUMS.includes(kind);
}

/** A silent timing source so drum voices reuse the generic onended cleanup. */
function drumSource(context: BaseAudioContext, out: AudioNode): AudioScheduledSourceNode {
  const keeper = context.createConstantSource();
  keeper.offset.value = 0;
  keeper.connect(out);
  return keeper;
}

/**
 * Synthesised drum kit. Each drum is a few native nodes with short envelopes:
 * kick = pitch-dropping sine + click; snare = tone body + bright noise;
 * hats = high-passed noise; toms/timpani = tuned sine drops; cymbals =
 * band-passed noise with a metallic FM shimmer. Returns the voice length.
 */
function playDrum(context: BaseAudioContext, out: GainNode, noise: AudioBuffer, kind: DrumKind, degree: number, peak: number, time: number, rootNote: number): number {
  const level = peak * 1.6;
  out.gain.setValueAtTime(1, time);
  const noiseBurst = (type: BiquadFilterType, frequency: number, q: number, gain: number, length: number, offset = 0) => {
    const src = context.createBufferSource();
    src.buffer = noise;
    // Different start offsets keep repeated hits from sounding identical.
    const start = (Math.abs(degree * 0.137 + offset) % 1.5) || 0;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const g = context.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + length);
    src.connect(filter).connect(g).connect(out);
    src.start(time, start);
    src.stop(time + length + 0.05);
  };
  const tone = (type: OscillatorType, from: number, to: number, drop: number, gain: number, length: number) => {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + drop);
    const g = context.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(g).connect(out);
    osc.start(time);
    osc.stop(time + length + 0.05);
  };

  /** Sum of decaying sine partials: [frequency ratio, gain, decay seconds]. */
  const additive = (frequency: number, partials: Array<[number, number, number]>, attack: number, detuneCents = 0) => {
    let longest = 0;
    for (const [ratio, gain, decay] of partials) {
      const osc = context.createOscillator();
      osc.frequency.value = frequency * ratio;
      osc.detune.value = detuneCents;
      const g = context.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(level * gain, time + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
      osc.connect(g).connect(out);
      osc.start(time);
      osc.stop(time + attack + decay + 0.05);
      longest = Math.max(longest, attack + decay);
    }
    return longest;
  };
  // Tuned one-shots treat `degree` as semitones above the instrument's root note.
  const tuned = 440 * 2 ** ((rootNote + degree - 69) / 12);

  switch (kind) {
    case "marimba": {
      // Tuned bar: fundamental plus the 4th and 10th partials, mallet thump on top.
      const decay = clamp(1.5 - ((rootNote + degree) - 48) / 36, 0.35, 1.6);
      noiseBurst("lowpass", 900, 0.7, level * 0.25, 0.02);
      return additive(tuned, [[1, 1, decay], [3.93, 0.32, decay * 0.25], [9.2, 0.1, decay * 0.1]], 0.002) + 0.05;
    }
    case "handpan": {
      // Steel tonefield: fundamental, octave and compound fifth with a slow bloom; a slightly detuned twin adds shimmer.
      const length = additive(tuned, [[1, 0.9, 3.4], [2, 0.42, 2.4], [3, 0.2, 1.6]], 0.006);
      additive(tuned, [[1, 0.25, 3]], 0.012, 4);
      noiseBurst("lowpass", 600, 0.8, level * 0.15, 0.03);
      return length;
    }
    case "kalimba":
      // Tine: clean fundamental, a bright inharmonic "tink" that dies fast.
      return additive(tuned, [[1, 1, 2.2], [5.95, 0.28, 0.12], [2, 0.08, 0.8]], 0.0015);
    case "tabla-na": {
      // Dayan rim stroke: the loaded syahi makes the overtones nearly harmonic.
      noiseBurst("bandpass", tuned * 6, 2, level * 0.25, 0.02);
      return additive(tuned, [[1, 1, 0.9], [2, 0.55, 0.6], [3, 0.32, 0.4], [4, 0.2, 0.28], [5, 0.1, 0.2]], 0.002);
    }
    case "tabla-tin":
      return additive(tuned, [[1, 0.9, 1.4], [2, 0.35, 1], [3, 0.18, 0.7]], 0.004);
    case "tabla-te":
      noiseBurst("bandpass", 2200, 1.5, level * 0.8, 0.06);
      return additive(tuned, [[1, 0.3, 0.07]], 0.001) + 0.03;
    case "tabla-ka":
      noiseBurst("lowpass", 450, 0.8, level * 1.1, 0.09);
      return 0.12;
    case "kick":
      tone("sine", 150, 45, 0.12, level * 1.6, 0.45);
      noiseBurst("highpass", 3000, 0.7, level * 0.25, 0.015);
      return 0.5;
    case "snare":
      tone("triangle", 230, 180, 0.05, level * 0.7, 0.14);
      noiseBurst("highpass", 1800, 0.6, level * 0.9, 0.22);
      return 0.3;
    case "hat":
      noiseBurst("highpass", 8000, 0.8, level * 0.45, 0.05);
      return 0.1;
    case "hat-open":
      noiseBurst("highpass", 7500, 0.8, level * 0.45, 0.4);
      return 0.45;
    case "tom": {
      // degree: 0 = high tom, 1 = mid, 2 = floor
      const base = [240, 180, 120][Math.max(0, Math.min(2, Math.round(degree)))] ?? 180;
      tone("sine", base * 1.6, base, 0.18, level * 1.1, 0.55);
      noiseBurst("bandpass", base * 4, 1, level * 0.15, 0.05);
      return 0.6;
    }
    case "timpani": {
      const base = 65 * 2 ** (degree / 12);
      tone("sine", base * 1.15, base, 0.25, level * 1.2, 1.4);
      tone("sine", base * 2.4, base * 2.3, 0.2, level * 0.3, 0.8);
      noiseBurst("lowpass", 500, 0.7, level * 0.2, 0.08);
      return 1.5;
    }
    case "crash":
    case "ride": {
      // Ride degree 1 = the bell: brighter, more focused and shorter.
      const bell = kind === "ride" && degree >= 1;
      const length = kind === "crash" ? 2.2 : bell ? 0.8 : 1.1;
      noiseBurst("bandpass", kind === "crash" ? 6500 : 9000, kind === "crash" ? 0.5 : 2, level * (kind === "crash" ? 0.75 : 0.35), length);
      const carrier = context.createOscillator();
      const modulator = context.createOscillator();
      const mod = context.createGain();
      carrier.type = "square";
      carrier.frequency.value = kind === "crash" ? 420 : bell ? 940 : 610;
      modulator.frequency.value = carrier.frequency.value * 2.76;
      mod.gain.value = carrier.frequency.value * 3;
      modulator.connect(mod).connect(carrier.frequency);
      const hp = context.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5000;
      const g = context.createGain();
      g.gain.setValueAtTime(level * (kind === "crash" ? 0.12 : 0.18), time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + length * 0.8);
      carrier.connect(hp).connect(g).connect(out);
      carrier.start(time);
      modulator.start(time);
      carrier.stop(time + length);
      modulator.stop(time + length);
      return length;
    }
  }
}
