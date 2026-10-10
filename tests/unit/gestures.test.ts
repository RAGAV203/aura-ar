import { describe, expect, it } from "vitest";
import { fingersExtended, GestureInterpreter, pinchRatio } from "@/features/vision/gestureInterpreter";
import { dedupeHandedness, normalizeHandedness, normalizeHands, normalizeLandmarks } from "@/features/vision/normalize";
import { OneEuroFilter } from "@/features/vision/oneEuroFilter";
import { gestureToControlEvents, gestureToControlPoints } from "@/features/studio/input/gestureControls";
import { frame, makeHand } from "./handFixtures";

/** Feeds the same hand every 33 ms from `start` for `durationMs`, returning all states. */
function run(interpreter: GestureInterpreter, start: number, durationMs: number, hand: ReturnType<typeof makeHand> | null) {
  const states = [];
  for (let t = start; t <= start + durationMs; t += 33) states.push(interpreter.update(frame(t, hand ? [hand] : [])));
  return states;
}

describe("landmark normalisation", () => {
  it("mirrors x for the selfie camera and clamps to 0..1", () => {
    const [a, b] = normalizeLandmarks(
      [
        { x: 0.2, y: 0.3, z: 0.1 },
        { x: 1.4, y: -0.2, z: Number.NaN },
      ],
      true,
    );
    expect(a).toEqual({ x: 0.8, y: 0.3, z: 0.1 });
    expect(b).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is independent of camera resolution (inputs are already 0..1)", () => {
    const raw = [{ x: 0.25, y: 0.75, z: 0 }];
    expect(normalizeLandmarks(raw, false)).toEqual(normalizeLandmarks(raw, false));
  });

  it("maps handedness labels depending on mirroring", () => {
    expect(normalizeHandedness({ categoryName: "Left", score: 1 }, true)).toBe("left");
    expect(normalizeHandedness({ categoryName: "Left", score: 1 }, false)).toBe("right");
  });

  it("drops malformed hands and resolves duplicate handedness labels", () => {
    const valid = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const hands = normalizeHands([valid, valid, valid.slice(0, 5)], [[{ categoryName: "Right", score: 0.9 }], [{ categoryName: "Right", score: 0.6 }], []], true);
    expect(hands).toHaveLength(2);
    expect(hands.map((h) => h.handedness).sort()).toEqual(["left", "right"]);
    expect(dedupeHandedness([makeHand({ handedness: "left" })])).toHaveLength(1);
  });
});

describe("hand geometry", () => {
  it("measures pinch relative to hand size", () => {
    expect(pinchRatio(makeHand({ pinch: true }).landmarks)).toBeLessThan(0.32);
    expect(pinchRatio(makeHand({ pinch: false }).landmarks)).toBeGreaterThan(0.48);
  });

  it("detects extended fingers for an open palm", () => {
    expect(fingersExtended(makeHand({ open: true }).landmarks)).toBe(true);
    expect(fingersExtended(makeHand({ open: false }).landmarks)).toBe(false);
  });
});

describe("OneEuroFilter", () => {
  it("passes the first value through and smooths jitter", () => {
    const filter = new OneEuroFilter(1, 0);
    expect(filter.filter(0.5, 0)).toBe(0.5);
    let out = 0.5;
    for (let i = 1; i < 30; i++) out = filter.filter(i % 2 ? 0.52 : 0.48, i * 33);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.015);
  });

  it("converges on a new steady value", () => {
    const filter = new OneEuroFilter(1.2, 0.02);
    let out = filter.filter(0, 0);
    for (let i = 1; i < 120; i++) out = filter.filter(1, i * 33);
    expect(out).toBeGreaterThan(0.98);
  });
});

