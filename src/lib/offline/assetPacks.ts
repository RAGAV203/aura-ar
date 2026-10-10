import { AppError } from "@/lib/errors/appErrors";
import { supportsCacheStorage } from "@/lib/browser/capabilities";

/**
 * Optional downloads that are not part of the app shell. Instruments are fully
 * procedural, so only camera tracking needs extra files. Packs are stored in a
 * dedicated Cache Storage bucket which the service worker serves cache-first,
 * and a pack is only reported "ready" after every file has been verified.
 */
export const MODEL_CACHE_NAME = "aura-models-v1";

export type AssetPackId = "hands" | "pose";

export interface AssetFile {
  url: string;
  /** Approximate size, used for progress when Content-Length is missing. */
  approxBytes: number;
}

export interface AssetPack {
  id: AssetPackId;
  name: string;
  description: string;
  files: AssetFile[];
}

const MODEL_BASE_URL = (process.env.NEXT_PUBLIC_MODEL_BASE_URL ?? "https://storage.googleapis.com/mediapipe-models").replace(/\/$/, "");

export const WASM_BASE_PATH = "/mediapipe/wasm";

export function wasmFiles(simd: boolean): { loader: AssetFile; binary: AssetFile } {
  const name = simd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
  return {
    loader: { url: `${WASM_BASE_PATH}/${name}.js`, approxBytes: 322_000 },
    binary: { url: `${WASM_BASE_PATH}/${name}.wasm`, approxBytes: simd ? 11_154_000 : 10_481_000 },
  };
}

/** MediaPipe bundle loaded by the inference worker (public/vision-worker.js). */
export const WORKER_BUNDLE: AssetFile = { url: "/mediapipe/vision_bundle.js", approxBytes: 137_566 };

export const HAND_MODEL: AssetFile = {
  url: `${MODEL_BASE_URL}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  approxBytes: 7_819_105,
};

export const POSE_MODEL: AssetFile = {
  url: `${MODEL_BASE_URL}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  approxBytes: 5_777_746,
};

export function getAssetPack(id: AssetPackId, simd: boolean): AssetPack {
  if (id === "pose") {
    return {
      id,
      name: "Body pose",
      description: "Optional full-body interaction. Needs the hand tracking pack.",
      files: [POSE_MODEL],
    };
  }
  const wasm = wasmFiles(simd);
  return {
    id,
    name: "Hand tracking",
    description: "On-device hand tracking runtime and model.",
    files: [wasm.loader, wasm.binary, WORKER_BUNDLE, HAND_MODEL],
  };
}

export const packSize = (pack: AssetPack): number => pack.files.reduce((sum, f) => sum + f.approxBytes, 0);

export interface PackStatus {
  ready: boolean;
  cachedFiles: number;
  totalFiles: number;
  cachedBytes: number;
}

async function openModelCache(): Promise<Cache | null> {
  if (!supportsCacheStorage()) return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/** Verifies that each file is present and non-empty (and matches Content-Length when known). */
export async function getPackStatus(pack: AssetPack): Promise<PackStatus> {
  const cache = await openModelCache();
  const status: PackStatus = { ready: false, cachedFiles: 0, totalFiles: pack.files.length, cachedBytes: 0 };
  if (!cache) return status;
  for (const file of pack.files) {
    const response = await cache.match(file.url);
    if (!response) continue;
    const expected = Number(response.headers.get("x-aura-bytes") ?? response.headers.get("content-length") ?? 0);
    const blob = await response.blob();
    if (blob.size === 0 || (expected > 0 && blob.size !== expected)) continue;
    status.cachedFiles += 1;
    status.cachedBytes += blob.size;
  }
  status.ready = status.cachedFiles === status.totalFiles;
  return status;
}

export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Fetches a file with byte-level progress. When Cache Storage is available
 * the verified bytes are stored so the next session (or an offline one) can
 * use them without the network.
 */
export async function fetchAsset(file: AssetFile, onProgress?: ProgressCallback, signal?: AbortSignal): Promise<Uint8Array> {
  const cache = await openModelCache();
  const cached = await cache?.match(file.url);
  if (cached) {
    const buffer = new Uint8Array(await cached.arrayBuffer());
    if (buffer.byteLength > 0) {
      onProgress?.(buffer.byteLength, buffer.byteLength);
      return buffer;
    }
  }

  let response: Response;
  try {
    response = await fetch(file.url, { signal, cache: "no-cache" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AppError(navigator.onLine === false ? "offline-asset-missing" : "model-download-failed", { cause: error });
  }
  if (!response.ok) throw new AppError("model-download-failed", { cause: new Error(`HTTP ${response.status}`) });

  const total = Number(response.headers.get("content-length") ?? 0) || file.approxBytes;
  const bytes = await readWithProgress(response, total, onProgress);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (bytes.byteLength === 0 || (declared > 0 && bytes.byteLength !== declared)) {
    throw new AppError("model-download-failed", { cause: new Error("Incomplete download") });
  }

  if (cache) {
    try {
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      await cache.put(
        file.url,
        new Response(bytes.slice().buffer, {
          headers: { "content-type": contentType, "content-length": String(bytes.byteLength), "x-aura-bytes": String(bytes.byteLength) },
        }),
      );
    } catch {
      // Quota exceeded or private mode: the asset still works for this session.
    }
  }
  return bytes;
}

async function readWithProgress(response: Response, total: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, Math.max(total, loaded));
  }
  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Downloads every file in the pack, reporting aggregate progress. */
export async function downloadPack(pack: AssetPack, onProgress?: ProgressCallback, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  const total = packSize(pack);
  const loadedPerFile = new Map<string, number>();
  const results = new Map<string, Uint8Array>();
  for (const file of pack.files) {
    const bytes = await fetchAsset(
      file,
      (loaded) => {
        loadedPerFile.set(file.url, loaded);
        const sum = [...loadedPerFile.values()].reduce((a, b) => a + b, 0);
        onProgress?.(sum, Math.max(total, sum));
      },
      signal,
    );
    results.set(file.url, bytes);
  }
  return results;
}

export async function deletePack(pack: AssetPack): Promise<void> {
  const cache = await openModelCache();
  if (!cache) return;
  await Promise.all(pack.files.map((f) => cache.delete(f.url)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
