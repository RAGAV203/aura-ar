import { createRandom } from "@/lib/math";
import type {
  AudioNoteEvent,
  AudioTargets,
  ControlInput,
  InstrumentEngine,
  InstrumentId,
  InstrumentParameters,
  QualityLevel,
  VoiceCommand,
  VoiceKind,
} from "@/types/instruments";
import { SILENT_TARGETS } from "@/features/audio/audioMath";

export const QUALITY_BUDGET: Record<QualityLevel, number> = { high: 1, balanced: 0.6, battery: 0.3 };

/** Page background; artwork canvases are transparent and sit on top of it (or the camera). */
export const BACKGROUND = "#080914";

const UNDO_LIMIT = 6;
/**
 * Fades smaller than this are accumulated and applied in one step. 8-bit
 * alpha rounding means tiny per-frame fades never reach zero and leave ghost
 * trails, which are very visible over the camera backdrop.
 */
const MIN_FADE_STEP = 0.06;

const EMPTY_INPUT: ControlInput = { points: [], spread: null, bodySpread: null, events: [] };

/**
 * Shared plumbing for Canvas 2D instruments: sizing, parameters, quality,
 * seeded randomness, the note queue, transparent fading, undo and the eraser.
 * Subclasses implement `step` and `draw`; all per-frame state lives in plain
 * fields and typed arrays, never in React state.
 */
export abstract class CanvasInstrument implements InstrumentEngine {
  abstract readonly id: InstrumentId;
  protected readonly ctx: CanvasRenderingContext2D;
  /**
   * Where persistent marks are painted. Defaults to the visible canvas; an
   * instrument can call useOffscreenLayer() so transient effects (sparks)
   * are composited on top each frame instead of smearing into the artwork.
   */
  protected paint: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;
  protected width = 1;
  protected height = 1;
  protected pixelRatio = 1;
  protected params: InstrumentParameters;
  protected quality: QualityLevel = "balanced";
  protected reducedMotion = false;
  protected time = 0;
  protected random: () => number;
  protected targets: AudioTargets = { ...SILENT_TARGETS };
  private notes: AudioNoteEvent[] = [];
  private voiceCommands: VoiceCommand[] = [];
  private retained = 1;
  private undoStack: HTMLCanvasElement[] = [];
  private strokeActive = false;
  private eraser = false;
  private eraserSize = 28;
  private eraserTrail = new Map<string, { x: number; y: number }>();

