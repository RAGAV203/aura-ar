import { clamp } from "@/lib/math";
import type { ControlPoint } from "@/types/instruments";

export type StickSide = "left" | "right";

/** A simulated drumstick or mallet held by one hand (or a touch). Coordinates are normalised. */
export interface Stick {
  side: StickSide;
  /** Where the hand grips it. */
  gripX: number;
  gripY: number;
  /** The striking end, last frame and now (hit tests use the whole swept segment). */
  prevTipX: number;
  prevTipY: number;
  tipX: number;
  tipY: number;
  /** Tip velocity, normalised units per second. */
  tipVx: number;
  tipVy: number;
  /** Current angle (radians) of the grip→tip direction, and its angular velocity. */
  angle: number;
  angularVelocity: number;
  /** 0..1 flash after a hit. */
  glow: number;
  /** Seconds since the last hit (for cooldown). */
  sinceHit: number;
  active: boolean;
  source: ControlPoint["source"] | null;
}

export interface StickOptions {
  /** Stick length as a fraction of the view height. */
  length: number;
  /** How far the wrist snap swings the tip (radians per unit of hand speed). */
  swing: number;
}

/** Rest angles: tips point down and in, towards the kit, like a seated drummer. */
const REST_ANGLE: Record<StickSide, number> = { left: Math.PI * 0.32, right: Math.PI * 0.68 };
const SPRING = 220;
const DAMPING = 18;

/**
 * Two-stick rig. Each hand (or touch) holds one stick; the stick's angle is a
 * damped spring chasing a target that the hand's vertical speed bends — so a
 * fast downstroke whips the tip forward past the hand, and after a hit the
 * stick bounces back. Tips move faster than hands, which makes air drumming
 * feel like real sticking rather than poking.
 */
export class StickRig {
  readonly sticks: Record<StickSide, Stick>;
  private aspect = 1;

  constructor(private readonly options: StickOptions = { length: 0.2, swing: 0.32 }) {
    const make = (side: StickSide): Stick => ({
      side,
      gripX: side === "left" ? 0.18 : 0.82,
      gripY: 0.92,
      prevTipX: side === "left" ? 0.3 : 0.7,
      prevTipY: 0.98,
      tipX: side === "left" ? 0.3 : 0.7,
      tipY: 0.98,
      tipVx: 0,
      tipVy: 0,
      angle: REST_ANGLE[side],
      angularVelocity: 0,
      glow: 0,
      sinceHit: 10,
      active: false,
      source: null,
    });
    this.sticks = { left: make("left"), right: make("right") };
  }

  /** View aspect (width / height) so stick lengths look the same on any screen. */
  setAspect(aspect: number): void {
    this.aspect = aspect > 0 ? aspect : 1;
  }

  /**
   * Assigns points to sticks: tracked hands by handedness, touches by screen
   * side. Touch tips sit exactly where the finger is (taps hit what you tap).
   */
  update(points: readonly ControlPoint[], dt: number): Stick[] {
    const claimed: Partial<Record<StickSide, ControlPoint>> = {};
    for (const point of points) {
      if (point.lifted) continue;
      const side: StickSide = point.source === "hand" ? (point.id.endsWith("left") ? "left" : "right") : point.position.x < 0.5 ? "left" : "right";
      const other: StickSide = side === "left" ? "right" : "left";
      if (!claimed[side]) claimed[side] = point;
      else if (!claimed[other]) claimed[other] = point;
    }
    const step = Math.max(dt, 1 / 240);
    for (const side of ["left", "right"] as const) {
      const stick = this.sticks[side];
      const point = claimed[side];
      stick.prevTipX = stick.tipX;
      stick.prevTipY = stick.tipY;
      stick.sinceHit += step;
      stick.glow *= Math.exp(-8 * step);
      stick.active = !!point;
      stick.source = point?.source ?? null;

      // Wrist snap: a downstroke drops the tip towards vertical, an upstroke lifts it
      // (angles grow clockwise; "towards vertical" is +angle for the left stick, −angle for the right).
      const vy = point ? point.velocity.y : 0;
      const sideSign = side === "left" ? 1 : -1;
      const target = REST_ANGLE[side] + sideSign * clamp(vy * this.options.swing, -0.55, 0.7);
      const accel = SPRING * (target - stick.angle) - DAMPING * stick.angularVelocity;
      stick.angularVelocity += accel * step;
      stick.angle += stick.angularVelocity * step;

      const dx = (Math.cos(stick.angle) * this.options.length) / this.aspect;
      const dy = Math.sin(stick.angle) * this.options.length;
      if (point && point.source !== "hand") {
        // Touch / keyboard: the finger is the tip.
        stick.tipX = point.position.x;
        stick.tipY = point.position.y;
        stick.gripX = stick.tipX - dx;
        stick.gripY = stick.tipY - dy;
      } else if (point) {
        stick.gripX = point.position.x;
        stick.gripY = point.position.y;
        stick.tipX = stick.gripX + dx;
        stick.tipY = stick.gripY + dy;
      } else {
        // Resting: drift back to the bottom corners.
        const restX = side === "left" ? 0.16 : 0.84;
        stick.gripX += (restX - stick.gripX) * Math.min(1, step * 3);
        stick.gripY += (0.95 - stick.gripY) * Math.min(1, step * 3);
        stick.tipX = stick.gripX + dx;
        stick.tipY = stick.gripY + dy;
      }
      stick.tipVx = (stick.tipX - stick.prevTipX) / step;
      stick.tipVy = (stick.tipY - stick.prevTipY) / step;
    }
    return [this.sticks.left, this.sticks.right];
  }

