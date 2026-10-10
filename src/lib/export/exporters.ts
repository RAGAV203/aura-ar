import { AppError } from "@/lib/errors/appErrors";
import { pickRecordingMimeType } from "@/lib/browser/capabilities";

/** Page background painted behind the (transparent) artwork in exports. */
const EXPORT_BACKGROUND = "#080914";

/** Optional camera layer for exports; only used after the person opts in. */
export interface CameraLayer {
  video: HTMLVideoElement;
  mirrored: boolean;
  opacity: number;
}

/** Draws background (+ optional camera, cropped like the studio view) + artwork onto ctx. */
function paintComposite(ctx: CanvasRenderingContext2D, art: HTMLCanvasElement, camera: CameraLayer | null): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, W, H);
  const video = camera?.video;
  if (camera && video && video.videoWidth > 0) {
    const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
    const dw = video.videoWidth * scale;
    const dh = video.videoHeight * scale;
    ctx.save();
    ctx.globalAlpha = camera.opacity;
    if (camera.mirrored) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.drawImage(art, 0, 0, W, H);
  ctx.restore();
}

/** Flattens the artwork onto the background (and camera, if given) for image export. */
export function composeArtwork(art: HTMLCanvasElement, camera: CameraLayer | null = null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = art.width;
  canvas.height = art.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AppError("export-failed");
  paintComposite(ctx, art, camera);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new AppError("export-failed"))), type, quality);
    } catch (error) {
      reject(new AppError("export-failed", { cause: error }));
    }
  });
}

/** Downscaled JPEG used for library thumbnails (small, decodes fast). */
export async function createThumbnail(source: HTMLCanvasElement, maxWidth = 480): Promise<Blob> {
  const ratio = Math.min(1, maxWidth / Math.max(1, source.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AppError("export-failed");
  // Thumbnails never include the camera; JPEG has no alpha, so paint the background first.
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, "image/jpeg", 0.82);
}

export function fileSafeName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "aura";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AppError("import-invalid"));
    };
    image.src = url;
  });
}

export interface RecordingHandle {
  stop(): void;
  result: Promise<{ blob: Blob; extension: string }>;
}

/**
 * Records the artwork (composited onto the background, plus the camera when
 * the person opted in) together with the audio graph, using MediaRecorder.
 * Returns null when the browser can't record; callers fall back to PNG.
 */
export function startRecording(art: HTMLCanvasElement, audio: MediaStream | null, camera: CameraLayer | null = null, maxDurationMs = 15_000): RecordingHandle | null {
  const mimeType = pickRecordingMimeType();
  const compositor = document.createElement("canvas");
  compositor.width = art.width;
  compositor.height = art.height;
  const ctx = compositor.getContext("2d");
  if (!mimeType || !ctx || typeof compositor.captureStream !== "function") return null;
  let frame = 0;
  const paint = () => {
    paintComposite(ctx, art, camera);
    frame = requestAnimationFrame(paint);
  };
  paint();
  const stream = compositor.captureStream(30);
  audio?.getAudioTracks().forEach((track) => stream.addTrack(track));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  } catch {
    cancelAnimationFrame(frame);
    return null;
  }
  const chunks: Blob[] = [];
  const result = new Promise<{ blob: Blob; extension: string }>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      cancelAnimationFrame(frame);
      stream.getVideoTracks().forEach((t) => t.stop());
      compositor.width = compositor.height = 1;
      if (chunks.length === 0) return reject(new AppError("export-failed"));
      resolve({ blob: new Blob(chunks, { type: mimeType }), extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" });
    };
    recorder.onerror = () => {
      cancelAnimationFrame(frame);
      reject(new AppError("export-failed"));
    };
  });
  recorder.start(500);
  const timer = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), maxDurationMs);
  return {
    stop() {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
    },
    result,
  };
}