  constructor(
    protected readonly canvas: HTMLCanvasElement,
    parameters: InstrumentParameters,
    protected readonly seed: number,
  ) {
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.paint = ctx;
    this.params = { ...parameters };
    this.random = createRandom(seed);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    const changed = w !== this.canvas.width || h !== this.canvas.height;
    const paintCanvas = this.paint.canvas;
    let previous: HTMLCanvasElement | null = null;
    if (changed && this.isPersistent() && paintCanvas.width > 1) previous = copyCanvas(paintCanvas);
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.layer) {
        this.layer.width = w;
        this.layer.height = h;
      }
      this.clear();
      if (previous) this.paint.drawImage(previous, 0, 0, w, h);
      // Undo snapshots no longer match the canvas size.
      this.dropUndo();
    }
    this.onResize();
  }

  protected useOffscreenLayer(): void {
    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    this.layer = layer;
    this.paint = ctx;
  }

  /** Copies the persistent paint layer onto the visible canvas. */
  protected presentLayer(): void {
    if (!this.layer) return;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = "copy";
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.layer, 0, 0);
    this.ctx.restore();
  }

  setParameters(parameters: InstrumentParameters): void {
    this.params = { ...this.params, ...parameters };
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.onQualityChange();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  frame(dt: number, input: ControlInput): void {
    const step = Math.min(dt, 1 / 20) * (this.reducedMotion ? 0.5 : 1);
    this.time += step;

    // A new stroke (or tap) on a persistent canvas starts a new undo step.
    const drawing = input.points.some((p) => !p.lifted);
    if (this.isPersistent() && ((drawing && !this.strokeActive) || (!drawing && input.events.length > 0))) this.pushUndo();
    this.strokeActive = drawing;

    if (this.eraser && this.isPersistent()) {
      this.erase(input);
      this.step(step, EMPTY_INPUT);
    } else {
      this.eraserTrail.clear();
      this.step(step, input);
    }
    this.draw();
  }

  audioTargets(): AudioTargets {
    return this.targets;
  }

  drainNotes(): AudioNoteEvent[] {
    if (this.notes.length === 0) return this.notes;
    const notes = this.notes;
    this.notes = [];
    return notes;
  }

  /** Sustained-voice commands queued since the last frame (never dropped: on/off must pair up). */
  drainVoiceCommands(): VoiceCommand[] {
    if (this.voiceCommands.length === 0) return this.voiceCommands;
    const commands = this.voiceCommands;
    this.voiceCommands = [];
    return commands;
  }

  protected voiceOn(id: string, kind: VoiceKind, midi: number, velocity: number, pan: number): void {
    this.voiceCommands.push({ type: "on", id, kind, midi, velocity, pan });
  }

  protected voiceUpdate(id: string, update: { midi?: number; expression?: number; pan?: number; glideMs?: number }): void {
    this.voiceCommands.push({ type: "update", id, ...update });
  }

  protected voiceOff(id: string, releaseSeconds?: number): void {
    this.voiceCommands.push({ type: "off", id, releaseSeconds });
  }

  protected allVoicesOff(): void {
    this.voiceCommands = [{ type: "all-off" }];
  }

  reset(): void {
    this.allVoicesOff();
    if (this.isPersistent()) this.pushUndo();
    this.time = 0;
    this.random = createRandom(this.seed);
    this.clear();
    this.onReset();
  }

  serializeState(): Record<string, unknown> {
    return {};
  }

  restoreState(_state: Record<string, unknown>): void {}

  restoreSnapshot(image: CanvasImageSource): void {
    const ctx = this.paint;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /* ---------- Tools ---------- */

  get supportsUndo(): boolean {
    return this.isPersistent();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    const ctx = this.paint;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;
    ctx.drawImage(snapshot, 0, 0);
    ctx.restore();
    snapshot.width = snapshot.height = 1;
    this.retained = 1;
    // In-flight particles belong to the undone stroke; don't let them repaint it.
    this.onUndo();
    return true;
  }

  get supportsEraser(): boolean {
    return this.isPersistent();
  }

  setEraser(enabled: boolean, size = 28): void {
    this.eraser = enabled;
    this.eraserSize = size;
  }

  dispose(): void {
    this.notes = [];
    this.voiceCommands = [];
    this.dropUndo();
    // Release the backing store promptly on memory-constrained phones.
    this.canvas.width = 1;
    this.canvas.height = 1;
    if (this.layer) this.layer.width = this.layer.height = 1;
    this.layer = null;
  }

  protected emit(note: AudioNoteEvent): void {
    if (this.notes.length < 8) this.notes.push(note);
  }

  protected clear(): void {
    for (const ctx of this.paint === this.ctx ? [this.ctx] : [this.ctx, this.paint]) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
    this.retained = 1;
  }

  /** Fades the paint layer toward transparent by `amount` (0..1 of the current alpha). */
  protected fade(amount: number): void {
    if (amount <= 0) return;
    this.retained *= 1 - Math.min(1, amount);
    const total = 1 - this.retained;
    if (total < MIN_FADE_STEP) return;
    const ctx = this.paint;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = total;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    this.retained = 1;
  }

  protected get budget(): number {
    return QUALITY_BUDGET[this.quality];
  }

  protected param(key: string, fallback = 0): number {
    return this.params[key] ?? fallback;
  }

  /** Whether marks accumulate (enables resize preservation, undo, eraser and snapshots). */
  protected isPersistent(): boolean {
    return false;
  }

  protected onResize(): void {}
  protected onQualityChange(): void {}
  protected onReset(): void {}
  protected onUndo(): void {}
  /** Lets instruments drop in-flight particles under the eraser (device pixels). */
  protected onErase(_x: number, _y: number, _radius: number): void {}
  protected abstract step(dt: number, input: ControlInput): void;
  protected abstract draw(): void;

  private pushUndo(): void {
    if (this.paint.canvas.width <= 1) return;
    this.undoStack.push(copyCanvas(this.paint.canvas));
    while (this.undoStack.length > UNDO_LIMIT) {
      const old = this.undoStack.shift();
      if (old) old.width = old.height = 1;
    }
  }

  private dropUndo(): void {
    for (const snapshot of this.undoStack) snapshot.width = snapshot.height = 1;
    this.undoStack = [];
  }

  private erase(input: ControlInput): void {
    const ctx = this.paint;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const seen = new Set<string>();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#000";
    for (const point of input.points) {
      if (point.lifted) continue;
      seen.add(point.id);
      const x = point.position.x * W;
      const y = point.position.y * H;
      const size = this.eraserSize * this.pixelRatio * (point.source === "hand" ? 0.5 + point.amount : 1);
      const previous = this.eraserTrail.get(point.id);
      if (previous) {
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      this.eraserTrail.set(point.id, { x, y });
      this.onErase(x, y, size / 2);
    }
    ctx.restore();
    for (const id of this.eraserTrail.keys()) if (!seen.has(id)) this.eraserTrail.delete(id);
  }
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

/** Pre-renders a soft radial glow sprite, much cheaper than shadowBlur per particle. */
export function createGlowSprite(size = 64): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return sprite;
}

/** Tints a white sprite once per hue bucket; cached so it never allocates per frame. */
export class TintedSprites {
  private cache = new Map<number, HTMLCanvasElement>();
  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly buckets = 36,
  ) {}

  get(hue: number, lightness = 65): HTMLCanvasElement {
    const bucket = Math.round((((hue % 360) + 360) % 360) / (360 / this.buckets)) % this.buckets;
    const key = bucket * 1000 + lightness;
    let sprite = this.cache.get(key);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = this.base.width;
      sprite.height = this.base.height;
      const ctx = sprite.getContext("2d");
      if (ctx) {
        ctx.drawImage(this.base, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = `hsl(${bucket * (360 / this.buckets)}, 95%, ${lightness}%)`;
        ctx.fillRect(0, 0, sprite.width, sprite.height);
      }
      this.cache.set(key, sprite);
    }
    return sprite;
  }

  clear(): void {
    this.cache.clear();
  }
}
