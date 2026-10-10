export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Maps `value` from [inMin, inMax] to [outMin, outMax], clamped. */
export const mapRange = (value: number, inMin: number, inMax: number, outMin: number, outMax: number): number => {
  if (inMax === inMin) return outMin;
  return lerp(outMin, outMax, clamp01((value - inMin) / (inMax - inMin)));
};

/** Frame-rate independent exponential approach. `rate` is per second. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const distance = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** Small, fast deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Converts a MIDI note number to frequency in Hz. */
export const midiToFrequency = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** Cheap smooth 1D value noise, deterministic for a given seed. */
export function createNoise1D(seed: number): (x: number) => number {
  const random = createRandom(seed);
  const size = 256;
  const values = new Float32Array(size);
  for (let i = 0; i < size; i++) values[i] = random() * 2 - 1;
  return (x: number) => {
    const xi = Math.floor(x);
    const t = x - xi;
    const a = values[((xi % size) + size) % size] ?? 0;
    const b = values[(((xi + 1) % size) + size) % size] ?? 0;
    const s = t * t * (3 - 2 * t);
    return a + (b - a) * s;
  };
}
