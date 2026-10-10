import { clamp, clamp01, damp } from "@/lib/math";
import type { ControlInput, ControlPoint, InstrumentParameters, VoiceKind } from "@/types/instruments";
import { isPluckedKind } from "@/features/audio/pluckedString";
import { noteName } from "../music";
import { buildCells, GRID_SCALES, locate, pitchAt, type Cell, type GridConfig, type GridRect, type NoteTransition } from "../grid/gridLayout";
import { CanvasInstrument } from "./canvasInstrument";

export interface GridSound {
  label: string;
  kind: VoiceKind;
  /** Semitone offset so each sound sits in its natural register. */
  shift: number;
}

export const GRID_SOUNDS: GridSound[] = [
  { label: "Acoustic Guitar", kind: "guitar", shift: 0 },
  { label: "Electric Guitar", kind: "electric", shift: 0 },
  { label: "Nylon Guitar", kind: "nylon", shift: 0 },
  { label: "Sitar", kind: "sitar", shift: 0 },
  { label: "Veena", kind: "veena", shift: 0 },
  { label: "Violin", kind: "violin", shift: 12 },
  { label: "Cello", kind: "cello", shift: -12 },
  { label: "Flute", kind: "flute", shift: 12 },
  { label: "Trumpet", kind: "trumpet", shift: 0 },
  { label: "Lead Synth", kind: "theremin", shift: 12 },
];

const TRANSITIONS: NoteTransition[] = ["piano", "guitar", "slide"];
const LFO_HZ = 5.6;
const PROGRESSION = [0, 7, 9, 5]; // I V vi IV

interface Finger {
  id: string;
  row: number;
  column: number;
  startY: number;
  velocity: number;
  /** Voice this finger drives (shared along a row in String mode). */
  voiceId: string | null;
  harmonicId: string | null;
  lastPitch: number;
  stillFor: number;
  source: ControlPoint["source"];
}

/**
 * Pitch Grid — an isomorphic performance surface. Rows are strings tuned in
 * fourths; columns step through the scale (or every semitone). Each finger is
 * its own expressive voice: slide sideways (snapped, glided or fretless),
 * wiggle vertically for vibrato, hammer on and pull off along a row in String
 * mode. The studio renders the control panel; this engine draws the grid and
 * plays the notes through Aura's string, bow, wind and synth voices.
 */
export class PitchGridInstrument extends CanvasInstrument {
  readonly id = "pitch-grid" as const;
  private fingers = new Map<string, Finger>();
  /** String mode: per row, fingers in press order (last = sounding). */
  private rowStacks = new Map<number, string[]>();
  private cells: Cell[] = [];
  private configKey = "";
  private rect: GridRect = { top: 0.3, bottom: 0.88 };
  private gridLayer: HTMLCanvasElement | null = null;
  private layerDirty = true;
  private voiceCounter = 0;
  private rowGlow = new Float32Array(16);
  private hover: { row: number; column: number } | null = null;
  // Backing track
  private trackStart = performance.now() / 1000;
  private lastStep = -1;
  private bassVoice: string | null = null;
  private beatFlash = 0;
  private readonly labelFont: string;

  constructor(canvas: HTMLCanvasElement, parameters: InstrumentParameters, seed: number) {
    super(canvas, parameters, seed);
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-serif").trim();
    this.labelFont = family || "Georgia, serif";
  }

  setInsets(insets: { top: number; bottom: number }): void {
    const top = clamp(insets.top + 0.006, 0, 0.7);
    const bottom = clamp(1 - insets.bottom - 0.006, top + 0.2, 1);
    if (Math.abs(top - this.rect.top) > 1e-4 || Math.abs(bottom - this.rect.bottom) > 1e-4) {
      this.rect = { top, bottom };
      this.layerDirty = true;
    }
  }

  override setParameters(parameters: InstrumentParameters): void {
    super.setParameters(parameters);
    if (this.param("track", 0) < 0.5 && this.bassVoice) {
      this.voiceOff(this.bassVoice, 0.1);
      this.bassVoice = null;
    }
  }

  protected override onResize(): void {
    this.layerDirty = true;
  }

  protected override onReset(): void {
    this.fingers.clear();
    this.rowStacks.clear();
    this.bassVoice = null;
  }

  override dispose(): void {
    if (this.gridLayer) this.gridLayer.width = this.gridLayer.height = 1;
    this.gridLayer = null;
    super.dispose();
  }

  /* ---------- Configuration ---------- */

