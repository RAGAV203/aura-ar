import { clamp, clamp01, damp, midiToFrequency } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters } from "@/types/instruments";
import { MAJOR, MAJOR_PENTATONIC, noteName } from "../music";
import { CanvasInstrument } from "./canvasInstrument";

const ANTENNA_X = 0.9;
const LOOP_X = 0.1;
const LOOP_Y = 0.82;
const SNAP_SCALES: Array<readonly number[] | null> = [null, MAJOR, MAJOR_PENTATONIC];

/** Continuous pitch → MIDI, optionally pulled towards the nearest scale note. */
export function thereminPitch(distance: number, lowMidi: number, rangeSemitones: number, snap: number, scale: readonly number[] | null): number {
  const raw = lowMidi + rangeSemitones * (1 - clamp01(distance / 0.85));
  if (!scale || snap <= 0) return raw;
  let best = raw;
  let bestD = Infinity;
  for (let octave = -1; octave <= Math.ceil(rangeSemitones / 12) + 1; octave++) {
    for (const step of scale) {
      const candidate = lowMidi + octave * 12 + step;
      const d = Math.abs(candidate - raw);
      if (d < bestD) {
        bestD = d;
        best = candidate;
      }
    }
  }
  return raw + (best - raw) * clamp01(snap);
}

/**
 * Theremin — the original touch-free instrument. One hand's distance from the
 * pitch antenna (right) sets the pitch, continuously; the other hand's height
 * over the volume loop (left) sets the loudness. With one hand, sideways is
 * pitch and height is volume. A live tuner shows how close you are to a note.
 */
