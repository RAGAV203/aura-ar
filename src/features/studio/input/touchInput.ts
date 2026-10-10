import { clamp01, damp } from "@/lib/math";
import type { ControlEvent, ControlPoint } from "@/types/instruments";

interface PointerState {
  point: ControlPoint;
  downAt: number;
  downX: number;
  downY: number;
  lastTime: number;
  maxTravel: number;
  /** Collected by at least one frame. */
  observed: boolean;
  /** Released before any frame saw it: kept for exactly one frame so quick taps still register. */
  releasing: boolean;
}

const TAP_MAX_MS = 260;
const TAP_MAX_TRAVEL = 0.025;
const DOUBLE_TAP_MS = 320;

/**
 * Converts pointer events on the artwork surface into normalised control
 * points. Works for touch, pen and mouse. Pointer capture keeps strokes going
 * when a finger slides off the canvas; `touch-action: none` on the element
 * (set in CSS) prevents page scrolling only while interacting with the art.
 */
export class TouchInput {
  /** Presses keyed by their own id (several quick taps from one mouse can be pending at once). */
  private pointers = new Map<string, PointerState>();
  /** The press each physical pointer is currently driving. */
  private activeByPointer = new Map<number, string>();
  private events: ControlEvent[] = [];
  private lastTapAt = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;
  private amount = 0.5;
  /**
   * Mice and pens reuse pointerId 1 for every press, so each press gets its
   * own control-point id; otherwise two quick taps could look like one hold.
   */
  private pressCounter = 0;
  private element: HTMLElement | null = null;

  attach(element: HTMLElement): () => void {
    this.element = element;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e, false);
    const cancel = (e: PointerEvent) => this.onUp(e, true);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", cancel);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      this.pointers.clear();
      this.activeByPointer.clear();
      this.element = null;
    };
  }

  /** Base amount for touch points (e.g. brush size slider position), 0..1. */
  setAmount(amount: number): void {
    this.amount = clamp01(amount);
  }

  get points(): ControlPoint[] {
    return [...this.pointers.values()].map((p) => p.point);
  }

  /**
   * Points for this frame. A press that was released before any frame saw it
   * is delivered once, then dropped — otherwise very quick taps (shorter than
   * a frame) would never reach instruments that act on presses.
   */
  collectPoints(): ControlPoint[] {
    const points: ControlPoint[] = [];
    for (const [id, state] of this.pointers) {
      points.push(state.point);
      state.observed = true;
      if (state.releasing) this.pointers.delete(id);
    }
    return points;
  }

  /** Distance between the first two active pointers, or null. */
  get spread(): number | null {
    const [a, b] = this.points;
    if (!a || !b) return null;
    return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  }

  drainEvents(): ControlEvent[] {
    if (this.events.length === 0) return this.events;
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Decay velocities of pointers that are held still. Call once per frame. */
  tick(dt: number, now: number): void {
    for (const state of this.pointers.values()) {
      if (now - state.lastTime > 50) {
        state.point.velocity.x = damp(state.point.velocity.x, 0, 10, dt);
        state.point.velocity.y = damp(state.point.velocity.y, 0, 10, dt);
        state.point.speed = Math.hypot(state.point.velocity.x, state.point.velocity.y);
      }
    }
  }

  reset(): void {
    this.pointers.clear();
    this.activeByPointer.clear();
    this.events = [];
  }

  private normalise(e: PointerEvent): { x: number; y: number } {
    const rect = this.element?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) };
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (this.activeByPointer.size >= 5) return;
    try {
      this.element?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    const { x, y } = this.normalise(e);
    const now = e.timeStamp || performance.now();
    const amount = e.pointerType === "pen" && e.pressure > 0 ? clamp01(e.pressure) : this.amount;
    const id = `touch-${e.pointerId}-${this.pressCounter++}`;
    this.activeByPointer.set(e.pointerId, id);
    this.pointers.set(id, {
      point: { id, source: "touch", position: { x, y }, velocity: { x: 0, y: 0 }, speed: 0, amount, engaged: true, lifted: false },
      downAt: now,
      downX: x,
      downY: y,
      lastTime: now,
      maxTravel: 0,
      observed: false,
      releasing: false,
    });
  }

  private onMove(e: PointerEvent): void {
    const id = this.activeByPointer.get(e.pointerId);
    const state = id ? this.pointers.get(id) : undefined;
    if (!state) return;
    const { x, y } = this.normalise(e);
    const now = e.timeStamp || performance.now();
    const dt = Math.max((now - state.lastTime) / 1000, 1 / 240);
    const point = state.point;
    point.velocity.x = damp(point.velocity.x, (x - point.position.x) / dt, 20, dt);
    point.velocity.y = damp(point.velocity.y, (y - point.position.y) / dt, 20, dt);
    point.speed = Math.hypot(point.velocity.x, point.velocity.y);
    point.position.x = x;
    point.position.y = y;
    if (e.pointerType === "pen" && e.pressure > 0) point.amount = clamp01(e.pressure);
    state.lastTime = now;
    state.maxTravel = Math.max(state.maxTravel, Math.hypot(x - state.downX, y - state.downY));
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    // lostpointercapture follows every pointerup; once released, the pointer has no active press.
    const id = this.activeByPointer.get(e.pointerId);
    const state = id ? this.pointers.get(id) : undefined;
    if (!id || !state) return;
    this.activeByPointer.delete(e.pointerId);
    // A press no frame has seen yet is delivered once more (quick taps), otherwise it ends now.
    if (!cancelled && !state.observed) state.releasing = true;
    else this.pointers.delete(id);
    if (cancelled) return;
    const now = e.timeStamp || performance.now();
    if (now - state.downAt > TAP_MAX_MS || state.maxTravel > TAP_MAX_TRAVEL) return;
    const position = { x: state.downX, y: state.downY };
    const isDouble = now - this.lastTapAt < DOUBLE_TAP_MS && Math.hypot(position.x - this.lastTapX, position.y - this.lastTapY) < 0.08;
    this.events.push({ type: isDouble ? "accent" : "tap", position, source: "touch" });
    this.lastTapAt = isDouble ? -Infinity : now;
    this.lastTapX = position.x;
    this.lastTapY = position.y;
  }
}
