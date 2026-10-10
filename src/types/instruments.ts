import type { Point2 } from "./gestures";

export type InstrumentId =
  | "aurora"
  | "inkflow"
  | "light-trails"
  | "particle-bloom"
  | "cosmic-garden"
  | "string-harp"
  | "ripple-pond"
  | "magnetic-field"
  | "piano"
  | "flute"
  | "trumpet"
  | "orchestra"
  | "drum-kit"
  | "freestyle-drums";

export type QualityLevel = "high" | "balanced" | "battery";

export type TrackingCapability = "hands" | "pose";

export type InputSource = "touch" | "hand" | "auto";

/**
 * A single control point fed to an instrument each frame. Touch pointers,
 * tracked hands and the autopilot used for previews all produce these, which
 * is what keeps touch and gesture interaction equivalent.
 */
export interface ControlPoint {
  id: string;
  source: InputSource;
  position: Point2;
  velocity: Point2;
  speed: number;
  /** 0..1: pinch openness for hands, size control for touch. */
  amount: number;
  /** Pinching (hands) or pressed (touch; touch points only exist while pressed). */
  engaged: boolean;
  /** Open palm: the "brush" is lifted. Always false for touch. */
  lifted: boolean;
}

export type ControlEventType = "tap" | "accent";

export interface ControlEvent {
  /** "tap": a touch tap or a pinch start. "accent": colour change / bloom trigger. */
  type: ControlEventType;
  position: Point2;
  source: InputSource;
}

/** The complete, mutable input snapshot an instrument reads every frame. */
export interface ControlInput {
  points: ControlPoint[];
  /** Two-point spread (two hands or two fingers), 0..~1.4, or null. */
  spread: number | null;
  /** Body openness from the optional pose model, 0..1, or null. */
  bodySpread: number | null;
  /** Discrete events since the previous frame; consumed by the instrument. */
  events: ControlEvent[];
}

export interface ParameterSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** Short description used as the accessible description of the slider. */
  description: string;
}

export type InstrumentParameters = Record<string, number>;

export interface InstrumentPreset {
  id: string;
  name: string;
  parameters: InstrumentParameters;
}

export interface MappingDescription {
  input: string;
  effect: string;
}

export type SoundPalette =
  | "ambient-pad"
  | "soft-percussion"
  | "pluck"
  | "texture"
  | "drone"
  | "harp"
  | "water"
  | "chime"
  | "piano-room"
  | "flute-air"
  | "brass-hall"
  | "orchestra-hall"
  | "drum-room"
  | "drum-loop";

export interface AudioConfig {
  /** Continuous layer. */
  palette: SoundPalette;
  /** Base note, MIDI number. */
  rootNote: number;
  /** Semitone offsets of the scale used for melodic material. */
  scale: number[];
}

export type RendererKind = "canvas2d" | "webgl";

export interface InstrumentDefinition {
  id: InstrumentId;
  name: string;
  tagline: string;
  description: string;
  renderer: RendererKind;
  /** Tracking capabilities the instrument can use; touch always works. */
  tracking: TrackingCapability[];
  /** Whether the canvas keeps accumulating marks (saved as a snapshot). */
  persistentCanvas: boolean;
  parameters: ParameterSpec[];
  presets: InstrumentPreset[];
  gestureMappings: MappingDescription[];
  touchMappings: MappingDescription[];
  audio: AudioConfig;
  exportFormats: Array<"png" | "json" | "video">;
  /** Accent colours used by UI chrome around the instrument. */
  palette: [string, string, string];
}

/** Values the instrument engine pushes to the audio engine (~30 Hz). */
export interface AudioTargets {
  /** 0..1 overall level of the continuous layer. */
  level: number;
  /** 0..1 filter brightness. */
  brightness: number;
  /** Pitch offset in semitones applied to the continuous layer, -12..12. */
  pitch: number;
  /** 0..1 stereo position. */
  pan: number;
  /** 0..1 texture / density amount. */
  texture: number;
}

export interface AudioNoteEvent {
  /** Scale degree index; the audio engine resolves it against the scale. */
  degree: number;
  /** 0..1 velocity. */
  velocity: number;
  kind: "pluck" | "percussion" | "swell" | "harp" | "drop" | "bell" | DrumKind;
  /** 0..1 stereo position. */
  pan: number;
}

export type DrumKind = "kick" | "snare" | "hat" | "hat-open" | "tom" | "crash" | "ride" | "timpani";

/** Timbres for sustained (held) notes. */
export type VoiceKind = "piano" | "flute" | "trumpet" | "strings" | "brass" | "woodwind";

/**
 * Commands for sustained voices: a note starts on press / pinch, follows the
 * hand while held (pitch glide, expression) and stops on release.
 */
export type VoiceCommand =
  | { type: "on"; id: string; kind: VoiceKind; midi: number; velocity: number; pan: number }
  | { type: "update"; id: string; midi?: number; expression?: number; pan?: number; glideMs?: number }
  | { type: "off"; id: string; releaseSeconds?: number }
  | { type: "all-off" };

/** Contract implemented by every visual engine (Canvas 2D or WebGL scene). */
export interface InstrumentEngine {
  readonly id: InstrumentId;
  resize(width: number, height: number, pixelRatio: number): void;
  setParameters(parameters: InstrumentParameters): void;
  setQuality(quality: QualityLevel): void;
  setReducedMotion(reduced: boolean): void;
  /** Advance the simulation by `dt` seconds with the given input and draw. */
  frame(dt: number, input: ControlInput): void;
  /** Continuous audio targets derived from the latest frame. */
  audioTargets(): AudioTargets;
  /** Discrete notes triggered since the last call. */
  drainNotes(): AudioNoteEvent[];
  /** Sustained-voice commands since the last call (melodic instruments). */
  drainVoiceCommands?(): VoiceCommand[];
  reset(): void;
  /** Instrument-specific serialisable state (validated on load). */
  serializeState(): Record<string, unknown>;
  restoreState(state: Record<string, unknown>): void;
  /** Paint a previously saved snapshot underneath new marks. */
  restoreSnapshot?(image: CanvasImageSource): void;
  /** Tools available on persistent-canvas instruments. */
  readonly supportsUndo?: boolean;
  canUndo?(): boolean;
  undo?(): boolean;
  readonly supportsEraser?: boolean;
  setEraser?(enabled: boolean, size?: number): void;
  dispose(): void;
}
