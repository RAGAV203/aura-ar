import { clamp, clamp01, damp } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters } from "@/types/instruments";
import { CARNATIC_RAGAS, HINDUSTANI_RAGAS, sargam, type Raga } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

interface Variant {
  kind: "veena" | "sitar";
  ragas: Raga[];
  /** MIDI of Sa before the "sa" parameter shift. */
  baseSa: number;
  neck: [string, string];
  fretColor: string;
  mainStrings: number;
  sympathetic: number;
}

const NUT = 0.07;
const SPAN = 0.76;
const NECK_Y = 0.5;
const NECK_H = 0.13;
const OCTAVES = 2;

interface Held {
  pointId: string;
  voiceId: string;
  fret: number;
  startY: number;
  bend: number;
}

/**
 * Shared engine for the veena and the sitar. Frets are placed like the real
 * instruments (log-spaced, closer together towards the bridge) on the notes
 * of the chosen raga. Pluck with a pinch or tap; while holding, pull the
 * string sideways for meend (pitch bend) or slide along the neck to glide.
 * A tanpura drone plays underneath.
 */
abstract class IndianStringInstrument extends CanvasInstrument {
  protected abstract readonly variant: Variant;
  protected frets: number[] = []; // semitones above Sa
  private held: Held | null = null;
  private voiceCounter = 0;
  private stringAmp = 0;
  private tarafAmp: number[] = [];
  private tarafNotes: number[] = [];
  private pressedTouch = new Set<string>();
  private queue: Array<{ at: number; midi: number; velocity: number; taraf: number }> = [];
  private finger: { x: number; y: number; visible: number } = { x: 0.5, y: NECK_Y, visible: 0 };
  protected readonly sprites = new TintedSprites(createGlowSprite(40), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.buildFrets();
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected buildFrets(): void {
    const raga = this.raga;
    const frets: number[] = [];
    for (let octave = 0; octave < OCTAVES; octave++) for (const note of raga.notes) frets.push(octave * 12 + note);
    frets.push(OCTAVES * 12);
    this.frets = frets;
    // Sympathetic strings are tuned to the raga across an octave and a half.
    this.tarafNotes = Array.from({ length: this.variant.sympathetic }, (_, i) => 12 + (raga.notes[i % raga.notes.length] ?? 0) + Math.floor(i / raga.notes.length) * 12);
    this.tarafAmp = this.tarafNotes.map(() => 0);
  }

  protected get raga(): Raga {
    return this.variant.ragas[clamp(Math.round(this.param("raga", 0)), 0, this.variant.ragas.length - 1)] ?? this.variant.ragas[0]!;
  }

  protected get sa(): number {
    return this.variant.baseSa + Math.round(this.param("sa", 0));
  }

  /**
   * Fret position. Real frets sit at 1 − 2^(−semitones/12) of the string, which
   * crowds the upper octave into a sliver on a phone; blending with even
   * spacing keeps the "closer towards the bridge" look while every swara stays
   * a comfortable target.
   */
  protected fretX(semitones: number): number {
    const full = 1 - 2 ** (-(OCTAVES * 12) / 12);
    const real = (1 - 2 ** (-semitones / 12)) / full;
    const even = semitones / (OCTAVES * 12);
    return NUT + (0.4 * real + 0.6 * even) * SPAN;
  }

  protected fretAt(x: number): number {
    let best = 0;
    let bestD = Infinity;
    this.frets.forEach((semi, i) => {
      const d = Math.abs(this.fretX(semi) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private onNeck(point: ControlPoint): boolean {
    return point.position.y > NECK_Y - NECK_H * 2.2 && point.position.y < NECK_Y + NECK_H * 2.2 && point.position.x < NUT + SPAN + 0.04;
  }

  private pluck(point: ControlPoint): void {
    const fret = this.fretAt(point.position.x);
    const midi = this.sa + (this.frets[fret] ?? 0);
    if (this.held) this.voiceOff(this.held.voiceId, 0.6);
    const voiceId = `${this.variant.kind}-${this.voiceCounter++}`;
    const velocity = clamp01(0.55 + point.speed * 0.25);
    this.voiceOn(voiceId, this.variant.kind, midi, velocity, 0.45);
    this.held = { pointId: point.id, voiceId, fret, startY: point.position.y, bend: 0 };
    this.stringAmp = Math.max(this.stringAmp, velocity);
    this.sympathise(midi, velocity);
  }

  /** Sympathetic strings ring quietly when a played note matches their pitch class (sitar). */
  private sympathise(midi: number, velocity: number): void {
    if (this.variant.sympathetic === 0) return;
    const pc = (midi - this.sa + 120) % 12;
    this.tarafNotes.forEach((note, i) => {
      if (note % 12 !== pc) return;
      this.queue.push({ at: this.time + 0.03 + i * 0.008, midi: this.sa + note, velocity: velocity * 0.14, taraf: i });
    });
  }

  protected step(dt: number, input: ControlInput): void {
    this.stringAmp *= Math.exp(-1.2 * dt);
    this.finger.visible *= Math.exp(-3 * dt);
    for (let i = 0; i < this.tarafAmp.length; i++) this.tarafAmp[i] = (this.tarafAmp[i] ?? 0) * Math.exp(-1.5 * dt);

    const touchesNow = new Set<string>();
    for (const point of input.points) {
      if (point.lifted || !this.onNeck(point)) continue;
      this.finger = { x: point.position.x, y: point.position.y, visible: 1 };
      if (point.source !== "hand") {
        touchesNow.add(point.id);
        if (!this.pressedTouch.has(point.id)) this.pluck(point);
      }
      const held = this.held;
      if (held && held.pointId === point.id && (point.source !== "hand" || point.engaged)) {
        // Slide along the neck, and pull the string (meend) with vertical movement.
        const fret = this.fretAt(point.position.x);
        const target = clamp(Math.abs(point.position.y - held.startY) * 16, 0, this.param("meend", 2.5));
        held.bend = damp(held.bend, target, 14, dt);
        const glide = fret !== held.fret ? 90 : 25;
        held.fret = fret;
        this.voiceUpdate(held.voiceId, { midi: this.sa + (this.frets[fret] ?? 0) + held.bend, glideMs: glide });
      }
    }
    this.pressedTouch = touchesNow;

    for (const event of input.events) {
      if (event.type === "accent") {
        // Chikari / tala strings: a bright drone strum.
        const strum = this.variant.kind === "sitar" ? [24, 24, 19] : [0, 7, 12];
        strum.forEach((semi, k) => this.queue.push({ at: this.time + k * 0.05, midi: this.sa + semi, velocity: 0.4, taraf: -1 }));
        continue;
      }
      if (event.source !== "hand") continue;
      const point = input.points.find((p) => p.source === "hand" && Math.hypot(p.position.x - event.position.x, p.position.y - event.position.y) < 0.02);
      if (point && this.onNeck(point)) this.pluck(point);
    }

    // When the playing hand lets go, the string springs back from the bend but keeps ringing.
    const held = this.held;
    if (held) {
      const point = input.points.find((p) => p.id === held.pointId);
      const holding = point && !point.lifted && (point.source !== "hand" || point.engaged);
      if (!holding && held.bend > 0.01) {
        held.bend = damp(held.bend, 0, 10, dt);
        this.voiceUpdate(held.voiceId, { midi: this.sa + (this.frets[held.fret] ?? 0) + held.bend, glideMs: 40 });
      }
    }

    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      for (const q of due) {
        const id = q.taraf >= 0 ? `taraf-${q.taraf}` : `chikari-${this.voiceCounter++}`;
        this.voiceOn(id, this.variant.kind, q.midi, q.velocity, q.taraf >= 0 ? 0.6 : 0.5);
        if (q.taraf >= 0) this.tarafAmp[q.taraf] = 1;
        else this.stringAmp = Math.max(this.stringAmp, 0.4);
      }
    }

    // Tanpura drone follows the chosen Sa (the layer is built on the default Sa).
    this.targets = { level: this.param("drone", 0.45) * 0.6, brightness: 0.32, pitch: Math.round(this.param("sa", 0)), pan: 0.5, texture: 0.25 };
  }

  /* ---------- Drawing ---------- */

  protected abstract drawResonators(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void;

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const v = this.variant;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.drawResonators(ctx, W, H, dpr);

    // Neck.
    const top = (NECK_Y - NECK_H / 2) * H;
    const height = NECK_H * H;
    const wood = ctx.createLinearGradient(0, top, 0, top + height);
    wood.addColorStop(0, v.neck[0]);
    wood.addColorStop(0.5, v.neck[1]);
    wood.addColorStop(1, v.neck[0]);
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(0.02 * W, top, (NUT + SPAN + 0.06 - 0.02) * W, height, 8 * dpr);
    ctx.fill();

    // Sympathetic strings run under the frets (sitar).
    if (v.sympathetic > 0) {
      for (let i = 0; i < v.sympathetic; i++) {
        const y = top + height * (0.62 + (i / v.sympathetic) * 0.33);
        const a = this.tarafAmp[i] ?? 0;
        ctx.strokeStyle = `rgba(230, 220, 255, ${0.18 + a * 0.6})`;
        ctx.lineWidth = (0.6 + a) * dpr;
        ctx.beginPath();
        ctx.moveTo((NUT + 0.1) * W, y + Math.sin(this.time * 70 + i) * a * 2 * dpr);
        ctx.lineTo((NUT + SPAN + 0.04) * W, y);
        ctx.stroke();
      }
    }

    // Frets, labelled in sargam (· above for the upper octave).
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    this.frets.forEach((semi, i) => {
      const x = this.fretX(semi) * W;
      const active = this.held?.fret === i && this.stringAmp > 0.05;
      if (v.kind === "sitar") {
        // Arched brass frets.
        ctx.strokeStyle = active ? "#ffe9a8" : v.fretColor;
        ctx.lineWidth = 2.6 * dpr;
        ctx.beginPath();
        ctx.ellipse(x, top + height * 0.5, 5 * dpr, height * 0.55, 0, Math.PI * 1.5, Math.PI * 0.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(15, 10, 8, 0.9)";
        ctx.fillRect(x - 4 * dpr, top + height * 0.05, 8 * dpr, height * 0.9);
        ctx.fillStyle = active ? "#ffe9a8" : v.fretColor;
        ctx.fillRect(x - 1.6 * dpr, top + height * 0.05, 3.2 * dpr, height * 0.9);
      }
      // Labels alternate above and below the neck so neighbours never collide.
      const name = sargam(semi % 12) + (semi >= 24 ? "··" : semi >= 12 ? "·" : "");
      ctx.fillStyle = active ? "#ffffff" : "rgba(246, 244, 255, 0.78)";
      ctx.font = `600 ${clamp(W * 0.026, 10 * dpr, 13 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(name, x, i % 2 === 0 ? top - 8 * dpr : top + height + 16 * dpr);
    });

    // Main strings, bending towards the finger while meend is applied.
    const bend = this.held?.bend ?? 0;
    for (let s = 0; s < v.mainStrings; s++) {
      const y = top + height * (0.18 + (s / Math.max(1, v.mainStrings - 1)) * 0.36);
      const isMelody = s === 0;
      const amp = isMelody ? this.stringAmp : this.stringAmp * 0.2;
      ctx.strokeStyle = isMelody ? `rgba(255, 250, 235, ${0.75 + amp * 0.25})` : "rgba(225, 220, 210, 0.5)";
      ctx.lineWidth = (isMelody ? 1.8 : 1.1) * dpr;
      ctx.beginPath();
      ctx.moveTo(NUT * W, y);
      if (isMelody && this.finger.visible > 0.1) {
        const fx = this.finger.x * W;
        const pull = bend * 10 * dpr * Math.sign(this.finger.y - NECK_Y || 1);
        ctx.lineTo(fx, y + pull + Math.sin(this.time * 80) * amp * 3 * dpr);
      } else {
        ctx.quadraticCurveTo(((NUT + NUT + SPAN) / 2) * W, y + Math.sin(this.time * 80 + s) * amp * 4 * dpr, (NUT + SPAN / 2) * W, y);
      }
      ctx.lineTo((NUT + SPAN + 0.05) * W, y);
      ctx.stroke();
    }

    // Finger marker.
    if (this.finger.visible > 0.05) {
      const fx = this.finger.x * W;
      const size = (26 + this.stringAmp * 30) * dpr;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = this.finger.visible * 0.8;
      ctx.drawImage(this.sprites.get(v.kind === "veena" ? 32 : 18, 70), fx - size / 2, NECK_Y * H - size / 2, size, size);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // Raga name.
    ctx.fillStyle = "rgba(246, 244, 255, 0.85)";
    ctx.font = `600 ${clamp(W * 0.032, 12 * dpr, 18 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(`Raga ${this.raga.name}`, W / 2, H * 0.22);
    ctx.restore();
  }
}

export class VeenaInstrument extends IndianStringInstrument {
  readonly id = "veena" as const;
  protected readonly variant: Variant = {
    kind: "veena",
    ragas: CARNATIC_RAGAS,
    baseSa: 50,
    neck: ["#4a2711", "#9a5b2a"],
    fretColor: "#d9b25a",
    mainStrings: 4,
    sympathetic: 0,
  };

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.buildFrets();
  }

  protected drawResonators(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    // Kudam: the large carved resonator at the bridge end.
    const cx = (NUT + SPAN + 0.13) * W;
    const cy = (NECK_Y + 0.04) * H;
    const r = Math.min(W * 0.24, H * 0.2);
    const wood = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    wood.addColorStop(0, "#c27a3a");
    wood.addColorStop(1, "#4a2510");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(240, 200, 120, 0.5)";
    ctx.lineWidth = 2 * dpr;
    for (const k of [0.8, 0.6]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Yali: the dragon-head scroll at the far end.
    const yx = 0.035 * W;
    const yy = (NECK_Y - 0.09) * H;
    ctx.strokeStyle = "#d9b25a";
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath();
    for (let t = 0; t < Math.PI * 3; t += 0.2) {
      const rr = 4 * dpr + t * 4 * dpr;
      const x = yx + Math.cos(t) * rr;
      const y = yy + Math.sin(t) * rr;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export class SitarInstrument extends IndianStringInstrument {
  readonly id = "sitar" as const;
  protected readonly variant: Variant = {
    kind: "sitar",
    ragas: HINDUSTANI_RAGAS,
    baseSa: 49,
    neck: ["#6b4220", "#c08a50"],
    fretColor: "#e3c27a",
    mainStrings: 7,
    sympathetic: 13,
  };

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.buildFrets();
  }

  protected drawResonators(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    // Tumba: the big gourd at the bridge end, and the small upper gourd.
    const cx = (NUT + SPAN + 0.12) * W;
    const cy = (NECK_Y + 0.06) * H;
    const rx = Math.min(W * 0.22, H * 0.18);
    const gourd = ctx.createRadialGradient(cx - rx * 0.3, cy - rx * 0.3, rx * 0.1, cx, cy, rx * 1.1);
    gourd.addColorStop(0, "#e2a35c");
    gourd.addColorStop(1, "#5a3010");
    ctx.fillStyle = gourd;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, rx * 1.15, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 230, 180, 0.45)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.75, rx * 0.86, -0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = gourd;
    ctx.beginPath();
    ctx.arc(0.06 * W, (NECK_Y - 0.1) * H, rx * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}
