import { clamp, clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, InstrumentParameters } from "@/types/instruments";
import { chordLabel, PROGRESSIONS, triad, type Progression } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

type SectionId = "strings" | "winds" | "brass" | "percussion";

interface Section {
  id: SectionId;
  label: string;
  hue: number;
  /** Angular span on the stage semicircle (radians, 0 = right, π = left). */
  from: number;
  to: number;
  rows: number;
  activity: number;
}

const BEATS_PER_BAR = 4;
const MIN_BEAT_GAP = 0.22;
const IDLE_RELEASE_S = 4;
const TRAIL = 28;

/**
 * Orchestra — you are the conductor. Each beat you give (a downward stroke,
 * a tap or a pinch) moves the ensemble on: strings sustain the chord, brass
 * swells on the downbeat, a woodwind line walks the chord tones and timpani
 * mark the bar. Height sets the dynamics, pointing at a section brings it
 * forward, and an open palm cuts everyone off.
 */
export class OrchestraInstrument extends CanvasInstrument {
  readonly id = "orchestra" as const;
  private sections: Section[] = [
    { id: "strings", label: "Strings", hue: 330, from: Math.PI * 0.62, to: Math.PI * 0.98, rows: 4, activity: 0 },
    { id: "winds", label: "Woodwinds", hue: 160, from: Math.PI * 0.38, to: Math.PI * 0.62, rows: 3, activity: 0 },
    { id: "brass", label: "Brass", hue: 42, from: Math.PI * 0.02, to: Math.PI * 0.38, rows: 3, activity: 0 },
    { id: "percussion", label: "Timpani", hue: 210, from: Math.PI * 0.4, to: Math.PI * 0.6, rows: 1, activity: 0 },
  ];
  private beat = -1;
  private bar = -1;
  private lastBeatAt = -10;
  private beatIntervals: number[] = [];
  private tempo = 0;
  private dynamics = 0.6;
  private focus = 0.5;
  private breadth = 0.6;
  private stringVoices: string[] = [];
  private brassVoices: string[] = [];
  private windVoice: string | null = null;
  private voiceCounter = 0;
  private downTravel = 0;
  private lastY: number | null = null;
  private trail: Array<{ x: number; y: number }> = [];
  private pulses: Array<{ x: number; y: number; born: number; strong: boolean }> = [];
  private cutAt = -10;
  private readonly sprites = new TintedSprites(createGlowSprite(32), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected override onReset(): void {
    this.cutOff(false);
    this.beat = -1;
    this.bar = -1;
    this.beatIntervals = [];
    this.trail = [];
    this.pulses = [];
  }

  private get progression(): Progression {
    return PROGRESSIONS[clamp(Math.round(this.param("mood", 0)), 0, PROGRESSIONS.length - 1)] ?? PROGRESSIONS[0]!;
  }

  private get keyRoot(): number {
    return 48 + this.progression.key + Math.round(this.param("transpose", 0));
  }

  private currentChord(): number[] {
    const p = this.progression;
    const degree = p.degrees[Math.max(0, this.bar) % p.degrees.length] ?? 0;
    return triad(this.keyRoot, p.scale, degree);
  }

  /** Section weight from where the conductor is pointing (left = strings, centre = winds, right = brass). */
  private weight(section: SectionId): number {
    const f = this.focus;
    const centre = section === "strings" ? 0.15 : section === "winds" ? 0.5 : section === "brass" ? 0.85 : 0.5;
    const near = 1 - clamp01(Math.abs(f - centre) / 0.45);
    return 0.45 + 0.55 * near;
  }

  private sectionPan(section: SectionId): number {
    const base = section === "strings" ? 0.2 : section === "brass" ? 0.8 : 0.5;
    return 0.5 + (base - 0.5) * this.breadth * 1.6;
  }

  private release(ids: string[], seconds?: number): void {
    for (const id of ids) this.voiceOff(id, seconds);
  }

  private onBeat(x: number, y: number): void {
    if (this.time - this.lastBeatAt < MIN_BEAT_GAP) return;
    const interval = this.time - this.lastBeatAt;
    if (interval < 2) {
      this.beatIntervals.push(interval);
      if (this.beatIntervals.length > 6) this.beatIntervals.shift();
      const avg = this.beatIntervals.reduce((a, b) => a + b, 0) / this.beatIntervals.length;
      this.tempo = Math.round(60 / avg);
    }
    this.lastBeatAt = this.time;
    this.beat = (this.beat + 1) % BEATS_PER_BAR;
    const downbeat = this.beat === 0;
    if (downbeat) this.bar += 1;
    this.pulses.push({ x, y, born: this.time, strong: downbeat });
    if (this.pulses.length > 8) this.pulses.shift();

    const chord = this.currentChord();
    const [root = this.keyRoot, third = root + 4, fifth = root + 7, octave = root + 12] = chord;
    const dyn = this.dynamics;

    if (downbeat || this.stringVoices.length === 0) {
      // Strings: re-voice the chord in the middle register.
      this.release(this.stringVoices, 0.5);
      this.stringVoices = [root + 12, third + 12, fifth + 12, octave + 12, root].map((midi, i) => {
        const id = `str-${this.voiceCounter++}`;
        this.voiceOn(id, "strings", midi, 0.5 + dyn * 0.4, clamp01(this.sectionPan("strings") + (i - 2) * 0.05));
        return id;
      });
      this.sections[0]!.activity = 1;
    }
    if (downbeat) {
      this.release(this.brassVoices, 0.6);
      this.brassVoices = [root, fifth].map((midi) => {
        const id = `brs-${this.voiceCounter++}`;
        this.voiceOn(id, "brass", midi, 0.45 + dyn * 0.5, this.sectionPan("brass"));
        return id;
      });
      this.emit({ kind: "timpani", degree: root - this.keyRoot, velocity: 0.45 + dyn * 0.5, pan: 0.5 });
      this.sections[2]!.activity = 1;
      this.sections[3]!.activity = 1;
    } else if (this.beat === 2) {
      this.release(this.brassVoices, 0.8);
      this.brassVoices = [];
      this.emit({ kind: "timpani", degree: fifth - this.keyRoot - 12, velocity: 0.25 + dyn * 0.35, pan: 0.5 });
      this.sections[3]!.activity = 0.6;
    }

    // Woodwind line: walks the chord tones, one per beat, an octave up.
    if (this.windVoice) this.voiceOff(this.windVoice, 0.12);
    const pattern = [octave, fifth, third, fifth];
    const midi = (pattern[this.beat] ?? octave) + 12;
    this.windVoice = `wnd-${this.voiceCounter++}`;
    this.voiceOn(this.windVoice, "woodwind", midi, 0.45 + dyn * 0.4, this.sectionPan("winds"));
    this.sections[1]!.activity = 1;
    this.applyExpression();
  }

  private applyExpression(): void {
    const dyn = this.dynamics;
    for (const id of this.stringVoices) this.voiceUpdate(id, { expression: dyn * this.weight("strings") });
    for (const id of this.brassVoices) this.voiceUpdate(id, { expression: dyn * this.weight("brass") });
    if (this.windVoice) this.voiceUpdate(this.windVoice, { expression: dyn * this.weight("winds") });
  }

  private cutOff(withFlourish: boolean): void {
    this.release(this.stringVoices, withFlourish ? 0.25 : 0.1);
    this.release(this.brassVoices, withFlourish ? 0.25 : 0.1);
    if (this.windVoice) this.voiceOff(this.windVoice, 0.1);
    this.stringVoices = [];
    this.brassVoices = [];
    this.windVoice = null;
    this.beat = -1;
    if (withFlourish) {
      this.cutAt = this.time;
      this.emit({ kind: "crash", degree: 0, velocity: 0.5, pan: 0.5 });
    }
  }

  protected step(dt: number, input: ControlInput): void {
    const baton = input.points.find((p) => !p.lifted) ?? input.points[0];
    if (baton) {
      const { x, y } = baton.position;
      this.trail.push({ x, y });
      if (this.trail.length > TRAIL) this.trail.shift();
      this.dynamics = damp(this.dynamics, mapRange(y, 0.9, 0.15, 0.2, 1), 4, dt);
      this.focus = damp(this.focus, x, 5, dt);
      // Beat detection: the baton travels down, then turns back up.
      if (this.lastY !== null) {
        const dy = y - this.lastY;
        if (dy > 0) this.downTravel += dy;
        else if (dy < -0.004 && this.downTravel > 0.05 * this.param("sensitivity", 1)) {
          this.onBeat(x, y);
          this.downTravel = 0;
        } else if (dy < 0) this.downTravel = Math.max(0, this.downTravel + dy * 0.5);
      }
      this.lastY = y;
    } else {
      this.lastY = null;
      this.downTravel = 0;
      if (this.trail.length > 0) this.trail.shift();
    }
    if (input.spread !== null) this.breadth = damp(this.breadth, mapRange(input.spread, 0.1, 0.8, 0.2, 1), 3, dt);

    for (const event of input.events) {
      if (event.type === "accent") this.cutOff(true);
      else this.onBeat(event.position.x, event.position.y);
    }

    // The orchestra waits: if the conductor stops beating, let the music settle.
    if (this.time - this.lastBeatAt > IDLE_RELEASE_S && (this.stringVoices.length > 0 || this.windVoice)) this.cutOff(false);
    this.applyExpression();
    for (const s of this.sections) s.activity = damp(s.activity, 0, 1.6, dt);

    this.targets = { level: 0.05 + this.dynamics * 0.08, brightness: 0.3 + this.dynamics * 0.4, pitch: 0, pan: 0.5, texture: 0.05 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const cx = W * 0.5;
    const cy = H * 0.84;
    const maxR = Math.min(W * 0.48, H * 0.62);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    // Seats arranged in arcs, lit by each section's activity and focus.
    for (const section of this.sections) {
      const isPercussion = section.id === "percussion";
      const glow = section.activity * (0.4 + 0.6 * this.weight(section.id)) * (0.5 + this.dynamics * 0.5);
      const sprite = this.sprites.get(section.hue, 65);
      for (let row = 0; row < section.rows; row++) {
        const r = isPercussion ? maxR * 1.02 : maxR * (0.42 + (row / Math.max(1, section.rows)) * 0.5);
        const seats = Math.max(3, Math.round(((section.to - section.from) * r) / (26 * dpr)));
        for (let s = 0; s < seats; s++) {
          const angle = section.from + ((s + 0.5) / seats) * (section.to - section.from);
          const x = cx + Math.cos(angle) * r;
          const y = cy - Math.sin(angle) * r * 0.78;
          const breathe = 0.5 + 0.5 * Math.sin(this.time * 2 + s + row);
          const size = (isPercussion ? 26 : 12 + glow * 22) * dpr;
          ctx.globalAlpha = clamp01(0.18 + glow * 0.8 + breathe * 0.05);
          ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        }
      }
    }

    // Beat pulses from the baton.
    this.pulses = this.pulses.filter((p) => this.time - p.born < 0.9);
    for (const pulse of this.pulses) {
      const age = this.time - pulse.born;
      ctx.globalAlpha = (1 - age / 0.9) * (pulse.strong ? 0.9 : 0.5);
      ctx.strokeStyle = pulse.strong ? "#ffffff" : `hsla(${this.param("hue", 45)}, 90%, 70%, 1)`;
      ctx.lineWidth = (pulse.strong ? 3 : 2) * dpr;
      ctx.beginPath();
      ctx.arc(pulse.x * W, pulse.y * H, (12 + age * 140) * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Baton trail.
    if (this.trail.length > 1) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1]!;
        const b = this.trail[i]!;
        const t = i / this.trail.length;
        ctx.globalAlpha = t * 0.9;
        ctx.strokeStyle = `hsla(${this.param("hue", 45)}, 95%, ${60 + t * 30}%, 1)`;
        ctx.lineWidth = (1 + t * 4) * dpr;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
    }

    // Score readout: chord, beat dots and tempo.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const p = this.progression;
    const degree = p.degrees[Math.max(0, this.bar) % p.degrees.length] ?? 0;
    const font = clamp(W * 0.035, 12 * dpr, 20 * dpr);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(246, 244, 255, 0.9)";
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    const cut = this.time - this.cutAt < 1.2;
    const status = cut ? "Fermata" : this.beat < 0 ? "Raise your hand and give a downbeat" : `${p.name} · ${chordLabel(p, degree)}${this.tempo ? ` · ${this.tempo} bpm` : ""}`;
    ctx.fillText(status, cx, H * 0.2);
    for (let i = 0; i < BEATS_PER_BAR; i++) {
      ctx.beginPath();
      ctx.fillStyle = i === this.beat ? "#ffffff" : "rgba(246, 244, 255, 0.25)";
      ctx.arc(cx + (i - 1.5) * 18 * dpr, H * 0.2 + font * 0.9, (i === 0 ? 5 : 4) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