  get config(): GridConfig {
    return {
      rows: clamp(Math.round(this.param("rows", 6)), 3, 8),
      columns: clamp(Math.round(this.param("columns", 12)), 5, 16),
      bottomOpen: 16 + 12 * Math.round(this.param("octave", 2)) + Math.round(this.param("key", 0)),
      rowInterval: 5,
      key: Math.round(this.param("key", 0)),
      scale: GRID_SCALES[clamp(Math.round(this.param("scale", 0)), 0, GRID_SCALES.length - 1)]?.notes ?? [0, 2, 4, 5, 7, 9, 11],
      diatonic: this.param("diatonic", 1) >= 0.5,
    };
  }

  private get sound(): GridSound {
    return GRID_SOUNDS[clamp(Math.round(this.param("sound", 0)), 0, GRID_SOUNDS.length - 1)] ?? GRID_SOUNDS[0]!;
  }

  private get transition(): NoteTransition {
    return TRANSITIONS[clamp(Math.round(this.param("transition", 1)), 0, 2)] ?? "guitar";
  }

  private get stringMode(): boolean {
    return this.param("playMode", 0) < 0.5;
  }

  private expression(): number {
    return clamp01(0.3 + 0.7 * this.param("filter", 0.75) * (0.55 + 0.45 * this.param("tone", 0.6)));
  }

  private releaseSeconds(): number {
    return 0.08 + this.param("sustain", 0.4) * 2.4;
  }

  /* ---------- Voices ---------- */

  private targetPitch(finger: Finger, config: GridConfig): number {
    const base = pitchAt(finger.row, finger.column, config, this.transition);
    const rowHeight = (this.rect.bottom - this.rect.top) / config.rows;
    const touchVibrato = clamp(finger.startY - this.lastY(finger), -rowHeight * 0.5, rowHeight * 0.5) / rowHeight; // ±0.5 semitone
    const lfo = this.param("vibrato", 0) * 0.45 * Math.sin(this.time * Math.PI * 2 * LFO_HZ);
    const whammy = -this.param("whammy", 0) * 2;
    return base + this.sound.shift + touchVibrato + lfo + whammy;
  }

  private yById = new Map<string, number>();
  private lastY(finger: Finger): number {
    return this.yById.get(finger.id) ?? finger.startY;
  }

  private startVoice(finger: Finger, pitch: number): void {
    const sound = this.sound;
    const id = `grid-${this.voiceCounter++}`;
    const pan = clamp01(finger.column / Math.max(1, this.config.columns - 1));
    this.voiceOn(id, sound.kind, pitch, finger.velocity, pan);
    this.voiceUpdate(id, { expression: this.expression() });
    finger.voiceId = id;
    finger.harmonicId = null;
    if (this.param("harmonic", 0) >= 0.5) {
      finger.harmonicId = `${id}:h`;
      this.voiceOn(finger.harmonicId, sound.kind, pitch + 12, finger.velocity * 0.35, pan);
      this.voiceUpdate(finger.harmonicId, { expression: this.expression() * 0.8 });
    }
    finger.lastPitch = pitch;
    this.rowGlow[finger.row] = Math.max(this.rowGlow[finger.row] ?? 0, finger.velocity);
  }

  private stopVoice(finger: Finger, squeal: boolean): void {
    if (!finger.voiceId) return;
    const release = this.releaseSeconds();
    this.voiceOff(finger.voiceId, release);
    if (finger.harmonicId) this.voiceOff(finger.harmonicId, release);
    // Pinch harmonic: the "squeal" of a string caught by the thumb as the note is let go.
    if (squeal && this.param("pinch", 0) >= 0.5 && isPluckedKind(this.sound.kind)) {
      const id = `pinch-${this.voiceCounter++}`;
      this.voiceOn(id, this.sound.kind, finger.lastPitch + 19, finger.velocity * 0.55, 0.5);
      this.voiceOff(id, 0.45);
    }
    finger.voiceId = null;
    finger.harmonicId = null;
  }

  private sendPitch(finger: Finger, config: GridConfig, force = false): void {
    if (!finger.voiceId) return;
    const pitch = this.targetPitch(finger, config);
    if (!force && Math.abs(pitch - finger.lastPitch) < 0.004) return;
    const glide = this.transition === "guitar" ? 35 : this.transition === "slide" ? 12 : 0;
    this.voiceUpdate(finger.voiceId, { midi: pitch, glideMs: glide });
    if (finger.harmonicId) this.voiceUpdate(finger.harmonicId, { midi: pitch + 12, glideMs: glide });
    finger.lastPitch = pitch;
  }

