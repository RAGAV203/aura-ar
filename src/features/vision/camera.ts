import { AppError } from "@/lib/errors/appErrors";
import { isSecureContextForCamera, supportsCamera } from "@/lib/browser/capabilities";

export type FacingMode = "user" | "environment";

/** Maps getUserMedia failures to user-facing error codes. */
export function mapCameraError(error: unknown): AppError {
  const name = error instanceof Error || (typeof error === "object" && error !== null && "name" in error) ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new AppError("camera-denied", { cause: error });
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return new AppError("camera-not-found", { cause: error });
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new AppError("camera-in-use", { cause: error });
    default:
      return new AppError("unknown", { cause: error });
  }
}

/**
 * Requests a low-resolution camera stream. Video only — Aura never asks for
 * the microphone. Resolution is kept small because the hand model downsamples
 * anyway, and smaller frames are cheaper to upload to the GPU.
 */
export async function openCamera(facingMode: FacingMode = "user"): Promise<MediaStream> {
  if (!isSecureContextForCamera()) throw new AppError("camera-insecure-context");
  if (!supportsCamera()) throw new AppError("unsupported-browser");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (error) {
    throw mapCameraError(error);
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function countCameras(): Promise<number> {
  if (!supportsCamera() || typeof navigator.mediaDevices.enumerateDevices !== "function") return 0;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").length;
  } catch {
    return 0;
  }
}
