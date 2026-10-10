import type { InstrumentId, InstrumentParameters } from "./instruments";

export const CURRENT_SCHEMA_VERSION = 1;

export interface CreationAudioSettings {
  volume: number;
  muted: boolean;
}

/** Portable, validated description of a saved artwork. */
export interface Creation {
  schemaVersion: number;
  id: string;
  name: string;
  instrumentId: InstrumentId;
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
  parameters: InstrumentParameters;
  /** Gesture → effect mappings that were active when the creation was saved. */
  gestureMappings: Record<string, string>;
  audioSettings: CreationAudioSettings;
  seed: number;
  /** Instrument-specific scene state, e.g. planted orbs in Cosmic Garden. */
  state: Record<string, unknown>;
}

/** Binary companions stored next to a creation in IndexedDB. */
export interface CreationMedia {
  id: string;
  thumbnail: Blob | null;
  /** Full-resolution canvas snapshot for instruments with a persistent canvas. */
  snapshot: Blob | null;
}

/** File format for exported projects. */
export interface ProjectFile {
  format: "aura-project";
  formatVersion: 1;
  exportedAt: string;
  creation: Creation;
  /** Optional PNG data URL of the persistent canvas. */
  snapshot: string | null;
}
