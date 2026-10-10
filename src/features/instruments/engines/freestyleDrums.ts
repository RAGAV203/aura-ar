import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, DrumKind, InstrumentParameters } from "@/types/instruments";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";
import { drawStick, haptic, StickRig } from "./sticks";
import { StrikeDetector } from "./strikes";

interface Voice {
  kind: DrumKind;
  degree: number;
  hue: number;
  label: string;
}

interface LoopHit {
  /** Position in the loop, in beats. */
  beat: number;
  voice: Voice;
  velocity: number;
  x: number;
  y: number;
}

const BEATS = 8; // two bars of 4/4
const MAX_LOOP_HITS = 160;
const MAX_SPLASH = 900;

const V = {
  crash: { kind: "crash", degree: 0, hue: 48, label: "Crash" },
  ride: { kind: "ride", degree: 0, hue: 36, label: "Ride" },
  hat: { kind: "hat", degree: 0, hue: 60, label: "Hi-hat" },
  hatOpen: { kind: "hat-open", degree: 0, hue: 70, label: "Open hat" },
  tomHigh: { kind: "tom", degree: 0, hue: 285, label: "High tom" },
  snare: { kind: "snare", degree: 0, hue: 195, label: "Snare" },
  tomFloor: { kind: "tom", degree: 2, hue: 245, label: "Floor tom" },
  kick: { kind: "kick", degree: 0, hue: 330, label: "Kick" },
} satisfies Record<string, Voice>;

/** Where you hit decides the drum: cymbals high, hats, then toms/snare, kick low. */
export function voiceAt(x: number, y: number): Voice {
  if (y < 0.3) return x < 0.5 ? V.crash : V.ride;
  if (y < 0.48) return x < 0.5 ? V.hat : V.hatOpen;
  if (y < 0.7) return x < 0.3 ? V.tomHigh : x > 0.7 ? V.tomFloor : V.snare;
  return V.kick;
}

/** Snaps a loop position to the nearest subdivision (4 = sixteenths) by `amount` 0..1. */
export function quantizeBeat(beat: number, amount: number, perBeat = 4): number {
  const snapped = Math.round(beat * perBeat) / perBeat;
  return (beat + (snapped - beat) * clamp01(amount) + BEATS) % BEATS;
}

/**
 * Freestyle Drums — air drumming without pads. Strike anywhere: the height
 * and side of each hit choose the drum, and every hit splashes light where it
 * landed. With the looper on, hits are recorded into a two-bar loop at your
 * tempo and played back while you layer more on top.
 */
