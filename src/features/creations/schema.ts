import { getInstrument, isInstrumentId, sanitizeParameters } from "@/features/instruments/registry";
import { sanitizeOrbs } from "@/features/instruments/engines/cosmicGarden";
import { clamp01, isFiniteNumber } from "@/lib/math";
import { CURRENT_SCHEMA_VERSION, type Creation, type ProjectFile } from "@/types/creations";
import type { InstrumentId } from "@/types/instruments";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const MAX_NAME_LENGTH = 80;
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoDate = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/** Strips control characters and trims to a safe display length. */
export function sanitizeName(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || "Untitled";
}

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Versioned migrations: MIGRATIONS[n] upgrades a record from schema n to n+1.
 * Version 1 is the first released schema, so the table is empty today; add an
 * entry here (and bump CURRENT_SCHEMA_VERSION) whenever the shape changes.
 */
export const MIGRATIONS: Record<number, Migration> = {};

export function migrateCreation(input: Record<string, unknown>): ValidationResult<Record<string, unknown>> {
  let version = input.schemaVersion;
  if (!isFiniteNumber(version) || !Number.isInteger(version) || version < 1) return { ok: false, errors: ["missing or invalid schemaVersion"] };
  if (version > CURRENT_SCHEMA_VERSION) return { ok: false, errors: [`created by a newer version of Aura (schema ${version})`] };
  let record = input;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { ok: false, errors: [`no migration from schema ${version}`] };
    record = migrate(record);
    version += 1;
    record = { ...record, schemaVersion: version };
  }
  return { ok: true, value: record };
}

function sanitizeState(instrumentId: InstrumentId, state: unknown): Record<string, unknown> {
  if (!isRecord(state)) return {};
  if (JSON.stringify(state).length > MAX_STATE_BYTES) return {};
  switch (instrumentId) {
    case "cosmic-garden":
      return { orbs: sanitizeOrbs(state.orbs) };
    case "inkflow":
      return isFiniteNumber(state.hueOffset) ? { hueOffset: state.hueOffset % 360 } : {};
    case "freestyle-drums":
      // The engine re-validates each loop hit on restore; here we only bound the size.
      return Array.isArray(state.loop) ? { loop: state.loop.slice(0, 160) } : {};
    case "light-trails":
      return isFiniteNumber(state.hueIndex) ? { hueIndex: Math.abs(Math.round(state.hueIndex)) % 5 } : {};
    default:
      return {};
  }
}

function sanitizeMappings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, mapped] of Object.entries(value).slice(0, 16)) {
    if (typeof mapped === "string") result[key.slice(0, 60)] = mapped.slice(0, 120);
  }
  return result;
}

/**
 * Validates untrusted creation data (from IndexedDB or an imported file) and
 * returns a fully normalised Creation. Never evaluates any content.
 */
export function validateCreation(input: unknown): ValidationResult<Creation> {
  if (!isRecord(input)) return { ok: false, errors: ["creation must be an object"] };
  const migrated = migrateCreation(input);
  if (!migrated.ok) return migrated;
  const data = migrated.value;
  const errors: string[] = [];

  if (typeof data.id !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(data.id)) errors.push("invalid id");
  if (typeof data.name !== "string") errors.push("invalid name");
  if (!isInstrumentId(data.instrumentId)) errors.push("unknown instrument");
  if (!isIsoDate(data.createdAt)) errors.push("invalid createdAt");
  if (!isIsoDate(data.updatedAt)) errors.push("invalid updatedAt");
  if (!isRecord(data.parameters)) errors.push("invalid parameters");
  if (!isFiniteNumber(data.seed)) errors.push("invalid seed");
  if (errors.length > 0) return { ok: false, errors };

  const instrumentId = data.instrumentId as InstrumentId;
  const definition = getInstrument(instrumentId);
  const audio = isRecord(data.audioSettings) ? data.audioSettings : {};
  const presetId = typeof data.presetId === "string" && definition.presets.some((p) => p.id === data.presetId) ? data.presetId : null;

  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: data.id as string,
      name: sanitizeName(data.name as string),
      instrumentId,
      presetId,
      createdAt: new Date(data.createdAt as string).toISOString(),
      updatedAt: new Date(data.updatedAt as string).toISOString(),
      parameters: sanitizeParameters(definition, data.parameters as Record<string, unknown>),
      gestureMappings: sanitizeMappings(data.gestureMappings),
      audioSettings: {
        volume: isFiniteNumber(audio.volume) ? clamp01(audio.volume) : 0.7,
        muted: audio.muted === true,
      },
      seed: Math.abs(Math.floor(data.seed as number)) % 2 ** 31,
      state: sanitizeState(instrumentId, data.state),
    },
  };
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

/** Parses and validates the text of an imported .aura.json file. */
export function parseProjectFile(text: string): ValidationResult<ProjectFile> {
  if (text.length > MAX_PROJECT_BYTES) return { ok: false, errors: ["file too large"] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["not valid JSON"] };
  }
  if (!isRecord(json) || json.format !== "aura-project") return { ok: false, errors: ["not an Aura project"] };
  if (json.formatVersion !== 1) return { ok: false, errors: ["unsupported project format version"] };
  const creation = validateCreation(json.creation);
  if (!creation.ok) return creation;
  let snapshot: string | null = null;
  if (typeof json.snapshot === "string") {
    if (!PNG_DATA_URL.test(json.snapshot)) return { ok: false, errors: ["snapshot must be a PNG data URL"] };
    snapshot = json.snapshot;
  }
  return {
    ok: true,
    value: {
      format: "aura-project",
      formatVersion: 1,
      exportedAt: isIsoDate(json.exportedAt) ? json.exportedAt : new Date().toISOString(),
      creation: creation.value,
      snapshot,
    },
  };
}

export function serializeProjectFile(creation: Creation, snapshot: string | null, now = new Date()): string {
  const file: ProjectFile = { format: "aura-project", formatVersion: 1, exportedAt: now.toISOString(), creation, snapshot };
  return JSON.stringify(file, null, 2);
}

export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
