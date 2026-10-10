import { describe, expect, it } from "vitest";
import { buildCells, cellMidi, GRID_SCALES, locate, pitchAt, rowOpen, type GridConfig } from "@/features/instruments/grid/gridLayout";
import { noteName } from "@/features/instruments/music";

const base: GridConfig = {
  rows: 6,
  columns: 13,
  bottomOpen: 40, // E2, like a guitar's low string
  rowInterval: 5,
  key: 0,
  scale: GRID_SCALES[0]!.notes,
  diatonic: false,
};

const names = (config: GridConfig, row: number) => Array.from({ length: config.columns }, (_, c) => noteName(cellMidi(row, c, config)).replace(/\d+$/, ""));

describe("Pitch Grid layout", () => {
  it("tunes rows in fourths with the top row highest", () => {
    expect(rowOpen(5, base)).toBe(40);
    expect(rowOpen(4, base)).toBe(45);
    expect(rowOpen(0, base)).toBe(65);
  });

  it("steps by semitones in chromatic mode", () => {
    expect([0, 1, 2, 12].map((c) => cellMidi(5, c, base))).toEqual([40, 41, 42, 52]);
  });

  it("steps through scale notes in diatonic mode, starting each row on a scale note", () => {
    const diatonic = { ...base, diatonic: true };
    expect(names(diatonic, 5).slice(0, 8)).toEqual(["E", "F", "G", "A", "B", "C", "D", "E"]);
    // A–D–G–C… rows each begin on a scale note a fourth (or the next scale note) above.
    expect(rowOpen(4, diatonic)).toBe(45);
    expect(names(diatonic, 4).slice(0, 3)).toEqual(["A", "B", "C"]);
  });

  it("reproduces the reference layout (C major without F, rows a fourth apart)", () => {
    // The screenshot's top row reads C D E G A B C …, then G A B C D E G …, D, A, E, B.
    const config: GridConfig = { ...base, rows: 6, bottomOpen: 35, key: 0, scale: [0, 2, 4, 7, 9, 11], diatonic: true };
    expect(names(config, 0).slice(0, 7)).toEqual(["C", "D", "E", "G", "A", "B", "C"]);
    expect(names(config, 1).slice(0, 3)).toEqual(["G", "A", "B"]);
    expect(names(config, 2)[0]).toBe("D");
    expect(names(config, 3)[0]).toBe("A");
    expect(names(config, 4)[0]).toBe("E");
    expect(names(config, 5)[0]).toBe("B");
  });

  it("marks roots and out-of-scale notes", () => {
    const cells = buildCells({ ...base, columns: 12 });
    const bottom = cells.filter((c) => c.row === 5);
    expect(bottom.filter((c) => c.isRoot).map((c) => c.midi)).toEqual([48]);
    expect(bottom.find((c) => c.midi === 42)?.inScale).toBe(false); // F♯ in C major
  });

  it("snaps in piano/guitar modes and glides through in slide mode", () => {
    const diatonic = { ...base, diatonic: true };
    expect(pitchAt(5, 1.4, diatonic, "piano")).toBe(41);
    expect(pitchAt(5, 1.6, diatonic, "guitar")).toBe(43);
    // Fretless: halfway between F (41) and G (43) is F♯.
    expect(pitchAt(5, 1.5, diatonic, "slide")).toBeCloseTo(42);
  });

  it("locates fingers inside the grid area only", () => {
    const rect = { top: 0.3, bottom: 0.9 };
    expect(locate(0.5, 0.2, base, rect)).toBeNull();
    const at = locate(0.5, 0.89, base, rect);
    expect(at?.row).toBe(5);
    expect(at?.column).toBeCloseTo(0.5 * 13 - 0.5);
  });
});
