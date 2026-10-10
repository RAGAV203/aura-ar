import { clamp } from "@/lib/math";

/** Scales for the Pitch Grid (semitones above the key). */
export const GRID_SCALES: Array<{ name: string; notes: number[] }> = [
  { name: "Major", notes: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Minor", notes: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Major pentatonic", notes: [0, 2, 4, 7, 9] },
  { name: "Minor pentatonic", notes: [0, 3, 5, 7, 10] },
  { name: "Blues", notes: [0, 3, 5, 6, 7, 10] },
  { name: "Dorian", notes: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Yaman (Lydian)", notes: [0, 2, 4, 6, 7, 9, 11] },
];

export interface GridConfig {
  rows: number;
  columns: number;
  /** MIDI note of the bottom row's first cell before scale snapping. */
  bottomOpen: number;
  /** Semitones between neighbouring rows (5 = fourths, like a guitar). */
  rowInterval: number;
  key: number;
  scale: readonly number[];
  diatonic: boolean;
}

export interface Cell {
  row: number;
  column: number;
  midi: number;
  isRoot: boolean;
  inScale: boolean;
}

const mod12 = (n: number) => ((Math.round(n) % 12) + 12) % 12;

export function inScale(midi: number, config: Pick<GridConfig, "key" | "scale">): boolean {
  return config.scale.includes(mod12(midi - config.key));
}

/** Smallest scale note ≥ midi. */
function snapUp(midi: number, config: Pick<GridConfig, "key" | "scale">): number {
  for (let m = Math.ceil(midi); m < midi + 12; m++) if (inScale(m, config)) return m;
  return Math.round(midi);
}

/** Next scale note above `midi` (which should itself be in the scale). */
function nextInScale(midi: number, config: Pick<GridConfig, "key" | "scale">): number {
  for (let m = midi + 1; m <= midi + 12; m++) if (inScale(m, config)) return m;
  return midi + 1;
}

/** Open (first-cell) pitch of a row; row 0 is the top (highest) row. */
export function rowOpen(row: number, config: GridConfig): number {
  const fromBottom = config.rows - 1 - row;
  const open = config.bottomOpen + fromBottom * config.rowInterval;
  return config.diatonic ? snapUp(open, config) : open;
}

/** MIDI note of a cell. Diatonic: successive scale notes; chromatic: successive semitones. */
export function cellMidi(row: number, column: number, config: GridConfig): number {
  let midi = rowOpen(row, config);
  if (!config.diatonic) return midi + column;
  for (let c = 0; c < column; c++) midi = nextInScale(midi, config);
  return midi;
}

export function buildCells(config: GridConfig): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < config.rows; row++) {
    for (let column = 0; column < config.columns; column++) {
      const midi = cellMidi(row, column, config);
      cells.push({ row, column, midi, isRoot: mod12(midi - config.key) === 0, inScale: inScale(midi, config) });
    }
  }
  return cells;
}

export type NoteTransition = "piano" | "guitar" | "slide";

/**
 * Pitch for a finger at a fractional column position along a row.
 * Piano and guitar snap to the nearest cell; slide interpolates between
 * neighbouring cells (fretless), so a diatonic slide passes through the
 * semitones in between.
 */
export function pitchAt(row: number, columnPosition: number, config: GridConfig, mode: NoteTransition): number {
  const position = clamp(columnPosition, 0, config.columns - 1);
  if (mode !== "slide") return cellMidi(row, Math.round(position), config);
  const left = Math.floor(position);
  const right = Math.min(config.columns - 1, left + 1);
  const t = position - left;
  const a = cellMidi(row, left, config);
  const b = cellMidi(row, right, config);
  return a + (b - a) * t;
}

/** Normalised view rectangle of the grid (between the control panel and the dock). */
export interface GridRect {
  top: number;
  bottom: number;
}

/** Row and fractional column under a normalised point, or null when outside the grid. */
export function locate(x: number, y: number, config: GridConfig, rect: GridRect): { row: number; column: number } | null {
  if (y < rect.top || y > rect.bottom || x < 0 || x > 1) return null;
  const rowHeight = (rect.bottom - rect.top) / config.rows;
  const row = clamp(Math.floor((y - rect.top) / rowHeight), 0, config.rows - 1);
  // Cell centres sit at column + 0.5, so the fractional column under the finger is x·columns − 0.5.
  const column = clamp(x * config.columns - 0.5, 0, config.columns - 1);
  return { row, column };
}
