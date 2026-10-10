import { clamp, clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, InstrumentParameters, QualityLevel } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

const GRID_WIDTH: Record<QualityLevel, number> = { high: 200, balanced: 150, battery: 100 };
const SIM_STEP = 1 / 60;
const MOTES = 36;

interface QueuedDrop {
  at: number;
  x: number;
  y: number;
  strength: number;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

/**
 * Ripple Pond — a height-field wave simulation (two-buffer discrete wave
 * equation) on a small grid, shaded as light glinting on water and scaled up.
 * Only highlights are opaque, so over the camera it reads as a pane of water
 * in front of the person. Drops, wakes and rain create interfering ripples.
 */
export class RipplePondInstrument extends CanvasInstrument {
  readonly id = "ripple-pond" as const;
  private gw = 2;
  private gh = 2;
  private current = new Float32Array(4);
  private previous = new Float32Array(4);
  private surface: HTMLCanvasElement;
  private surfaceCtx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private accumulator = 0;
  private damping = 0.99;
  private energy = 0;
  private trail = new Map<string, { x: number; y: number }>();
  private queue: QueuedDrop[] = [];
  private idle = 0;
  private nextIdleDrop = 1.5;
  private readonly mx = new Float32Array(MOTES);
  private readonly my = new Float32Array(MOTES);
  private readonly sprites = new TintedSprites(createGlowSprite(32), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.surface = document.createElement("canvas");
    this.surfaceCtx = this.surface.getContext("2d");
    for (let i = 0; i < MOTES; i++) {
      this.mx[i] = this.random();
      this.my[i] = this.random();
    }
  }

  protected override onResize(): void {
    this.allocate();
  }

  protected override onQualityChange(): void {
    this.allocate();
  }

  protected override onReset(): void {
    this.current.fill(0);
    this.previous.fill(0);
    this.queue = [];
  }

  override dispose(): void {
    this.sprites.clear();
    this.surface.width = this.surface.height = 1;
    super.dispose();
  }

  private allocate(): void {
    const gw = GRID_WIDTH[this.quality];
    const aspect = this.height > 0 ? this.height / Math.max(1, this.width) : 1;
    const gh = clamp(Math.round(gw * aspect), 24, 400);
    if (gw === this.gw && gh === this.gh) return;
    // Resample the existing water into the new grid so a quality or size change
    // (e.g. adaptive quality stepping down mid-gesture) doesn't wipe the ripples.
    const resample = (source: Float32Array) => {
      const target = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) {
        const sy = Math.min(this.gh - 1, Math.round((y / Math.max(1, gh - 1)) * (this.gh - 1)));
        for (let x = 0; x < gw; x++) {
          const sx = Math.min(this.gw - 1, Math.round((x / Math.max(1, gw - 1)) * (this.gw - 1)));
          target[y * gw + x] = source[sy * this.gw + sx] ?? 0;
        }
      }
      return target;
    };
    const current = resample(this.current);
    const previous = resample(this.previous);
    this.gw = gw;
    this.gh = gh;
    this.current = current;
    this.previous = previous;
    this.surface.width = gw;
    this.surface.height = gh;
    this.image = this.surfaceCtx?.createImageData(gw, gh) ?? null;
  }

  /** Adds a smooth circular bump to the surface at normalised (x, y). */
  private disturb(x: number, y: number, radius: number, strength: number): void {
    const cx = x * (this.gw - 1);
    const cy = y * (this.gh - 1);
    const r = Math.max(1, radius);
    for (let gy = Math.max(1, Math.floor(cy - r)); gy <= Math.min(this.gh - 2, Math.ceil(cy + r)); gy++) {
      for (let gx = Math.max(1, Math.floor(cx - r)); gx <= Math.min(this.gw - 2, Math.ceil(cx + r)); gx++) {
        const d = Math.hypot(gx - cx, gy - cy) / r;
        if (d >= 1) continue;
        const i = gy * this.gw + gx;
        this.current[i] = (this.current[i] ?? 0) + strength * (Math.cos(d * Math.PI) + 1) * 0.5;
      }
    }
  }

  private drop(x: number, y: number, strength: number, sound: boolean): void {
    this.disturb(x, y, 3 + strength * 0.5, -strength);
    if (sound) this.emit({ kind: "drop", degree: Math.round((1 - y) * 8), velocity: clamp01(0.3 + strength * 0.08), pan: x });
  }

  protected step(dt: number, input: ControlInput): void {
    let reach = this.param("calm", 0.5);
    if (input.spread !== null) reach = mapRange(input.spread, 0.08, 0.8, 0.1, 1);
    this.damping = damp(this.damping, 0.982 + reach * 0.015, 3, dt);

    const seen = new Set<string>();
    const wake = this.param("wake", 0.6);
    for (const point of input.points) {
      if (point.lifted) continue;
      seen.add(point.id);
      const previous = this.trail.get(point.id);
      const moving = point.source !== "hand" || point.speed > 0.15;
      if (previous && moving) {
        const steps = 3;
        const strength = Math.min(point.speed, 2.5) * wake * 1.4 + (point.engaged && point.source === "hand" ? 0.6 : 0);
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          this.disturb(previous.x + (point.position.x - previous.x) * t, previous.y + (point.position.y - previous.y) * t, 2, -strength / steps);
        }
      }
      this.trail.set(point.id, { x: point.position.x, y: point.position.y });
    }
    for (const id of this.trail.keys()) if (!seen.has(id)) this.trail.delete(id);

