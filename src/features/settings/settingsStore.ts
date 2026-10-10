import { clamp01, isFiniteNumber } from "@/lib/math";
import type { PerformanceMode } from "@/lib/performance/qualityController";

export interface Settings {
  onboardingComplete: boolean;
  /** Use the camera automatically when opening the studio (still requires the permission prompt the first time). */
  cameraEnabled: boolean;
  /** Load the optional pose model for body interaction. */
  poseEnabled: boolean;
  touchOnly: boolean;
  gestureSensitivity: number;
  handedness: "both" | "left" | "right";
  volume: number;
  muted: boolean;
  visualIntensity: number;
  /** "system" follows prefers-reduced-motion. */
  reducedMotion: "system" | "on" | "off";
  performanceMode: PerformanceMode;
  diagnostics: boolean;
  lastInstrument: string | null;
  /** Show the live camera behind the artwork while camera interaction is on. */
  cameraBackdrop: boolean;
  /** 0.15..1 opacity of the camera backdrop. */
  backdropOpacity: number;
  /** Draw a glowing skeleton over tracked hands. */
  handSkeleton: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  onboardingComplete: false,
  cameraEnabled: false,
  poseEnabled: false,
  touchOnly: false,
  gestureSensitivity: 0.5,
  handedness: "both",
  volume: 0.7,
  muted: false,
  visualIntensity: 0.85,
  reducedMotion: "system",
  performanceMode: "auto",
  diagnostics: false,
  lastInstrument: null,
  cameraBackdrop: true,
  backdropOpacity: 0.6,
  handSkeleton: true,
};

export const SETTINGS_KEY = "aura.settings.v1";

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;

/** Validates persisted settings; unknown or malformed values fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const s = raw as Record<string, unknown>;
  const num = (key: keyof Settings, fallback: number) => (isFiniteNumber(s[key]) ? clamp01(s[key] as number) : fallback);
  const bool = (key: keyof Settings, fallback: boolean) => (typeof s[key] === "boolean" ? (s[key] as boolean) : fallback);
  return {
    onboardingComplete: bool("onboardingComplete", DEFAULT_SETTINGS.onboardingComplete),
    cameraEnabled: bool("cameraEnabled", DEFAULT_SETTINGS.cameraEnabled),
    poseEnabled: bool("poseEnabled", DEFAULT_SETTINGS.poseEnabled),
    touchOnly: bool("touchOnly", DEFAULT_SETTINGS.touchOnly),
    gestureSensitivity: num("gestureSensitivity", DEFAULT_SETTINGS.gestureSensitivity),
    handedness: oneOf(s.handedness, ["both", "left", "right"] as const, DEFAULT_SETTINGS.handedness),
    volume: num("volume", DEFAULT_SETTINGS.volume),
    muted: bool("muted", DEFAULT_SETTINGS.muted),
    visualIntensity: num("visualIntensity", DEFAULT_SETTINGS.visualIntensity),
    reducedMotion: oneOf(s.reducedMotion, ["system", "on", "off"] as const, DEFAULT_SETTINGS.reducedMotion),
    performanceMode: oneOf(s.performanceMode, ["auto", "high", "balanced", "battery"] as const, DEFAULT_SETTINGS.performanceMode),
    diagnostics: bool("diagnostics", DEFAULT_SETTINGS.diagnostics),
    lastInstrument: typeof s.lastInstrument === "string" ? s.lastInstrument.slice(0, 40) : null,
    cameraBackdrop: bool("cameraBackdrop", DEFAULT_SETTINGS.cameraBackdrop),
    backdropOpacity: Math.max(0.15, num("backdropOpacity", DEFAULT_SETTINGS.backdropOpacity)),
    handSkeleton: bool("handSkeleton", DEFAULT_SETTINGS.handSkeleton),
  };
}

type Listener = () => void;

/**
 * Small external store for preferences. Reads once from localStorage on first
 * access (never at module initialisation), writes are debounced.
 */
class SettingsStore {
  private settings: Settings = DEFAULT_SETTINGS;
  private loaded = false;
  private listeners = new Set<Listener>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  get = (): Settings => {
    if (!this.loaded && typeof window !== "undefined") {
      this.loaded = true;
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        this.settings = parseSettings(raw ? JSON.parse(raw) : null);
      } catch {
        this.settings = { ...DEFAULT_SETTINGS };
      }
    }
    return this.settings;
  };

  getServerSnapshot = (): Settings => DEFAULT_SETTINGS;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update = (patch: Partial<Settings>): void => {
    this.settings = parseSettings({ ...this.get(), ...patch });
    this.listeners.forEach((l) => l());
    this.scheduleWrite();
  };

  reset = (): void => {
    this.settings = { ...DEFAULT_SETTINGS };
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((l) => l());
  };

  /** Writes immediately (used before navigation/unload). */
  flush = (): void => {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode or quota: settings stay in memory for this session */
    }
  };

  /** Test helper. */
  _reload = (): void => {
    this.loaded = false;
  };

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(this.flush, 300);
    this.guardUnload();
  }

  private unloadGuarded = false;

  /**
   * A pending debounced write would be lost if the page is reloaded, closed
   * or backgrounded (and killed) within the debounce window, so flush then.
   */
  private guardUnload(): void {
    if (this.unloadGuarded || typeof window === "undefined") return;
    this.unloadGuarded = true;
    const flushPending = () => {
      if (this.writeTimer) this.flush();
    };
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPending();
    });
  }
}

export const settingsStore = new SettingsStore();
