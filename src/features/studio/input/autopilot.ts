import { createRandom } from "@/lib/math";
import type { ControlInput, ControlPoint } from "@/types/instruments";

/**
 * Deterministic, gentle "performer" used for live instrument previews and the
 * home hero. It drives the real instrument engines through the same input
 * contract as touch and hands, so previews are genuine renderings.
 */
export class Autopilot {
  private time = 0;
  private nextEvent: number;
  private readonly random: () => number;
  private readonly point: ControlPoint = {
    id: "auto",
    source: "auto",
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    speed: 0,
    amount: 0.5,
    engaged: true,
    lifted: false,
  };
  private readonly input: ControlInput = { points: [], spread: null, bodySpread: null, events: [] };
  /** Optional external attractor (e.g. pointer hover on the home hero). */
  private attractor: { x: number; y: number } | null = null;

  constructor(
    seed: number,
    private readonly options: { draw: boolean; events: boolean } = { draw: true, events: true },
  ) {
    this.random = createRandom(seed);
    this.nextEvent = 1.5 + this.random() * 2;
  }

  setAttractor(point: { x: number; y: number } | null): void {
    this.attractor = point;
  }

  next(dt: number): ControlInput {
    this.time += dt;
    const t = this.time;
    let x = 0.5 + 0.32 * Math.sin(t * 0.53) * Math.cos(t * 0.21);
    let y = 0.5 + 0.26 * Math.sin(t * 0.37 + 1.3);
    if (this.attractor) {
      x = x * 0.4 + this.attractor.x * 0.6;
      y = y * 0.4 + this.attractor.y * 0.6;
    }
    const p = this.point;
    p.velocity.x = (x - p.position.x) / Math.max(dt, 1e-3);
    p.velocity.y = (y - p.position.y) / Math.max(dt, 1e-3);
    p.speed = Math.hypot(p.velocity.x, p.velocity.y);
    p.position.x = x;
    p.position.y = y;
    p.amount = 0.45 + 0.35 * Math.sin(t * 0.8);
    // Lift the "brush" periodically so drawing instruments produce separate strokes.
    const drawing = this.options.draw && Math.sin(t * 0.45) > -0.35;
    p.engaged = drawing;

    this.input.points = drawing || !this.options.draw ? [p] : [];
    this.input.spread = 0.3 + 0.2 * Math.sin(t * 0.29);
    this.input.events = [];
    if (this.options.events && t > this.nextEvent) {
      this.nextEvent = t + 2.2 + this.random() * 2.5;
      this.input.events.push({ type: "tap", position: { x, y }, source: "auto" });
    }
    return this.input;
  }
}
