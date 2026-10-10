/* Aura service worker.
 *
 * Caches (explicitly versioned):
 *   aura-shell-<version>  App shell: every HTML page, JS/CSS chunk, font and icon of this
 *                         build (list generated into /sw-manifest.js at build time). Installing
 *                         is atomic: if any file fails to download, the install fails and the
 *                         browser retries later, so a half-cached shell is never activated.
 *   aura-runtime-v1       Same-origin files fetched at runtime that weren't precached.
 *   aura-models-v1        Optional tracking runtime + models. Written by the app (with progress
 *                         and verification) and served here cache-first. Never precached.
 *
 * Updates: a new worker waits until the page sends SKIP_WAITING (after the user accepts the
 * update prompt and unsaved work has been preserved).
 */
importScripts("/sw-manifest.js");

const MANIFEST = self.__AURA_MANIFEST || { version: "dev", shell: [] };
const SHELL_CACHE = `aura-shell-${MANIFEST.version}`;
const RUNTIME_CACHE = "aura-runtime-v1";
const MODEL_CACHE = "aura-models-v1";
const MODEL_HOST = "storage.googleapis.com";
const NAVIGATION_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(MANIFEST.shell)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("aura-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)));
      // The runtime cache may hold chunks from an older build; start clean on each version.
      await caches.delete(RUNTIME_CACHE);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "SHELL_STATUS" && event.ports[0]) {
    const port = event.ports[0];
    caches
      .open(SHELL_CACHE)
      .then(async (cache) => {
        const keys = await cache.keys();
        const cached = new Set(keys.map((request) => new URL(request.url).pathname));
        const count = MANIFEST.shell.filter((path) => cached.has(path)).length;
        port.postMessage({ cached: count, total: MANIFEST.shell.length, version: MANIFEST.version });
      })
      .catch(() => port.postMessage({ cached: 0, total: MANIFEST.shell.length, version: MANIFEST.version }));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === MODEL_HOST) {
    event.respondWith(cacheFirst(request, MODEL_CACHE, false));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/mediapipe/")) {
    event.respondWith(cacheFirst(request, MODEL_CACHE, false));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE, true));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

async function matchShell(request, options) {
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(request, options);
}

async function cacheFirst(request, runtimeCache, store) {
  const shellHit = await matchShell(request, { ignoreSearch: true });
  if (shellHit) return shellHit;
  const cache = await caches.open(runtimeCache);
  const hit = await cache.match(request, { ignoreSearch: runtimeCache === MODEL_CACHE });
  if (hit) return hit;
  const response = await fetch(request);
  if (store && response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function navigate(request) {
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    return response;
  } catch {
    const url = new URL(request.url);
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return (
      (await matchShell(path)) ||
      (await matchShell(request, { ignoreSearch: true })) ||
      (await matchShell("/")) ||
      new Response("<h1>Offline</h1><p>Aura hasn't finished downloading for offline use yet. Reconnect once to finish.</p>", {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function staleWhileRevalidate(request) {
  const cached = (await matchShell(request, { ignoreSearch: true })) || (await caches.open(RUNTIME_CACHE).then((c) => c.match(request)));
  const network = fetch(request)
    .then((response) => {
      if (response.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(request, response.clone())).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const response = await network;
  return response || new Response("", { status: 504, statusText: "Offline" });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
