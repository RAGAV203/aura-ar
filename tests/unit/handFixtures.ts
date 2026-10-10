import type { Landmark, TrackedHand, TrackingFrame } from "@/types/gestures";

/**
 * Builds a synthetic 21-point hand in normalised coordinates. The hand is
 * upright with the wrist at (cx, cy + 0.15). `pinch` moves the thumb tip
 * toward the index tip; `open` extends all fingers (open palm) versus curled.
 */
export function makeHand(options: { cx?: number; cy?: number; pinch?: boolean; open?: boolean; handedness?: "left" | "right"; score?: number } = {}): TrackedHand {
  const { cx = 0.5, cy = 0.5, pinch = false, open = false, handedness = "right", score = 0.95 } = options;
  const points: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const set = (i: number, x: number, y: number) => (points[i] = { x: cx + x, y: cy + y, z: 0 });

  set(0, 0, 0.15); // wrist
  set(9, 0, 0.05); // middle MCP → hand size 0.10
  // Finger PIP joints
  set(6, -0.03, 0.0);
  set(10, 0, -0.01);
  set(14, 0.025, 0.0);
  set(18, 0.05, 0.02);
  set(5, -0.03, 0.05);
  // Fingertips: far from wrist when open, curled back near PIP otherwise
  const reach = open ? -0.08 : 0.04;
  set(8, -0.035, reach); // index tip
  set(12, 0, reach - 0.01);
  set(16, 0.03, reach);
  set(20, 0.055, reach + 0.02);
  // Thumb tip: touching index tip when pinching, wide otherwise
  if (pinch) set(4, -0.033, reach + 0.01);
  else set(4, -0.11, 0.06);
  return { handedness, score, landmarks: points };
}

export function frame(timestamp: number, hands: TrackedHand[]): TrackingFrame {
  return { timestamp, hands, pose: null, inferenceMs: 5 };
}
