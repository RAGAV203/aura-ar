import { clamp01, damp, distance, lerp } from "@/lib/math";
import type {
  GestureConfig,
  GestureEvent,
  GestureEventType,
  GestureState,
  HandGesture,
  Handedness,
  Landmark,
  TrackedHand,
  TrackedPose,
  TrackingFrame,
  TrackingStatus,
} from "@/types/gestures";
import { HAND, POSE } from "./normalize";
import { OneEuroFilter } from "./oneEuroFilter";

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  sensitivity: 0.5,
  pinchOnRatio: 0.32,
  pinchOffRatio: 0.48,
  stableAfterMs: 160,
  lostAfterMs: 350,
  palmHoldMs: 450,
  eventCooldownMs: 350,
  handedness: "both",
};

const PINCH_RATIO_MIN = 0.12;
const PINCH_RATIO_MAX = 1.1;

class HandTracker {
  firstSeen: number;
  lastSeen: number;
  readonly filterX = new OneEuroFilter();
  readonly filterY = new OneEuroFilter();
  readonly pinchFilter = new OneEuroFilter(2, 0.01);
  position = { x: 0.5, y: 0.5 };
  velocity = { x: 0, y: 0 };
  pinchOpenness = 1;
  isPinching = false;
  palmCandidateSince: number | null = null;
  isOpenPalm = false;
  lastEventAt: Partial<Record<GestureEventType, number>> = {};
  private lastUpdate: number;

  constructor(
    readonly handedness: Handedness,
    now: number,
  ) {
    this.firstSeen = now;
    this.lastSeen = now;
    this.lastUpdate = now;
  }

  update(landmarks: Landmark[], now: number, config: GestureConfig): GestureEventType[] {
    const minCutoff = lerp(0.6, 3.2, config.sensitivity);
    const beta = lerp(0.004, 0.06, config.sensitivity);
    this.filterX.configure(minCutoff, beta);
    this.filterY.configure(minCutoff, beta);

    const tip = landmarks[HAND.indexTip];
    if (!tip) return [];
    const x = this.filterX.filter(tip.x, now);
    const y = this.filterY.filter(tip.y, now);
    const dt = Math.max((now - this.lastUpdate) / 1000, 1 / 240);
    if (now > this.firstSeen) {
      this.velocity.x = damp(this.velocity.x, (x - this.position.x) / dt, 18, dt);
      this.velocity.y = damp(this.velocity.y, (y - this.position.y) / dt, 18, dt);
    }
    this.position = { x, y };
    this.lastUpdate = now;
    this.lastSeen = now;

    const ratio = this.pinchFilter.filter(pinchRatio(landmarks), now);
    this.pinchOpenness = clamp01((ratio - PINCH_RATIO_MIN) / (PINCH_RATIO_MAX - PINCH_RATIO_MIN));

    const events: GestureEventType[] = [];
    if (!this.isPinching && ratio < config.pinchOnRatio) {
      this.isPinching = true;
      events.push("pinch-start");
    } else if (this.isPinching && ratio > config.pinchOffRatio) {
      this.isPinching = false;
      events.push("pinch-end");
    }

    const extended = !this.isPinching && fingersExtended(landmarks);
    if (extended) {
      this.palmCandidateSince ??= now;
      if (!this.isOpenPalm && now - this.palmCandidateSince >= config.palmHoldMs) {
        this.isOpenPalm = true;
        events.push("palm-open");
      }
    } else {
      this.palmCandidateSince = null;
      if (this.isOpenPalm) {
        this.isOpenPalm = false;
        events.push("palm-close");
      }
    }
    return events;
  }

  isStable(now: number, config: GestureConfig): boolean {
    return now - this.firstSeen >= config.stableAfterMs;
  }

  /** Called on frames where the hand is momentarily missing. */
  coast(dt: number): void {
    this.velocity.x = damp(this.velocity.x, 0, 12, dt);
    this.velocity.y = damp(this.velocity.y, 0, 12, dt);
  }

  snapshot(now: number, config: GestureConfig): HandGesture {
    return {
      handedness: this.handedness,
      position: { ...this.position },
      velocity: { ...this.velocity },
      speed: Math.hypot(this.velocity.x, this.velocity.y),
      pinchOpenness: this.pinchOpenness,
      isPinching: this.isPinching,
      isOpenPalm: this.isOpenPalm,
      stable: this.isStable(now, config),
    };
  }
}

/** Thumb–index distance relative to hand size, so it's independent of distance to camera. */
export function pinchRatio(landmarks: Landmark[]): number {
  const thumb = landmarks[HAND.thumbTip];
  const index = landmarks[HAND.indexTip];
  const wrist = landmarks[HAND.wrist];
  const middleMcp = landmarks[HAND.middleMcp];
  if (!thumb || !index || !wrist || !middleMcp) return 1;
  const handSize = distance(wrist.x, wrist.y, middleMcp.x, middleMcp.y);
  if (handSize < 1e-4) return 1;
  return distance(thumb.x, thumb.y, index.x, index.y) / handSize;
}

