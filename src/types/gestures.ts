/**
 * Types shared between the vision engine, the gesture interpreter and the
 * instrument engine. All coordinates are normalised to the 0..1 range in the
 * user's mirrored ("selfie") view, independent of camera resolution.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface Landmark extends Point2 {
  /** Relative depth as reported by the model; smaller is closer. */
  z: number;
}

export type Handedness = "left" | "right";

/** A single hand as published by the vision engine (already normalised). */
export interface TrackedHand {
  handedness: Handedness;
  /** Model confidence for the handedness classification, 0..1. */
  score: number;
  /** 21 landmarks in MediaPipe hand topology. */
  landmarks: Landmark[];
}

export interface TrackedPose {
  /** 33 landmarks in MediaPipe pose topology. */
  landmarks: Landmark[];
  /** Mean landmark visibility, 0..1. */
  visibility: number;
}

/** One processed camera frame. Raw pixels never leave the vision engine. */
export interface TrackingFrame {
  timestamp: number;
  hands: TrackedHand[];
  pose: TrackedPose | null;
  /** Duration of the inference call in milliseconds (diagnostics only). */
  inferenceMs: number;
}

export type TrackingStatus = "inactive" | "acquiring" | "tracking" | "lost";

/** Semantic, smoothed state for one hand produced by the gesture interpreter. */
export interface HandGesture {
  handedness: Handedness;
  /** Smoothed index-fingertip position. */
  position: Point2;
  /** Velocity in normalised units per second. */
  velocity: Point2;
  speed: number;
  /** Continuous pinch openness: 0 = fingertips touching, 1 = wide open. */
  pinchOpenness: number;
  /** Binary pinch with hysteresis applied. */
  isPinching: boolean;
  /** Open palm, only true after being held for the configured duration. */
  isOpenPalm: boolean;
  /** True once the hand has been tracked continuously long enough to act on. */
  stable: boolean;
}

export type GestureEventType = "pinch-start" | "pinch-end" | "palm-open" | "palm-close";

export interface GestureEvent {
  type: GestureEventType;
  handedness: Handedness;
  position: Point2;
  timestamp: number;
}

export interface GestureState {
  status: TrackingStatus;
  hands: HandGesture[];
  /** Distance between both hands (normalised, 0..~1.4) or null with fewer than two. */
  twoHandDistance: number | null;
  /** Upper-body openness derived from pose (0..1) or null when pose is off. */
  bodySpread: number | null;
  events: GestureEvent[];
}

export interface GestureConfig {
  /** 0..1 user-facing sensitivity; higher = more responsive, less smoothing. */
  sensitivity: number;
  /** Pinch engages below this normalised ratio... */
  pinchOnRatio: number;
  /** ...and releases above this one (hysteresis). */
  pinchOffRatio: number;
  /** Time a hand must be tracked before it produces gestures. */
  stableAfterMs: number;
  /** Time without detection before tracking is considered lost. */
  lostAfterMs: number;
  /** Open palm must be held this long before it counts. */
  palmHoldMs: number;
  /** Minimum time between discrete events of the same type per hand. */
  eventCooldownMs: number;
  /** Optional preference to ignore one hand. */
  handedness: "both" | Handedness;
}
