import { CURRENT_SCHEMA_VERSION, type Creation } from "@/types/creations";

export function sampleCreation(overrides: Partial<Creation> = {}): Creation {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "abc123def456",
    name: "Aurora Study",
    instrumentId: "aurora",
    presetId: "polar-night",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    parameters: { hue: 165, flow: 0.7, spread: 0.45, glow: 0.7 },
    gestureMappings: { "Move hand": "Steers" },
    audioSettings: { volume: 0.6, muted: false },
    seed: 12345,
    state: {},
    ...overrides,
  };
}
