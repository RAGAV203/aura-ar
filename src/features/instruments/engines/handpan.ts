import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { noteName } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";
import { haptic } from "./sticks";
import { StrikeDetector } from "./strikes";

/** Handpan scales: ding + tonefields, as semitones above D3. */
export const HANDPAN_SCALES: Array<{ name: string; notes: number[] }> = [
  { name: "D Kurd", notes: [0, 7, 8, 10, 12, 14, 15, 17, 19] },
  { name: "D Celtic", notes: [0, 7, 10, 12, 14, 15, 17, 19, 22] },
  { name: "D Hijaz", notes: [0, 7, 8, 11, 12, 14, 15, 17, 19] },
  { name: "D Pygmy", notes: [0, 5, 7, 8, 12, 15, 17, 19, 20] },
];

interface Field {
  semis: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  glow: number;
}

/**
 * Handpan — a steel pan with a central "ding" and tonefields around it,
 * arranged in the zig-zag order real handpans use. Tap a tonefield, or tap
 * down onto it in the air; ripples spread across the steel.
 */
export class HandpanInstrument extends CanvasInstrument {
  readonly id = "handpan" as const;
  private fields: Field[] = [];
  private touches = new Set<string>();
  private readonly strikes = new StrikeDetector(0.7);
  private ripples: Array<{ x: number; y: number; born: number; hue: number }> = [];
  private readonly sprites = new TintedSprites(createGlowSprite(48), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.layout();
  }

  protected override onResize(): void {
    this.layout();
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  private get scale() {
    return HANDPAN_SCALES[clamp(Math.round(this.param("scale", 0)), 0, HANDPAN_SCALES.length - 1)] ?? HANDPAN_SCALES[0]!;
  }

  private layout(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const R = Math.min(W, H) * 0.42;
    const cx = 0.5;
    const cy = 0.55;
    const notes = this.scale.notes;
    const fields: Field[] = [{ semis: notes[0] ?? 0, x: cx, y: cy, rx: R * 0.24, ry: R * 0.24, angle: 0, glow: 0 }];
    const ring = notes.slice(1);
    ring.forEach((semis, i) => {
      // Zig-zag: alternate sides as pitch rises, starting at the bottom.
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor((i + 1) / 2);
      // Spread the zig-zag all the way round the ding.
      const angle = Math.PI / 2 + side * step * ((Math.PI * 2) / (ring.length + 1));
      const dist = R * 0.64;
      fields.push({
        semis,
        x: cx + (Math.cos(angle) * dist) / W,
        y: cy + (Math.sin(angle) * dist) / H,
        rx: R * 0.19,
        ry: R * 0.13,
        angle: angle + Math.PI / 2,
        glow: 0,
      });
    });
    this.fields = fields;
  }

  private fieldAt(x: number, y: number): Field | null {
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (const field of this.fields) {
      const dx = (x - field.x) * W;
      const dy = (y - field.y) * H;
      const c = Math.cos(-field.angle);
      const s = Math.sin(-field.angle);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if ((lx / field.rx) ** 2 + (ly / field.ry) ** 2 <= 1.3) return field;
    }
    return null;
  }

  private strike(field: Field, velocity: number): void {
    field.glow = 1;
    this.emit({ kind: "handpan", degree: field.semis, velocity: clamp01(velocity), pan: field.x });
    this.ripples.push({ x: field.x, y: field.y, born: this.time, hue: this.hueFor(field.semis) });
    if (this.ripples.length > 16) this.ripples.shift();
  }

  private hueFor(semis: number): number {
    return this.param("hue", 200) + (semis % 12) * 12;
  }

  protected step(dt: number, input: ControlInput): void {
    const now = new Set<string>();
    for (const point of input.points) {
      if (point.source === "hand" || point.lifted) continue;
      now.add(point.id);
      if (this.touches.has(point.id)) continue;
      const field = this.fieldAt(point.position.x, point.position.y);
      if (field) {
        this.strike(field, 0.6 + point.amount * 0.35);
        haptic(6);
      }
    }
    this.touches = now;
    for (const strike of this.strikes.update(input.points, this.time, 1)) {
      const field = this.fieldAt(strike.x, strike.y);
      if (field) this.strike(field, strike.velocity);
    }
    for (const event of input.events) {
      if (event.source !== "hand") continue;
      const field = event.type === "accent" ? this.fields[0] : this.fieldAt(event.position.x, event.position.y);
      if (field) this.strike(field, 0.7);
    }
    for (const field of this.fields) field.glow *= Math.exp(-2.5 * dt);
    this.targets = { level: 0.04, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const R = Math.min(W, H) * 0.42;
    const cx = 0.5 * W;
    const cy = 0.55 * H;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Nitrided steel shell.
    const shell = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
    shell.addColorStop(0, "#6a5a4c");
    shell.addColorStop(0.55, "#3a2f28");
    shell.addColorStop(0.92, "#211a17");
    shell.addColorStop(1, "#7a6a5a");
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 230, 200, 0.25)";
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();

    // Ripples across the steel.
    this.ripples = this.ripples.filter((r) => this.time - r.born < 1.6);
    ctx.globalCompositeOperation = "lighter";
    for (const ripple of this.ripples) {
      const age = this.time - ripple.born;
      ctx.strokeStyle = `hsla(${ripple.hue}, 80%, 70%, ${(1 - age / 1.6) * 0.35})`;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(ripple.x * W, ripple.y * H, Math.min(R * 1.2, age * R * 1.3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Tonefields with dimples.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const field of this.fields) {
      const x = field.x * W;
      const y = field.y * H;
      const hue = this.hueFor(field.semis);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(field.angle);
      const dimple = ctx.createRadialGradient(-field.rx * 0.2, -field.ry * 0.3, 0, 0, 0, field.rx);
      dimple.addColorStop(0, `hsla(${hue}, 40%, ${30 + field.glow * 40}%, 0.95)`);
      dimple.addColorStop(1, "rgba(20, 15, 12, 0.9)");
      ctx.fillStyle = dimple;
      ctx.beginPath();
      ctx.ellipse(0, 0, field.rx, field.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 60%, ${55 + field.glow * 30}%, ${0.4 + field.glow * 0.6})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.ellipse(0, 0, field.rx * 0.38, field.ry * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (field.glow > 0.05) {
        const size = field.rx * 3;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = field.glow * 0.7;
        ctx.drawImage(this.sprites.get(hue, 65), x - size / 2, y - size / 2, size, size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.fillStyle = "rgba(246, 244, 255, 0.7)";
      ctx.font = `600 ${clamp(field.rx * 0.32, 9 * dpr, 13 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(noteName(50 + field.semis).replace(/\d+$/, ""), x, y);
    }
    ctx.fillStyle = "rgba(246, 244, 255, 0.8)";
    ctx.font = `600 ${clamp(W * 0.03, 12 * dpr, 17 * dpr)}px system-ui, sans-serif`;
    ctx.fillText(this.scale.name, W / 2, H * 0.12);
    ctx.restore();
  }
}
