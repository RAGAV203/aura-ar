import { clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters, QualityLevel } from "@/types/instruments";
import { CanvasInstrument } from "./canvasInstrument";

const SPACING: Record<QualityLevel, number> = { high: 22, balanced: 28, battery: 38 };
const BUCKETS = 6;

/**
 * Magnetic Field — a lattice of "iron filings" sprung to their home
 * positions. Hands and fingers push them away (or pull them in while
 * pinching), so the field lines draw the shape of the force around you.
 */
export class MagneticFieldInstrument extends CanvasInstrument {
  readonly id = "magnetic-field" as const;
  private count = 0;
  private hx = new Float32Array(0);
  private hy = new Float32Array(0);
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private energy = 0;
  private lastBell = -1;
  private radiusScale = 1;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  protected override onResize(): void {
    this.build();
  }

  protected override onQualityChange(): void {
    this.build();
  }

  protected override onReset(): void {
    this.px.set(this.hx);
    this.py.set(this.hy);
    this.vx.fill(0);
    this.vy.fill(0);
  }

  private build(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const spacing = SPACING[this.quality] * this.pixelRatio;
    const cols = Math.max(2, Math.floor(W / spacing) + 1);
    const rows = Math.max(2, Math.floor(H / spacing) + 1);
    const offsetX = (W - (cols - 1) * spacing) / 2;
    const offsetY = (H - (rows - 1) * spacing) / 2;
    this.count = cols * rows;
    this.hx = new Float32Array(this.count);
    this.hy = new Float32Array(this.count);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        // A little jitter keeps the lattice from looking mechanical.
        this.hx[i] = offsetX + c * spacing + (this.random() - 0.5) * spacing * 0.25;
        this.hy[i] = offsetY + r * spacing + (this.random() - 0.5) * spacing * 0.25;
      }
    }
    this.px = this.hx.slice();
    this.py = this.hy.slice();
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
  }

  private polarity(point: ControlPoint, touchCount: number): number {
    const base = this.param("polarity", 1) >= 0 ? 1 : -1;
    // Pinching (hands) or holding two fingers (touch) attracts instead.
    if ((point.source === "hand" && point.engaged) || (point.source === "touch" && touchCount >= 2)) return -base;
    return base;
  }

  private impulse(x: number, y: number, radius: number, strength: number): void {
    for (let i = 0; i < this.count; i++) {
      const dx = (this.px[i] ?? 0) - x;
      const dy = (this.py[i] ?? 0) - y;
      const d = Math.hypot(dx, dy);
      if (d > radius || d < 1) continue;
      const f = strength * (1 - d / radius);
      this.vx[i] = (this.vx[i] ?? 0) + (dx / d) * f;
      this.vy[i] = (this.vy[i] ?? 0) + (dy / d) * f;
    }
  }

  protected step(dt: number, input: ControlInput): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    this.radiusScale = damp(this.radiusScale, input.spread !== null ? mapRange(input.spread, 0.08, 0.8, 0.6, 2) : 1, 4, dt);
    const radius = this.param("radius", 0.2) * Math.min(W, H) * this.radiusScale;
    const strength = this.param("strength", 0.6) * 9000 * dpr;
    const spring = this.param("spring", 0.5) * 40 + 4;
    const friction = Math.exp(-5 * dt);
    const touchCount = input.points.filter((p) => p.source === "touch").length;

    const sources: Array<{ x: number; y: number; polarity: number }> = [];
    for (const point of input.points) {
      if (point.lifted) continue;
      sources.push({ x: point.position.x * W, y: point.position.y * H, polarity: this.polarity(point, touchCount) });
    }

    let displacement = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i] ?? 0;
      const y = this.py[i] ?? 0;
      let fx = ((this.hx[i] ?? 0) - x) * spring;
      let fy = ((this.hy[i] ?? 0) - y) * spring;
      for (const s of sources) {
        const dx = x - s.x;
        const dy = y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const falloff = 1 - d / radius;
        const f = (strength * falloff * falloff * s.polarity) / Math.max(d, 12 * dpr);
        fx += (dx / d) * f * 60;
        fy += (dy / d) * f * 60;
      }
      const nvx = ((this.vx[i] ?? 0) + fx * dt) * friction;
      const nvy = ((this.vy[i] ?? 0) + fy * dt) * friction;
      this.vx[i] = nvx;
      this.vy[i] = nvy;
      this.px[i] = x + nvx * dt;
      this.py[i] = y + nvy * dt;
      displacement += Math.abs(x - (this.hx[i] ?? 0)) + Math.abs(y - (this.hy[i] ?? 0));
    }

    for (const event of input.events) {
      const x = event.position.x * W;
      const y = event.position.y * H;
      if (event.type === "accent") {
        this.impulse(x, y, Math.max(W, H), 1400 * dpr);
        this.bell(Math.round((1 - event.position.y) * 6), 0.8, event.position.x, true);
        this.bell(Math.round((1 - event.position.y) * 6) + 2, 0.6, event.position.x, true);
      } else {
        this.impulse(x, y, radius * 1.6, 600 * dpr);
        this.bell(Math.round((1 - event.position.y) * 8), 0.6, event.position.x, true);
      }
    }

    const energy = clamp01(displacement / Math.max(1, this.count) / (14 * dpr));
    // A strong surge in the field rings a bell (rate-limited).
    if (energy > 0.35 && energy > this.energy + 0.05) {
      const primary = input.points[0];
      this.bell(Math.round((1 - (primary?.position.y ?? 0.5)) * 8), clamp01(0.3 + energy * 0.5), primary?.position.x ?? 0.5, false);
    }
    this.energy = damp(this.energy, energy, 5, dt);
    this.targets = {
      level: 0.1 + this.energy * 0.5,
      brightness: clamp01(0.3 + this.energy * 0.6),
      pitch: Math.round(mapRange(this.radiusScale, 0.6, 2, 3, -5)),
      pan: input.points[0]?.position.x ?? 0.5,
      texture: this.energy,
    };
  }

  private bell(degree: number, velocity: number, pan: number, force: boolean): void {
    if (!force && this.time - this.lastBell < 0.3) return;
    this.lastBell = this.time;
    this.emit({ kind: "bell", degree, velocity, pan });
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const hue = this.param("hue", 200);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // Batch filings into a few intensity buckets so each frame issues only a handful of strokes.
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      ctx.beginPath();
      for (let i = 0; i < this.count; i++) {
        const x = this.px[i] ?? 0;
        const y = this.py[i] ?? 0;
        const dx = x - (this.hx[i] ?? 0);
        const dy = y - (this.hy[i] ?? 0);
        const magnitude = Math.hypot(dx, dy);
        const level = Math.min(BUCKETS - 1, Math.floor((magnitude / (24 * dpr)) * BUCKETS));
        if (level !== bucket) continue;
        const length = (6 * dpr + Math.min(magnitude * 0.7, 26 * dpr)) * 0.5;
        const ux = magnitude > 0.5 ? dx / magnitude : 0;
        const uy = magnitude > 0.5 ? dy / magnitude : 1;
        ctx.moveTo(x - ux * length, y - uy * length);
        ctx.lineTo(x + ux * length, y + uy * length);
      }
      const t = bucket / (BUCKETS - 1);
      ctx.strokeStyle = `hsla(${hue + t * 70}, ${60 + t * 35}%, ${60 + t * 22}%, ${0.42 + t * 0.55})`;
      ctx.lineWidth = (1.2 + t * 1.6) * dpr;
      ctx.stroke();
    }
    ctx.restore();
  }
}
