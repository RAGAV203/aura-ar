import type { HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { AppError, logDiagnostic, toAppError } from "@/lib/errors/appErrors";
import { fetchAsset, getAssetPack, HAND_MODEL, WORKER_BUNDLE, packSize, POSE_MODEL, wasmFiles, type ProgressCallback } from "@/lib/offline/assetPacks";
import type { QualityLevel } from "@/types/instruments";
import type { TrackingFrame } from "@/types/gestures";
import { openCamera, stopStream, type FacingMode } from "./camera";
import { normalizeHands, normalizePose, type RawCategory, type RawLandmark } from "./normalize";

export type VisionPhase = "idle" | "requesting-camera" | "downloading" | "initializing" | "running" | "paused" | "error";

export interface VisionStatus {
  phase: VisionPhase;
  /** 0..1 while downloading. */
  progress: number;
  error: AppError | null;
}

export interface VisionOptions {
  pose: boolean;
  quality: QualityLevel;
  facingMode: FacingMode;
}

type FrameListener = (frame: TrackingFrame) => void;
type StatusListener = (status: VisionStatus) => void;

const INFERENCE_INTERVAL_MS: Record<QualityLevel, number> = { high: 1000 / 30, balanced: 1000 / 24, battery: 1000 / 15 };

/**
 * Owns the camera stream, the MediaPipe runtime and the per-frame inference
 * loop. Publishes normalised TrackingFrames and never touches React.
 *
 * Inference runs in a classic Web Worker (public/vision-worker.js): video
 * frames are copied to transferable ImageBitmaps and at most one frame is in
 * flight, so the main thread never waits on the model. If the worker can't
 * start (old browser, no createImageBitmap for video), inference falls back
 * to the main thread with an adaptive gap so it uses at most ~30% of frame
 * time even on slow devices.
 */
export class VisionEngine {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private hands: HandLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private frameListeners = new Set<FrameListener>();
  private statusListeners = new Set<StatusListener>();
  private status: VisionStatus = { phase: "idle", progress: 0, error: null };
  private loopHandle: number | null = null;
  private lastInference = 0;
  private lastVideoTime = -1;
  private lastInferenceMs = 0;
  private worker: Worker | null = null;
  private frameInFlight = false;
  private generation = 0;
  private options: VisionOptions;
  private readonly onVisibilityChange = () => this.handleVisibility();

  constructor(options: Partial<VisionOptions> = {}) {
    this.options = { pose: false, quality: "balanced", facingMode: "user", ...options };
  }

  getStatus(): VisionStatus {
    return this.status;
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Where inference currently runs (diagnostics). */
  inferenceMode(): "worker" | "main" | null {
    if (this.worker) return "worker";
    return this.hands ? "main" : null;
  }

  setQuality(quality: QualityLevel): void {
    this.options.quality = quality;
  }

  async start(video: HTMLVideoElement, options: Partial<VisionOptions> = {}): Promise<void> {
    this.stop();
    this.options = { ...this.options, ...options };
    const generation = ++this.generation;
    this.video = video;

    try {
      this.setStatus({ phase: "requesting-camera", progress: 0, error: null });
      const stream = await openCamera(this.options.facingMode);
      if (generation !== this.generation) return stopStream(stream);
      this.stream = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);

      this.setStatus({ phase: "downloading", progress: 0, error: null });
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const simd = await FilesetResolver.isSimdSupported();
      const pack = getAssetPack("hands", simd);
      const total = packSize(pack) + (this.options.pose ? POSE_MODEL.approxBytes : 0);
      const progress = new Map<string, number>();
      const track =
        (url: string): ProgressCallback =>
        (loaded) => {
          progress.set(url, loaded);
          const sum = [...progress.values()].reduce((a, b) => a + b, 0);
          this.setStatus({ phase: "downloading", progress: Math.min(sum / total, 1), error: null });
        };

      // Warm the cache for the WASM runtime so it is available offline; the
      // loader itself is fetched by MediaPipe through the service worker.
      const wasm = wasmFiles(simd);
      await fetchAsset(wasm.loader, track(wasm.loader.url));
      await fetchAsset(wasm.binary, track(wasm.binary.url));
      await fetchAsset(WORKER_BUNDLE, track(WORKER_BUNDLE.url));
      const handModel = await fetchAsset(HAND_MODEL, track(HAND_MODEL.url));
      const poseModel = this.options.pose ? await fetchAsset(POSE_MODEL, track(POSE_MODEL.url)) : null;
      if (generation !== this.generation) return;

      this.setStatus({ phase: "initializing", progress: 1, error: null });
      const fileset = { wasmLoaderPath: wasm.loader.url, wasmBinaryPath: wasm.binary.url };
      const worker = await startWorker(fileset, handModel, poseModel);
      if (generation !== this.generation) {
        worker?.terminate();
        return;
      }
      if (worker) {
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onWorkerMessage(event.data);
        worker.onerror = () => void this.fallBackToMainThread(fileset, handModel, poseModel);
      } else try {
        this.hands = await createWithFallback((delegate) =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: handModel, delegate },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.5,
          }),
        );
        if (poseModel) {
          this.pose = await createWithFallback((delegate) =>
            PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetBuffer: poseModel, delegate },
              runningMode: "VIDEO",
              numPoses: 1,
            }),
          );
        }
      } catch (error) {
        throw toAppError(error, "model-init-failed");
      }
      if (generation !== this.generation) return this.releaseModels();
      logDiagnostic("vision", this.worker ? "inference in worker" : "inference on main thread");

      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.setStatus({ phase: "running", progress: 1, error: null });
      this.scheduleLoop();
    } catch (error) {
      if (generation !== this.generation) return;
      const appError = toAppError(error, "model-download-failed");
      logDiagnostic("vision", `start failed: ${appError.code}`, error);
      this.stop();
      this.setStatus({ phase: "error", progress: 0, error: appError });
      throw appError;
    }
  }

  /** Stops the camera, the loop and releases the models. Safe to call repeatedly. */
  stop(): void {
    this.generation++;
    if (this.loopHandle !== null) cancelAnimationFrame(this.loopHandle);
    this.loopHandle = null;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    stopStream(this.stream);
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.releaseModels();
    this.lastVideoTime = -1;
    if (this.status.phase !== "idle" && this.status.phase !== "error") this.setStatus({ phase: "idle", progress: 0, error: null });
  }

  dispose(): void {
    this.stop();
    this.frameListeners.clear();
    this.statusListeners.clear();
  }

  private releaseModels(): void {
    if (this.worker) {
      this.worker.postMessage({ type: "close" });
      this.worker.terminate();
      this.worker = null;
    }
    this.frameInFlight = false;
    this.hands?.close();
    this.pose?.close();
    this.hands = null;
    this.pose = null;
  }

  private handleVisibility(): void {
    const hidden = document.visibilityState === "hidden";
    this.stream?.getVideoTracks().forEach((track) => (track.enabled = !hidden));
    if (hidden && this.status.phase === "running") {
      if (this.loopHandle !== null) cancelAnimationFrame(this.loopHandle);
      this.loopHandle = null;
      this.setStatus({ ...this.status, phase: "paused" });
    } else if (!hidden && this.status.phase === "paused") {
      this.setStatus({ ...this.status, phase: "running" });
      this.scheduleLoop();
    }
  }

  private scheduleLoop(): void {
    const tick = () => {
      this.loopHandle = requestAnimationFrame(tick);
      this.process();
    };
    this.loopHandle = requestAnimationFrame(tick);
  }

  private process(): void {
    const video = this.video;
    if (!video || video.readyState < 2) return;
    const now = performance.now();
    if (video.currentTime === this.lastVideoTime) return;

    if (this.worker) {
      if (this.frameInFlight || now - this.lastInference < INFERENCE_INTERVAL_MS[this.options.quality]) return;
      this.lastVideoTime = video.currentTime;
      this.lastInference = now;
      this.frameInFlight = true;
      const worker = this.worker;
      createImageBitmap(video)
        .then((bitmap) => {
          if (this.worker !== worker) return bitmap.close();
          worker.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
        })
        .catch(() => {
          this.frameInFlight = false;
        });
      return;
    }

    const hands = this.hands;
    if (!hands) return;
    // Main-thread fallback: leave at least ~70% of the time for rendering.
    const gap = Math.max(INFERENCE_INTERVAL_MS[this.options.quality], this.lastInferenceMs * 2.5);
    if (now - this.lastInference < gap) return;
    this.lastVideoTime = video.currentTime;
    this.lastInference = now;

    try {
      const start = performance.now();
      const mirrored = this.options.facingMode === "user";
      const handResult = hands.detectForVideo(video, now);
      const poseResult = this.pose?.detectForVideo(video, now);
      const frame: TrackingFrame = {
        timestamp: now,
        hands: normalizeHands(handResult.landmarks, handResult.handedness, mirrored),
        pose: normalizePose(poseResult?.landmarks[0], mirrored),
        inferenceMs: performance.now() - start,
      };
      this.lastInferenceMs = frame.inferenceMs;
      this.frameListeners.forEach((listener) => listener(frame));
    } catch (error) {
      logDiagnostic("vision", "inference failed", error);
    }
  }

  private onWorkerMessage(message: WorkerMessage): void {
    if (message.type === "frame-error") {
      this.frameInFlight = false;
      return;
    }
    if (message.type !== "result") return;
    this.frameInFlight = false;
    const mirrored = this.options.facingMode === "user";
    const frame: TrackingFrame = {
      timestamp: message.timestamp,
      hands: normalizeHands(message.landmarks, message.handedness, mirrored),
      pose: normalizePose(message.pose ?? undefined, mirrored),
      inferenceMs: message.inferenceMs,
    };
    this.lastInferenceMs = frame.inferenceMs;
    this.frameListeners.forEach((listener) => listener(frame));
  }

  /** The worker crashed mid-session: continue on the main thread. */
  private async fallBackToMainThread(fileset: Fileset, handModel: Uint8Array, poseModel: Uint8Array | null): Promise<void> {
    logDiagnostic("vision", "worker failed; falling back to main thread");
    this.worker?.terminate();
    this.worker = null;
    this.frameInFlight = false;
    try {
      const { HandLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      this.hands = await createWithFallback((delegate) =>
        HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: handModel, delegate }, runningMode: "VIDEO", numHands: 2 }),
      );
      if (poseModel) {
        this.pose = await createWithFallback((delegate) =>
          PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: poseModel, delegate }, runningMode: "VIDEO", numPoses: 1 }),
        );
      }
    } catch (error) {
      this.stop();
      this.setStatus({ phase: "error", progress: 0, error: toAppError(error, "model-init-failed") });
    }
  }

  private setStatus(status: VisionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

async function createWithFallback<T>(create: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await create("GPU");
  } catch (error) {
    logDiagnostic("vision", "GPU delegate unavailable, falling back to CPU", error);
    return create("CPU");
  }
}