describe("GestureInterpreter", () => {
  it("requires stable tracking before producing hands", () => {
    const interpreter = new GestureInterpreter({ stableAfterMs: 160 });
    const first = interpreter.update(frame(0, [makeHand()]));
    expect(first.status).toBe("acquiring");
    expect(first.hands).toHaveLength(0);
    const later = run(interpreter, 33, 200, makeHand()).at(-1);
    expect(later?.status).toBe("tracking");
    expect(later?.hands).toHaveLength(1);
  });

  it("applies hysteresis so a pinch doesn't flicker", () => {
    const interpreter = new GestureInterpreter();
    run(interpreter, 0, 300, makeHand());
    const pinched = run(interpreter, 333, 300, makeHand({ pinch: true }));
    expect(pinched.at(-1)?.hands[0]?.isPinching).toBe(true);
    const starts = pinched.flatMap((s) => s.events).filter((e) => e.type === "pinch-start");
    expect(starts).toHaveLength(1);
    const released = run(interpreter, 666, 400, makeHand());
    expect(released.at(-1)?.hands[0]?.isPinching).toBe(false);
    expect(released.flatMap((s) => s.events).some((e) => e.type === "pinch-end")).toBe(true);
  });

  it("applies a cooldown to repeated discrete pinch events", () => {
    const interpreter = new GestureInterpreter({ eventCooldownMs: 1000, sensitivity: 1 });
    run(interpreter, 0, 300, makeHand());
    let t = 333;
    const events = [];
    // Rapid pinch / release cycles well inside the cooldown.
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const pinch of [true, false]) {
        for (let i = 0; i < 4; i++, t += 33) events.push(...interpreter.update(frame(t, [makeHand({ pinch })])).events);
      }
    }
    expect(events.filter((e) => e.type === "pinch-start")).toHaveLength(1);
  });

  it("only reports an open palm after it is held", () => {
    const interpreter = new GestureInterpreter({ palmHoldMs: 450 });
    run(interpreter, 0, 300, makeHand());
    const brief = run(interpreter, 333, 200, makeHand({ open: true }));
    expect(brief.some((s) => s.hands[0]?.isOpenPalm)).toBe(false);
    const held = run(interpreter, 566, 400, makeHand({ open: true }));
    expect(held.at(-1)?.hands[0]?.isOpenPalm).toBe(true);
    expect(held.flatMap((s) => s.events).filter((e) => e.type === "palm-open")).toHaveLength(1);
  });

  it("handles lost tracking without stuck pinches and reacquires gracefully", () => {
    const interpreter = new GestureInterpreter({ lostAfterMs: 300 });
    run(interpreter, 0, 300, makeHand());
    run(interpreter, 333, 200, makeHand({ pinch: true }));
    // Brief dropout: hand is coasted, not lost.
    const dropout = interpreter.update(frame(600, []));
    expect(dropout.status).toBe("tracking");
    const lost = run(interpreter, 633, 400, null);
    expect(lost.at(-1)?.status).toBe("lost");
    expect(lost.at(-1)?.hands).toHaveLength(0);
    expect(lost.flatMap((s) => s.events).some((e) => e.type === "pinch-end")).toBe(true);
    // Reacquiring requires stability again.
    expect(interpreter.update(frame(1100, [makeHand()])).status).toBe("acquiring");
    expect(run(interpreter, 1133, 250, makeHand()).at(-1)?.status).toBe("tracking");
  });

  it("measures two-hand distance and honours the handedness preference", () => {
    const both = new GestureInterpreter();
    const hands = [makeHand({ cx: 0.3, handedness: "left" }), makeHand({ cx: 0.7, handedness: "right" })];
    let state = both.update(frame(0, hands));
    for (let t = 33; t < 300; t += 33) state = both.update(frame(t, hands));
    expect(state.hands).toHaveLength(2);
    expect(state.twoHandDistance).toBeCloseTo(0.4, 1);

    const rightOnly = new GestureInterpreter({ handedness: "right" });
    for (let t = 0; t < 300; t += 33) state = rightOnly.update(frame(t, hands));
    expect(state.hands.map((h) => h.handedness)).toEqual(["right"]);
    expect(state.twoHandDistance).toBeNull();
  });

  it("maps gesture state to the shared control vocabulary", () => {
    const interpreter = new GestureInterpreter();
    run(interpreter, 0, 300, makeHand());
    const states = run(interpreter, 333, 200, makeHand({ pinch: true }));
    const withEvent = states.find((s) => s.events.length > 0);
    expect(withEvent).toBeDefined();
    expect(gestureToControlEvents(withEvent!)).toEqual([expect.objectContaining({ type: "tap", source: "hand" })]);
    const points = gestureToControlPoints(states.at(-1)!);
    expect(points[0]).toMatchObject({ id: "hand-right", source: "hand", engaged: true, lifted: false });
    expect(gestureToControlPoints(interpreter.inactiveState())).toEqual([]);
  });
});
