import { clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

const MAX_PARTICLES = 6000;

/**
 * Particle Bloom — gestures release flower-shaped bursts of glowing petals.
 * Two-point spread scales the expansion; particle activity drives the sound
 * texture within the audio engine's safety limits.
 */
export class ParticleBloomInstrument extends CanvasInstrument {
  readonly id = "particle-bloom" as const;
  private readonly x = new Float32Array(MAX_PARTICLES);
  private readonly y = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly hue = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private active = 0;
  private expansion = 1;
  private idleTime = 0;
  private nextIdleBloom = 1.2;
  private readonly sprites: TintedSprites;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.sprites = new TintedSprites(createGlowSprite(48), 24);
  }

  protected override onReset(): void {
    this.life.fill(0);
    this.active = 0;
    this.idleTime = 0;
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  private get capacity(): number {
    return Math.floor(MAX_PARTICLES * this.budget);
  }

  protected step(dt: number, input: ControlInput): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;

    let target = this.param("expansion", 1);
    if (input.spread !== null) target *= mapRange(input.spread, 0.08, 0.8, 0.5, 2.2);
    if (input.bodySpread !== null) target *= 1 + input.bodySpread;
    this.expansion = damp(this.expansion, target, 4, dt);

    for (const event of input.events) {
      const strength = event.type === "accent" ? 2.2 : 1;
      this.bloom(event.position.x * W, event.position.y * H, strength);
      this.emit({ kind: "swell", degree: Math.round((1 - event.position.y) * 6), velocity: event.type === "accent" ? 0.8 : 0.55, pan: event.position.x });
    }

    let streaming = 0;
    for (const point of input.points) {
      if (!point.engaged || point.lifted) continue;
      streaming++;
      const count = Math.round(5 * this.param("density", 0.6) * this.budget) + 1;
      for (let i = 0; i < count; i++) {
        const angle = this.random() * Math.PI * 2;
        const speed = (30 + this.random() * 90) * dpr * this.expansion;
        this.spawn(point.position.x * W, point.position.y * H, Math.cos(angle) * speed + point.velocity.x * W * 0.2, Math.sin(angle) * speed + point.velocity.y * H * 0.2, (1.5 + point.amount * 4) * dpr, this.param("hue", 280) + (this.random() - 0.5) * 50, 0.8 + this.random());
      }
    }

    // Gentle self-playing blooms keep the scene alive when nobody is interacting.
    const interacting = input.points.length > 0 || input.events.length > 0;
    this.idleTime = interacting ? 0 : this.idleTime + dt;
    if (!this.reducedMotion && this.idleTime > this.nextIdleBloom) {
      this.idleTime = 0;
      this.nextIdleBloom = 2.5 + this.random() * 2.5;
      this.bloom(W * (0.2 + this.random() * 0.6), H * (0.25 + this.random() * 0.5), 0.45);
    }

    const activity = clamp01(this.active / Math.max(1, this.capacity * 0.6));
    if (activity > 0.05 && this.random() < activity * 0.04) {
      this.emit({ kind: "pluck", degree: 7 + Math.floor(this.random() * 6), velocity: 0.15 + activity * 0.2, pan: this.random() });
    }
    this.targets = {
      level: 0.12 + activity * 0.5 + (streaming > 0 ? 0.1 : 0),
      brightness: clamp01(0.25 + this.expansion * 0.3),
      pitch: 0,
      pan: input.points[0]?.position.x ?? 0.5,
      texture: activity,
    };
  }

  private bloom(cx: number, cy: number, strength: number): void {
    const dpr = this.pixelRatio;
    const density = this.param("density", 0.6);
    const n = Math.round((density * 260 * this.budget + 24) * strength);
    const petals = 5 + Math.floor(this.random() * 4);
    const twist = this.random() * Math.PI;
    const baseHue = this.param("hue", 280) + (this.random() - 0.5) * 70;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + this.random() * 0.05;
      const petal = Math.abs(Math.cos((petals * (angle + twist)) / 2));
      const speed = (40 + petal * 200 + this.random() * 30) * dpr * this.expansion * Math.sqrt(strength);
      const hue = baseHue + petal * 40;
      this.spawn(cx, cy, Math.cos(angle) * speed, Math.sin(angle) * speed, (1.5 + (1 - density) * 3 + petal * 2) * dpr, hue, 1.2 + this.random() * 1.3);
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, size: number, hue: number, life: number): void {
    const capacity = this.capacity;
    if (capacity === 0) return;
    const i = this.cursor % capacity;
    this.cursor = (this.cursor + 1) % capacity;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.size[i] = size;
    this.hue[i] = hue;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  protected draw(): void {
    const { ctx } = this;
    const dt = 1 / 60;
    const dpr = this.pixelRatio;
    const drag = 0.955 + Math.min(this.expansion, 2) * 0.012;
    const gravity = this.param("gravity", -0.15) * 50 * dpr;
    this.fade(this.reducedMotion ? 0.5 : 0.24);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    let active = 0;
    const capacity = this.capacity;
    for (let i = 0; i < capacity; i++) {
      const life = this.life[i] ?? 0;
      if (life <= 0) continue;
      active++;
      const vx = (this.vx[i] ?? 0) * drag;
      const vy = (this.vy[i] ?? 0) * drag + gravity * dt;
      this.vx[i] = vx;
      this.vy[i] = vy;
      const x = (this.x[i] ?? 0) + vx * dt;
      const y = (this.y[i] ?? 0) + vy * dt;
      this.x[i] = x;
      this.y[i] = y;
      this.life[i] = life - dt;
      const ratio = life / (this.maxLife[i] ?? 1);
      const size = (this.size[i] ?? 2) * (1 + (1 - ratio) * 1.5) * 2.4;
      ctx.globalAlpha = ratio * 0.75;
      ctx.drawImage(this.sprites.get(this.hue[i] ?? 0, 62 + Math.round(ratio * 2) * 8), x - size / 2, y - size / 2, size, size);
    }
    this.active = active;
    ctx.restore();
  }
}