  /* ---------- Input ---------- */

  private pressing(point: ControlPoint): boolean {
    return !point.lifted && (point.source !== "hand" || point.engaged);
  }

  private press(point: ControlPoint, config: GridConfig): void {
    const at = locate(point.position.x, point.position.y, config, this.rect);
    if (!at) return;
    const amp = 0.45 + 0.55 * this.param("ampVol", 0.8);
    const velocity = clamp01((point.source === "hand" ? 0.5 + point.speed * 0.2 : 0.55 + point.amount * 0.45) * amp);
    const finger: Finger = {
      id: point.id,
      row: at.row,
      column: this.transition === "slide" ? at.column : Math.round(at.column),
      startY: point.position.y,
      velocity,
      voiceId: null,
      harmonicId: null,
      lastPitch: 0,
      stillFor: 0,
      source: point.source,
    };
    this.fingers.set(point.id, finger);
    this.yById.set(point.id, point.position.y);

    if (!this.stringMode) {
      this.startVoice(finger, this.targetPitch(finger, config));
      return;
    }
    // String mode: one voice per row. A new finger on a sounding row hammers on (legato).
    const stack = this.rowStacks.get(at.row) ?? [];
    const owner = stack.length > 0 ? this.fingers.get(stack[stack.length - 1]!) : undefined;
    stack.push(point.id);
    this.rowStacks.set(at.row, stack);
    if (owner?.voiceId && this.transition !== "piano") {
      finger.voiceId = owner.voiceId;
      finger.harmonicId = owner.harmonicId;
      finger.lastPitch = owner.lastPitch;
      owner.voiceId = null;
      owner.harmonicId = null;
      this.sendPitch(finger, config, true);
      this.rowGlow[at.row] = Math.max(this.rowGlow[at.row] ?? 0, 0.6);
    } else {
      if (owner) this.stopVoice(owner, false);
      this.startVoice(finger, this.targetPitch(finger, config));
    }
  }

  private release(finger: Finger, config: GridConfig): void {
    this.fingers.delete(finger.id);
    this.yById.delete(finger.id);
    if (!this.stringMode) {
      this.stopVoice(finger, true);
      return;
    }
    const stack = (this.rowStacks.get(finger.row) ?? []).filter((id) => id !== finger.id);
    this.rowStacks.set(finger.row, stack);
    if (!finger.voiceId) return; // a covered finger lifting changes nothing audible
    const next = stack.length > 0 ? this.fingers.get(stack[stack.length - 1]!) : undefined;
    if (next && this.transition !== "piano") {
      // Pull-off: the lower held note sounds again on the same string.
      next.voiceId = finger.voiceId;
      next.harmonicId = finger.harmonicId;
      next.lastPitch = finger.lastPitch;
      this.sendPitch(next, config, true);
    } else {
      this.stopVoice(finger, true);
      if (next) this.startVoice(next, this.targetPitch(next, config));
    }
  }

  protected step(dt: number, input: ControlInput): void {
    const config = this.config;
    const key = JSON.stringify(config);
    if (key !== this.configKey) {
      this.configKey = key;
      this.cells = buildCells(config);
      this.layerDirty = true;
    }

    const seen = new Set<string>();
    this.hover = null;
    for (const point of input.points) {
      if (!this.pressing(point)) {
        if (point.source === "hand" && !point.lifted) {
          const at = locate(point.position.x, point.position.y, config, this.rect);
          if (at) this.hover = { row: at.row, column: Math.round(at.column) };
        }
        continue;
      }
      seen.add(point.id);
      const finger = this.fingers.get(point.id);
      if (!finger) {
        this.press(point, config);
        continue;
      }
      // Slide along the row; vertical movement is vibrato (the row never changes mid-note).
      const at = locate(point.position.x, clamp(point.position.y, this.rect.top, this.rect.bottom), config, this.rect);
      if (at) {
        const target = this.transition === "slide" ? at.column : Math.round(at.column);
        const moving = Math.abs(point.velocity.x) > 0.04;
        finger.stillFor = moving ? 0 : finger.stillFor + dt;
        finger.column = target;
        // Auto: a fretless slide settles onto the nearest note when the finger rests.
        if (this.transition === "slide" && this.param("auto", 0) >= 0.5 && finger.stillFor > 0.12) {
          finger.column = damp(finger.column, Math.round(finger.column), 6, finger.stillFor);
        }
      }
      this.yById.set(point.id, point.position.y);
    }
    for (const finger of [...this.fingers.values()]) if (!seen.has(finger.id)) this.release(finger, config);

    const expression = this.expression();
    for (const finger of this.fingers.values()) {
      this.sendPitch(finger, config);
      if (finger.voiceId) this.voiceUpdate(finger.voiceId, { expression });
    }
    for (let r = 0; r < this.rowGlow.length; r++) this.rowGlow[r] = (this.rowGlow[r] ?? 0) * Math.exp(-2.5 * dt);

    this.backingTrack(config);
    this.beatFlash *= Math.exp(-6 * dt);
    this.targets = { level: 0.03, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 };
  }

