/**
 * Browser feature detection. Every function is safe to call during server
 * rendering (returns the conservative answer) and never caches globals at
 * module initialisation.
 */

export const isBrowser = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";

export function supportsCamera(): boolean {
  return isBrowser() && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

export function isSecureContextForCamera(): boolean {
  return isBrowser() && window.isSecureContext;
}

let webglSupport: boolean | null = null;

/** Cached: probing creates (and immediately releases) a WebGL context. */
export function supportsWebGL(): boolean {
  if (!isBrowser()) return false;
  webglSupport ??= probeWebGL();
  return webglSupport;
}

function probeWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const supported = !!context;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

export function supportsWebAudio(): boolean {
  return isBrowser() && (typeof AudioContext !== "undefined" || "webkitAudioContext" in window);
}

export function supportsIndexedDB(): boolean {
  try {
    return isBrowser() && typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export function supportsServiceWorker(): boolean {
  return isBrowser() && "serviceWorker" in navigator;
}

export function supportsCacheStorage(): boolean {
  return isBrowser() && "caches" in window;
}

export function supportsVideoRecording(): boolean {
  if (!isBrowser() || typeof MediaRecorder === "undefined") return false;
  const canvas = document.createElement("canvas");
  return typeof canvas.captureStream === "function" && pickRecordingMimeType() !== null;
}

export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function prefersReducedMotion(): boolean {
  return isBrowser() && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isStandalone(): boolean {
  if (!isBrowser()) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

export function isIOS(): boolean {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/**
 * Conservative initial quality guess. Runtime frame measurements refine it
 * (see lib/performance/qualityController.ts).
 */
export function estimateInitialQuality(): "high" | "balanced" | "battery" {
  if (!isBrowser()) return "balanced";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (cores <= 4 || memory <= 2) return "battery";
  if (!coarse && cores >= 8 && memory >= 8) return "high";
  return "balanced";
}
