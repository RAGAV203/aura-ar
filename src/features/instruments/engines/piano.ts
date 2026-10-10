import { clamp, clamp01 } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters } from "@/types/instruments";
import { isBlackKey, noteName } from "../music";
import { CanvasInstrument, createGlowSprite, TintedSprites } from "./canvasInstrument";

/** Keyboard occupies this vertical band of the view (clear of the studio dock). */
const BAND_TOP = 0.5;
const BAND_BOTTOM = 0.86;
const BLACK_HEIGHT = 0.6;
const MAX_BARS = 96;
const BAR_SPEED = 0.32; // view heights per second

interface Key {
  midi: number;
  black: boolean;
  x: number;
  width: number;
}

interface Held {
  midi: number;
  voiceId: string;
  bar: Bar;
}

interface Bar {
  midi: number;
  x: number;
  width: number;
  start: number;
  end: number | null;
  hue: number;
}

/**
 * Piano — a glass keyboard floating over the view. Tap or press keys, or
 * pinch over a key in the air; sliding while pressed glides across keys.
 * Each note rises from its key as a bar of light whose length is how long it
 * was held, so a melody draws itself.
 */
export class PianoInstrument extends CanvasInstrument {
  readonly id = "piano" as const;
  private keys: Key[] = [];
  private held = new Map<string, Held>();
  private bars: Bar[] = [];
  private pressed = new Map<number, number>();
  private hover = new Set<number>();
  private glissando: Array<{ at: number; midi: number; off: boolean }> = [];
  private voiceCounter = 0;
  private readonly sprites = new TintedSprites(createGlowSprite(48), 24);

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

  protected override onReset(): void {
    this.held.clear();
    this.bars = [];
    this.pressed.clear();
    this.glissando = [];
  }

  private get startMidi(): number {
    return 12 * (Math.round(this.param("octave", 4)) + 1);
  }

  private layout(): void {
    const whiteCount = clamp(Math.round(this.param("keys", 15)), 8, 29);
    const whiteWidth = 1 / whiteCount;
    const keys: Key[] = [];
    let white = 0;
    for (let midi = this.startMidi; white < whiteCount; midi++) {
      if (isBlackKey(midi)) {
        keys.push({ midi, black: true, x: white * whiteWidth - whiteWidth * 0.3, width: whiteWidth * 0.6 });
      } else {
        keys.push({ midi, black: false, x: white * whiteWidth, width: whiteWidth });
        white++;
      }
    }
    this.keys = keys;
  }

  /** Key under a normalised position, black keys first (they sit on top). */
  private keyAt(x: number, y: number): Key | null {
    if (y < BAND_TOP || y > BAND_BOTTOM) return null;
    const inBlackZone = y < BAND_TOP + (BAND_BOTTOM - BAND_TOP) * BLACK_HEIGHT;
    if (inBlackZone) {
      const black = this.keys.find((k) => k.black && x >= k.x && x <= k.x + k.width);
      if (black) return black;
    }
    return this.keys.find((k) => !k.black && x >= k.x && x <= k.x + k.width) ?? null;
  }

  private hueFor(midi: number): number {
    return this.param("hue", 260) + ((midi % 12) / 12) * this.param("rainbow", 0.6) * 300;
  }

  private velocityFor(point: ControlPoint): number {
    if (point.source === "touch") return clamp01(0.55 + point.amount * 0.4);
    return clamp01(0.5 + Math.max(0, point.velocity.y) * 0.4 + point.speed * 0.1);
  }

  private noteOn(pointId: string, key: Key, velocity: number): void {
    const voiceId = `${pointId}:${key.midi}:${this.voiceCounter++}`;
    this.voiceOn(voiceId, "piano", key.midi, velocity, key.x + key.width / 2);
    const bar: Bar = { midi: key.midi, x: key.x, width: key.width, start: this.time, end: null, hue: this.hueFor(key.midi) };
    this.bars.push(bar);
    if (this.bars.length > MAX_BARS) this.bars.shift();
    this.held.set(pointId, { midi: key.midi, voiceId, bar });
    this.pressed.set(key.midi, (this.pressed.get(key.midi) ?? 0) + 1);
  }

  private noteOff(pointId: string): void {
    const held = this.held.get(pointId);
    if (!held) return;
    // With sustain, notes ring on after the key is released, like the damper pedal.
    const sustain = this.param("sustain", 0.3);
    this.voiceOff(held.voiceId, 0.1 + sustain * 1.6);
    held.bar.end = this.time;
    const count = (this.pressed.get(held.midi) ?? 1) - 1;
    if (count <= 0) this.pressed.delete(held.midi);
    else this.pressed.set(held.midi, count);
    this.held.delete(pointId);
  }

