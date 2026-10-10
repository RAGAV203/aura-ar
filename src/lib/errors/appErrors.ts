/**
 * Every recoverable failure the interface can present. Each code maps to a
 * human-readable explanation and a suggested next action; raw stack traces are
 * never shown to the user.
 */
export type AppErrorCode =
  | "camera-denied"
  | "camera-not-found"
  | "camera-in-use"
  | "camera-insecure-context"
  | "unsupported-browser"
  | "model-download-failed"
  | "model-init-failed"
  | "tracking-lost"
  | "webgl-unavailable"
  | "webgl-context-lost"
  | "audio-activation-failed"
  | "storage-unavailable"
  | "storage-quota-exceeded"
  | "storage-write-failed"
  | "import-invalid"
  | "import-too-large"
  | "export-failed"
  | "offline-asset-missing"
  | "update-failed"
  | "unknown";

export interface AppErrorInfo {
  title: string;
  message: string;
  action: string;
}

export const ERROR_CATALOG: Record<AppErrorCode, AppErrorInfo> = {
  "camera-denied": {
    title: "Camera access is blocked",
    message: "Aura can't see your hands because camera permission was declined.",
    action: "Allow camera access in your browser's site settings, then try again — or keep playing with touch.",
  },
  "camera-not-found": {
    title: "No camera found",
    message: "We couldn't find a camera on this device.",
    action: "Connect a camera and retry, or continue with touch controls.",
  },
  "camera-in-use": {
    title: "Camera is busy",
    message: "Another app or browser tab is using the camera right now.",
    action: "Close the other app or tab, then retry.",
  },
  "camera-insecure-context": {
    title: "Camera needs a secure connection",
    message: "Browsers only allow camera access on HTTPS or localhost.",
    action: "Open Aura over HTTPS, or continue with touch controls.",
  },
  "unsupported-browser": {
    title: "This browser is missing a feature",
    message: "Some capabilities Aura relies on aren't available in this browser.",
    action: "Update your browser, or use touch controls which work everywhere.",
  },
  "model-download-failed": {
    title: "Hand tracking couldn't download",
    message: "The hand-tracking model didn't finish downloading. Your connection may be offline or interrupted.",
    action: "Check your connection and retry. Touch controls keep working meanwhile.",
  },
  "model-init-failed": {
    title: "Hand tracking couldn't start",
    message: "The tracking model downloaded but failed to start on this device.",
    action: "Retry, or switch Performance mode to Battery saver. Touch controls keep working.",
  },
  "tracking-lost": {
    title: "Looking for your hands",
    message: "Move your hands back into view of the camera.",
    action: "Make sure your hands are well lit and inside the frame.",
  },
  "webgl-unavailable": {
    title: "3D graphics unavailable",
    message: "This browser or device has WebGL turned off, so 3D instruments can't render.",
    action: "Try a 2D instrument such as Aurora or InkFlow, or enable hardware acceleration.",
  },
  "webgl-context-lost": {
    title: "Graphics were interrupted",
    message: "The device reclaimed graphics memory. Your settings are safe.",
    action: "Tap restore to restart the scene.",
  },
  "audio-activation-failed": {
    title: "Sound couldn't start",
    message: "The browser blocked or failed to start audio.",
    action: "Tap the sound button again. On iPhone, check that silent mode is off.",
  },
  "storage-unavailable": {
    title: "Saving isn't available",
    message: "This browser context doesn't allow local storage (private browsing can do this).",
    action: "Export your creation as a file instead, or open Aura in a regular window.",
  },
  "storage-quota-exceeded": {
    title: "Storage is full",
    message: "There isn't enough space on this device to save.",
    action: "Delete or export older creations in your library, then try again.",
  },
  "storage-write-failed": {
    title: "Couldn't save",
    message: "Something went wrong writing to local storage.",
    action: "Try again, or export the creation as a file to keep it safe.",
  },
  "import-invalid": {
    title: "That file can't be opened",
    message: "The file isn't a valid Aura project or it has been damaged.",
    action: "Choose a .aura.json file exported from Aura.",
  },
  "import-too-large": {
    title: "That file is too large",
    message: "Aura projects are limited to 8 MB to keep the app responsive.",
    action: "Choose a smaller project file.",
  },
  "export-failed": {
    title: "Export failed",
    message: "The artwork couldn't be exported in this browser.",
    action: "Try PNG export, or save the creation to your library.",
  },
  "offline-asset-missing": {
    title: "Not available offline yet",
    message: "This feature needs files that haven't been downloaded to this device.",
    action: "Reconnect to the internet once to download them.",
  },
  "update-failed": {
    title: "Update didn't install",
    message: "A new version of Aura couldn't be installed.",
    action: "Reload the page to try again. Your creations are safe.",
  },
  unknown: {
    title: "Something went wrong",
    message: "An unexpected problem occurred.",
    action: "Try again. If it keeps happening, reload Aura.",
  },
};

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    options?: { cause?: unknown },
  ) {
    super(ERROR_CATALOG[code].message, options);
    this.name = "AppError";
  }

  get info(): AppErrorInfo {
    return ERROR_CATALOG[this.code];
  }
}

export function toAppError(error: unknown, fallback: AppErrorCode = "unknown"): AppError {
  if (error instanceof AppError) return error;
  return new AppError(fallback, { cause: error });
}

/** Development-only diagnostics. Never pass camera, audio or user content here. */
export function logDiagnostic(scope: string, message: string, detail?: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[aura:${scope}] ${message}`, detail instanceof Error ? detail.message : (detail ?? ""));
  }
}