  /** Visual + physical rebound after a hit. */
  rebound(stick: Stick, velocity: number): void {
    // Lift the tip back up (the opposite of the downstroke direction).
    const sideSign = stick.side === "left" ? 1 : -1;
    stick.angularVelocity -= sideSign * (6 + velocity * 10);
    stick.glow = 1;
    stick.sinceHit = 0;
  }
}

/** Tip speed (down-weighted) → hit velocity 0..1. */
export function strikeVelocity(stick: Stick): number {
  const down = Math.max(0, stick.tipVy);
  const speed = Math.hypot(stick.tipVx, stick.tipVy);
  return clamp(0.25 + down * 0.22 + speed * 0.05, 0.15, 1);
}

/**
 * True when the stick tip entered a region this frame moving downward fast
 * enough. The swept segment is sampled so fast strokes can't skip a drum
 * between frames.
 */
export function sweptHit(stick: Stick, inside: (x: number, y: number) => boolean, minDownSpeed: number): boolean {
  if (stick.tipVy < minDownSpeed) return false;
  if (inside(stick.prevTipX, stick.prevTipY)) return false;
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    if (inside(stick.prevTipX + (stick.tipX - stick.prevTipX) * t, stick.prevTipY + (stick.tipY - stick.prevTipY) * t)) return true;
  }
  return false;
}

/** Draws a wooden drumstick (or a yarn mallet) from grip to tip. */
export function drawStick(ctx: CanvasRenderingContext2D, stick: Stick, W: number, H: number, dpr: number, kind: "stick" | "mallet" = "stick"): void {
  const gx = stick.gripX * W;
  const gy = stick.gripY * H;
  const tx = stick.tipX * W;
  const ty = stick.tipY * H;
  const alpha = stick.active ? 1 : 0.45;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";

  // Motion blur ghost along the swing.
  const swing = Math.hypot(stick.tipX - stick.prevTipX, stick.tipY - stick.prevTipY);
  if (swing > 0.004) {
    ctx.globalAlpha = alpha * 0.25;
    ctx.strokeStyle = "#f3d7a6";
    ctx.lineWidth = 5 * dpr;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(stick.prevTipX * W, stick.prevTipY * H);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // Shaft: tapered wood (drawn as a thick-to-thin quad with a highlight).
  const angle = Math.atan2(ty - gy, tx - gx);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const butt = (kind === "mallet" ? 3 : 5.5) * dpr;
  const neck = (kind === "mallet" ? 2.5 : 2.2) * dpr;
  const wood = ctx.createLinearGradient(gx + nx * butt, gy + ny * butt, gx - nx * butt, gy - ny * butt);
  wood.addColorStop(0, kind === "mallet" ? "#c9a46b" : "#f6dfb4");
  wood.addColorStop(0.5, kind === "mallet" ? "#8d6a3c" : "#d9b47a");
  wood.addColorStop(1, kind === "mallet" ? "#5e4425" : "#9c7444");
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(gx + nx * butt, gy + ny * butt);
  ctx.lineTo(tx + nx * neck, ty + ny * neck);
  ctx.lineTo(tx - nx * neck, ty - ny * neck);
  ctx.lineTo(gx - nx * butt, gy - ny * butt);
  ctx.closePath();
  ctx.fill();

  // Grip tape near the hand.
  ctx.strokeStyle = "rgba(20, 16, 30, 0.55)";
  ctx.lineWidth = butt * 2.1;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + (tx - gx) * 0.16, gy + (ty - gy) * 0.16);
  ctx.stroke();

  // Tip: wooden bead, or a yarn mallet head.
  const head = (kind === "mallet" ? 9 : 4.5) * dpr;
  const tipGradient = ctx.createRadialGradient(tx - head * 0.3, ty - head * 0.3, head * 0.1, tx, ty, head);
  tipGradient.addColorStop(0, kind === "mallet" ? "#ffd2ec" : "#fff3dc");
  tipGradient.addColorStop(1, kind === "mallet" ? "#b13f7c" : "#c79a5e");
  ctx.fillStyle = tipGradient;
  ctx.beginPath();
  ctx.ellipse(tx, ty, head, head * (kind === "mallet" ? 1 : 0.8), angle, 0, Math.PI * 2);
  ctx.fill();

  if (stick.glow > 0.05) {
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 40 * dpr);
    glow.addColorStop(0, `rgba(255, 240, 200, ${0.8 * stick.glow})`);
    glow.addColorStop(1, "rgba(255, 240, 200, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(tx, ty, 40 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Short haptic tick on devices that support it (Android). Never required. */
export function haptic(ms = 8): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* unsupported */
  }
}
