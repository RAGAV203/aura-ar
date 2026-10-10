// Copies the MediaPipe Tasks Vision WebAssembly runtime from node_modules into
// public/ so it is served from Aura's own origin (no third-party script CDN,
// works with a strict CSP and can be cached for offline use).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const target = join(root, "public", "mediapipe", "wasm");
const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

if (!existsSync(source)) {
  console.error("[copy-mediapipe-wasm] @mediapipe/tasks-vision is not installed. Run npm install first.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(source, file), join(target, file));
// The CommonJS bundle is loaded with importScripts() by public/vision-worker.js.
// Renamed to .js so every static host serves it with a JavaScript MIME type.
copyFileSync(join(source, "..", "vision_bundle.cjs"), join(target, "..", "vision_bundle.js"));

const { version } = JSON.parse(readFileSync(join(source, "..", "package.json"), "utf8"));
console.log(`[copy-mediapipe-wasm] copied ${files.length + 1} files from @mediapipe/tasks-vision@${version}`);
