import { describe, expect, it } from "vitest";
import { gestureToControlPoints, viewSpread } from "@/features/studio/input/gestureControls";
import { applySymmetry, symmetryMappers } from "@/features/studio/input/symmetry";
import { applyTransform, coverTransform, IDENTITY_TRANSFORM } from "@/lib/browser/viewTransform";
import type { GestureState } from "@/types/gestures";
import type { ControlInput } from "@/types/instruments";

describe("cover view transform", () => {
  it("is the identity when aspect ratios match", () => {
    expect(coverTransform(640, 480, 1280, 960)).toEqual(IDENTITY_TRANSFORM);
  });

  it("crops the sides of a landscape camera shown on a portrait phone", () => {
    // 4:3 camera on a 390×844 screen: the video is scaled to the screen height.
    const t = coverTransform(640, 480, 390, 844);
    expect(t.scaleY).toBeCloseTo(1);
    expect(t.scaleX).toBeCloseTo((640 * (844 / 480)) / 390);
    // The centre stays the centre; the visible band maps to 0..1.
    expect(applyTransform({ x: 0.5, y: 0.5 }, t)).toEqual({ x: 0.5, y: 0.5 });
    const leftEdgeVisible = (0 - t.offsetX) / t.scaleX;
    expect(applyTransform({ x: leftEdgeVisible, y: 0 }, t).x).toBeCloseTo(0);
    expect(applyTransform({ x: 0, y: 0 }, t).x).toBeLessThan(0);
  });

  it("crops top and bottom of a camera shown on an ultrawide view", () => {
    const t = coverTransform(640, 480, 2000, 800);
    expect(t.scaleX).toBeCloseTo(1);
    expect(t.scaleY).toBeGreaterThan(1);
  });

  it("degrades to identity for unknown sizes", () => {
    expect(coverTransform(0, 0, 100, 100)).toEqual(IDENTITY_TRANSFORM);
  });

  it("maps gesture points, velocities and two-hand spread into view space", () => {
    const state: GestureState = {
      status: "tracking",
      twoHandDistance: 0.2,
      bodySpread: null,
      events: [],
      hands: [
        { handedness: "left", position: { x: 0.4, y: 0.5 }, velocity: { x: 1, y: 0 }, speed: 1, pinchOpenness: 1, isPinching: false, isOpenPalm: false, stable: true },
        { handedness: "right", position: { x: 0.6, y: 0.5 }, velocity: { x: 0, y: 0 }, speed: 0, pinchOpenness: 1, isPinching: false, isOpenPalm: false, stable: true },
      ],
    };
    const t = { scaleX: 2, scaleY: 1, offsetX: -0.5, offsetY: 0 };
    const [left] = gestureToControlPoints(state, t);
    expect(left?.position.x).toBeCloseTo(0.3);
    expect(left?.velocity.x).toBe(2);
    expect(viewSpread(state, t)).toBeCloseTo(0.4);
  });
});

describe("symmetry", () => {
  const input: ControlInput = {
    points: [{ id: "touch-1", source: "touch", position: { x: 0.2, y: 0.3 }, velocity: { x: 1, y: 0 }, speed: 1, amount: 0.5, engaged: true, lifted: false }],
    spread: null,
    bodySpread: null,
    events: [{ type: "tap", position: { x: 0.2, y: 0.3 }, source: "touch" }],
  };

  it("leaves input untouched when off", () => {
    expect(applySymmetry(input, 1, 1)).toBe(input);
  });

  it("mirrors left/right with mirrored velocity and unique ids", () => {
    const out = applySymmetry(input, 2, 1.5);
    expect(out.points).toHaveLength(2);
    expect(out.points[1]?.position.x).toBeCloseTo(0.8);
    expect(out.points[1]?.velocity.x).toBeCloseTo(-1);
    expect(new Set(out.points.map((p) => p.id)).size).toBe(2);
    expect(out.events).toHaveLength(2);
  });

  it("produces four quadrant copies", () => {
    const xs = applySymmetry(input, 4, 1).points.map((p) => [Number(p.position.x.toFixed(2)), Number(p.position.y.toFixed(2))]);
    expect(xs).toEqual([
      [0.2, 0.3],
      [0.8, 0.3],
      [0.2, 0.7],
      [0.8, 0.7],
    ]);
  });

  it("rotates around the centre in aspect-correct space", () => {
    const aspect = 16 / 9;
    const maps = symmetryMappers(6, aspect);
    expect(maps).toHaveLength(6);
    const p = { x: 0.7, y: 0.5 };
    const radius = (q: { x: number; y: number }) => Math.hypot((q.x - 0.5) * aspect, q.y - 0.5);
    for (const map of maps) expect(radius(map(p))).toBeCloseTo(radius(p));
  });
});
