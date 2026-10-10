import { clamp, clamp01, damp, mapRange } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters, VoiceKind } from "@/types/instruments";
import { MAJOR, MAJOR_PENTATONIC, MINOR, noteName, scaleNotes } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

const SCALES = [MAJOR, MINOR, MAJOR_PENTATONIC];
const MAX_PARTICLES = 600;

interface Queued {
  at: number;
  midi: number | null;
}

/**
 * Shared mechanics for monophonic wind instruments. The view is divided into
 * vertical pitch lanes (one scale note each): press / pinch to blow, move
 * sideways to change note, raise the hand for more breath (louder, brighter).
 */
abstract class WindInstrument extends CanvasInstrument {
  protected abstract readonly voiceKind: VoiceKind;
  protected lanes: number[] = [];
  protected laneIndex = -1;
  protected blowing = false;
  protected expression = 0;
  protected point: { x: number; y: number } = { x: 0.5, y: 0.5 };
  private voiceId: string | null = null;
  private voiceCounter = 0;
  private queue: Queued[] = [];
  protected readonly px = new Float32Array(MAX_PARTICLES);
  protected readonly py = new Float32Array(MAX_PARTICLES);
  protected readonly pvx = new Float32Array(MAX_PARTICLES);
  protected readonly pvy = new Float32Array(MAX_PARTICLES);
  protected readonly plife = new Float32Array(MAX_PARTICLES);
  protected readonly phue = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  protected readonly sprites = new TintedSprites(createGlowSprite(40), 24);

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

  protected override onReset(): void {
    this.stopVoice();
    this.queue = [];
    this.plife.fill(0);
  }

  private buildLanes(): void {
    const scale = SCALES[clamp(Math.round(this.param("scale", 0)), 0, SCALES.length - 1)] ?? MAJOR;
    const root = 12 * (Math.round(this.param("octave", 5)) + 1) + Math.round(this.param("key", 0));
    this.lanes = scaleNotes(root, scale, clamp(Math.round(this.param("range", 10)), 5, 15));
  }

  protected laneAt(x: number): number {
    return clamp(Math.floor(clamp01(x) * this.lanes.length), 0, this.lanes.length - 1);
  }

  protected get currentMidi(): number {
    return this.lanes[this.laneIndex] ?? this.lanes[0] ?? 72;
  }

  /** Legato instruments glide between notes; others re-articulate each one. */
  protected abstract readonly legato: boolean;
  /** Ornament played on the accent gesture (trill, fanfare…). */
  protected abstract ornament(laneIndex: number): Array<{ offset: number; lane: number | null }>;
  protected abstract emitBreath(dt: number, point: ControlPoint): void;

  private startVoice(midi: number, velocity: number): void {
    this.voiceId = `${this.id}-${this.voiceCounter++}`;
    this.voiceOn(this.voiceId, this.voiceKind, midi, velocity, this.point.x);
    this.voiceUpdate(this.voiceId, { expression: this.expression });
  }

  private stopVoice(): void {
    if (this.voiceId) this.voiceOff(this.voiceId);
    this.voiceId = null;
  }

  protected step(dt: number, input: ControlInput): void {
    // Monophonic: the first blowing point plays.
    const player = input.points.find((p) => !p.lifted && (p.source !== "hand" || p.engaged));
    if (player) {
      this.point = { x: player.position.x, y: player.position.y };
      const target = mapRange(player.position.y, 0.95, 0.1, 0.15, 1);
      this.expression = damp(this.expression, target, 10, dt);
      const lane = this.laneAt(player.position.x);
      if (!this.blowing) {
        this.laneIndex = lane;
        this.startVoice(this.currentMidi, clamp01(0.5 + player.speed * 0.2));
        this.blowing = true;
        this.onArticulate();
      } else if (lane !== this.laneIndex) {
        this.laneIndex = lane;
        if (this.legato && this.voiceId) {
          this.voiceUpdate(this.voiceId, { midi: this.currentMidi, glideMs: this.param("glide", 0.4) * 220 });
        } else {
          this.stopVoice();
          this.startVoice(this.currentMidi, clamp01(0.55 + player.speed * 0.2));
          this.onArticulate();
        }
      }
      if (this.voiceId) this.voiceUpdate(this.voiceId, { expression: this.expression, pan: this.point.x });
      this.emitBreath(dt, player);
    } else if (this.blowing) {
      this.blowing = false;
      this.stopVoice();
    } else {
      this.expression = damp(this.expression, 0, 4, dt);
    }

    for (const event of input.events) {
      if (event.type !== "accent") continue;
      const lane = this.laneAt(event.position.x);
      for (const step of this.ornament(lane)) this.queue.push({ at: this.time + step.offset, midi: step.lane === null ? null : (this.lanes[clamp(step.lane, 0, this.lanes.length - 1)] ?? null) });
    }
    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      for (const q of due) {
        if (this.blowing && this.voiceId && q.midi !== null) {
          // While playing, ornaments bend the current note.
          this.voiceUpdate(this.voiceId, { midi: q.midi, glideMs: 15 });
        } else if (!this.blowing) {
          const id = `${this.id}-orn`;
          this.voiceOff(id, 0.08);
          if (q.midi !== null) {
            this.voiceOn(id, this.voiceKind, q.midi, 0.7, 0.5);
            this.voiceUpdate(id, { expression: 0.85 });
          }
        }
      }
      if (this.blowing && this.voiceId && this.queue.length === 0) this.voiceUpdate(this.voiceId, { midi: this.currentMidi, glideMs: 15 });
    }