export class FreestyleDrumsInstrument extends CanvasInstrument {
  readonly id = "freestyle-drums" as const;
  private readonly strikes = new StrikeDetector(0.9);
  private readonly rig = new StickRig({ length: 0.19, swing: 0.36 });
  private touchDown = new Set<string>();
  private loop: LoopHit[] = [];
  private clockStart = performance.now() / 1000;
  private lastBeat = 0;
  private readonly sx = new Float32Array(MAX_SPLASH);
  private readonly sy = new Float32Array(MAX_SPLASH);
  private readonly svx = new Float32Array(MAX_SPLASH);
  private readonly svy = new Float32Array(MAX_SPLASH);
  private readonly slife = new Float32Array(MAX_SPLASH);
  private readonly shue = new Float32Array(MAX_SPLASH);
  private cursor = 0;
  private rings: Array<{ x: number; y: number; born: number; hue: number; velocity: number; looped: boolean }> = [];
  private zoneFlash = new Map<string, number>();
  private readonly sprites = new TintedSprites(createGlowSprite(40), 24);

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    this.useOffscreenLayer();
  }

  protected override onResize(): void {
    this.rig.setAspect(this.canvas.width / Math.max(1, this.canvas.height));
  }

  override dispose(): void {
    this.sprites.clear();
    super.dispose();
  }

  protected override onReset(): void {
    this.loop = [];
    this.strikes.reset();
    this.rings = [];
    this.slife.fill(0);
    this.clockStart = performance.now() / 1000;
  }

  override serializeState(): Record<string, unknown> {
    return { loop: this.loop.map((h) => ({ beat: h.beat, x: h.x, y: h.y, velocity: h.velocity })) };
  }

  override restoreState(state: Record<string, unknown>): void {
    if (!Array.isArray(state.loop)) return;
    this.loop = state.loop.slice(0, MAX_LOOP_HITS).flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const h = raw as Record<string, unknown>;
      if (![h.beat, h.x, h.y, h.velocity].every((v) => typeof v === "number" && Number.isFinite(v))) return [];
      const x = clamp01(h.x as number);
      const y = clamp01(h.y as number);
      return [{ beat: (((h.beat as number) % BEATS) + BEATS) % BEATS, x, y, velocity: clamp01(h.velocity as number), voice: voiceAt(x, y) }];
    });
  }

  private get looping(): boolean {
    return this.param("looper", 1) >= 0.5;
  }

  /** Loop clock uses wall time so tempo isn't affected by reduced motion. */
  private currentBeat(): number {
    const bpm = clamp(this.param("tempo", 96), 50, 180);
    const elapsed = performance.now() / 1000 - this.clockStart;
    return ((elapsed * bpm) / 60) % BEATS;
  }

  private play(voice: Voice, velocity: number, x: number, y: number, looped: boolean): void {
    this.emit({ kind: voice.kind, degree: voice.degree, velocity: clamp01(velocity) * this.param("volume", 0.85), pan: x });
    this.zoneFlash.set(voice.label, 1);
    this.rings.push({ x, y, born: this.time, hue: voice.hue, velocity, looped });
    if (this.rings.length > 40) this.rings.shift();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const count = Math.round((looped ? 8 : 22) * this.budget * (0.5 + velocity)) + 3;
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const speed = (60 + this.random() * 260 * velocity) * this.pixelRatio;
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % Math.max(1, Math.floor(MAX_SPLASH * this.budget));
      this.sx[k] = x * W;
      this.sy[k] = y * H;
      this.svx[k] = Math.cos(a) * speed;
      this.svy[k] = Math.sin(a) * speed;
      this.slife[k] = 0.5 + this.random() * 0.6;
      this.shue[k] = voice.hue + (this.random() - 0.5) * 30;
    }
  }

  private hit(x: number, y: number, velocity: number): void {
    const voice = voiceAt(x, y);
    this.play(voice, velocity, x, y, false);
    if (this.looping && this.loop.length < MAX_LOOP_HITS) {
      this.loop.push({ beat: quantizeBeat(this.currentBeat(), this.param("quantize", 0.5)), voice, velocity, x, y });
    }
  }

  protected step(dt: number, input: ControlInput): void {
    this.fade(dt * 1.2);
    const seen = new Set<string>();
    const sticks = this.rig.update(input.points, dt);
    for (const point of input.points) {
      if (point.source === "hand" || point.lifted) continue;
      seen.add(point.id);
      if (!this.touchDown.has(point.id)) {
        this.hit(point.position.x, point.position.y, 0.55 + point.amount * 0.45);
        const stick = sticks.find((st) => st.source !== "hand" && Math.abs(st.tipX - point.position.x) < 1e-3);
        if (stick) this.rig.rebound(stick, 0.7);
        haptic();
      }
    }
    this.touchDown = seen;
    // In open air there is no drum head: a hit is the stick tip "bouncing" at the bottom of a stroke.
    const tips = sticks
      .filter((st) => st.active && st.source === "hand")
      .map((st) => ({ id: st.side, source: "hand" as const, position: { x: st.tipX, y: st.tipY }, velocity: { x: st.tipVx, y: st.tipVy }, speed: Math.hypot(st.tipVx, st.tipVy), amount: 1, engaged: false, lifted: false }));
    for (const strike of this.strikes.update(tips, this.time, this.param("sensitivity", 1))) {
      this.hit(strike.x, strike.y, strike.velocity);
      const stick = this.rig.sticks[strike.id === "left" ? "left" : "right"];
      this.rig.rebound(stick, strike.velocity);
    }
    for (const event of input.events) {
      if (event.type === "accent") {
        // Clear the loop and start fresh (non-destructive to saved work; just the jam).
        this.loop = [];
        this.play(V.crash, 0.8, event.position.x, event.position.y, false);
      } else if (event.source === "hand") {
        this.hit(event.position.x, event.position.y, 0.7);
      }
    }

    // Loop playback: fire hits whose beat was crossed since the last frame.
    const beat = this.currentBeat();
    if (this.looping && this.loop.length > 0) {
      const from = this.lastBeat;
      const wrapped = beat < from;
      for (const h of this.loop) {
        const crossed = wrapped ? h.beat > from || h.beat <= beat : h.beat > from && h.beat <= beat;
        if (crossed) this.play(h.voice, h.velocity * 0.9, h.x, h.y, true);
      }
    }
    this.lastBeat = beat;
    for (const [label, value] of this.zoneFlash) this.zoneFlash.set(label, value * 0.88);

    const recent = this.rings.filter((r) => this.time - r.born < 1).length;
    this.targets = { level: 0.04, brightness: 0.3, pitch: 0, pan: 0.5, texture: clamp01(recent / 14) * 0.2 };
  }

  protected draw(): void {
    const paint = this.paint;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;

    // Splashes accumulate on the paint layer and fade, like light on a long exposure.
    paint.save();
    paint.setTransform(1, 0, 0, 1, 0, 0);
    paint.globalCompositeOperation = "lighter";
    const dt = 1 / 60;
    const capacity = Math.floor(MAX_SPLASH * this.budget);
    for (let i = 0; i < capacity; i++) {
      const life = this.slife[i] ?? 0;
      if (life <= 0) continue;
      this.svx[i] = (this.svx[i] ?? 0) * 0.9;
      this.svy[i] = (this.svy[i] ?? 0) * 0.9 + 40 * dpr * dt;
      this.sx[i] = (this.sx[i] ?? 0) + (this.svx[i] ?? 0) * dt;
      this.sy[i] = (this.sy[i] ?? 0) + (this.svy[i] ?? 0) * dt;
      this.slife[i] = life - dt;
      const size = (3 + life * 7) * dpr;
      paint.globalAlpha = clamp01(life) * 0.35;
      paint.drawImage(this.sprites.get(this.shue[i] ?? 0, 65), (this.sx[i] ?? 0) - size / 2, (this.sy[i] ?? 0) - size / 2, size, size);
    }
    paint.restore();

    this.presentLayer();
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Faint zone map so players know where each drum lives.
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `600 ${clamp(W * 0.03, 10 * dpr, 15 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const zones: Array<[Voice, number, number]> = [
      [V.crash, 0.25, 0.22],
      [V.ride, 0.75, 0.22],
      [V.hat, 0.25, 0.39],
      [V.hatOpen, 0.75, 0.39],
      [V.tomHigh, 0.15, 0.59],
      [V.snare, 0.5, 0.59],
      [V.tomFloor, 0.85, 0.59],
      [V.kick, 0.5, 0.78],
    ];
    for (const [voice, zx, zy] of zones) {
      const flash = this.zoneFlash.get(voice.label) ?? 0;
      ctx.fillStyle = `hsla(${voice.hue}, 90%, 75%, ${0.28 + flash * 0.7})`;
      ctx.fillText(voice.label, zx * W, zy * H);
    }
    ctx.fillStyle = "rgba(246, 244, 255, 0.08)";
    for (const y of [0.3, 0.48, 0.7]) ctx.fillRect(W * 0.04, y * H, W * 0.92, Math.max(1, dpr));

    // Impact rings.
    ctx.globalCompositeOperation = "lighter";
    this.rings = this.rings.filter((r) => this.time - r.born < 0.5);
    for (const ring of this.rings) {
      const age = this.time - ring.born;
      ctx.globalAlpha = (1 - age / 0.5) * (ring.looped ? 0.45 : 0.9);
      ctx.strokeStyle = `hsla(${ring.hue}, 95%, 70%, 1)`;
      ctx.lineWidth = (2 + ring.velocity * 4) * dpr;
      ctx.beginPath();
      ctx.arc(ring.x * W, ring.y * H, (10 + age * 180 * (0.6 + ring.velocity)) * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Looper strip: 8 beats, playhead and recorded hits.
    if (this.looping) {
      const left = W * 0.08;
      const width = W * 0.84;
      const top = H * 0.12;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      for (let b = 0; b <= BEATS; b++) {
        ctx.fillStyle = b % 4 === 0 ? "rgba(246, 244, 255, 0.35)" : "rgba(246, 244, 255, 0.15)";
        ctx.fillRect(left + (b / BEATS) * width, top - 6 * dpr, Math.max(1, dpr), 12 * dpr);
      }
      for (const h of this.loop) {
        ctx.fillStyle = `hsla(${h.voice.hue}, 90%, 65%, 0.9)`;
        ctx.beginPath();
        ctx.arc(left + (h.beat / BEATS) * width, top + (h.y - 0.5) * 14 * dpr, (2 + h.velocity * 2.5) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      const head = left + (this.currentBeat() / BEATS) * width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillRect(head - dpr, top - 10 * dpr, 2 * dpr, 20 * dpr);
    }
    drawStick(ctx, this.rig.sticks.left, W, H, dpr);
    drawStick(ctx, this.rig.sticks.right, W, H, dpr);
    ctx.restore();
  }
}