  /* ---------- Backing track ---------- */

  private backingTrack(config: GridConfig): void {
    if (this.param("track", 0) < 0.5) {
      this.lastStep = -1;
      return;
    }
    const tempo = clamp(this.param("tempo", 96), 50, 180);
    const now = performance.now() / 1000;
    if (this.lastStep < 0) this.trackStart = now;
    const step = Math.floor(((now - this.trackStart) * tempo) / 60 * 4);
    if (step === this.lastStep) return;
    this.lastStep = step;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const vol = this.param("trackVol", 0.6);
    if (s % 4 === 0) this.beatFlash = s === 0 ? 1 : 0.6;
    if (s === 0 || s === 8 || s === 10) this.emit({ kind: "kick", degree: 0, velocity: 0.85 * vol, pan: 0.5 });
    if (s === 4 || s === 12) this.emit({ kind: "snare", degree: 0, velocity: 0.7 * vol, pan: 0.5 });
    if (s % 2 === 0 && s !== 14) this.emit({ kind: "hat", degree: 0, velocity: (s % 4 === 0 ? 0.45 : 0.3) * vol, pan: 0.6 });
    if (s === 14) this.emit({ kind: "hat-open", degree: 0, velocity: 0.35 * vol, pan: 0.6 });
    // Bass: root on the downbeats, fifth on the "and" of 2, following I–V–vi–IV.
    if (s === 0 || s === 6 || s === 8) {
      const chordRoot = config.key + (PROGRESSION[bar % PROGRESSION.length] ?? 0);
      const midi = 36 + (((chordRoot % 12) + 12) % 12) + (s === 6 ? 7 : 0);
      if (this.bassVoice) this.voiceOff(this.bassVoice, 0.08);
      this.bassVoice = `bass-${this.voiceCounter++}`;
      this.voiceOn(this.bassVoice, "electric", midi, 0.7 * vol, 0.45);
    }
  }

  /* ---------- Drawing ---------- */

