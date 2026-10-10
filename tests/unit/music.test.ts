import { describe, expect, it } from "vitest";
import { AUDIO_LIMITS, clampVoiceCommand } from "@/features/audio/audioMath";
import { chordLabel, isBlackKey, MAJOR, MINOR, noteName, PROGRESSIONS, scaleNotes, triad } from "@/features/instruments/music";

describe("music helpers", () => {
  it("names notes and finds black keys", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(61)).toBe("C♯4");
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([false, true, false, true, false, false, true]);
  });

  it("builds scales across octaves", () => {
    expect(scaleNotes(60, MAJOR, 9)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74]);
  });

  it("builds diatonic triads with octave doubling", () => {
    expect(triad(60, MAJOR, 0)).toEqual([60, 64, 67, 72]); // C major
    expect(triad(60, MAJOR, 4)).toEqual([67, 71, 74, 79]); // G major
    expect(triad(60, MAJOR, 5)).toEqual([69, 72, 76, 81]); // A minor
    expect(triad(57, MINOR, 0)).toEqual([57, 60, 64, 69]); // A minor
  });

  it("labels chord quality with roman numerals", () => {
    const heroic = PROGRESSIONS[0]!;
    expect(heroic.degrees.map((d) => chordLabel(heroic, d))).toEqual(["I", "V", "vi", "IV"]);
    const nocturne = PROGRESSIONS[1]!;
    expect(chordLabel(nocturne, 0)).toBe("i");
  });
});

describe("sustained voice limits", () => {
  it("clamps note-on values into the safe range", () => {
    expect(clampVoiceCommand({ type: "on", id: "a", kind: "piano", midi: 200, velocity: 3, pan: -1 })).toEqual({
      type: "on",
      id: "a",
      kind: "piano",
      midi: AUDIO_LIMITS.maxMidi,
      velocity: 1,
      pan: 0,
    });
  });

  it("clamps updates and leaves absent fields absent", () => {
    const update = clampVoiceCommand({ type: "update", id: "a", expression: 5, glideMs: 99999 });
    expect(update).toMatchObject({ expression: 1, glideMs: 2000 });
    expect(update).toHaveProperty("midi", undefined);
  });

  it("bounds release times", () => {
    expect(clampVoiceCommand({ type: "off", id: "a", releaseSeconds: 60 })).toEqual({ type: "off", id: "a", releaseSeconds: 4 });
  });
});
