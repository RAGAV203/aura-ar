import { clamp01, distance } from "@/lib/math";
import type { ControlInput, ControlPoint, DrumKind, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";
import { StrikeDetector } from "./strikes";

interface Pad {
  id: string;
  label: string;
  kind: DrumKind;
  /** Tom pitch index (0 high … 2 floor). */
  degree: number;
  x: number;
  y: number;
  /** Radius as a fraction of the shorter view side. */
  r: number;
  hue: number;
  cymbal: boolean;
  flash: number;
}

const HISTORY_S = 4;

const LAYOUT: Array<Omit<Pad, "flash">> = [
  { id: "crash", label: "Crash", kind: "crash", degree: 0, x: 0.17, y: 0.26, r: 0.13, hue: 48, cymbal: true },
  { id: "ride", label: "Ride", kind: "ride", degree: 0, x: 0.83, y: 0.28, r: 0.14, hue: 38, cymbal: true },
  { id: "hat-open", label: "Open hat", kind: "hat-open", degree: 0, x: 0.1, y: 0.47, r: 0.075, hue: 58, cymbal: true },
  { id: "hat", label: "Hi-hat", kind: "hat", degree: 0, x: 0.22, y: 0.52, r: 0.09, hue: 58, cymbal: true },
  { id: "tom-high", label: "Tom 1", kind: "tom", degree: 0, x: 0.39, y: 0.36, r: 0.095, hue: 280, cymbal: false },
  { id: "tom-mid", label: "Tom 2", kind: "tom", degree: 1, x: 0.61, y: 0.36, r: 0.1, hue: 260, cymbal: false },
  { id: "tom-floor", label: "Floor", kind: "tom", degree: 2, x: 0.8, y: 0.6, r: 0.12, hue: 240, cymbal: false },
  { id: "snare", label: "Snare", kind: "snare", degree: 0, x: 0.38, y: 0.62, r: 0.12, hue: 195, cymbal: false },
  { id: "kick", label: "Kick", kind: "kick", degree: 0, x: 0.58, y: 0.76, r: 0.14, hue: 330, cymbal: false },
];

/**
 * Drum Kit — nine pads arranged like a real kit. Tap a pad, or strike down
 * through it with your hand and bounce back like a stick (strike speed sets
 * the loudness). Pinching over a pad also hits it. A scrolling strip records
 * the groove you play.
 */
export class DrumKitInstrument extends CanvasInstrument {
  readonly id = "drum-kit" as const;
  private pads: Pad[] = LAYOUT.map((p) => ({ ...p, flash: 0 }));
  private readonly strikes = new StrikeDetector();
  private touchPad = new Map<string, string | null>();
  private history: Array<{ lane: number; at: number; velocity: number }> = [];
  private rings: Array<{ pad: Pad; born: number; velocity: number }> = [];
  private readonly sprites = new TintedSprites(createGlowSprite(48), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected override onReset(): void {
    this.strikes.reset();
    this.history = [];
    this.rings = [];
  }

  private padAt(x: number, y: number): Pad | null {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const side = Math.min(W, H);
    const scale = this.param("size", 1);
    let best: Pad | null = null;
    let bestD = Infinity;
    for (const pad of this.pads) {
      const d = distance(x * W, y * H, pad.x * W, pad.y * H) / (pad.r * side * scale);
      if (d < 1 && d < bestD) {
        best = pad;
        bestD = d;
      }
    }
    return best;
  }

  private hit(pad: Pad, velocity: number): void {
    const v = clamp01(velocity) * this.param("volume", 0.85);
    pad.flash = 1;
    this.emit({ kind: pad.kind, degree: pad.degree, velocity: v, pan: pad.x });
    this.rings.push({ pad, born: this.time, velocity: v });
    if (this.rings.length > 24) this.rings.shift();
    this.history.push({ lane: this.pads.indexOf(pad), at: this.time, velocity: v });
  }

  private handleTouch(point: ControlPoint): void {
    const pad = this.padAt(point.position.x, point.position.y);
    const previous = this.touchPad.get(point.id);
    // Hit on press, and when sliding onto a different pad (rolls across toms).
    if (pad && (previous === undefined || previous !== pad.id)) this.hit(pad, 0.55 + point.amount * 0.45);
    this.touchPad.set(point.id, pad?.id ?? null);
  }

  protected step(_dt: number, input: ControlInput): void {
    const seenTouch = new Set<string>();
    for (const point of input.points) {
      if (point.source === "hand") continue;
      seenTouch.add(point.id);
      this.handleTouch(point);
    }
    for (const id of this.touchPad.keys()) if (!seenTouch.has(id)) this.touchPad.delete(id);
    for (const strike of this.strikes.update(input.points, this.time, this.param("sensitivity", 1))) {
      const pad = this.padAt(strike.x, strike.y);
      if (pad) this.hit(pad, strike.velocity);
    }

    for (const event of input.events) {
      if (event.type === "accent") {
        // Big ending: kick + crash together.
        const kick = this.pads.find((p) => p.id === "kick");
        const crash = this.pads.find((p) => p.id === "crash");
        if (kick) this.hit(kick, 0.95);
        if (crash) this.hit(crash, 0.9);
      } else if (event.source === "hand") {
        // Pinch over a pad: an alternative to striking.
        const pad = this.padAt(event.position.x, event.position.y);
        if (pad) this.hit(pad, 0.7);
      }
    }

    for (const pad of this.pads) pad.flash *= 0.86;
    this.history = this.history.filter((h) => this.time - h.at < HISTORY_S);
    const recent = this.history.filter((h) => this.time - h.at < 1).length;
    this.targets = { level: 0.04, brightness: 0.3, pitch: 0, pan: 0.5, texture: clamp01(recent / 12) * 0.2 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const side = Math.min(W, H);
    const scale = this.param("size", 1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (const pad of this.pads) {
      const x = pad.x * W;
      const y = pad.y * H;
      const r = pad.r * side * scale;
      // Cymbals wobble after a hit.
      const wobble = pad.cymbal ? Math.sin(this.time * 30) * pad.flash * 0.12 : 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, pad.cymbal ? 0.55 + wobble : 0.8);
      const head = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      head.addColorStop(0, `hsla(${pad.hue}, 80%, ${pad.cymbal ? 70 : 60}%, ${0.08 + pad.flash * 0.6})`);
      head.addColorStop(1, `hsla(${pad.hue}, 80%, 50%, ${0.04 + pad.flash * 0.25})`);
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = (pad.cymbal ? 2 : 3) * dpr;
      ctx.strokeStyle = `hsla(${pad.hue}, 90%, ${65 + pad.flash * 25}%, ${0.55 + pad.flash * 0.45})`;
      ctx.stroke();
      if (pad.cymbal) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = `rgba(246, 244, 255, ${0.55 + pad.flash * 0.45})`;
      ctx.font = `600 ${Math.max(10 * dpr, r * 0.22)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pad.label, x, y);
    }

    ctx.globalCompositeOperation = "lighter";
    this.rings = this.rings.filter((ring) => this.time - ring.born < 0.6);
    for (const ring of this.rings) {
      const age = this.time - ring.born;
      const r = ring.pad.r * side * scale * (1 + age * 1.6);
      ctx.globalAlpha = (1 - age / 0.6) * (0.4 + ring.velocity * 0.6);
      ctx.strokeStyle = `hsla(${ring.pad.hue}, 95%, 70%, 1)`;
      ctx.lineWidth = (2 + ring.velocity * 4) * dpr;
      ctx.beginPath();
      ctx.ellipse(ring.pad.x * W, ring.pad.y * H, r, r * (ring.pad.cymbal ? 0.55 : 0.8), 0, 0, Math.PI * 2);
      ctx.stroke();
      if (age < 0.12) {
        const glow = r * 1.6;
        ctx.globalAlpha = (1 - age / 0.12) * ring.velocity;
        ctx.drawImage(this.sprites.get(ring.pad.hue, 70), ring.pad.x * W - glow / 2, ring.pad.y * H - glow / 2, glow, glow);
      }
    }

    // Groove strip: the last few seconds of hits, newest on the right.
    const top = H * 0.12;
    const height = H * 0.07;
    const lanes = this.pads.length;
    for (const h of this.history) {
      const age = this.time - h.at;
      const pad = this.pads[h.lane];
      if (!pad) continue;
      ctx.globalAlpha = (1 - age / HISTORY_S) * (0.4 + h.velocity * 0.6);
      ctx.fillStyle = `hsla(${pad.hue}, 90%, 65%, 1)`;
      const x = W * (0.95 - (age / HISTORY_S) * 0.9);
      const y = top + (h.lane / Math.max(1, lanes - 1)) * height;
      ctx.beginPath();
      ctx.arc(x, y, (2 + h.velocity * 3) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