    for (const event of input.events) {
      if (event.type === "accent") {
        // Rain shower.
        for (let k = 0; k < 26; k++) {
          this.queue.push({ at: this.time + this.random() * 1.8, x: 0.05 + this.random() * 0.9, y: 0.05 + this.random() * 0.9, strength: 2 + this.random() * 3 });
        }
      } else {
        this.drop(event.position.x, event.position.y, 7, true);
      }
    }

    const interacting = input.points.length > 0 || input.events.length > 0;
    this.idle = interacting ? 0 : this.idle + dt;
    if (!this.reducedMotion && this.idle > this.nextIdleDrop) {
      this.idle = 0;
      this.nextIdleDrop = 2 + this.random() * 3;
      this.drop(0.15 + this.random() * 0.7, 0.15 + this.random() * 0.7, 3, true);
    }

    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      due.forEach((q, index) => this.drop(q.x, q.y, q.strength, index % 3 === 0));
    }

    this.accumulator = Math.min(this.accumulator + dt, SIM_STEP * 3);
    while (this.accumulator >= SIM_STEP) {
      this.simulate();
      this.accumulator -= SIM_STEP;
    }

    let sum = 0;
    for (let i = 0; i < this.current.length; i += 7) sum += Math.abs(this.current[i] ?? 0);
    this.energy = damp(this.energy, clamp01((sum / (this.current.length / 7)) * 1.5), 6, dt);
    const primary = input.points[0];
    this.targets = {
      level: 0.12 + this.energy * 0.5,
      brightness: clamp01(0.25 + this.energy * 0.6),
      pitch: 0,
      pan: primary?.position.x ?? 0.5,
      texture: clamp01(0.15 + this.energy * 0.9),
    };
  }

  private simulate(): void {
    const { gw, gh, damping } = this;
    const a = this.current;
    const b = this.previous;
    for (let y = 1; y < gh - 1; y++) {
      const row = y * gw;
      for (let x = 1; x < gw - 1; x++) {
        const i = row + x;
        b[i] = (((a[i - 1] ?? 0) + (a[i + 1] ?? 0) + (a[i - gw] ?? 0) + (a[i + gw] ?? 0)) * 0.5 - (b[i] ?? 0)) * damping;
      }
    }
    this.current = b;
    this.previous = a;
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const image = this.image;
    const surfaceCtx = this.surfaceCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (image && surfaceCtx) {
      const data = image.data;
      const [r, g, b] = hslToRgb(this.param("hue", 195), 0.85, 0.6);
      const { gw, gh } = this;
      const a = this.current;
      const gain = this.param("glint", 0.7) * 160;
      for (let y = 1; y < gh - 1; y++) {
        for (let x = 1; x < gw - 1; x++) {
          const i = y * gw + x;
          const dx = (a[i + 1] ?? 0) - (a[i - 1] ?? 0);
          const dy = (a[i + gw] ?? 0) - (a[i - gw] ?? 0);
          // Light from the top-left: slopes facing it glint white, others tint the water.
          const shade = (dx * 0.7 + dy * 0.6) * gain;
          const highlight = clamp01(shade / 255);
          const alpha = clamp(Math.abs(shade) * 1.8 + Math.abs(a[i] ?? 0) * 26, 0, 240);
          const o = i * 4;
          data[o] = r + (255 - r) * highlight;
          data[o + 1] = g + (255 - g) * highlight;
          data[o + 2] = b + (255 - b) * highlight;
          data[o + 3] = alpha;
        }
      }
      surfaceCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = this.quality === "battery" ? "low" : "high";
      ctx.drawImage(this.surface, 0, 0, W, H);
    }

    // Floating motes ride the slope of the surface.
    ctx.globalCompositeOperation = "lighter";
    const sprite = this.sprites.get(this.param("hue", 195) + 40, 75);
    const dpr = this.pixelRatio;
    for (let k = 0; k < MOTES; k++) {
      const gx = clamp(Math.round((this.mx[k] ?? 0) * (this.gw - 1)), 1, this.gw - 2);
      const gy = clamp(Math.round((this.my[k] ?? 0) * (this.gh - 1)), 1, this.gh - 2);
      const i = gy * this.gw + gx;
      const sx = ((this.current[i + 1] ?? 0) - (this.current[i - 1] ?? 0)) * 0.004;
      const sy = ((this.current[i + this.gw] ?? 0) - (this.current[i - this.gw] ?? 0)) * 0.004;
      this.mx[k] = ((this.mx[k] ?? 0) - sx + 0.00005 + 1) % 1;
      this.my[k] = ((this.my[k] ?? 0) - sy + 1) % 1;
      const size = (6 + Math.abs(this.current[i] ?? 0) * 3) * dpr;
      ctx.globalAlpha = 0.35 + clamp01(Math.abs(this.current[i] ?? 0) * 0.2);
      ctx.drawImage(sprite, (this.mx[k] ?? 0) * W - size / 2, (this.my[k] ?? 0) * H - size / 2, size, size);
    }
    ctx.restore();
  }
}
