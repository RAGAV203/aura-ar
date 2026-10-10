import { clamp01 } from "@/lib/math";
import type { ControlEvent, ControlPoint } from "@/types/instruments";

const SPEED = 0.45; // normalised units per second

/**
 * Keyboard alternative for people who can't use touch or gestures:
 * arrow keys move and draw, Enter triggers a tap (bloom / plant / splash),
 * Shift+Enter triggers the accent (colour shift / pulse).
 */
export class KeyboardInput {
  private held = new Set<string>();
  private events: ControlEvent[] = [];
  private readonly point: ControlPoint = {
    id: "keyboard",
    source: "touch",
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    speed: 0,
    amount: 0.5,
    engaged: true,
    lifted: false,
  };

  /** Returns true when the key was handled. */
  keyDown(key: string, shift: boolean): boolean {
    if (key.startsWith("Arrow")) {
      this.held.add(key);
      return true;
    }
    if (key === "Enter") {
      this.events.push({ type: shift ? "accent" : "tap", position: { ...this.point.position }, source: "touch" });
      return true;
    }
    return false;
  }

  keyUp(key: string): void {
    this.held.delete(key);
  }

  reset(): void {
    this.held.clear();
    this.events = [];
  }

  tick(dt: number): ControlPoint | null {
    if (this.held.size === 0) {
      this.point.velocity.x = this.point.velocity.y = this.point.speed = 0;
      return null;
    }
    const dx = (this.held.has("ArrowRight") ? 1 : 0) - (this.held.has("ArrowLeft") ? 1 : 0);
    const dy = (this.held.has("ArrowDown") ? 1 : 0) - (this.held.has("ArrowUp") ? 1 : 0);
    this.point.velocity.x = dx * SPEED;
    this.point.velocity.y = dy * SPEED;
    this.point.speed = Math.hypot(this.point.velocity.x, this.point.velocity.y);
    this.point.position.x = clamp01(this.point.position.x + this.point.velocity.x * dt);
    this.point.position.y = clamp01(this.point.position.y + this.point.velocity.y * dt);
    return this.point;
  }

  drainEvents(): ControlEvent[] {
    if (this.events.length === 0) return this.events;
    const events = this.events;
    this.events = [];
    return events;
  }
}