interface Fileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

type WorkerMessage =
  | { type: "ready"; delegate: string }
  | { type: "error"; message: string }
  | { type: "frame-error" }
  | {
      type: "result";
      timestamp: number;
      landmarks: RawLandmark[][];
      handedness: RawCategory[][];
      pose: RawLandmark[] | null;
      inferenceMs: number;
    };

const WORKER_READY_TIMEOUT_MS = 20_000;

/**
 * Starts the inference worker and waits for the models to initialise.
 * Resolves null if workers or video ImageBitmaps aren't usable here, so the
 * caller can fall back to main-thread inference. Model bytes are copied, not
 * transferred, so the fallback can still use them.
 */
async function startWorker(fileset: Fileset, handModel: Uint8Array, poseModel: Uint8Array | null): Promise<Worker | null> {
  if (typeof Worker === "undefined" || typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker("/vision-worker.js", { name: "aura-vision" });
  } catch {
    return null;
  }
  const hand = handModel.slice().buffer;
  const pose = poseModel ? poseModel.slice().buffer : null;
  return new Promise((resolve) => {
    const finish = (result: Worker | null) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (!result) worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), WORKER_READY_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === "ready") finish(worker);
      else if (event.data.type === "error") {
        logDiagnostic("vision", "worker init failed", event.data.message);
        finish(null);
      }
    };
    worker.onerror = () => finish(null);
    worker.postMessage({ type: "init", ...fileset, handModel: hand, poseModel: pose }, pose ? [hand, pose] : [hand]);
  });
}