export class ThereminInstrument extends CanvasInstrument {
  readonly id = "theremin" as const;
  private voiceId: string | null = null;
  private voiceCounter = 0;
  private midi = 60;
  private volume = 0;
  private quietFor = 0;
  private pitchHand: { x: number; y: number } | null = null;
  private volumeHand: { x: number; y: number } | null = null;
  private phase = 0;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
  }

  protected override onReset(): void {
    if (this.voiceId) this.voiceOff(this.voiceId);
    this.voiceId = null;
  }

  protected step(dt: number, input: ControlInput): void {
    const points = input.points.filter((p) => !p.lifted);
    // The hand nearer the antenna plays pitch; the other one controls volume.
    const sorted = [...points].sort((a, b) => b.position.x - a.position.x);
    const pitchPoint: ControlPoint | undefined = sorted[0];
    const volumePoint: ControlPoint | undefined = sorted[1];
    this.pitchHand = pitchPoint ? { ...pitchPoint.position } : null;
    this.volumeHand = volumePoint ? { ...volumePoint.position } : null;

    if (pitchPoint) {
      const low = 36 + Math.round(this.param("octave", 3)) * 12 - 12;
      const range = Math.round(this.param("range", 3)) * 12;
      const snapScale = SNAP_SCALES[clamp(Math.round(this.param("snapScale", 0)), 0, 2)] ?? null;
      const target = thereminPitch(ANTENNA_X - pitchPoint.position.x, low, range, this.param("snap", 0), snapScale);
      this.midi = damp(this.midi, target, 30, dt);
      const height = volumePoint ? volumePoint.position.y : pitchPoint.position.y;
      this.volume = damp(this.volume, clamp01((0.92 - height) / 0.72), 14, dt);
      this.quietFor = 0;
      if (!this.voiceId) {
        this.voiceId = `theremin-${this.voiceCounter++}`;
        this.voiceOn(this.voiceId, "theremin", this.midi, 0.8, 0.5);
      }
      this.voiceUpdate(this.voiceId, { midi: this.midi, expression: this.volume, glideMs: 20, pan: clamp01(pitchPoint.position.x) });
    } else {
      this.volume = damp(this.volume, 0, 10, dt);
      this.quietFor += dt;
      if (this.voiceId) {
        this.voiceUpdate(this.voiceId, { expression: this.volume });
        if (this.quietFor > 0.25) {
          this.voiceOff(this.voiceId, 0.15);
          this.voiceId = null;
        }
      }
    }
    this.phase += dt * midiToFrequency(this.midi) * 0.02;
    this.targets = { level: 0.03, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const hue = this.param("hue", 190);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ax = ANTENNA_X * W;

    // Field: rings around the antenna; spacing follows the wavelength of the note.
    const frequency = midiToFrequency(this.midi);
    const spacing = clamp(26000 / frequency, 8, 90) * dpr;
    ctx.globalCompositeOperation = "lighter";
    for (let r = (this.phase * spacing) % spacing; r < W; r += spacing) {
      const fade = 1 - r / W;
      ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${fade * (0.05 + this.volume * 0.25)})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(ax, H * 0.5, r, Math.PI * 0.55, Math.PI * 1.45);
      ctx.stroke();
    }
    // Link between pitch hand and antenna.
    if (this.pitchHand) {
      const hx = this.pitchHand.x * W;
      const hy = this.pitchHand.y * H;
      const grad = ctx.createLinearGradient(hx, hy, ax, hy);
      grad.addColorStop(0, `hsla(${hue}, 95%, 70%, ${0.2 + this.volume * 0.6})`);
      grad.addColorStop(1, `hsla(${hue + 40}, 95%, 70%, 0.1)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = (2 + this.volume * 4) * dpr;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      for (let x = hx; x < ax; x += 6 * dpr) ctx.lineTo(x, hy + Math.sin((x - hx) / spacing * Math.PI * 2 - this.phase * 6) * 6 * dpr * this.volume);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // Antenna (chrome rod) and volume loop.
    const rod = ctx.createLinearGradient(ax - 6 * dpr, 0, ax + 6 * dpr, 0);
    rod.addColorStop(0, "#6b7082");
    rod.addColorStop(0.5, "#f2f4fa");
    rod.addColorStop(1, "#5a5f70");
    ctx.fillStyle = rod;
    ctx.fillRect(ax - 4 * dpr, H * 0.16, 8 * dpr, H * 0.7);
    ctx.fillStyle = "#2a2440";
    ctx.beginPath();
    ctx.roundRect(ax - 30 * dpr, H * 0.84, 60 * dpr, 26 * dpr, 6 * dpr);
    ctx.fill();
    ctx.strokeStyle = "rgba(230, 232, 245, 0.85)";
    ctx.lineWidth = 5 * dpr;
    ctx.beginPath();
    ctx.ellipse(LOOP_X * W + 30 * dpr, LOOP_Y * H, 34 * dpr, 12 * dpr, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(246, 244, 255, 0.5)";
    ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("pitch", ax, H * 0.14);
    ctx.fillText("volume", LOOP_X * W + 30 * dpr, LOOP_Y * H + 18 * dpr);

    // Hands.
    for (const [hand, label] of [
      [this.pitchHand, hue],
      [this.volumeHand, hue + 60],
    ] as const) {
      if (!hand) continue;
      ctx.fillStyle = `hsla(${label}, 95%, 70%, 0.9)`;
      ctx.beginPath();
      ctx.arc(hand.x * W, hand.y * H, 8 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Oscilloscope and tuner.
    const scopeTop = H * 0.13;
    const scopeH = H * 0.08;
    ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${0.35 + this.volume * 0.6})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    const cycles = clamp(frequency / 110, 1, 14);
    for (let x = 0; x <= W * 0.7; x += 3 * dpr) {
      const t = x / (W * 0.7);
      const y = scopeTop + scopeH / 2 + Math.sin(t * cycles * Math.PI * 2 + this.phase * 4) * (scopeH / 2) * this.volume;
      if (x === 0) ctx.moveTo(W * 0.15 + x, y);
      else ctx.lineTo(W * 0.15 + x, y);
    }
    ctx.stroke();
    const nearest = Math.round(this.midi);
    const cents = Math.round((this.midi - nearest) * 100);
    ctx.fillStyle = this.voiceId ? "rgba(246, 244, 255, 0.95)" : "rgba(246, 244, 255, 0.4)";
    ctx.font = `700 ${clamp(W * 0.05, 16 * dpr, 28 * dpr)}px system-ui, sans-serif`;
    ctx.fillText(noteName(nearest), W / 2, scopeTop + scopeH + 30 * dpr);
    ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = Math.abs(cents) < 10 ? "rgba(111, 240, 176, 0.95)" : "rgba(255, 200, 107, 0.9)";
    ctx.fillText(this.voiceId ? `${cents > 0 ? "+" : ""}${cents}¢` : "Move a hand towards the antenna", W / 2, scopeTop + scopeH + 50 * dpr);
    ctx.restore();
  }
}
