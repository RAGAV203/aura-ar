import { applyTransform, IDENTITY_TRANSFORM, type ViewTransform } from "@/lib/browser/viewTransform";
import type { GestureState } from "@/types/gestures";
import type { ControlEvent, ControlPoint } from "@/types/instruments";

/**
 * Maps semantic gesture state to the same control vocabulary touch produces:
 *
 *   index fingertip position  → point position
 *   pinch openness            → point amount (brush size, particle size…)
 *   pinch held                → engaged
 *   open palm held            → lifted (brush up / pause drawing)
 *   pinch start               → "tap" event
 *   open palm start           → "accent" event (colour shift, pulse…)
 *
 * Open palm is deliberately non-destructive: it only pauses drawing or shifts
 * colour, so a false detection can never delete or navigate.
 *
 * `view` maps camera-frame coordinates to the visible area when the camera
 * is shown cropped behind the artwork, so marks land on the fingertip.
 */
export function gestureToControlPoints(state: GestureState, view: ViewTransform = IDENTITY_TRANSFORM): ControlPoint[] {
  if (state.status !== "tracking") return [];
  return state.hands
    .filter((hand) => hand.stable)
    .map((hand) => ({
      id: `hand-${hand.handedness}`,
      source: "hand" as const,
      position: applyTransform(hand.position, view),
      velocity: { x: hand.velocity.x * view.scaleX, y: hand.velocity.y * view.scaleY },
      speed: Math.hypot(hand.velocity.x * view.scaleX, hand.velocity.y * view.scaleY),
      amount: hand.pinchOpenness,
      engaged: hand.isPinching,
      lifted: hand.isOpenPalm,
    }));
}

export function gestureToControlEvents(state: GestureState, view: ViewTransform = IDENTITY_TRANSFORM): ControlEvent[] {
  const events: ControlEvent[] = [];
  for (const event of state.events) {
    if (event.type === "pinch-start") events.push({ type: "tap", position: applyTransform(event.position, view), source: "hand" });
    else if (event.type === "palm-open") events.push({ type: "accent", position: applyTransform(event.position, view), source: "hand" });
  }
  return events;
}

/** Two-hand distance in view space (it scales with the crop). */
export function viewSpread(state: GestureState, view: ViewTransform = IDENTITY_TRANSFORM): number | null {
  const [a, b] = state.hands;
  if (state.status !== "tracking" || !a || !b) return null;
  return Math.hypot((a.position.x - b.position.x) * view.scaleX, (a.position.y - b.position.y) * view.scaleY);
}
