import type { ControlPoint } from "@/types/instruments";

export interface Strike {
  id: string;
  x: number;
  y: number;
  /** 0..1 from the peak downward speed of the stroke. */
  velocity: number;
}

interface Stick {
  peakDown: number;
  lastHit: number;
}

/**
 * Detects air-drum strikes from tracked hands: a fast downward stroke
 * followed by the "bounce" (the hand slowing or turning back up). The hit
 * lands where the bounce happens — the bottom of the stroke — like a stick
 * meeting a drum head. Pure apart from the timestamps it is given.
 */
export class StrikeDetector {
  private sticks = new Map<string, Stick>();

  constructor(
    /** Minimum downward speed (normalised units per second). */
    private readonly threshold = 0.9,
    private readonly cooldownSeconds = 0.09,
  ) {}

  update(points: readonly ControlPoint[], time: number, sensitivity = 1): Strike[] {
    const strikes: Strike[] = [];
    const seen = new Set<string>();
    const threshold = this.threshold * sensitivity;
    for (const point of points) {
      if (point.source !== "hand") continue;
      seen.add(point.id);
      let stick = this.sticks.get(point.id);
      if (!stick) {
        stick = { peakDown: 0, lastHit: -Infinity };
        this.sticks.set(point.id, stick);
      }
      const down = point.velocity.y;
      if (down > threshold) {
        stick.peakDown = Math.max(stick.peakDown, down);
      } else if (stick.peakDown > 0 && down < threshold * 0.35) {
        if (time - stick.lastHit > this.cooldownSeconds) {
          strikes.push({ id: point.id, x: point.position.x, y: point.position.y, velocity: Math.min(1, 0.35 + Math.min(stick.peakDown, 4) * 0.16) });
          stick.lastHit = time;
        }
        stick.peakDown = 0;
      }
    }
    for (const id of this.sticks.keys()) if (!seen.has(id)) this.sticks.delete(id);
    return strikes;
  }

  reset(): void {
    this.sticks.clear();
  }
}
