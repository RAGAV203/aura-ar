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

/* ---------- Ragas (Indian classical) ---------- */

export interface Raga {
  name: string;
  /** Semitones above Sa. */
  notes: number[];
}

export const CARNATIC_RAGAS: Raga[] = [
  { name: "Mayamalavagowla", notes: [0, 1, 4, 5, 7, 8, 11] },
  { name: "Shankarabharanam", notes: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Kalyani", notes: [0, 2, 4, 6, 7, 9, 11] },
  { name: "Kharaharapriya", notes: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Mohanam", notes: [0, 2, 4, 7, 9] },
];

export const HINDUSTANI_RAGAS: Raga[] = [
  { name: "Yaman", notes: [0, 2, 4, 6, 7, 9, 11] },
  { name: "Bhairav", notes: [0, 1, 4, 5, 7, 8, 11] },
  { name: "Kafi", notes: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Bhupali", notes: [0, 2, 4, 7, 9] },
  { name: "Malkauns", notes: [0, 3, 5, 8, 10] },
];

const SARGAM = ["Sa", "re", "Re", "ga", "Ga", "Ma", "Ma'", "Pa", "dha", "Dha", "ni", "Ni"];

/** Sargam name for a semitone offset from Sa (lowercase = komal, Ma' = tivra). */
export function sargam(semitones: number): string {
  return SARGAM[((Math.round(semitones) % 12) + 12) % 12] ?? "Sa";
}

/* ---------- Guitar-family chords ---------- */

export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
export const UKULELE_TUNING = [67, 60, 64, 69]; // G4 C4 E4 A4 (re-entrant)

export interface Chord {
  name: string;
  root: number; // pitch class
  tones: number[]; // pitch classes
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** The diatonic chords most songs use, in a major key: I V vi IV ii iii V7 IV/I-type choices. */
export function keyChords(key: number): Chord[] {
  const make = (offset: number, quality: "maj" | "min" | "7"): Chord => {
    const root = (((key + offset) % 12) + 12) % 12;
    const intervals = quality === "maj" ? [0, 4, 7] : quality === "min" ? [0, 3, 7] : [0, 4, 7, 10];
    const suffix = quality === "maj" ? "" : quality === "min" ? "m" : "7";
    return { name: `${NAMES[root]}${suffix}`, root, tones: intervals.map((i) => (root + i) % 12) };
  };
  return [make(0, "maj"), make(7, "maj"), make(9, "min"), make(5, "maj"), make(2, "min"), make(4, "min"), make(7, "7"), make(10, "maj")];
}

/**
 * Finds a playable voicing: for each string the lowest fret (0–4) that lands
 * on a chord tone. Bass strings are muted until the first root so chords
 * sound grounded, the way a guitarist would play them. Returns frets with
 * -1 for muted strings.
 */
export function voiceChord(tuning: readonly number[], chord: Chord, muteBassUntilRoot = true): number[] {
  let foundRoot = !muteBassUntilRoot;
  return tuning.map((open, index) => {
    for (let fret = 0; fret <= 4; fret++) {
      const pc = (open + fret) % 12;
      if (!chord.tones.includes(pc)) continue;
      if (!foundRoot && index < 2 && pc !== chord.root) return -1;
      if (pc === chord.root) foundRoot = true;
      return fret;
    }
    return -1;
  });
}
