import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters, PluckedKind } from "@/types/instruments";
import { GUITAR_TUNING, keyChords, noteName, UKULELE_TUNING, voiceChord, type Chord } from "../music";
import { CanvasInstrument } from "./canvasInstrument";

interface Style {
  kind: PluckedKind;
  tuning: readonly number[];
  muteBass: boolean;
  /** Plain (unwound) strings start at this index. */
  plainFrom: number;
  woundColor: string;
  plainColor: string;
  body: string;
}

const STYLES: Style[] = [
  { kind: "guitar", tuning: GUITAR_TUNING, muteBass: true, plainFrom: 4, woundColor: "#d9a35b", plainColor: "#e8ecf5", body: "#8a5a2b" },
  { kind: "nylon", tuning: GUITAR_TUNING, muteBass: true, plainFrom: 3, woundColor: "#c9c3b8", plainColor: "#f4f0e6", body: "#a8743f" },
  { kind: "electric", tuning: GUITAR_TUNING, muteBass: true, plainFrom: 4, woundColor: "#c8ccd6", plainColor: "#eef1f8", body: "#3a1f5c" },
  { kind: "ukulele", tuning: UKULELE_TUNING, muteBass: false, plainFrom: 0, woundColor: "#f4f0e6", plainColor: "#f4f0e6", body: "#b88a4a" },
];

const CHORD_X0 = 0.02;
const CHORD_X1 = 0.25;
const STRUM_X0 = 0.29;
const BRIDGE_X = 0.92;
const STRINGS_Y0 = 0.36;
const STRINGS_Y1 = 0.66;

/**
 * Guitar — pick a chord on the left, strum across the strings on the right.
 * Strings are physically modelled (Karplus–Strong); muted strings give a
 * percussive chuck, fast strums naturally stagger across the strings, and an
 * open palm chokes everything (palm mute).
 */