/** True when index, middle, ring and pinky fingertips are clearly further from the wrist than their PIP joints. */
export function fingersExtended(landmarks: Landmark[]): boolean {
  const wrist = landmarks[HAND.wrist];
  if (!wrist) return false;
  const pairs: Array<[number, number]> = [
    [HAND.indexTip, HAND.indexPip],
    [HAND.middleTip, HAND.middlePip],
    [HAND.ringTip, HAND.ringPip],
    [HAND.pinkyTip, HAND.pinkyPip],
  ];
  return pairs.every(([tipIndex, pipIndex]) => {
    const tip = landmarks[tipIndex];
    const pip = landmarks[pipIndex];
    if (!tip || !pip) return false;
    return distance(tip.x, tip.y, wrist.x, wrist.y) > distance(pip.x, pip.y, wrist.x, wrist.y) * 1.18;
  });
}

export function poseSpread(pose: TrackedPose): number | null {
  const ls = pose.landmarks[POSE.leftShoulder];
  const rs = pose.landmarks[POSE.rightShoulder];
  const lw = pose.landmarks[POSE.leftWrist];
  const rw = pose.landmarks[POSE.rightWrist];
  if (!ls || !rs || !lw || !rw || pose.visibility < 0.3) return null;
  const shoulders = distance(ls.x, ls.y, rs.x, rs.y);
  if (shoulders < 1e-3) return null;
  return clamp01((distance(lw.x, lw.y, rw.x, rw.y) / shoulders - 0.8) / 3);
}

/**
 * Converts noisy per-frame tracking data into smoothed semantic gesture state.
 * Pure and deterministic given timestamps, which makes it unit-testable.
 */
export class GestureInterpreter {
  private trackers = new Map<Handedness, HandTracker>();
  private config: GestureConfig;
  private everTracked = false;
  private active = false;
  private lastFrameTime: number | null = null;
  private smoothedBodySpread: number | null = null;

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  configure(config: Partial<GestureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): GestureConfig {
    return this.config;
  }

  reset(): void {
    this.trackers.clear();
    this.everTracked = false;
    this.active = false;
    this.lastFrameTime = null;
    this.smoothedBodySpread = null;
  }

  update(frame: TrackingFrame): GestureState {
    const now = frame.timestamp;
    const dt = this.lastFrameTime === null ? 1 / 30 : Math.max((now - this.lastFrameTime) / 1000, 1 / 240);
    this.lastFrameTime = now;
    this.active = true;

    const events: GestureEvent[] = [];
    const seen = new Set<Handedness>();
    for (const hand of this.selectHands(frame.hands)) {
      seen.add(hand.handedness);
      let tracker = this.trackers.get(hand.handedness);
      if (!tracker) {
        tracker = new HandTracker(hand.handedness, now);
        this.trackers.set(hand.handedness, tracker);
      }
      const raw = tracker.update(hand.landmarks, now, this.config);
      if (!tracker.isStable(now, this.config)) continue;
      this.everTracked = true;
      for (const type of raw) {
        const last = tracker.lastEventAt[type];
        // Releases are always delivered so state never sticks; starts obey the cooldown.
        const coolingDown = (type === "pinch-start" || type === "palm-open") && last !== undefined && now - last < this.config.eventCooldownMs;
        if (coolingDown) continue;
        tracker.lastEventAt[type] = now;
        events.push({ type, handedness: hand.handedness, position: { ...tracker.position }, timestamp: now });
      }
    }

    for (const [handedness, tracker] of this.trackers) {
      if (seen.has(handedness)) continue;
      if (now - tracker.lastSeen > this.config.lostAfterMs) {
        if (tracker.isPinching && tracker.isStable(tracker.lastSeen, this.config)) {
          events.push({ type: "pinch-end", handedness, position: { ...tracker.position }, timestamp: now });
        }
        this.trackers.delete(handedness);
      } else {
        tracker.coast(dt);
      }
    }

    const hands = [...this.trackers.values()]
      .filter((t) => t.isStable(now, this.config))
      .map((t) => t.snapshot(now, this.config));

    const [first, second] = hands;
    const twoHandDistance = first && second ? distance(first.position.x, first.position.y, second.position.x, second.position.y) : null;

    let bodySpread: number | null = null;
    if (frame.pose) {
      const spread = poseSpread(frame.pose);
      if (spread !== null) {
        this.smoothedBodySpread = this.smoothedBodySpread === null ? spread : damp(this.smoothedBodySpread, spread, 6, dt);
        bodySpread = this.smoothedBodySpread;
      }
    }

    return { status: this.status(hands.length > 0), hands, twoHandDistance, bodySpread, events };
  }

  /** State to report when the camera isn't running. */
  inactiveState(): GestureState {
    return { status: "inactive", hands: [], twoHandDistance: null, bodySpread: null, events: [] };
  }

  private status(hasStableHands: boolean): TrackingStatus {
    if (!this.active) return "inactive";
    if (hasStableHands) return "tracking";
    if (this.trackers.size > 0) return "acquiring";
    return this.everTracked ? "lost" : "acquiring";
  }

  private selectHands(hands: TrackedHand[]): TrackedHand[] {
    const preference = this.config.handedness;
    if (preference === "both") return hands;
    return hands.filter((hand) => hand.handedness === preference);
  }
}
