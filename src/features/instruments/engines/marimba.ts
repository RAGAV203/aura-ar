import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { isBlackKey, noteName } from "../music";
import { CanvasInstrument } from "./canvasInstrument";
import { drawStick, haptic, StickRig, strikeVelocity, sweptHit } from "./sticks";

interface Bar {
  midi: number;
  accidental: boolean;
  x: number;
  w: number;
  y: number;
  h: number;
  flash: number;
}

const ROOT = 48; // C3

/**
 * Marimba — rosewood bars over resonator tubes, laid out like a piano in two
 * rows. Play with a mallet in each hand: strike down onto a bar and the
 * mallet bounces back. Taps play bars directly.
 */
export class MarimbaInstrument extends CanvasInstrument {
  readonly id = "marimba" as const;
  private bars: Bar[] = [];
  private readonly rig = new StickRig({ length: 0.22, swing: 0.3 });
  private touches = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.layout();
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.layout();
  }

  protected override onResize(): void {
    this.rig.setAspect(this.canvas.width / Math.max(1, this.canvas.height));
  }

  private layout(): void {
    const start = ROOT + Math.round(this.param("octave", 0)) * 12;
    const naturals = clamp(Math.round(this.param("bars", 15)), 8, 22);
    const width = 0.94 / naturals;
    const bars: Bar[] = [];
    let n = 0;
    for (let midi = start; n < naturals; midi++) {
      const t = n / naturals;
      if (isBlackKey(midi)) {
        const h = 0.17 - t * 0.05;
        bars.push({ midi, accidental: true, x: 0.03 + n * width - width * 0.42, w: width * 0.84, y: 0.36, h, flash: 0 });
      } else {
        const h = 0.24 - t * 0.08;
        bars.push({ midi, accidental: false, x: 0.03 + n * width + width * 0.06, w: width * 0.88, y: 0.56, h, flash: 0 });
        n++;
      }
    }
    this.bars = bars;
  }

  private barAt(x: number, y: number): Bar | null {
    // Accidentals sit behind (higher up), naturals in front.
    for (const bar of this.bars) {
      if (x >= bar.x && x <= bar.x + bar.w && y >= bar.y && y <= bar.y + bar.h) return bar;
    }
    return null;
  }

  private strike(bar: Bar, velocity: number): void {
    bar.flash = 1;
    this.emit({ kind: "marimba", degree: bar.midi - ROOT, velocity: clamp01(velocity), pan: bar.x + bar.w / 2 });
  }

  protected step(dt: number, input: ControlInput): void {
    const sticks = this.rig.update(input.points, dt);
    const now = new Map<string, number>();
    for (const point of input.points) {
      if (point.source === "hand" || point.lifted) continue;
      const bar = this.barAt(point.position.x, point.position.y);
      const previous = this.touches.get(point.id);
      if (bar && previous !== bar.midi) {
        this.strike(bar, 0.6 + point.amount * 0.35);
        const stick = sticks.find((s) => s.source !== "hand" && Math.abs(s.tipX - point.position.x) < 1e-3);
        if (stick) this.rig.rebound(stick, 0.6);
        haptic(6);
      }
      now.set(point.id, bar?.midi ?? -1);
    }
    this.touches = now;
    for (const stick of sticks) {
      if (!stick.active || stick.source !== "hand" || stick.sinceHit < 0.06) continue;
      let hitBar: Bar | null = null;
      const inside = (x: number, y: number) => {
        hitBar = this.barAt(x, y);
        return hitBar !== null;
      };
      if (sweptHit(stick, inside, 0.45) && hitBar) {
        const velocity = strikeVelocity(stick);
        this.strike(hitBar, velocity);
        this.rig.rebound(stick, velocity);
      }
    }
    for (const event of input.events) {
      if (event.source !== "hand") continue;
      const bar = this.barAt(event.position.x, event.position.y);
      if (bar) this.strike(bar, 0.65);
    }
    for (const bar of this.bars) bar.flash *= Math.exp(-6 * dt);
    this.targets = { level: 0.03, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Resonator tubes under the natural bars (longer for low notes).
    for (const bar of this.bars) {
      if (bar.accidental) continue;
      const x = (bar.x + bar.w * 0.2) * W;
      const w = bar.w * 0.6 * W;
      const top = (bar.y + bar.h) * H;
      const len = (0.16 - (bar.midi - ROOT) * 0.003) * H;
      const tube = ctx.createLinearGradient(x, 0, x + w, 0);
      tube.addColorStop(0, "#5a4318");
      tube.addColorStop(0.5, "#e2be6a");
      tube.addColorStop(1, "#5a4318");
      ctx.fillStyle = tube;
      ctx.fillRect(x, top, w, Math.max(20 * dpr, len));
    }
    // Support cords.
    ctx.strokeStyle = "rgba(240, 225, 200, 0.4)";
    ctx.lineWidth = 1.5 * dpr;
    for (const row of [false, true]) {
      const sample = this.bars.find((b) => b.accidental === row);
      if (!sample) continue;
      for (const frac of [0.22, 0.78]) {
        ctx.beginPath();
        ctx.moveTo(0.02 * W, (sample.y + sample.h * frac) * H);
        ctx.lineTo(0.98 * W, (sample.y + sample.h * frac) * H);
        ctx.stroke();
      }
    }
    // Rosewood bars with grain.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const bar of this.bars) {
      const x = bar.x * W;
      const y = bar.y * H + bar.flash * 2 * dpr;
      const w = bar.w * W;
      const h = bar.h * H;
      const wood = ctx.createLinearGradient(x, 0, x + w, 0);
      const l = 30 + bar.flash * 25;
      wood.addColorStop(0, `hsl(18, 55%, ${l - 8}%)`);
      wood.addColorStop(0.5, `hsl(22, 60%, ${l + 8}%)`);
      wood.addColorStop(1, `hsl(16, 55%, ${l - 10}%)`);
      ctx.fillStyle = wood;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4 * dpr);
      ctx.fill();
      ctx.strokeStyle = "rgba(20, 8, 2, 0.25)";
      ctx.lineWidth = 1 * dpr;
      for (let g = 1; g < 4; g++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * g) / 4, y + 4 * dpr);
        ctx.bezierCurveTo(x + (w * g) / 4 + 2 * dpr, y + h * 0.3, x + (w * g) / 4 - 2 * dpr, y + h * 0.7, x + (w * g) / 4, y + h - 4 * dpr);
        ctx.stroke();
      }
      if (bar.flash > 0.05) {
        ctx.fillStyle = `rgba(255, 220, 170, ${bar.flash * 0.35})`;
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255, 240, 220, 0.8)";
      ctx.font = `600 ${clamp(w * 0.38, 8 * dpr, 13 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(noteName(bar.midi).replace(/\d+$/, ""), x + w / 2, y + h - 12 * dpr);
    }
    drawStick(ctx, this.rig.sticks.left, W, H, dpr, "mallet");
    drawStick(ctx, this.rig.sticks.right, W, H, dpr, "mallet");
    ctx.restore();
  }
}
