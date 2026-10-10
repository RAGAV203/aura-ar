/** Small music-theory helpers shared by the melodic instruments. */

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12);
}

/** `count` consecutive notes of `scale` starting at `root` (MIDI), spanning octaves as needed. */
export function scaleNotes(root: number, scale: readonly number[], count: number): number[] {
  const notes: number[] = [];
  for (let i = 0; i < count; i++) {
    const octave = Math.floor(i / scale.length);
    notes.push(root + octave * 12 + (scale[i % scale.length] ?? 0));
  }
  return notes;
}

/** Triad (plus octave root) on scale degree `degree` (0-based) of a key. */
export function triad(keyRoot: number, scale: readonly number[], degree: number): number[] {
  const n = scale.length;
  const at = (step: number) => {
    const index = degree + step;
    return keyRoot + Math.floor(index / n) * 12 + (scale[((index % n) + n) % n] ?? 0);
  };
  return [at(0), at(2), at(4), at(7)];
}

export interface Progression {
  name: string;
  /** Semitone offset of the key from C. */
  key: number;
  scale: readonly number[];
  /** Scale degrees (0-based), one chord per bar. */
  degrees: number[];
}

/** Moods selectable in the Orchestra instrument (index = "mood" parameter). */
export const PROGRESSIONS: Progression[] = [
  { name: "Heroic", key: 0, scale: MAJOR, degrees: [0, 4, 5, 3] }, // I–V–vi–IV
  { name: "Nocturne", key: 9, scale: MINOR, degrees: [0, 5, 2, 6] }, // i–VI–III–VII
  { name: "Hymn", key: 5, scale: MAJOR, degrees: [0, 3, 0, 4, 5, 3, 4, 0] }, // I–IV–I–V–vi–IV–V–I
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function chordLabel(progression: Progression, degree: number): string {
  const third = (progression.scale[(degree + 2) % 7] ?? 0) - (progression.scale[degree % 7] ?? 0);
  const minor = ((third + 12) % 12) === 3;
  const numeral = ROMAN[degree % 7] ?? "I";
  return minor ? numeral.toLowerCase() : numeral;
}
