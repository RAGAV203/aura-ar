import { describe, expect, it } from "vitest";
import { MAX_PROJECT_BYTES, migrateCreation, parseProjectFile, sanitizeName, serializeProjectFile, validateCreation } from "@/features/creations/schema";
import { CURRENT_SCHEMA_VERSION } from "@/types/creations";
import { sampleCreation } from "./creationFixtures";

describe("creation validation", () => {
  it("accepts a valid creation", () => {
    const result = validateCreation(sampleCreation());
    expect(result.ok).toBe(true);
  });

  it("rejects missing fields and unknown instruments", () => {
    const result = validateCreation({ ...sampleCreation(), instrumentId: "theremin", id: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["invalid id", "unknown instrument"]));
    expect(validateCreation(null).ok).toBe(false);
    expect(validateCreation([]).ok).toBe(false);
  });

  it("normalises out-of-range values instead of trusting them", () => {
    const result = validateCreation({
      ...sampleCreation(),
      name: "  \u0007Hello\u0000  ",
      parameters: { hue: -50, flow: 100, injected: 1 },
      audioSettings: { volume: 7, muted: "yes" },
      presetId: "does-not-exist",
      seed: -99.7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Hello");
    expect(result.value.parameters).toEqual({ hue: 0, flow: 2, spread: 0.45, glow: 0.7 });
    expect(result.value.audioSettings).toEqual({ volume: 1, muted: false });
    expect(result.value.presetId).toBeNull();
    expect(result.value.seed).toBe(100);
  });

  it("only keeps known instrument state", () => {
    const result = validateCreation(
      sampleCreation({ instrumentId: "cosmic-garden", parameters: {}, state: { orbs: [{ x: 1, y: 1, z: 1, hue: 10, size: 0.3 }], script: "alert(1)" } }),
    );
    expect(result.ok && result.value.state).toEqual({ orbs: [{ x: 1, y: 1, z: 1, hue: 10, size: 0.3 }] });
  });

  it("sanitises names", () => {
    expect(sanitizeName("   ")).toBe("Untitled");
    expect(sanitizeName("x".repeat(200))).toHaveLength(80);
  });
});

describe("schema migrations", () => {
  it("accepts the current version and rejects newer or invalid ones", () => {
    expect(migrateCreation({ schemaVersion: CURRENT_SCHEMA_VERSION }).ok).toBe(true);
    const future = migrateCreation({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0]).toMatch(/newer version/);
    expect(migrateCreation({ schemaVersion: 0 }).ok).toBe(false);
    expect(migrateCreation({}).ok).toBe(false);
  });
});

describe("project files", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("round-trips through serialisation", () => {
    const creation = sampleCreation();
    const text = serializeProjectFile(creation, png, new Date("2026-10-10T00:00:00Z"));
    const parsed = parseProjectFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.creation).toEqual(creation);
      expect(parsed.value.snapshot).toBe(png);
      expect(parsed.value.exportedAt).toBe("2026-10-10T00:00:00.000Z");
    }
  });

  it("rejects corrupted, foreign and oversized files", () => {
    expect(parseProjectFile("{not json").ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ format: "other" })).ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ format: "aura-project", formatVersion: 9, creation: sampleCreation() })).ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ format: "aura-project", formatVersion: 1, creation: { ...sampleCreation(), seed: "x" } })).ok).toBe(false);
    expect(parseProjectFile("x".repeat(MAX_PROJECT_BYTES + 1)).ok).toBe(false);
  });

  it("rejects snapshots that aren't PNG data URLs", () => {
    for (const snapshot of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "https://example.com/a.png"]) {
      const text = JSON.stringify({ format: "aura-project", formatVersion: 1, creation: sampleCreation(), snapshot });
      expect(parseProjectFile(text).ok, snapshot).toBe(false);
    }
  });
});