  private cellRect(cell: { row: number; column: number }, config: GridConfig) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const w = W / config.columns;
    const h = ((this.rect.bottom - this.rect.top) * H) / config.rows;
    return { x: cell.column * w, y: this.rect.top * H + cell.row * h, w, h };
  }

  /** Static grid (cells, rings, labels, strings) rendered once per layout change. */
  private renderLayer(config: GridConfig): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    this.gridLayer ??= document.createElement("canvas");
    this.gridLayer.width = W;
    this.gridLayer.height = H;
    const ctx = this.gridLayer.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const cell of this.cells) {
      const r = this.cellRect(cell, config);
      const pad = 2.5 * dpr;
      const colour = cell.isRoot ? "255, 138, 61" : cell.inScale ? "85, 231, 255" : "120, 130, 160";
      ctx.fillStyle = "rgba(24, 26, 34, 0.82)";
      ctx.beginPath();
      ctx.roundRect(r.x + pad, r.y + pad, r.w - pad * 2, r.h - pad * 2, 6 * dpr);
      ctx.fill();
      // Neon border: soft outer glow, then the crisp edge.
      ctx.strokeStyle = `rgba(${colour}, 0.22)`;
      ctx.lineWidth = 5 * dpr;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${colour}, ${cell.inScale ? 0.95 : 0.45})`;
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();
      // Corner screws.
      ctx.fillStyle = `rgba(${colour}, 0.35)`;
      for (const [sx, sy] of [
        [r.x + pad * 3, r.y + pad * 3],
        [r.x + r.w - pad * 3, r.y + pad * 3],
        [r.x + pad * 3, r.y + r.h - pad * 3],
        [r.x + r.w - pad * 3, r.y + r.h - pad * 3],
      ] as const) {
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      // Speaker rings.
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const ring = Math.min(r.w, r.h) * 0.36;
      for (const k of [1, 0.78, 0.56]) {
        ctx.strokeStyle = `rgba(${colour}, ${0.18 + (1 - k) * 0.2})`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, ring * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Strings through each row.
    for (let row = 0; row < config.rows; row++) {
      const r = this.cellRect({ row, column: 0 }, config);
      ctx.strokeStyle = "rgba(220, 225, 240, 0.35)";
      ctx.lineWidth = (1 + (row / config.rows) * 1.4) * dpr;
      ctx.beginPath();
      ctx.moveTo(0, r.y + r.h / 2);
      ctx.lineTo(W, r.y + r.h / 2);
      ctx.stroke();
    }
    // Note names on top of the strings.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const cell of this.cells) {
      const r = this.cellRect(cell, config);
      ctx.font = `700 ${Math.min(r.w, r.h) * 0.34}px ${this.labelFont}`;
      ctx.fillStyle = cell.inScale ? "rgba(246, 244, 255, 0.95)" : "rgba(180, 184, 205, 0.55)";
      ctx.fillText(noteName(cell.midi).replace(/\d+$/, ""), r.x + r.w / 2, r.y + r.h / 2);
    }
    this.layerDirty = false;
  }

  protected draw(): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.pixelRatio;
    const config = this.config;
    if (this.layerDirty || !this.gridLayer || this.gridLayer.width !== W || this.gridLayer.height !== H) this.renderLayer(config);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.gridLayer) ctx.drawImage(this.gridLayer, 0, 0);

    // Vibrating strings on rows that are sounding.
    ctx.globalCompositeOperation = "lighter";
    for (let row = 0; row < config.rows; row++) {
      const glow = this.rowGlow[row] ?? 0;
      const active = [...this.fingers.values()].some((f) => f.row === row && f.voiceId);
      if (glow < 0.02 && !active) continue;
      const r = this.cellRect({ row, column: 0 }, config);
      const y = r.y + r.h / 2;
      const amp = Math.max(glow, active ? 0.35 : 0) * 3 * dpr;
      ctx.strokeStyle = `rgba(160, 240, 255, ${0.35 + Math.max(glow, active ? 0.4 : 0) * 0.5})`;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8 * dpr) {
        const yy = y + Math.sin(x * 0.05 + this.time * 60) * amp * Math.sin((x / W) * Math.PI);
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // Hand hover outline.
    if (this.hover) {
      const r = this.cellRect(this.hover, config);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(r.x + 3 * dpr, r.y + 3 * dpr, r.w - 6 * dpr, r.h - 6 * dpr);
    }

    // Fingers: the cell lights up, and a marker shows the exact (possibly fretless) position.
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const finger of this.fingers.values()) {
      const near = { row: finger.row, column: Math.round(finger.column) };
      const r = this.cellRect(near, config);
      const isRoot = this.cells.find((c) => c.row === near.row && c.column === near.column)?.isRoot;
      const colour = isRoot ? "255, 150, 70" : "85, 231, 255";
      const fill = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.7);
      fill.addColorStop(0, `rgba(${colour}, ${finger.voiceId ? 0.55 : 0.2})`);
      fill.addColorStop(1, `rgba(${colour}, 0)`);
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const mx = ((finger.column + 0.5) / config.columns) * W;
      const my = this.lastY(finger) * H;
      ctx.strokeStyle = `rgba(${colour}, 0.95)`;
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.arc(mx, my, Math.min(r.w, r.h) * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      if (finger.voiceId) {
        const pitch = finger.lastPitch - this.sound.shift;
        const nearest = Math.round(pitch);
        const cents = Math.round((pitch - nearest) * 100);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(246, 244, 255, 0.95)";
        ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
        ctx.fillText(`${noteName(nearest)}${Math.abs(cents) >= 5 ? ` ${cents > 0 ? "+" : ""}${cents}¢` : ""}`, mx, my - Math.min(r.w, r.h) * 0.34);
        ctx.globalCompositeOperation = "lighter";
      }
    }

    // Backing-track beat light at the top-left of the grid.
    if (this.param("track", 0) >= 0.5) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(255, 138, 61, ${0.35 + this.beatFlash * 0.65})`;
      ctx.beginPath();
      ctx.arc(10 * dpr, this.rect.top * H - 8 * dpr, (4 + this.beatFlash * 3) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
