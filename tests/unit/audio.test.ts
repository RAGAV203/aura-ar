import { describe, expect, it } from "vitest";
import { AUDIO_LIMITS, brightnessToCutoff, clampAudioTargets, clampNote, degreeToMidi, NoteRateLimiter, volumeToGain } from "@/features/audio/audioMath";

describe("audio parameter limits", () => {
  it("clamps targets into safe ranges and replaces non-finite values", () => {
    expect(clampAudioTargets({ level: 4, brightness: -1, pitch: 99, pan: Number.NaN, texture: Infinity })).toEqual({
      level: 1,
      brightness: 0,
      pitch: AUDIO_LIMITS.maxPitchSemitones,
      pan: 0.5,
      texture: 0,
    });
  });

  it("clamps notes", () => {
    expect(clampNote({ kind: "pluck", degree: 400, velocity: 2, pan: -3 })).toEqual({ kind: "pluck", degree: 21, velocity: 1, pan: 0 });
  });

  it("keeps filter cutoff within limits on a perceptual curve", () => {
    expect(brightnessToCutoff(0)).toBeCloseTo(AUDIO_LIMITS.minFilterHz);
    expect(brightnessToCutoff(1)).toBeCloseTo(AUDIO_LIMITS.maxFilterHz);
    expect(brightnessToCutoff(5)).toBeCloseTo(AUDIO_LIMITS.maxFilterHz);
    expect(brightnessToCutoff(0.5)).toBeLessThan((AUDIO_LIMITS.minFilterHz + AUDIO_LIMITS.maxFilterHz) / 2);
  });

  it("maps volume to a bounded gain and honours mute", () => {
    expect(volumeToGain(1, false)).toBe(AUDIO_LIMITS.maxMasterGain);
    expect(volumeToGain(0.5, false)).toBeCloseTo(0.25 * AUDIO_LIMITS.maxMasterGain);
    expect(volumeToGain(1, true)).toBe(0);
    expect(volumeToGain(3, false)).toBe(AUDIO_LIMITS.maxMasterGain);
  });

  it("resolves scale degrees across octaves", () => {
    const pentatonic = [0, 2, 4, 7, 9];
    expect(degreeToMidi(60, pentatonic, 0)).toBe(60);
    expect(degreeToMidi(60, pentatonic, 3)).toBe(67);
    expect(degreeToMidi(60, pentatonic, 5)).toBe(72);
    expect(degreeToMidi(60, pentatonic, -1)).toBe(57);
    expect(degreeToMidi(60, [], 4)).toBe(60);
  });

  it("rate-limits discrete notes", () => {
    const limiter = new NoteRateLimiter(100);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(50)).toBe(false);
    expect(limiter.allow(120)).toBe(true);
  });
});