    this.targets = { level: 0.06 + this.expression * 0.1, brightness: 0.3 + this.expression * 0.4, pitch: 0, pan: this.point.x, texture: this.blowing ? this.expression * 0.3 : 0 };
  }

  protected onArticulate(): void {}

  protected spawn(x: number, y: number, vx: number, vy: number, life: number, hue: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % Math.max(1, Math.floor(MAX_PARTICLES * this.budget));
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.plife[i] = life;
    this.phue[i] = hue;
  }

  protected drawLanes(hue: number): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const n = this.lanes.length;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const active = this.blowing && i === this.laneIndex;
      if (active) {
        ctx.fillStyle = `hsla(${hue}, 90%, 60%, ${0.08 + this.expression * 0.12})`;
        ctx.fillRect(x, 0, W / n, H);
      }
      ctx.fillStyle = "rgba(246, 244, 255, 0.1)";
      ctx.fillRect(x, 0, Math.max(1, dpr * 0.75), H);
      ctx.fillStyle = active ? "rgba(246, 244, 255, 0.95)" : "rgba(246, 244, 255, 0.45)";
      ctx.font = `600 ${clamp((W / n) * 0.28, 9 * dpr, 14 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(noteName(this.lanes[i] ?? 60).replace(/\d+$/, ""), x + W / n / 2, H * 0.14);
    }
    ctx.restore();
  }

  protected drawParticles(lightness: number): void {
    const { ctx } = this;
    const dt = 1 / 60;
    const dpr = this.pixelRatio;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const capacity = Math.floor(MAX_PARTICLES * this.budget);
    for (let i = 0; i < capacity; i++) {
      const life = this.plife[i] ?? 0;
      if (life <= 0) continue;
      this.px[i] = (this.px[i] ?? 0) + (this.pvx[i] ?? 0) * dt;
      this.py[i] = (this.py[i] ?? 0) + (this.pvy[i] ?? 0) * dt;
      this.pvx[i] = (this.pvx[i] ?? 0) * 0.97;
      this.pvy[i] = (this.pvy[i] ?? 0) * 0.97;
      this.plife[i] = life - dt;
      const size = (4 + life * 10) * dpr;
      ctx.globalAlpha = clamp01(life) * 0.7;
      ctx.drawImage(this.sprites.get(this.phue[i] ?? 0, lightness), (this.px[i] ?? 0) - size / 2, (this.py[i] ?? 0) - size / 2, size, size);
    }
    ctx.restore();
  }
}

/**
 * Flute — breathy, legato and airy. Notes glide into each other; a light
 * wave whose spacing follows the pitch flows up from the hand. Open palm
 * plays a trill.
 */
export class FluteInstrument extends WindInstrument {
  readonly id = "flute" as const;
  protected readonly voiceKind = "flute" as const;
  protected readonly legato = true;

  protected ornament(lane: number) {
    return Array.from({ length: 10 }, (_, i) => ({ offset: i * 0.06, lane: i % 2 === 0 ? lane + 1 : lane }));
  }

  protected emitBreath(_dt: number, point: ControlPoint): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const count = Math.round((1 + this.expression * 3) * this.budget) + 1;
    for (let i = 0; i < count; i++) {
      this.spawn(point.position.x * W, point.position.y * H, (this.random() - 0.5) * 40 * this.pixelRatio, -(60 + this.random() * 120) * this.pixelRatio * (0.5 + this.expression), 0.8 + this.random() * 0.8, this.param("hue", 175) + (this.random() - 0.5) * 30);
    }
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const hue = this.param("hue", 175);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.restore();
    this.drawLanes(hue);
    if (this.expression > 0.02) {
      // Sound wave: wavelength shrinks as pitch rises; amplitude follows breath.
      const x0 = this.point.x * W;
      const y0 = this.point.y * H;
      const wavelength = (H * 0.18 * 2 ** ((60 - this.currentMidi) / 24)) / 1;
      const amp = this.expression * 22 * dpr;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const [width, alpha, light] of [
        [8, 0.15, 60],
        [2, 0.85, 82],
      ] as const) {
        ctx.beginPath();
        for (let y = y0; y > 0; y -= 4 * dpr) {
          const t = (y0 - y) / wavelength;
          const fade = 1 - (y0 - y) / y0;
          const x = x0 + Math.sin(t * Math.PI * 2 - this.time * 8) * amp * fade;
          if (y === y0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hue}, 90%, ${light}%, ${alpha * this.expression})`;
        ctx.lineWidth = width * dpr;
        ctx.stroke();
      }
      ctx.restore();
    }
    this.drawParticles(72);
  }
}