export class GuitarInstrument extends CanvasInstrument {
  readonly id = "guitar" as const;
  private chords: Chord[] = [];
  private voicings: number[][] = [];
  private chordIndex = 0;
  private hover = new Map<string, { index: number; since: number }>();
  private lastY = new Map<string, number>();
  private queue: Array<{ at: number; string: number; velocity: number }> = [];
  private amp = new Float32Array(6);
  private pick: { x: number; y: number; tilt: number; visible: number } = { x: 0.6, y: 0.5, tilt: 0, visible: 0 };

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.buildChords();
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.buildChords();
  }

  private get style(): Style {
    return STYLES[clamp(Math.round(this.param("style", 0)), 0, STYLES.length - 1)] ?? STYLES[0]!;
  }

  private buildChords(): void {
    const style = this.style;
    this.chords = keyChords(Math.round(this.param("key", 7)));
    this.voicings = this.chords.map((chord) => voiceChord(style.tuning, chord, style.muteBass));
    this.amp = new Float32Array(style.tuning.length);
  }

  private stringY(index: number): number {
    const n = this.style.tuning.length;
    return STRINGS_Y0 + (index / Math.max(1, n - 1)) * (STRINGS_Y1 - STRINGS_Y0);
  }

  private padRect(index: number): { y0: number; y1: number } {
    const n = this.chords.length;
    const top = 0.17;
    const bottom = 0.86;
    const h = (bottom - top) / n;
    return { y0: top + index * h, y1: top + (index + 1) * h - 0.008 };
  }

  private padAt(x: number, y: number): number {
    if (x < CHORD_X0 || x > CHORD_X1) return -1;
    for (let i = 0; i < this.chords.length; i++) {
      const r = this.padRect(i);
      if (y >= r.y0 && y <= r.y1) return i;
    }
    return -1;
  }

  private pluck(string: number, velocity: number): void {
    const style = this.style;
    const fret = this.voicings[this.chordIndex]?.[string] ?? -1;
    const open = style.tuning[string] ?? 52;
    const id = `gtr-${string}`;
    if (fret < 0) {
      // Muted string: a short percussive chuck.
      this.voiceOn(id, style.kind, open, velocity * 0.6, 0.5);
      this.voiceOff(id, 0.035);
      this.amp[string] = Math.max(this.amp[string] ?? 0, 0.2);
      return;
    }
    this.voiceOn(id, style.kind, open + fret, velocity, 0.35 + (string / style.tuning.length) * 0.3);
    this.amp[string] = Math.max(this.amp[string] ?? 0, velocity);
  }

  private selectChord(index: number): void {
    if (index === this.chordIndex || index < 0) return;
    this.chordIndex = index;
  }

  /** Hands hold the pick while pinching; touch always strums. */
  private strumming(point: ControlPoint): boolean {
    return !point.lifted && (point.source !== "hand" || point.engaged);
  }

  protected step(dt: number, input: ControlInput): void {
    const n = this.style.tuning.length;
    for (let i = 0; i < n; i++) this.amp[i] = (this.amp[i] ?? 0) * Math.exp(-2.2 * dt);
    this.pick.visible *= Math.exp(-3 * dt);

    const seen = new Set<string>();
    for (const point of input.points) {
      const { x, y } = point.position;
      seen.add(point.id);
      const pad = this.padAt(x, y);
      if (pad >= 0) {
        // Chord hand: touch selects instantly; a hand selects by pinching or resting briefly.
        const h = this.hover.get(point.id);
        if (point.source !== "hand" || point.engaged) this.selectChord(pad);
        else if (h && h.index === pad && this.time - h.since > 0.25) this.selectChord(pad);
        else if (!h || h.index !== pad) this.hover.set(point.id, { index: pad, since: this.time });
        this.lastY.delete(point.id);
        continue;
      }
      this.hover.delete(point.id);
      if (x < STRUM_X0 || !this.strumming(point)) {
        this.lastY.delete(point.id);
        continue;
      }
      this.pick = { x, y, tilt: clamp(point.velocity.y * 0.4, -0.6, 0.6), visible: 1 };
      const previous = this.lastY.get(point.id);
      if (previous !== undefined) {
        // Strings crossed this frame, in the order the pick met them.
        const crossed: number[] = [];
        for (let i = 0; i < n; i++) {
          const sy = this.stringY(i);
          if ((previous - sy) * (y - sy) < 0) crossed.push(i);
        }
        if (y < previous) crossed.reverse();
        const velocity = clamp01(0.35 + point.speed * 0.28);
        crossed.forEach((string, k) => this.queue.push({ at: this.time + k * 0.011, string, velocity }));
      }
      this.lastY.set(point.id, y);
    }
    for (const id of [...this.lastY.keys()]) if (!seen.has(id)) this.lastY.delete(id);
    for (const id of [...this.hover.keys()]) if (!seen.has(id)) this.hover.delete(id);

    for (const event of input.events) {
      if (event.type === "accent") {
        // Palm mute: choke every string.
        for (let i = 0; i < n; i++) this.voiceOff(`gtr-${i}`, 0.06);
        this.amp.fill(0);
        continue;
      }
      if (event.position.x < STRUM_X0) continue;
      // Tap or pinch on a single string: pick just that string.
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(this.stringY(i) - event.position.y);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      if (best < 0.05) this.pluck(nearest, 0.6);
    }

    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      for (const q of due) this.pluck(q.string, q.velocity);
    }
    this.targets = { level: 0.03, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const style = this.style;
    const n = style.tuning.length;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Body: a soft wood glow behind the strings, sound hole and bridge.
    const midY = ((STRINGS_Y0 + STRINGS_Y1) / 2) * H;
    const bodyGrad = ctx.createRadialGradient(W * 0.62, midY, 0, W * 0.62, midY, W * 0.5);
    bodyGrad.addColorStop(0, `${style.body}cc`);
    bodyGrad.addColorStop(1, `${style.body}00`);
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(STRUM_X0 * W, 0.18 * H, (1 - STRUM_X0) * W, 0.66 * H);
    if (style.kind !== "electric") {
      const holeR = Math.min(W * 0.14, H * 0.13);
      ctx.fillStyle = "rgba(8, 6, 12, 0.88)";
      ctx.beginPath();
      ctx.arc(W * 0.6, midY, holeR, 0, Math.PI * 2);
      ctx.fill();
      for (const [k, color] of [
        [1.08, "rgba(240, 220, 180, 0.55)"],
        [1.16, "rgba(120, 70, 30, 0.6)"],
        [1.22, "rgba(240, 220, 180, 0.4)"],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.arc(W * 0.6, midY, holeR * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Electric: two pickups instead of a sound hole.
      for (const px of [0.55, 0.7]) {
        ctx.fillStyle = "rgba(15, 15, 22, 0.9)";
        ctx.fillRect(W * px - 9 * dpr, (STRINGS_Y0 - 0.03) * H, 18 * dpr, (STRINGS_Y1 - STRINGS_Y0 + 0.06) * H);
      }
    }
    // Bridge.
    ctx.fillStyle = "rgba(25, 15, 8, 0.9)";
    ctx.fillRect(BRIDGE_X * W - 7 * dpr, (STRINGS_Y0 - 0.04) * H, 14 * dpr, (STRINGS_Y1 - STRINGS_Y0 + 0.08) * H);
    ctx.fillStyle = "rgba(245, 240, 225, 0.9)";
    ctx.fillRect(BRIDGE_X * W - 1.5 * dpr, (STRINGS_Y0 - 0.03) * H, 3 * dpr, (STRINGS_Y1 - STRINGS_Y0 + 0.06) * H);
    // Neck end: frets near the chord column.
    ctx.fillStyle = "rgba(30, 18, 12, 0.85)";
    ctx.fillRect(STRUM_X0 * W, (STRINGS_Y0 - 0.04) * H, 0.07 * W, (STRINGS_Y1 - STRINGS_Y0 + 0.08) * H);
    ctx.fillStyle = "rgba(220, 225, 235, 0.7)";
    for (const fx of [0.31, 0.335, 0.357]) ctx.fillRect(fx * W, (STRINGS_Y0 - 0.04) * H, 2 * dpr, (STRINGS_Y1 - STRINGS_Y0 + 0.08) * H);

    // Strings with standing-wave vibration.
    for (let i = 0; i < n; i++) {
      const y = this.stringY(i) * H;
      const amp = this.amp[i] ?? 0;
      const thickness = (style.kind === "ukulele" ? 1.6 : 2.8 - (i / n) * 1.8) * dpr;
      const wound = i < style.plainFrom;
      const swing = amp * 9 * dpr * Math.sin(this.time * (90 - i * 8));
      ctx.strokeStyle = wound ? style.woundColor : style.plainColor;
      ctx.lineWidth = thickness + amp * 2 * dpr;
      ctx.globalAlpha = 0.85 + amp * 0.15;
      ctx.beginPath();
      ctx.moveTo(STRUM_X0 * W, y);
      ctx.quadraticCurveTo(((STRUM_X0 + BRIDGE_X) / 2) * W, y + swing * 2, BRIDGE_X * W, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // String note at the nut end.
      ctx.fillStyle = "rgba(246, 244, 255, 0.55)";
      ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(noteName(style.tuning[i] ?? 40).replace(/\d+$/, ""), (STRUM_X0 - 0.006) * W, y);
    }

    // Chord pads with the voicing written the way guitarists read it (e.g. x32010).
    for (let i = 0; i < this.chords.length; i++) {
      const r = this.padRect(i);
      const active = i === this.chordIndex;
      const x = CHORD_X0 * W;
      const w = (CHORD_X1 - CHORD_X0) * W;
      ctx.fillStyle = active ? "rgba(155, 124, 255, 0.85)" : "rgba(17, 19, 38, 0.72)";
      ctx.strokeStyle = active ? "rgba(255, 255, 255, 0.9)" : "rgba(166, 168, 193, 0.3)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.roundRect(x, r.y0 * H, w, (r.y1 - r.y0) * H, 10 * dpr);
      ctx.fill();
      ctx.stroke();
      const cy = ((r.y0 + r.y1) / 2) * H;
      ctx.fillStyle = active ? "#0b0820" : "rgba(246, 244, 255, 0.95)";
      ctx.font = `700 ${clamp(w * 0.2, 12 * dpr, 20 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(this.chords[i]?.name ?? "", x + w / 2, cy + 2 * dpr);
      ctx.font = `600 ${clamp(w * 0.11, 8 * dpr, 12 * dpr)}px ui-monospace, monospace`;
      ctx.fillStyle = active ? "rgba(11, 8, 32, 0.75)" : "rgba(180, 182, 204, 0.85)";
      ctx.fillText((this.voicings[i] ?? []).map((f) => (f < 0 ? "x" : String(f))).join(""), x + w / 2, cy + 15 * dpr);
    }

    // The pick, following the strumming hand.
    if (this.pick.visible > 0.05) {
      const px = this.pick.x * W;
      const py = this.pick.y * H;
      const s = 16 * dpr;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(this.pick.tilt);
      ctx.globalAlpha = this.pick.visible;
      const pickGrad = ctx.createLinearGradient(-s, -s, s, s);
      pickGrad.addColorStop(0, "#ffd36b");
      pickGrad.addColorStop(1, "#c4552f");
      ctx.fillStyle = pickGrad;
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(s * 1.1, s * 0.2, s * 0.9, -s, 0, -s);
      ctx.bezierCurveTo(-s * 0.9, -s, -s * 1.1, s * 0.2, 0, s);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
