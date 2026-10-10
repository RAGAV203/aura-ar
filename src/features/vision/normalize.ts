import { clamp01 } from "@/lib/math";
import type { Handedness, Landmark, TrackedHand, TrackedPose } from "@/types/gestures";

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface RawCategory {
  categoryName: string;
  score: number;
}

/** MediaPipe hand landmark indices used by the interpreter. */
export const HAND = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringPip: 14,
  ringTip: 16,
  pinkyPip: 18,
  pinkyTip: 20,
} as const;

export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
} as const;

/**
 * Converts model-space landmarks into Aura's normalised, mirrored space.
 * MediaPipe already returns coordinates in 0..1 relative to the input image,
 * so the result is independent of camera resolution. Mirroring makes the
 * artwork respond like a mirror, which is what people expect from a selfie
 * camera.
 */
export function normalizeLandmarks(raw: readonly RawLandmark[], mirrored: boolean): Landmark[] {
  return raw.map((point) => ({
    x: clamp01(mirrored ? 1 - point.x : point.x),
    y: clamp01(point.y),
    z: Number.isFinite(point.z) ? point.z : 0,
  }));
}

/**
 * MediaPipe labels handedness assuming a mirrored image. When we mirror the
 * coordinates ourselves the labels already match the user's real hands.
 */
export function normalizeHandedness(category: RawCategory | undefined, mirrored: boolean): Handedness {
  const label = category?.categoryName?.toLowerCase() === "left" ? "left" : "right";
  if (mirrored) return label;
  return label === "left" ? "right" : "left";
}

export function normalizeHands(
  landmarks: readonly (readonly RawLandmark[])[],
  handedness: readonly (readonly RawCategory[])[],
  mirrored: boolean,
): TrackedHand[] {
  const hands: TrackedHand[] = [];
  landmarks.forEach((points, index) => {
    if (points.length !== 21) return;
    const category = handedness[index]?.[0];
    hands.push({
      handedness: normalizeHandedness(category, mirrored),
      score: clamp01(category?.score ?? 0),
      landmarks: normalizeLandmarks(points, mirrored),
    });
  });
  return dedupeHandedness(hands);
}

/**
 * The model occasionally labels both hands the same. Keep the more confident
 * label and assign the other hand the opposite one so each hand keeps a
 * stable identity for smoothing.
 */
export function dedupeHandedness(hands: TrackedHand[]): TrackedHand[] {
  if (hands.length !== 2) return hands;
  const [a, b] = hands as [TrackedHand, TrackedHand];
  if (a.handedness !== b.handedness) return hands;
  const [high, low] = a.score >= b.score ? [a, b] : [b, a];
  // Fall back to horizontal position: the hand further right on screen is the user's right.
  const lowLabel: Handedness = high.handedness === "left" ? "right" : "left";
  return [high, { ...low, handedness: lowLabel }];
}

export function normalizePose(raw: readonly RawLandmark[] | undefined, mirrored: boolean): TrackedPose | null {
  if (!raw || raw.length < 33) return null;
  const visibility = raw.reduce((sum, p) => sum + (p.visibility ?? 0), 0) / raw.length;
  return { landmarks: normalizeLandmarks(raw, mirrored), visibility: clamp01(visibility) };
}