  protected step(_dt: number, input: ControlInput): void {
    const seen = new Set<string>();
    this.hover.clear();
    for (const point of input.points) {
      const key = this.keyAt(point.position.x, point.position.y);
      // Touch presses whenever down; a hand presses while pinching.
      const pressing = !point.lifted && (point.source !== "hand" || point.engaged);
      if (key && !pressing) this.hover.add(key.midi);
      if (!pressing) continue;
      seen.add(point.id);
      const held = this.held.get(point.id);
      if (held && key && held.midi === key.midi) continue;
      if (held) this.noteOff(point.id);
      if (key) this.noteOn(point.id, key, this.velocityFor(point));
    }
    for (const id of [...this.held.keys()]) if (!seen.has(id)) this.noteOff(id);

    for (const event of input.events) {
      if (event.type !== "accent") continue;
      // Glissando up the white keys from where the gesture happened.
      const whites = this.keys.filter((k) => !k.black);
      const startIndex = Math.max(0, whites.findIndex((k) => event.position.x <= k.x + k.width));
      whites.slice(startIndex, startIndex + 10).forEach((k, i) => {
        this.glissando.push({ at: this.time + i * 0.045, midi: k.midi, off: false }, { at: this.time + i * 0.045 + 0.25, midi: k.midi, off: true });
      });
    }
    if (this.glissando.length > 0) {
      const due = this.glissando.filter((g) => g.at <= this.time);
      this.glissando = this.glissando.filter((g) => g.at > this.time);
      for (const g of due) {
        const key = this.keys.find((k) => k.midi === g.midi);
        if (!key) continue;
        const id = `gliss-${g.midi}`;
        if (g.off) this.noteOff(id);
        else {
          this.noteOff(id);
          this.noteOn(id, key, 0.6);
        }
      }
    }

    const top = this.time - (BAND_TOP + 0.1) / BAR_SPEED;
    this.bars = this.bars.filter((b) => b.end === null || b.end > top);
    this.targets = { level: 0.05, brightness: 0.4, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const bandTop = H * BAND_TOP;
    const bandH = H * (BAND_BOTTOM - BAND_TOP);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Rising light bars.
    ctx.globalCompositeOperation = "lighter";
    for (const bar of this.bars) {
      const head = bandTop - (this.time - bar.start) * BAR_SPEED * H;
      const tail = bar.end === null ? bandTop : bandTop - (this.time - bar.end) * BAR_SPEED * H;
      const x = bar.x * W + 2 * dpr;
      const w = bar.width * W - 4 * dpr;
      const gradient = ctx.createLinearGradient(0, head, 0, tail);
      gradient.addColorStop(0, `hsla(${bar.hue}, 95%, 70%, 0.15)`);
      gradient.addColorStop(1, `hsla(${bar.hue}, 95%, 65%, 0.85)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, head, w, Math.max(2 * dpr, tail - head), 4 * dpr);
      ctx.fill();
    }

    // Keyboard.
    ctx.globalCompositeOperation = "source-over";
    const glass = this.param("glass", 0.55);
    for (const black of [false, true]) {
      for (const key of this.keys) {
        if (key.black !== black) continue;
        const x = key.x * W;
        const w = key.width * W;
        const h = black ? bandH * BLACK_HEIGHT : bandH;
        const isPressed = this.pressed.has(key.midi);
        const hue = this.hueFor(key.midi);
        if (isPressed) {
          ctx.fillStyle = `hsla(${hue}, 95%, ${black ? 55 : 65}%, 0.9)`;
        } else if (this.hover.has(key.midi)) {
          ctx.fillStyle = black ? `hsla(${hue}, 60%, 30%, 0.85)` : `hsla(${hue}, 60%, 85%, ${glass * 0.7})`;
        } else {
          ctx.fillStyle = black ? `rgba(10, 10, 24, ${0.6 + glass * 0.35})` : `rgba(246, 244, 255, ${glass * 0.42})`;
        }
        ctx.beginPath();
        ctx.roundRect(x + 1 * dpr, bandTop, w - 2 * dpr, h, [0, 0, 6 * dpr, 6 * dpr]);
        ctx.fill();
        ctx.strokeStyle = black ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
        if (isPressed) {
          ctx.globalCompositeOperation = "lighter";
          const size = w * 2.4;
          ctx.drawImage(this.sprites.get(hue, 70), x + w / 2 - size / 2, bandTop - size / 2, size, size);
          ctx.globalCompositeOperation = "source-over";
        }
        // Label the Cs so players can find their place.
        if (!black && key.midi % 12 === 0) {
          ctx.fillStyle = "rgba(20, 20, 40, 0.7)";
          ctx.font = `600 ${clamp(w * 0.28, 9 * dpr, 15 * dpr)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(noteName(key.midi), x + w / 2, bandTop + bandH - 8 * dpr);
        }
      }
    }
    ctx.restore();
  }
}
