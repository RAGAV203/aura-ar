import type { QualityLevel } from "@/types/instruments";

export type PerformanceMode = "auto" | QualityLevel;

const ORDER: QualityLevel[] = ["battery", "balanced", "high"];

/** Battery saver also caps the render rate. */
export const FRAME_INTERVAL_MS: Record<QualityLevel, number> = { high: 0, balanced: 0, battery: 1000 / 30 };

export interface QualitySample {
  fps: number;
  quality: QualityLevel;
}

/**
 * Measures rendering FPS and, in "auto" mode, steps quality down after
 * sustained frame drops (and cautiously back up after sustained headroom).
 * Pure apart from the timestamps it is fed, so it is unit-testable.
 */
export class QualityController {
  private quality: QualityLevel;
  private frames = 0;
  private windowStart: number | null = null;
  private lowWindows = 0;
  private highWindows = 0;
  private fps = 60;
  private listeners = new Set<(quality: QualityLevel) => void>();

  constructor(
    private mode: PerformanceMode,
    private readonly ceiling: QualityLevel,
    private readonly windowMs = 1000,
  ) {
    this.quality = mode === "auto" ? ceiling : mode;
  }

  setMode(mode: PerformanceMode): void {
    this.mode = mode;
    this.lowWindows = this.highWindows = 0;
    this.set(mode === "auto" ? this.ceiling : mode);
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  getFps(): number {
    return this.fps;
  }

  onChange(listener: (quality: QualityLevel) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call once per rendered frame. */
  tick(now: number): void {
    if (this.windowStart === null) {
      this.windowStart = now;
      this.frames = 0;
      return;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return;
    this.fps = (this.frames * 1000) / elapsed;
    this.windowStart = now;
    this.frames = 0;
    if (this.mode !== "auto") return;

    const target = this.quality === "battery" ? 27 : 45;
    if (this.fps < target * 0.62 || (this.quality !== "battery" && this.fps < 28)) {
      this.lowWindows++;
      this.highWindows = 0;
    } else if (this.fps > 56) {
      this.highWindows++;
      this.lowWindows = 0;
    } else {
      this.lowWindows = Math.max(0, this.lowWindows - 1);
      this.highWindows = 0;
    }

    if (this.lowWindows >= 3) {
      this.lowWindows = 0;
      this.step(-1);
    } else if (this.highWindows >= 12) {
      this.highWindows = 0;
      this.step(1);
    }
  }

  /** Resets the measurement window, e.g. after the tab was hidden. */
  resetWindow(): void {
    this.windowStart = null;
    this.frames = 0;
  }

  private step(direction: 1 | -1): void {
    const index = ORDER.indexOf(this.quality) + direction;
    const ceilingIndex = ORDER.indexOf(this.ceiling);
    const next = ORDER[Math.max(0, Math.min(index, ceilingIndex))];
    if (next) this.set(next);
  }

  private set(quality: QualityLevel): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.listeners.forEach((l) => l(quality));
  }
}
