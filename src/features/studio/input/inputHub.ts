import { IDENTITY_TRANSFORM, type ViewTransform } from "@/lib/browser/viewTransform";
import type { GestureState } from "@/types/gestures";
import type { ControlInput } from "@/types/instruments";
import { gestureToControlEvents, gestureToControlPoints, viewSpread } from "./gestureControls";
import { KeyboardInput } from "./keyboardInput";
import { TouchInput } from "./touchInput";

/**
 * Merges touch, keyboard and gesture input into the single ControlInput
 * snapshot the instrument reads each frame. Gesture state arrives
 * asynchronously from the vision engine; its events are queued until the next
 * frame consumes them.
 */
export class InputHub {
  readonly touch = new TouchInput();
  readonly keyboard = new KeyboardInput();
  private gesture: GestureState | null = null;
  private pendingGestureEvents: ControlInput["events"] = [];
  private view: ViewTransform = IDENTITY_TRANSFORM;
  private readonly snapshot: ControlInput = { points: [], spread: null, bodySpread: null, events: [] };

  /** How camera-frame coordinates map onto the visible artwork (see viewTransform.ts). */
  setViewTransform(view: ViewTransform): void {
    this.view = view;
  }

  getViewTransform(): ViewTransform {
    return this.view;
  }

  pushGesture(state: GestureState): void {
    this.gesture = state;
    if (state.events.length > 0) this.pendingGestureEvents.push(...gestureToControlEvents(state, this.view));
  }

  clearGesture(): void {
    this.gesture = null;
    this.pendingGestureEvents = [];
  }

  collect(dt: number, now: number): ControlInput {
    this.touch.tick(dt, now);
    const keyPoint = this.keyboard.tick(dt);
    const handPoints = this.gesture ? gestureToControlPoints(this.gesture, this.view) : [];
    const points = this.touch.points;
    if (keyPoint) points.push(keyPoint);
    points.push(...handPoints);
    this.snapshot.points = points;
    this.snapshot.spread = this.touch.spread ?? (this.gesture ? viewSpread(this.gesture, this.view) : null);
    this.snapshot.bodySpread = this.gesture?.bodySpread ?? null;
    const touchEvents = this.touch.drainEvents();
    const keyEvents = this.keyboard.drainEvents();
    this.snapshot.events =
      touchEvents.length + keyEvents.length + this.pendingGestureEvents.length > 0 ? [...touchEvents, ...keyEvents, ...this.pendingGestureEvents] : [];
    this.pendingGestureEvents = [];
    return this.snapshot;
  }

  reset(): void {
    this.touch.reset();
    this.keyboard.reset();
    this.clearGesture();
  }
}
