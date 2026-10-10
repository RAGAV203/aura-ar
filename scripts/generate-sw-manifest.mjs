// Walks the static export in out/ and writes out/sw-manifest.js: the exact list
// of app-shell URLs for this build plus a content hash used as the cache version.
// Optional assets (the MediaPipe runtime under /mediapipe/) are deliberately excluded.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const outDir = join(root, "out");
if (!existsSync(outDir)) {
  console.error("[sw-manifest] out/ not found — run next build first.");
  process.exit(1);
}

const EXCLUDE = [/^mediapipe\//, /^sw\.js$/, /^sw-manifest\.js$/, /^_headers$/, /\.map$/];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const hash = createHash("sha256");
const shell = [];
for (const file of walk(outDir).sort()) {
  const rel = relative(outDir, file).split(sep).join("/");
  if (EXCLUDE.some((pattern) => pattern.test(rel))) continue;
  hash.update(rel);
  hash.update(readFileSync(file));
  // Pages are requested by directory URL (trailingSlash: true).
  if (rel === "index.html") shell.push("/");
  else if (rel.endsWith("/index.html")) shell.push(`/${rel.slice(0, -"index.html".length)}`);
  else shell.push(`/${rel}`);
}

const version = hash.digest("hex").slice(0, 12);
const body = `self.__AURA_MANIFEST = ${JSON.stringify({ version, shell }, null, 0)};\n`;
writeFileSync(join(outDir, "sw-manifest.js"), body);
const bytes = shell.reduce((sum, path) => {
  const rel = path === "/" ? "index.html" : path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1);
  return sum + statSync(join(outDir, rel)).size;
}, 0);
console.log(`[sw-manifest] version ${version}: ${shell.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB precached`);
