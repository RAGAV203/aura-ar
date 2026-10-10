import { describe, expect, it } from "vitest";
import { renderPluck, ringSeconds } from "@/features/audio/pluckedString";
import { kalimbaOrder } from "@/features/instruments/engines/kalimba";
import { StickRig, sweptHit } from "@/features/instruments/engines/sticks";
import { combineBols, strokeAt } from "@/features/instruments/engines/tabla";
import { thereminPitch } from "@/features/instruments/engines/theremin";
import { GUITAR_TUNING, keyChords, MAJOR, sargam, UKULELE_TUNING, voiceChord } from "@/features/instruments/music";
import { CATEGORIES, INSTRUMENTS, instrumentsByCategory } from "@/features/instruments/registry";
import { midiToFrequency } from "@/lib/math";
import type { ControlPoint } from "@/types/instruments";

/** Fundamental frequency by autocorrelation over a window of the signal. */
function estimatePitch(signal: Float32Array, sampleRate: number, start: number, length: number): number {
  const minLag = Math.floor(sampleRate / 2000);
  const maxLag = Math.floor(sampleRate / 50);
  const corr = (lag: number) => {
    let sum = 0;
    for (let i = start; i < start + length; i++) sum += (signal[i] ?? 0) * (signal[i + lag] ?? 0);
    return sum;
  };
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const sum = corr(lag);
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  // Parabolic interpolation around the peak for sub-sample lag accuracy.
  const a = corr(bestLag - 1);
  const c = corr(bestLag + 1);
  const shift = (a - c) / (2 * (a - 2 * best + c));
  return sampleRate / (bestLag + (Number.isFinite(shift) ? shift : 0));
}

function highFrequencyRatio(signal: Float32Array): number {
  let diff = 0;
  let total = 0;
  for (let i = 1; i < Math.min(signal.length, 20000); i++) {
    diff += ((signal[i] ?? 0) - (signal[i - 1] ?? 0)) ** 2;
    total += (signal[i] ?? 0) ** 2;
  }
  return diff / Math.max(1e-9, total);
}

describe("Karplus–Strong plucked strings", () => {
  const sampleRate = 44100;

  it("sounds at the right pitch across the range", () => {
    for (const midi of [40, 52, 64, 76, 84]) {
      const signal = renderPluck(sampleRate, "guitar", midi);
      const pitch = estimatePitch(signal, sampleRate, 2000, 4000);
      const expected = midiToFrequency(midi);
      const cents = 1200 * Math.log2(pitch / expected);
      expect(Math.abs(cents), `midi ${midi}: ${pitch.toFixed(1)} Hz vs ${expected.toFixed(1)} Hz`).toBeLessThan(8);
    }
  });

  it("decays, and low strings ring longer than high ones", () => {
    const signal = renderPluck(sampleRate, "guitar", 52);
    const early = signal.slice(0, 4000).reduce((a, v) => a + v * v, 0);
    const late = signal.slice(signal.length - 8000, signal.length - 4000).reduce((a, v) => a + v * v, 0);
    expect(late).toBeLessThan(early * 0.05);
    expect(ringSeconds("guitar", 40)).toBeGreaterThan(ringSeconds("guitar", 76));
  });

  it("gives the sitar its buzz: brighter than nylon at the same pitch", () => {
    expect(highFrequencyRatio(renderPluck(sampleRate, "sitar", 52))).toBeGreaterThan(highFrequencyRatio(renderPluck(sampleRate, "nylon", 52)) * 1.5);
  });

  it("is deterministic for caching", () => {
    expect(renderPluck(sampleRate, "veena", 50, 7)).toEqual(renderPluck(sampleRate, "veena", 50, 7));
  });
});

describe("guitar chords", () => {
  it("finds the standard open shapes", () => {
    const [g, , , c] = keyChords(7); // G major key: G, D, Em, C …
    expect(voiceChord(GUITAR_TUNING, g!)).toEqual([3, 2, 0, 0, 0, 3]);
    expect(voiceChord(GUITAR_TUNING, c!)).toEqual([-1, 3, 2, 0, 1, 0]);
  });

  it("names diatonic chords with the right quality", () => {
    expect(keyChords(0).map((c) => c.name).slice(0, 4)).toEqual(["C", "G", "Am", "F"]);
  });

  it("voices ukulele chords without muting", () => {
    const [c] = keyChords(0);
    expect(voiceChord(UKULELE_TUNING, c!, false)).toEqual([0, 0, 0, 3]);
  });
});