/**
 * Trumpet — bright and punchy. Every note change is tongued with a brassy
 * attack; golden rings flare from the bell (your hand) at a rate that follows
 * the pitch. Open palm plays a fanfare.
 */
export class TrumpetInstrument extends WindInstrument {
  readonly id = "trumpet" as const;
  protected readonly voiceKind = "trumpet" as const;
  protected readonly legato = false;
  private rings: Array<{ x: number; y: number; born: number; strength: number }> = [];
  private ringClock = 0;

  protected ornament(lane: number) {
    // Fanfare: root, third, fifth, octave — da-da-da-daaa.
    const steps = [0, 2, 4, 7, 4, 7];
    const times = [0, 0.12, 0.24, 0.36, 0.62, 0.74];
    return [...steps.map((s, i) => ({ offset: times[i] ?? 0, lane: lane + s })), { offset: 1.3, lane: null }];
  }

  protected override onArticulate(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let i = 0; i < 14 * this.budget + 4; i++) {
      const a = this.random() * Math.PI * 2;
      const s = (80 + this.random() * 160) * this.pixelRatio;
      this.spawn(this.point.x * W, this.point.y * H, Math.cos(a) * s, Math.sin(a) * s, 0.4 + this.random() * 0.4, this.param("hue", 42));
    }
  }

  protected emitBreath(dt: number, point: ControlPoint): void {
    // One ring per (scaled) wave period: higher notes flare faster.
    this.ringClock += dt * (2 + (this.currentMidi - 55) / 8) * (0.5 + this.expression);
    if (this.ringClock >= 1) {
      this.ringClock = 0;
      this.rings.push({ x: point.position.x, y: point.position.y, born: this.time, strength: this.expression });
      if (this.rings.length > 24) this.rings.shift();
    }
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const hue = this.param("hue", 42);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.restore();
    this.drawLanes(hue);
    this.rings = this.rings.filter((r) => this.time - r.born < 1.4);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ring of this.rings) {
      const age = this.time - ring.born;
      // Bell flare: arcs open upward and widen as they travel.
      const radius = (20 + age * 260) * dpr;
      const alpha = (1 - age / 1.4) * (0.25 + ring.strength * 0.6);
      ctx.beginPath();
      ctx.arc(ring.x * W, ring.y * H, radius, Math.PI * 1.15, Math.PI * 1.85);
      ctx.strokeStyle = `hsla(${hue}, 95%, ${65 + ring.strength * 15}%, ${alpha})`;
      ctx.lineWidth = (2 + ring.strength * 4) * dpr;
      ctx.stroke();
    }
    if (this.blowing) {
      const glow = (40 + this.expression * 60) * dpr;
      ctx.globalAlpha = 0.5 + this.expression * 0.4;
      ctx.drawImage(this.sprites.get(hue, 70), this.point.x * W - glow / 2, this.point.y * H - glow / 2, glow, glow);
    }
    ctx.restore();
    this.drawParticles(68);
  }
}
