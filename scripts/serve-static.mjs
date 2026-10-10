// Minimal static file server for the exported site (used by `npm start` and
// the Playwright tests). Production should use a real static host/CDN; see
// docs/DEPLOYMENT.md. Serves out/ with correct MIME types (incl. .wasm),
// directory index files, the 404 page and the headers from public/_headers.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "out");
const port = Number(process.env.PORT ?? process.argv[2] ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, safe);
  if (!file.startsWith(root)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  return existsSync(file) ? file : null;
}

createServer((req, res) => {
  const url = req.url ?? "/";
  // Mirror trailingSlash: true — /studio → /studio/
  if (!extname(url.split("?")[0] ?? "") && !url.split("?")[0]?.endsWith("/")) {
    const [path, query] = url.split("?");
    res.writeHead(308, { Location: `${path}/${query ? `?${query}` : ""}` });
    return res.end();
  }
  const file = resolvePath(url);
  const headers = { ...SECURITY_HEADERS };
  if (!file) {
    res.writeHead(404, { ...headers, "Content-Type": TYPES[".html"] });
    return createReadStream(join(root, "404.html")).pipe(res);
  }
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const cache = url.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : url.startsWith("/sw") ? "no-cache" : "public, max-age=0, must-revalidate";
  res.writeHead(200, { ...headers, "Content-Type": type, "Cache-Control": cache, "Content-Length": statSync(file).size });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Aura static server on http://localhost:${port}`));