describe("Indian music helpers", () => {
  it("names swaras in sargam with komal and tivra", () => {
    expect([0, 1, 2, 5, 6, 7, 11].map(sargam)).toEqual(["Sa", "re", "Re", "Ma", "Ma'", "Pa", "Ni"]);
  });

  it("maps tabla zones to bols and combines strokes", () => {
    expect(strokeAt("dayan", 0.9, false)).toBe("Na");
    expect(strokeAt("dayan", 0.6, false)).toBe("Tin");
    expect(strokeAt("dayan", 0.2, false)).toBe("Te");
    expect(strokeAt("bayan", 0.4, false)).toBe("Ge");
    expect(strokeAt("bayan", 0.4, true)).toBe("Ka");
    expect(combineBols("Ge", "Na")).toBe("Dha");
    expect(combineBols("Tin", "Ge")).toBe("Dhin");
    expect(combineBols("Na", "Tin")).toBeNull();
  });
});

describe("kalimba layout", () => {
  it("puts the lowest note in the middle and alternates outward", () => {
    expect(kalimbaOrder(7)).toEqual([5, 3, 1, 0, 2, 4, 6]);
    expect(kalimbaOrder(17)[8]).toBe(0);
  });
});

describe("theremin pitch", () => {
  it("rises continuously as the hand approaches the antenna", () => {
    const far = thereminPitch(0.85, 48, 36, 0, null);
    const near = thereminPitch(0.02, 48, 36, 0, null);
    expect(far).toBeCloseTo(48);
    expect(near).toBeGreaterThan(83);
    expect(thereminPitch(0.4, 48, 36, 0, null) % 1).not.toBe(0);
  });

  it("snaps towards scale notes by the snap amount", () => {
    const raw = thereminPitch(0.4, 48, 36, 0, null);
    const snapped = thereminPitch(0.4, 48, 36, 1, MAJOR);
    expect(Number.isInteger(Math.round(snapped * 1000) / 1000)).toBe(true);
    expect(MAJOR).toContain(((Math.round(snapped) - 48) % 12 + 12) % 12);
    const half = thereminPitch(0.4, 48, 36, 0.5, MAJOR);
    expect(half).toBeCloseTo((raw + snapped) / 2);
  });
});

describe("drumstick physics", () => {
  const hand = (y: number, vy: number): ControlPoint => ({ id: "hand-right", source: "hand", position: { x: 0.6, y }, velocity: { x: 0, y: vy }, speed: Math.abs(vy), amount: 1, engaged: false, lifted: false });

  it("swings the tip down past a drum on a fast downstroke and registers a swept hit", () => {
    const rig = new StickRig({ length: 0.2, swing: 0.34 });
    rig.setAspect(1);
    for (let i = 0; i < 30; i++) rig.update([hand(0.3, 0)], 1 / 60);
    const drumTop = rig.sticks.right.tipY + 0.05;
    const inside = (_x: number, y: number) => y > drumTop && y < drumTop + 0.1;
    let hit = false;
    for (let i = 0; i < 12 && !hit; i++) {
      rig.update([hand(0.3 + i * 0.02, 2.4)], 1 / 60);
      hit = sweptHit(rig.sticks.right, inside, 0.5);
    }
    expect(hit).toBe(true);
  });

  it("puts the stick tip exactly under a touch", () => {
    const rig = new StickRig();
    const touch: ControlPoint = { ...hand(0.7, 0), id: "touch-1", source: "touch", position: { x: 0.25, y: 0.7 } };
    rig.update([touch], 1 / 60);
    expect(rig.sticks.left.tipX).toBeCloseTo(0.25);
    expect(rig.sticks.left.tipY).toBeCloseTo(0.7);
    expect(rig.sticks.left.active).toBe(true);
    expect(rig.sticks.right.active).toBe(false);
  });
});

describe("instrument library", () => {
  it("assigns every instrument a known category and groups them all", () => {
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const instrument of INSTRUMENTS) expect(known.has(instrument.category), instrument.id).toBe(true);
    expect(instrumentsByCategory().reduce((n, c) => n + c.instruments.length, 0)).toBe(INSTRUMENTS.length);
    expect(INSTRUMENTS.filter((i) => i.category === "strings").length).toBeGreaterThanOrEqual(5);
  });
});

describe("engine clock", () => {
  it("never runs backwards on a negative frame delta", async () => {
    const { CosmicGardenModel } = await import("@/features/instruments/engines/cosmicGarden");
    const model = new CosmicGardenModel({}, 1);
    model.frame(0.016, { points: [], spread: null, bodySpread: null, events: [] });
    const before = model.time;
    model.frame(-0.005, { points: [], spread: null, bodySpread: null, events: [] });
    expect(model.time).toBeGreaterThanOrEqual(before);
  });
});
