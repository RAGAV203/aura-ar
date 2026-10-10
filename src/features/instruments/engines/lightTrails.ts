import { clamp01, damp, isFiniteNumber } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

interface TrailState {
  x: number;
  y: number;
  travelled: number;
}

const MAX_SPARKS = 2400;
const HUE_STEPS = [0, 55, 150, 205, 285];

/**
 * Light Trails — long-exposure light painting. Trails accumulate on an
 * offscreen paint layer that fades by (1 - persistence); sparks are drawn
 * fresh on top each frame so they glitter instead of smearing. Fast movement
 * sheds sparks and plays plucked notes pitched by hand height.
 */
export class LightTrailsInstrument extends CanvasInstrument {
  readonly id = "light-trails" as const;
  private trails = new Map<string, TrailState>();
  private readonly sx = new Float32Array(MAX_SPARKS);
  private readonly sy = new Float32Array(MAX_SPARKS);
  private readonly svx = new Float32Array(MAX_SPARKS);
  private readonly svy = new Float32Array(MAX_SPARKS);
  private readonly slife = new Float32Array(MAX_SPARKS);
  private cursor = 0;
  private hueIndex = 0;
  private activity = 0;
  private readonly sprites: TintedSprites;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.sprites = new TintedSprites(createGlowSprite(48));
    this.useOffscreenLayer();
  }

  protected override isPersistent(): boolean {
    return true;
  }

  protected override onUndo(): void {
    this.slife.fill(0);
    this.trails.clear();
  }

  protected override onReset(): void {
    this.slife.fill(0);
    this.trails.clear();
  }

  override serializeState(): Record<string, unknown> {
    return { hueIndex: this.hueIndex };
  }

  override restoreState(state: Record<string, unknown>): void {
    if (isFiniteNumber(state.hueIndex)) this.hueIndex = Math.abs(Math.round(state.hueIndex)) % HUE_STEPS.length;
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  private get hue(): number {
    return this.param("hue", 45) + (HUE_STEPS[this.hueIndex] ?? 0);
  }

  protected step(dt: number, input: ControlInput): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const persistence = this.param("persistence", 0.992);
    this.fade((1 - persistence) * dt * 60);

    const seen = new Set<string>();
    let speedSum = 0;
    let xSum = 0;
    for (const point of input.points) {
      if (point.lifted) continue;
      seen.add(point.id);
      const x = point.position.x * W;
      const y = point.position.y * H;
      speedSum += point.speed;
      xSum += point.position.x;
      const trail = this.trails.get(point.id);
      if (!trail) {
        this.trails.set(point.id, { x, y, travelled: 0 });
        continue;
      }
      this.drawTrail(trail.x, trail.y, x, y, point.speed);
      const moved = Math.hypot(x - trail.x, y - trail.y);
      trail.travelled += moved / Math.max(W, H);
      if (trail.travelled > 0.11 && point.speed > 0.12) {
        trail.travelled = 0;
        this.emit({ kind: "pluck", degree: Math.round((1 - point.position.y) * 10) - 2, velocity: clamp01(0.3 + point.speed * 0.35), pan: point.position.x });
      }
      const sparks = Math.round(point.speed * this.param("sparks", 0.6) * 6 * this.budget);
      for (let i = 0; i < sparks; i++) {
        const t = this.random();
        this.spawnSpark(trail.x + (x - trail.x) * t, trail.y + (y - trail.y) * t, point.velocity.x * W * 0.15, point.velocity.y * H * 0.15, dpr);
      }
      trail.x = x;
      trail.y = y;
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);

    for (const event of input.events) {
      const x = event.position.x * W;
      const y = event.position.y * H;
      if (event.type === "accent" || event.source === "hand") {
        this.hueIndex = (this.hueIndex + 1) % HUE_STEPS.length;
        this.emit({ kind: "pluck", degree: 7, velocity: 0.6, pan: event.position.x });
      } else {
        this.emit({ kind: "pluck", degree: Math.round((1 - event.position.y) * 10) - 2, velocity: 0.5, pan: event.position.x });
      }
      for (let i = 0; i < 24 * this.budget + 6; i++) {
        const angle = this.random() * Math.PI * 2;
        const speed = (40 + this.random() * 160) * dpr;
        this.spawnSpark(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, dpr);
      }
    }

    const count = seen.size;
    this.activity = damp(this.activity, count > 0 ? clamp01(speedSum * 0.8) : 0, 5, dt);
    this.targets = {
      level: 0.14 + this.activity * 0.4,
      brightness: 0.3 + this.activity * 0.6,
      pitch: 0,
      pan: count > 0 ? xSum / count : 0.5,
      texture: this.activity * this.param("sparks", 0.6) * 0.6,
    };
  }

  private drawTrail(x0: number, y0: number, x1: number, y1: number, speed: number): void {
    const ctx = this.paint;
    const width = this.param("width", 4) * this.pixelRatio;
    const intensity = clamp01(0.8 + speed * 0.3);
    const hue = this.hue;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = `hsla(${hue}, 100%, 55%, ${0.16 * intensity})`;
    ctx.lineWidth = width * 5;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${0.6 * intensity})`;
    ctx.lineWidth = width * 1.8;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue}, 100%, 92%, ${0.9 * intensity})`;
    ctx.lineWidth = width * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  private spawnSpark(x: number, y: number, vx: number, vy: number, dpr: number): void {
    const capacity = Math.floor(MAX_SPARKS * this.budget);
    if (capacity === 0) return;
    const i = this.cursor % capacity;
    this.cursor = (this.cursor + 1) % capacity;
    this.sx[i] = x;
    this.sy[i] = y;
    this.svx[i] = vx + (this.random() - 0.5) * 60 * dpr;
    this.svy[i] = vy + (this.random() - 0.5) * 60 * dpr;
    this.slife[i] = 0.5 + this.random() * 0.9;
  }

  protected draw(): void {
    const { ctx } = this;
    const dt = 1 / 60;
    const capacity = Math.floor(MAX_SPARKS * this.budget);
    const sprite = this.sprites.get(this.hue, 70);
    const dpr = this.pixelRatio;
    this.presentLayer();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < capacity; i++) {
      const life = this.slife[i] ?? 0;
      if (life <= 0) continue;
      const vx = (this.svx[i] ?? 0) * 0.94;
      const vy = (this.svy[i] ?? 0) * 0.94 + 18 * dpr * dt;
      this.svx[i] = vx;
      this.svy[i] = vy;
      const x = (this.sx[i] ?? 0) + vx * dt;
      const y = (this.sy[i] ?? 0) + vy * dt;
      this.sx[i] = x;
      this.sy[i] = y;
      this.slife[i] = life - dt;
      const size = (4 + life * 7) * dpr;
      ctx.globalAlpha = clamp01(life) * 0.85;
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
  }
}
