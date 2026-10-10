import { clamp, clamp01, createNoise1D, damp, isFiniteNumber } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

interface StrokeState {
  x: number;
  y: number;
  width: number;
  travelled: number;
}

const MAX_PARTICLES = 1800;

/**
 * InkFlow — fluid-looking ink on a persistent canvas. The main stroke is laid
 * down directly; "bleed" particles then curl outward along a noise flow field
 * so the ink feathers like wet pigment.
 */
export class InkFlowInstrument extends CanvasInstrument {
  readonly id = "inkflow" as const;
  private strokes = new Map<string, StrokeState>();
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly hue = new Float32Array(MAX_PARTICLES);
  /** Per-particle offset into the flow field so neighbours diffuse apart. */
  private readonly phase = new Float32Array(MAX_PARTICLES);
  private readonly sprites = new TintedSprites(createGlowSprite(32), 24);
  private cursor = 0;
  private hueOffset = 0;
  private activity = 0;
  private readonly noiseA: (x: number) => number;
  private readonly noiseB: (x: number) => number;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.noiseA = createNoise1D(seed + 1);
    this.noiseB = createNoise1D(seed + 2);
  }

  protected override isPersistent(): boolean {
    return true;
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected override onErase(x: number, y: number, radius: number): void {
    // Bleed particles would otherwise drift back and re-ink the erased area.
    const r2 = (radius * 1.6) ** 2;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if ((this.life[i] ?? 0) <= 0) continue;
      const dx = (this.px[i] ?? 0) - x;
      const dy = (this.py[i] ?? 0) - y;
      if (dx * dx + dy * dy < r2) this.life[i] = 0;
    }
  }

  protected override onUndo(): void {
    this.life.fill(0);
    this.strokes.clear();
  }

  protected override onReset(): void {
    this.life.fill(0);
    this.strokes.clear();
    this.activity = 0;
  }

  override serializeState(): Record<string, unknown> {
    return { hueOffset: this.hueOffset };
  }

  override restoreState(state: Record<string, unknown>): void {
    if (isFiniteNumber(state.hueOffset)) this.hueOffset = state.hueOffset % 360;
  }

  private get capacity(): number {
    return Math.floor(MAX_PARTICLES * this.budget);
  }

  private inkHue(): number {
    return this.param("hue", 300) + this.hueOffset + Math.sin(this.time * 0.15) * 25;
  }

  protected step(dt: number, input: ControlInput): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const fade = this.param("fade", 0);
    if (fade > 0) this.fade(fade * fade * 0.05 * dt * 60);

    let speedSum = 0;
    let ySum = 0;
    let xSum = 0;
    let drawing = 0;
    const seen = new Set<string>();

    for (const point of input.points) {
      if (point.lifted) continue;
      seen.add(point.id);
      const x = point.position.x * W;
      const y = point.position.y * H;
      const width = this.brushWidth(point) * dpr;
      const stroke = this.strokes.get(point.id);
      drawing++;
      speedSum += point.speed;
      xSum += point.position.x;
      ySum += point.position.y;

      if (!stroke) {
        this.strokes.set(point.id, { x, y, width, travelled: 0 });
        this.dab(x, y, width);
        this.emit({ kind: "percussion", degree: Math.round((1 - point.position.y) * 7), velocity: 0.35, pan: point.position.x });
        continue;
      }
      const smoothedWidth = damp(stroke.width, width, 12, dt);
      this.segment(stroke.x, stroke.y, x, y, stroke.width, smoothedWidth);
      const moved = Math.hypot(x - stroke.x, y - stroke.y);
      stroke.travelled += moved / Math.max(W, H);
      if (stroke.travelled > 0.09) {
        stroke.travelled = 0;
        this.emit({ kind: "percussion", degree: Math.round((1 - point.position.y) * 9), velocity: clamp01(0.2 + point.speed * 0.4), pan: point.position.x });
      }
      this.spawnBleed(stroke.x, stroke.y, x, y, point, smoothedWidth, moved);
      stroke.x = x;
      stroke.y = y;
      stroke.width = smoothedWidth;
    }
    for (const id of this.strokes.keys()) if (!seen.has(id)) this.strokes.delete(id);

    for (const event of input.events) {
      if (event.type === "tap") this.splash(event.position.x * W, event.position.y * H);
      else this.hueOffset = (this.hueOffset + 60) % 360;
    }

    this.activity = damp(this.activity, drawing > 0 ? clamp01(0.3 + speedSum * 0.6) : 0, 4, dt);
    this.targets = {
      level: 0.18 + this.activity * 0.45,
      brightness: drawing > 0 ? clamp01(1 - ySum / drawing) : 0.35,
      pitch: 0,
      pan: drawing > 0 ? xSum / drawing : 0.5,
      texture: this.activity * this.param("bleed", 0.5),
    };
  }

  private brushWidth(point: ControlPoint): number {
    const base = this.param("size", 14);
    const amount = point.source === "hand" ? 0.25 + point.amount * 1.75 : 0.3 + point.amount * 1.4;
    const speedThinning = clamp(1.25 - point.speed * 0.35, 0.45, 1.25);
    return base * amount * speedThinning;
  }

  private dab(x: number, y: number, width: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = `hsl(${this.inkHue()}, 85%, 62%)`;
    ctx.beginPath();
    ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private segment(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): void {
    const { ctx } = this;
    const hue = this.inkHue();
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    // Soft halo first, then the saturated core.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = `hsl(${hue + 20}, 90%, 55%)`;
    ctx.lineWidth = (w0 + w1) * 0.9;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = `hsl(${hue}, 85%, 62%)`;
    ctx.lineWidth = (w0 + w1) / 2;
    ctx.stroke();
    ctx.restore();
  }

  /** Spreads bleed particles along the whole segment so ink feathers continuously. */
  private spawnBleed(x0: number, y0: number, x1: number, y1: number, point: ControlPoint, width: number, moved: number): void {
    const bleed = this.param("bleed", 0.5);
    const count = Math.round((2 + moved / Math.max(2, width * 0.35)) * bleed * 2 * this.budget);
    for (let i = 0; i < count; i++) {
      const t = this.random();
      this.spawn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, point.velocity.x * 60, point.velocity.y * 60, width, 0.8 + this.random() * 1.6);
    }
  }

  private splash(x: number, y: number): void {
    const n = Math.round(40 * this.budget + 10);
    const base = this.param("size", 14) * this.pixelRatio;
    this.dab(x, y, base * 1.6);
    for (let i = 0; i < n; i++) {
      const angle = this.random() * Math.PI * 2;
      const speed = (20 + this.random() * 80) * this.pixelRatio;
      this.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, base, 0.8 + this.random() * 1.2);
    }
    this.emit({ kind: "percussion", degree: Math.round((1 - y / this.canvas.height) * 7), velocity: 0.6, pan: x / this.canvas.width });
  }

  private spawn(x: number, y: number, vx: number, vy: number, width: number, life: number): void {
    const capacity = this.capacity;
    if (capacity === 0) return;
    const i = this.cursor % capacity;
    this.cursor = (this.cursor + 1) % capacity;
    const jitter = width * 0.5;
    this.px[i] = x + (this.random() - 0.5) * jitter;
    this.py[i] = y + (this.random() - 0.5) * jitter;
    const angle = this.random() * Math.PI * 2;
    const push = (8 + this.random() * 30) * this.pixelRatio;
    this.vx[i] = vx * 0.15 + Math.cos(angle) * push;
    this.vy[i] = vy * 0.15 + Math.sin(angle) * push;
    this.phase[i] = this.random() * 50;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = width * (0.12 + this.random() * 0.3);
    this.hue[i] = this.inkHue() + (this.random() - 0.5) * 40;
  }

  protected draw(): void {
    const { ctx } = this;
    const dt = 1 / 60;
    const capacity = this.capacity;
    const flow = (8 + this.param("bleed", 0.5) * 30) * this.pixelRatio;
    const scale = 0.004 / this.pixelRatio;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < capacity; i++) {
      const life = this.life[i] ?? 0;
      if (life <= 0) continue;
      const x = this.px[i] ?? 0;
      const y = this.py[i] ?? 0;
      const p = this.phase[i] ?? 0;
      const angle = (this.noiseA(x * scale + p + this.time * 0.15) + this.noiseB(y * scale - p - this.time * 0.1)) * Math.PI * 2;
      const vx = ((this.vx[i] ?? 0) + Math.cos(angle) * flow * dt) * 0.94;
      const vy = ((this.vy[i] ?? 0) + Math.sin(angle) * flow * dt) * 0.94;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.px[i] = x + vx * dt;
      this.py[i] = y + vy * dt;
      const remaining = life - dt;
      this.life[i] = remaining;
      const ratio = remaining / (this.maxLife[i] ?? 1);
      // Soft sprites accumulate into feathered, pigment-like edges.
      ctx.globalAlpha = 0.05 * ratio;
      const r = (this.size[i] ?? 1) * (2.2 - ratio * 0.8);
      ctx.drawImage(this.sprites.get(this.hue[i] ?? 0, 60), x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}
