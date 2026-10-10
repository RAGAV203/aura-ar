import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { MAJOR, MAJOR_PENTATONIC, MINOR } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";
import { haptic } from "./sticks";

interface Tine {
  midi: number;
  /** Scale degree number engraved on the tine (1–7) and its octave. */
  degree: number;
  octave: number;
  x: number;
  length: number;
  amp: number;
}

const SCALES = [MAJOR, MINOR, MAJOR_PENTATONIC];
const BRIDGE_Y = 0.22;

/**
 * Real kalimba layout: the lowest note is the longest tine in the middle,
 * then notes alternate left, right, left… outward. Returns, for each
 * position left→right, the index of the note it plays.
 */
export function kalimbaOrder(count: number): number[] {
  const order = new Array<number>(count).fill(0);
  const centre = Math.floor(count / 2);
  for (let note = 0; note < count; note++) {
    const step = Math.ceil(note / 2);
    // Real kalimbas (e.g. 17-key in C): D sits left of the centre C, E to its right, and so on.
    const position = note === 0 ? centre : note % 2 === 1 ? centre - step : centre + step;
    if (position >= 0 && position < count) order[position] = note;
  }
  return order;
}

/**
 * Kalimba — a thumb piano. Tap a tine, or pinch over it, to pluck; slide
 * across the tips for a glissando. Engraved numbers show scale degrees, with
 * dots for higher octaves, as on a real kalimba.
 */
export class KalimbaInstrument extends CanvasInstrument {
  readonly id = "kalimba" as const;
  private tines: Tine[] = [];
  private lastX = new Map<string, number>();
  private touches = new Set<string>();
  private readonly sprites = new TintedSprites(createGlowSprite(32), 12);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.layout();
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.layout();
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  private layout(): void {
    const count = clamp(Math.round(this.param("tines", 17)), 8, 21);
    const scale = SCALES[clamp(Math.round(this.param("scale", 0)), 0, SCALES.length - 1)] ?? MAJOR;
    const root = 60 + Math.round(this.param("key", 0));
    const order = kalimbaOrder(count);
    const spacing = 0.86 / count;
    this.tines = order.map((note, position) => {
      const octave = Math.floor(note / scale.length);
      const midi = root + octave * 12 + (scale[note % scale.length] ?? 0);
      return { midi, degree: (note % scale.length) + 1, octave, x: 0.07 + (position + 0.5) * spacing, length: 0.42 - (note / count) * 0.22, amp: 0 };
    });
  }

  private tineAt(x: number, y: number): Tine | null {
    const spacing = 0.86 / Math.max(1, this.tines.length);
    for (const tine of this.tines) {
      if (Math.abs(x - tine.x) <= spacing * 0.5 && y >= BRIDGE_Y && y <= BRIDGE_Y + tine.length + 0.03) return tine;
    }
    return null;
  }

  private pluck(tine: Tine, velocity: number): void {
    tine.amp = 1;
    this.emit({ kind: "kalimba", degree: tine.midi - 60, velocity: clamp01(velocity), pan: tine.x });
  }

  protected step(dt: number, input: ControlInput): void {
    const now = new Set<string>();
    for (const point of input.points) {
      if (point.lifted) continue;
      const pressing = point.source !== "hand" || point.engaged;
      if (!pressing) {
        this.lastX.delete(point.id);
        continue;
      }
      now.add(point.id);
      const tine = this.tineAt(point.position.x, point.position.y);
      if (point.source !== "hand" && !this.touches.has(point.id) && tine) {
        this.pluck(tine, 0.6 + point.amount * 0.35);
        haptic(5);
      }
      // Glissando: crossing between tines while pressed plucks each one passed.
      const previous = this.lastX.get(point.id);
      if (previous !== undefined && point.position.y > BRIDGE_Y && point.position.y < BRIDGE_Y + 0.45) {
        for (const t of this.tines) {
          if ((previous - t.x) * (point.position.x - t.x) < 0 && point.position.y <= BRIDGE_Y + t.length + 0.03) this.pluck(t, clamp01(0.4 + point.speed * 0.3));
        }
      }
      this.lastX.set(point.id, point.position.x);
    }
    this.touches = new Set([...now].filter((id) => !id.startsWith("hand")));
    for (const id of [...this.lastX.keys()]) if (!now.has(id)) this.lastX.delete(id);
    for (const event of input.events) {
      if (event.source !== "hand") continue;
      const tine = this.tineAt(event.position.x, event.position.y);
      if (tine) this.pluck(tine, 0.65);
    }
    for (const tine of this.tines) tine.amp *= Math.exp(-3 * dt);
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

    // Wooden body with sound hole.
    const bx = 0.04 * W;
    const by = 0.15 * H;
    const bw = 0.92 * W;
    const bh = 0.7 * H;
    const wood = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    wood.addColorStop(0, "#a86b35");
    wood.addColorStop(0.5, "#d49a5a");
    wood.addColorStop(1, "#7a4a22");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 40 * dpr);
    ctx.fill();
    ctx.fillStyle = "rgba(20, 10, 4, 0.85)";
    ctx.beginPath();
    ctx.arc(W / 2, by + bh * 0.82, Math.min(bw, bh) * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // Tines.
    const spacing = (0.86 / Math.max(1, this.tines.length)) * W;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const tine of this.tines) {
      const wiggle = Math.sin(this.time * 60 + tine.midi) * tine.amp * 2.5 * dpr;
      const x = tine.x * W + wiggle;
      const top = BRIDGE_Y * H;
      const len = tine.length * H;
      const w = Math.min(spacing * 0.62, 16 * dpr);
      const steel = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      steel.addColorStop(0, "#7d8394");
      steel.addColorStop(0.5, tine.amp > 0.05 ? "#ffffff" : "#eef1f8");
      steel.addColorStop(1, "#6b7082");
      ctx.fillStyle = steel;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, top, w, len, [0, 0, w / 2, w / 2]);
      ctx.fill();
      if (tine.amp > 0.05) {
        const size = w * 5;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = tine.amp * 0.8;
        ctx.drawImage(this.sprites.get(200, 75), x - size / 2, top + len - size / 2, size, size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      // Engraved degree number with octave dots.
      ctx.fillStyle = "rgba(30, 30, 45, 0.85)";
      ctx.font = `700 ${clamp(w * 0.75, 8 * dpr, 12 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(String(tine.degree), x, top + len - 14 * dpr);
      for (let d = 0; d < tine.octave; d++) {
        ctx.beginPath();
        ctx.arc(x, top + len - 26 * dpr - d * 6 * dpr, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Bridge bar over the tines.
    const bridge = ctx.createLinearGradient(0, BRIDGE_Y * H - 8 * dpr, 0, BRIDGE_Y * H + 8 * dpr);
    bridge.addColorStop(0, "#f2f4fa");
    bridge.addColorStop(1, "#5a5f70");
    ctx.fillStyle = bridge;
    ctx.fillRect(0.06 * W, BRIDGE_Y * H - 6 * dpr, 0.88 * W, 12 * dpr);
    ctx.restore();
  }
}
