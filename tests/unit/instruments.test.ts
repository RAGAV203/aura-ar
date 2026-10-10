import { describe, expect, it } from "vitest";
import { CosmicGardenModel, MAX_ORBS, sanitizeOrbs } from "@/features/instruments/engines/cosmicGarden";
import { defaultParameters, getInstrument, INSTRUMENTS, isInstrumentId, sanitizeParameters, validateInstrumentDefinition } from "@/features/instruments/registry";
import { Autopilot } from "@/features/studio/input/autopilot";
import type { ControlInput } from "@/types/instruments";

const idle: ControlInput = { points: [], spread: null, bodySpread: null, events: [] };

describe("instrument registry", () => {
  it("defines at least five valid, distinct instruments", () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length);
    for (const instrument of INSTRUMENTS) expect(validateInstrumentDefinition(instrument), instrument.id).toEqual([]);
  });

  it("gives each instrument a distinct sound and mapping vocabulary", () => {
    const sounds = new Set(INSTRUMENTS.map((i) => i.audio.palette));
    expect(sounds.size).toBe(INSTRUMENTS.length);
    const vocabularies = new Set(INSTRUMENTS.map((i) => i.gestureMappings.map((m) => m.effect).join("|")));
    expect(vocabularies.size).toBe(INSTRUMENTS.length);
  });

  it("detects invalid definitions", () => {
    const broken = { ...getInstrument("aurora"), presets: [{ id: "x", name: "X", parameters: { glow: 5, nope: 1 } }] };
    const problems = validateInstrumentDefinition(broken);
    expect(problems).toContain("preset x: glow out of range");
    expect(problems).toContain("preset x: unknown parameter nope");
  });

  it("sanitises untrusted parameters", () => {
    const aurora = getInstrument("aurora");
    const result = sanitizeParameters(aurora, { hue: 9999, flow: "fast", extra: 1 });
    expect(result.hue).toBe(360);
    expect(result.flow).toBe(defaultParameters(aurora).flow);
    expect(result).not.toHaveProperty("extra");
  });

  it("recognises instrument ids", () => {
    expect(isInstrumentId("inkflow")).toBe(true);
    expect(isInstrumentId("kazoo")).toBe(false);
    expect(isInstrumentId(42)).toBe(false);
  });
});

describe("Cosmic Garden model", () => {
  it("plants orbs from taps, caps them, and round-trips state", () => {
    const model = new CosmicGardenModel(defaultParameters(getInstrument("cosmic-garden")), 1);
    model.frame(1 / 60, { ...idle, events: [{ type: "tap", position: { x: 0.3, y: 0.4 }, source: "touch" }] });
    expect(model.orbs).toHaveLength(1);
    expect(model.drainNotes()).toEqual([expect.objectContaining({ kind: "pluck" })]);
    for (let i = 0; i < MAX_ORBS + 10; i++) model.plant(0.5, 0.5);
    expect(model.orbs).toHaveLength(MAX_ORBS);

    const restored = new CosmicGardenModel(defaultParameters(getInstrument("cosmic-garden")), 1);
    restored.restoreState(model.serializeState());
    expect(restored.orbs).toEqual(model.orbs);
  });

  it("maps spread to scale and keeps audio targets in range", () => {
    const model = new CosmicGardenModel(defaultParameters(getInstrument("cosmic-garden")), 1);
    for (let i = 0; i < 120; i++) model.frame(1 / 60, { ...idle, spread: 0.8 });
    expect(model.scale).toBeGreaterThan(1.5);
    const t = model.audioTargets();
    for (const value of [t.level, t.brightness, t.pan, t.texture]) expect(value).toBeGreaterThanOrEqual(0);
    expect(t.level).toBeLessThanOrEqual(1);
  });

  it("rejects malformed orb state", () => {
    expect(sanitizeOrbs("nope")).toEqual([]);
    expect(sanitizeOrbs([{ x: 1, y: 2, z: 3, hue: 400, size: 9 }, { x: "a" }])).toEqual([{ x: 1, y: 2, z: 3, hue: 40, size: 1 }]);
  });
});

describe("Autopilot", () => {
  it("is deterministic for a seed", () => {
    const a = new Autopilot(3);
    const b = new Autopilot(3);
    for (let i = 0; i < 200; i++) {
      const ia = a.next(1 / 30);
      const ib = b.next(1 / 30);
      expect(ia.points.map((p) => p.position)).toEqual(ib.points.map((p) => p.position));
      expect(ia.events.length).toBe(ib.events.length);
    }
  });
});
