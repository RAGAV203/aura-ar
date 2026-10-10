import { clamp, clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

const MAX_STRINGS = 16;
const MAX_SPARKS = 240;
const MARGIN = 0.06;
const PLUCK_COOLDOWN_S = 0.07;

interface QueuedPluck {
  at: number;
  index: number;
  velocity: number;
}

/**
 * String Harp — luminous strings hang across the view (over the camera when
 * it is on). Sweeping a fingertip or finger across a string plucks it; the
 * string vibrates from the point where it was struck and rings out in tune.
 */
export class StringHarpInstrument extends CanvasInstrument {
  readonly id = "string-harp" as const;
  private readonly amp = new Float32Array(MAX_STRINGS);
  private readonly pluckY = new Float32Array(MAX_STRINGS).fill(0.5);
  private readonly lastPluck = new Float64Array(MAX_STRINGS).fill(-1);
  private readonly flash = new Float32Array(MAX_STRINGS);
  private readonly prevX = new Map<string, number>();
  private queue: QueuedPluck[] = [];
  private vibrato = 0;
  private readonly sx = new Float32Array(MAX_SPARKS);
  private readonly sy = new Float32Array(MAX_SPARKS);
  private readonly svx = new Float32Array(MAX_SPARKS);
  private readonly svy = new Float32Array(MAX_SPARKS);
  private readonly slife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;
  private readonly sprites = new TintedSprites(createGlowSprite(48), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected override onReset(): void {
    this.amp.fill(0);
    this.flash.fill(0);
    this.slife.fill(0);
    this.queue = [];
    this.prevX.clear();
  }

  private get count(): number {
    return clamp(Math.round(this.param("strings", 10)), 4, MAX_STRINGS);
  }

  private stringX(index: number, count: number): number {
    return MARGIN + ((index + 0.5) / count) * (1 - 2 * MARGIN);
  }

  protected step(dt: number, input: ControlInput): void {
    const count = this.count;
    const decayRate = mapRange(this.param("sustain", 0.6), 0, 1, 3.5, 0.45);
    const fall = Math.exp(-decayRate * dt);
    for (let i = 0; i < count; i++) {
      this.amp[i] = (this.amp[i] ?? 0) * fall;
      this.flash[i] = (this.flash[i] ?? 0) * Math.exp(-6 * dt);
    }
    this.vibrato = damp(this.vibrato, input.spread !== null ? mapRange(input.spread, 0.1, 0.8, 0, 1) : 0, 3, dt);

    const seen = new Set<string>();
    for (const point of input.points) {
      if (point.lifted) continue;
      seen.add(point.id);
      const x = point.position.x;
      const previous = this.prevX.get(point.id);
      if (previous !== undefined) {
        for (let i = 0; i < count; i++) {
          const sx = this.stringX(i, count);
          if ((previous - sx) * (x - sx) < 0) this.pluck(i, clamp01(0.35 + point.speed * 0.35), point.position.y);
        }
      }
      this.prevX.set(point.id, x);
    }
    for (const id of this.prevX.keys()) if (!seen.has(id)) this.prevX.delete(id);

    for (const event of input.events) {
      if (event.type === "accent") {
        // Strum: sweep across every string, direction away from where the gesture happened.
        const ascending = event.position.x < 0.5;
        for (let k = 0; k < count; k++) {
          this.queue.push({ at: this.time + k * 0.045, index: ascending ? k : count - 1 - k, velocity: 0.55 });
        }
      } else {
        let nearest = 0;
        let best = Infinity;
        for (let i = 0; i < count; i++) {
          const d = Math.abs(this.stringX(i, count) - event.position.x);
          if (d < best) {
            best = d;
            nearest = i;
          }
        }
        this.pluck(nearest, 0.65, event.position.y);
      }
    }
    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      for (const q of due) this.pluck(q.index, q.velocity, 0.5);
    }

    let energy = 0;
    let weighted = 0;
    for (let i = 0; i < count; i++) {
      energy += this.amp[i] ?? 0;
      weighted += (this.amp[i] ?? 0) * this.stringX(i, count);
    }
    this.targets = {
      level: 0.1 + Math.min(energy, 2) * 0.12,
      brightness: clamp01(0.3 + energy * 0.25),
      pitch: 0,
      pan: energy > 0.01 ? weighted / energy : 0.5,
      texture: this.vibrato * 0.3,
    };
  }

  private pluck(index: number, velocity: number, y: number): void {
    if (this.time - (this.lastPluck[index] ?? -1) < PLUCK_COOLDOWN_S) return;
    this.lastPluck[index] = this.time;
    this.amp[index] = Math.max(this.amp[index] ?? 0, velocity);
    this.pluckY[index] = clamp(y, 0.08, 0.92);
    this.flash[index] = 1;
    const x = this.stringX(index, this.count);
    // Plucking near the ends sounds brighter, like a real string.
    const edge = Math.abs(this.pluckY[index]! - 0.5) * 2;
    this.emit({ kind: "harp", degree: index, velocity: clamp01(velocity * (0.75 + edge * 0.25)), pan: x });
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let k = 0; k < 10 * this.budget + 4; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      const angle = this.random() * Math.PI * 2;
      const speed = (30 + this.random() * 90) * this.pixelRatio;
      this.sx[i] = x * W;
      this.sy[i] = this.pluckY[index]! * H;
      this.svx[i] = Math.cos(angle) * speed;
      this.svy[i] = Math.sin(angle) * speed;
      this.slife[i] = 0.4 + this.random() * 0.5;
    }
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const count = this.count;
    const segments = this.quality === "battery" ? 18 : 32;
    const tension = this.param("tension", 1);
    const baseHue = this.param("hue", 40);
    const top = H * 0.04;
    const bottom = H * 0.96;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < count; i++) {
      const x = this.stringX(i, count) * W;
      const amp = this.amp[i] ?? 0;
      const p = this.pluckY[i] ?? 0.5;
      const hue = baseHue + i * this.param("spread", 10);
      const frequency = (2.2 + i * 0.35) * tension;
      const swing = amp * W * 0.022 * Math.cos(this.time * frequency * Math.PI * 2 + i);
      ctx.beginPath();
      for (let j = 0; j <= segments; j++) {
        const u = j / segments;
        // Blend of the plucked triangle shape and the fundamental mode.
        const shape = (u < p ? u / p : (1 - u) / (1 - p)) * 0.6 + Math.sin(Math.PI * u) * 0.4;
        const shimmer = this.vibrato * dpr * 3 * Math.sin(this.time * 7 + u * 9 + i);
        const px = x + swing * shape + shimmer * shape;
        const py = top + (bottom - top) * u;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `hsla(${hue}, 95%, 60%, ${0.12 + amp * 0.3})`;
      ctx.lineWidth = (6 + amp * 10) * dpr;
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hue}, 100%, 78%, ${0.45 + amp * 0.55})`;
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();

      const flash = this.flash[i] ?? 0;
      if (flash > 0.02) {
        const size = (24 + flash * 60) * dpr;
        ctx.globalAlpha = flash * 0.8;
        ctx.drawImage(this.sprites.get(hue, 70), x - size / 2, top + (bottom - top) * p - size / 2, size, size);
        ctx.globalAlpha = 1;
      }
      // Anchor points so the strings read as physical objects.
      ctx.fillStyle = `hsla(${hue}, 80%, 80%, 0.6)`;
      ctx.fillRect(x - 2 * dpr, top - 2 * dpr, 4 * dpr, 4 * dpr);
      ctx.fillRect(x - 2 * dpr, bottom - 2 * dpr, 4 * dpr, 4 * dpr);
    }

    const dt = 1 / 60;
    const sprite = this.sprites.get(baseHue, 80);
    for (let i = 0; i < MAX_SPARKS; i++) {
      const life = this.slife[i] ?? 0;
      if (life <= 0) continue;
      this.svx[i] = (this.svx[i] ?? 0) * 0.93;
      this.svy[i] = (this.svy[i] ?? 0) * 0.93;
      this.sx[i] = (this.sx[i] ?? 0) + (this.svx[i] ?? 0) * dt;
      this.sy[i] = (this.sy[i] ?? 0) + (this.svy[i] ?? 0) * dt;
      this.slife[i] = life - dt;
      const size = (3 + life * 8) * dpr;
      ctx.globalAlpha = clamp01(life * 1.5);
      ctx.drawImage(sprite, (this.sx[i] ?? 0) - size / 2, (this.sy[i] ?? 0) - size / 2, size, size);
    }
    ctx.restore();
  }
}
