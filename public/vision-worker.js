/* Aura vision worker (classic worker).
 *
 * Runs MediaPipe hand / pose inference off the main thread so rendering stays
 * smooth. It is a classic (non-module) worker because MediaPipe's WASM loader
 * relies on importScripts(). The CommonJS bundle is copied to
 * /mediapipe/vision_bundle.js at build time (scripts/copy-mediapipe-wasm.mjs).
 *
 * Protocol (main → worker):
 *   { type: "init", wasmLoaderPath, wasmBinaryPath, handModel: ArrayBuffer, poseModel: ArrayBuffer | null }
 *   { type: "frame", bitmap: ImageBitmap, timestamp }   (bitmap is transferred and closed here)
 *   { type: "close" }
 * Worker → main:
 *   { type: "ready", delegate } | { type: "error", message }
 *   { type: "result", timestamp, landmarks, handedness, pose, inferenceMs } | { type: "frame-error" }
 *
 * Frames are never stored, logged or sent anywhere else.
 */
self.exports = {};
self.module = { exports: self.exports };
importScripts("/mediapipe/vision_bundle.js");
const vision = self.module.exports;

let hands = null;
let pose = null;

async function createWithFallback(create) {
  try {
    return { task: await create("GPU"), delegate: "GPU" };
  } catch {
    return { task: await create("CPU"), delegate: "CPU" };
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === "init") {
    try {
      const fileset = { wasmLoaderPath: msg.wasmLoaderPath, wasmBinaryPath: msg.wasmBinaryPath };
      const created = await createWithFallback((delegate) =>
        vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: new Uint8Array(msg.handModel), delegate },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5,
        }),
      );
      hands = created.task;
      if (msg.poseModel) {
        pose = (
          await createWithFallback((delegate) =>
            vision.PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetBuffer: new Uint8Array(msg.poseModel), delegate },
              runningMode: "VIDEO",
              numPoses: 1,
            }),
          )
        ).task;
      }
      self.postMessage({ type: "ready", delegate: created.delegate });
    } catch (error) {
      self.postMessage({ type: "error", message: String((error && error.message) || error) });
    }
    return;
  }

  if (msg.type === "frame") {
    const bitmap = msg.bitmap;
    try {
      if (!hands) throw new Error("not ready");
      const start = performance.now();
      const handResult = hands.detectForVideo(bitmap, msg.timestamp);
      const poseResult = pose ? pose.detectForVideo(bitmap, msg.timestamp) : null;
      self.postMessage({
        type: "result",
        timestamp: msg.timestamp,
        landmarks: handResult.landmarks,
        handedness: handResult.handedness,
        pose: poseResult && poseResult.landmarks[0] ? poseResult.landmarks[0] : null,
        inferenceMs: performance.now() - start,
      });
    } catch {
      self.postMessage({ type: "frame-error" });
    } finally {
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
    }
    return;
  }

  if (msg.type === "close") {
    if (hands) hands.close();
    if (pose) pose.close();
    hands = pose = null;
    self.close();
  }
};
