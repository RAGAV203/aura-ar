import { describe, expect, it } from "vitest";
import { quantizeBeat, voiceAt } from "@/features/instruments/engines/freestyleDrums";
import { StrikeDetector } from "@/features/instruments/engines/strikes";
import type { ControlPoint } from "@/types/instruments";

const hand = (y: number, vy: number, x = 0.5): ControlPoint => ({
  id: "hand-right",
  source: "hand",
  position: { x, y },
  velocity: { x: 0, y: vy },
  speed: Math.abs(vy),
  amount: 1,
  engaged: false,
  lifted: false,
});

describe("StrikeDetector", () => {
  it("fires once on the bounce after a fast downward stroke, at the bounce point", () => {
    const detector = new StrikeDetector(0.9, 0.09);
    expect(detector.update([hand(0.3, 0.2)], 0)).toEqual([]);
    expect(detector.update([hand(0.4, 2.5)], 0.03)).toEqual([]);
    expect(detector.update([hand(0.55, 3)], 0.06)).toEqual([]);
    const strikes = detector.update([hand(0.6, -0.4)], 0.09);
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({ y: 0.6 });
    expect(strikes[0]!.velocity).toBeGreaterThan(0.75);
    expect(detector.update([hand(0.58, -0.6)], 0.12)).toEqual([]);
  });

  it("ignores slow movement, touch points and strikes inside the cooldown", () => {
    const detector = new StrikeDetector(0.9, 0.5);
    expect(detector.update([hand(0.4, 0.5), hand(0.45, 0.1)], 0)).toEqual([]);
    const touch: ControlPoint = { ...hand(0.5, 3), id: "touch-1", source: "touch" };
    detector.update([touch], 0);
    expect(detector.update([{ ...touch, velocity: { x: 0, y: 0 } }], 0.05)).toEqual([]);
    detector.update([hand(0.4, 2)], 0.1);
    expect(detector.update([hand(0.5, 0)], 0.12)).toHaveLength(1);
    detector.update([hand(0.4, 2)], 0.2);
    expect(detector.update([hand(0.5, 0)], 0.25)).toEqual([]);
  });

  it("scales the speed threshold with sensitivity", () => {
    const detector = new StrikeDetector(0.9);
    detector.update([hand(0.4, 1.2)], 0, 2);
    expect(detector.update([hand(0.5, 0)], 0.05, 2)).toEqual([]);
  });
});

describe("freestyle drum zones", () => {
  it("maps height and side to drums", () => {
    expect(voiceAt(0.2, 0.1).kind).toBe("crash");
    expect(voiceAt(0.8, 0.1).kind).toBe("ride");
    expect(voiceAt(0.2, 0.4).kind).toBe("hat");
    expect(voiceAt(0.8, 0.4).kind).toBe("hat-open");
    expect(voiceAt(0.1, 0.6)).toMatchObject({ kind: "tom", degree: 0 });
    expect(voiceAt(0.5, 0.6).kind).toBe("snare");
    expect(voiceAt(0.9, 0.6)).toMatchObject({ kind: "tom", degree: 2 });
    expect(voiceAt(0.5, 0.9).kind).toBe("kick");
  });

  it("quantizes loop positions to sixteenths by the given amount", () => {
    expect(quantizeBeat(1.1, 1)).toBeCloseTo(1);
    expect(quantizeBeat(1.1, 0)).toBeCloseTo(1.1);
    expect(quantizeBeat(1.1, 0.5)).toBeCloseTo(1.05);
    expect(quantizeBeat(7.98, 1)).toBeCloseTo(0); // wraps to the loop start
  });
});
