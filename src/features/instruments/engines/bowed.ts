import { clamp, clamp01, damp } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters, VoiceKind } from "@/types/instruments";
import { MAJOR, MAJOR_PENTATONIC, MINOR, noteName, scaleNotes } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

interface Body {
  label: string;
  kind: VoiceKind;
  /** MIDI of the lowest open string; strings are a fifth apart. */
  lowest: number;
  hue: number;
}

const BODIES: Body[] = [
  { label: "Violin", kind: "violin", lowest: 55, hue: 24 },
  { label: "Viola", kind: "violin", lowest: 48, hue: 18 },
  { label: "Cello", kind: "cello", lowest: 36, hue: 12 },
];
const SCALES = [MAJOR, MINOR, MAJOR_PENTATONIC];
const LANES_TOP = 0.16;
const LANES_BOTTOM = 0.86;
const STRINGS_X = [0.43, 0.48, 0.53, 0.58];
const MAX_DUST = 240;

/**
 * Violin / Viola / Cello — bowed strings. Height chooses the note (like
 * fingers on the fingerboard); bowing — moving sideways — makes the sound,
 * and bow speed is loudness. Change direction and you hear the small dip of
 * a real bow change. With two hands, the left chooses notes while the right
 * bows.
 */
export class BowedInstrument extends CanvasInstrument {
  readonly id = "violin" as const;
  private lanes: number[] = [];
  private laneIndex = -1;
  private voiceId: string | null = null;
  private voiceCounter = 0;
  private bowSpeed = 0;
  private bowDirection = 0;
  private dip = 0;
  private bow: { x: number; y: number; visible: number } = { x: 0.5, y: 0.6, visible: 0 };
  private readonly dx = new Float32Array(MAX_DUST);
  private readonly dy = new Float32Array(MAX_DUST);
  private readonly dvy = new Float32Array(MAX_DUST);
  private readonly dlife = new Float32Array(MAX_DUST);
  private dustCursor = 0;
  private readonly sprites = new TintedSprites(createGlowSprite(32), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.buildLanes();
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    this.buildLanes();
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  private get body(): Body {
    return BODIES[clamp(Math.round(this.param("body", 0)), 0, BODIES.length - 1)] ?? BODIES[0]!;
  }

  private buildLanes(): void {
    const scale = SCALES[clamp(Math.round(this.param("scale", 0)), 0, SCALES.length - 1)] ?? MAJOR;
    const root = this.body.lowest + Math.round(this.param("key", 0));
    this.lanes = scaleNotes(root, scale, clamp(Math.round(this.param("range", 12)), 6, 18));
  }

  /** Higher on screen = higher note, like moving up the fingerboard. */
  private laneAt(y: number): number {
    const t = clamp01((LANES_BOTTOM - y) / (LANES_BOTTOM - LANES_TOP));
    return clamp(Math.floor(t * this.lanes.length), 0, this.lanes.length - 1);
  }

  private laneY(index: number): number {
    const h = (LANES_BOTTOM - LANES_TOP) / this.lanes.length;
    return LANES_BOTTOM - (index + 0.5) * h;
  }

  /** Which of the four strings a note sounds on (for the visuals). */
  private stringFor(midi: number): number {
    const lowest = this.body.lowest;
    return clamp(Math.floor((midi - lowest) / 7), 0, 3);
  }

  private holdsBow(point: ControlPoint): boolean {
    return !point.lifted && (point.source !== "hand" || point.engaged);
  }

  protected step(dt: number, input: ControlInput): void {
    // Two hands: the left one fingers notes, the right one bows. One point does both.
    const hands = input.points.filter((p) => !p.lifted);
    let fingering: ControlPoint | undefined;
    let bowing: ControlPoint | undefined;
    if (hands.length >= 2) {
      const sorted = [...hands].sort((a, b) => a.position.x - b.position.x);
      fingering = sorted[0];
      bowing = sorted[sorted.length - 1];
    } else {
      fingering = hands[0];
      bowing = hands[0];
    }

    const bowHeld = bowing ? this.holdsBow(bowing) : false;
    const rawSpeed = bowing && bowHeld ? Math.abs(bowing.velocity.x) : 0;
    this.bowSpeed = damp(this.bowSpeed, clamp01(rawSpeed * 1.1), 12, dt);
    if (bowing && bowHeld) {
      const direction = Math.sign(bowing.velocity.x);
      if (direction !== 0 && direction !== this.bowDirection && rawSpeed > 0.15) {
        if (this.bowDirection !== 0) this.dip = 0.35; // bow change
        this.bowDirection = direction;
      }
      this.bow = { x: bowing.position.x, y: bowing.position.y, visible: 1 };
    } else {
      this.bow.visible *= Math.exp(-4 * dt);
    }
    this.dip = damp(this.dip, 0, 9, dt);

    if (fingering) {
      const lane = this.laneAt(fingering.position.y);
      if (lane !== this.laneIndex) {
        this.laneIndex = lane;
        if (this.voiceId) this.voiceUpdate(this.voiceId, { midi: this.lanes[lane] ?? 60, glideMs: 40 + this.param("portamento", 0.2) * 220 });
      }
    }

    const midi = this.lanes[this.laneIndex] ?? this.lanes[0] ?? 60;
    if (bowHeld && !this.voiceId && this.bowSpeed > 0.06) {
      this.voiceId = `bow-${this.voiceCounter++}`;
      this.voiceOn(this.voiceId, this.body.kind, midi, clamp01(0.4 + this.bowSpeed * 0.5), 0.5);
    }
    if (this.voiceId) {
      if (!bowHeld) {
        this.voiceOff(this.voiceId);
        this.voiceId = null;
      } else {
        const expression = clamp01(this.bowSpeed * (1 - this.dip));
        this.voiceUpdate(this.voiceId, { expression, pan: 0.5 });
        // Rosin dust where the bow meets the string.
        if (expression > 0.2) {
          const W = this.canvas.width;
          const H = this.canvas.height;
          const sx = (STRINGS_X[this.stringFor(midi)] ?? 0.5) * W;
          for (let k = 0; k < Math.round(expression * 2 * this.budget) + 1; k++) {
            const i = this.dustCursor;
            this.dustCursor = (this.dustCursor + 1) % MAX_DUST;
            this.dx[i] = sx + (this.random() - 0.5) * 12 * this.pixelRatio;
            this.dy[i] = this.bow.y * H;
            this.dvy[i] = (20 + this.random() * 40) * this.pixelRatio;
            this.dlife[i] = 0.6 + this.random() * 0.6;
          }
        }
      }
    }

    for (const event of input.events) {
      if (event.type === "accent" && this.voiceId) {
        // Accent: a strong bow attack.
        this.dip = 0;
        this.bowSpeed = 1;
      }
    }
    this.targets = { level: 0.04, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const body = this.body;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Note lanes (left), like positions on the fingerboard.
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    this.lanes.forEach((note, i) => {
      const y = this.laneY(i) * H;
      const active = i === this.laneIndex && !!this.voiceId;
      if (active) {
        ctx.fillStyle = `hsla(${body.hue + 10}, 90%, 62%, ${0.07 + this.bowSpeed * 0.12})`;
        ctx.fillRect(0, y - ((LANES_BOTTOM - LANES_TOP) / this.lanes.length / 2) * H, W, ((LANES_BOTTOM - LANES_TOP) / this.lanes.length) * H);
      }
      ctx.fillStyle = active ? "#ffffff" : "rgba(246, 244, 255, 0.5)";
      ctx.font = `600 ${clamp(W * 0.026, 10 * dpr, 14 * dpr)}px system-ui, sans-serif`;
      ctx.fillText(noteName(note), 0.03 * W, y);
      ctx.fillStyle = "rgba(246, 244, 255, 0.06)";
      ctx.fillRect(0.1 * W, y, 0.8 * W, Math.max(1, dpr * 0.5));
    });

    // Fingerboard and four strings.
    const fbX0 = (STRINGS_X[0]! - 0.035) * W;
    const fbX1 = (STRINGS_X[3]! + 0.035) * W;
    ctx.fillStyle = "rgba(12, 10, 14, 0.85)";
    ctx.beginPath();
    ctx.roundRect(fbX0, 0.1 * H, fbX1 - fbX0, 0.8 * H, 10 * dpr);
    ctx.fill();
    const active = this.voiceId ? this.stringFor(this.lanes[this.laneIndex] ?? 60) : -1;
    STRINGS_X.forEach((sx, s) => {
      const x = sx * W;
      const vibrating = s === active ? this.bowSpeed : 0;
      ctx.strokeStyle = s === active ? `rgba(255, 245, 220, ${0.8 + vibrating * 0.2})` : "rgba(220, 215, 205, 0.55)";
      ctx.lineWidth = (2.2 - s * 0.35 + vibrating * 3) * dpr;
      ctx.beginPath();
      ctx.moveTo(x, 0.1 * H);
      ctx.lineTo(x, 0.9 * H);
      ctx.stroke();
    });

    // The bow: stick with a slight camber, hair beneath, frog at the right.
    if (this.bow.visible > 0.05) {
      const y = this.bow.y * H;
      const centre = this.bow.x * W;
      const half = Math.min(W * 0.42, 260 * dpr);
      ctx.globalAlpha = this.bow.visible;
      ctx.strokeStyle = "rgba(240, 235, 220, 0.95)";
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(centre - half, y);
      ctx.lineTo(centre + half, y);
      ctx.stroke();
      ctx.strokeStyle = "#8a4d24";
      ctx.lineWidth = 5.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(centre - half, y - 2 * dpr);
      ctx.quadraticCurveTo(centre, y - 14 * dpr, centre + half, y - 8 * dpr);
      ctx.stroke();
      ctx.fillStyle = "#1c1410";
      ctx.fillRect(centre + half - 18 * dpr, y - 12 * dpr, 22 * dpr, 14 * dpr);
      ctx.globalAlpha = 1;
    }

    // Rosin dust.
    ctx.globalCompositeOperation = "lighter";
    const dt = 1 / 60;
    const sprite = this.sprites.get(45, 85);
    for (let i = 0; i < MAX_DUST; i++) {
      const life = this.dlife[i] ?? 0;
      if (life <= 0) continue;
      this.dy[i] = (this.dy[i] ?? 0) + (this.dvy[i] ?? 0) * dt;
      this.dlife[i] = life - dt;
      const size = (3 + life * 5) * dpr;
      ctx.globalAlpha = clamp01(life) * 0.6;
      ctx.drawImage(sprite, (this.dx[i] ?? 0) - size / 2, (this.dy[i] ?? 0) - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    ctx.restore();
  }
}
