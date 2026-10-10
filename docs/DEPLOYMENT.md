# Deployment

Aura is a static site. `npm run build` produces `out/`; upload that directory to any static host or CDN over **HTTPS** (camera and service workers require a secure context).

## Build

```bash
npm ci
npm run check          # lint, typecheck, unit tests, build
npm run test:e2e       # optional but recommended before release
```

The build:
1. copies the MediaPipe runtime from `node_modules` to `public/mediapipe/` (`scripts/copy-mediapipe-wasm.mjs`),
2. runs `next build` (static export),
3. writes `out/sw-manifest.js` — the precache list plus a content hash used as the cache version.

## Hosting requirements

| Path | Header |
| --- | --- |
| `/*` | The security headers in `public/_headers` (CSP, Permissions-Policy `camera=(self), microphone=()`, nosniff, Referrer-Policy, COOP) |
| `/sw.js`, `/sw-manifest.js` | `Cache-Control: no-cache` (**required** — otherwise updates are delayed) |
| `/_next/static/*` | `Cache-Control: public, max-age=31536000, immutable` |
| `*.wasm` | `Content-Type: application/wasm` |

- **Netlify / Cloudflare Pages:** `public/_headers` is copied into `out/` and applied automatically.
- **Vercel:** deploy as a static Next.js export (framework preset "Other", output `out`), and port `_headers` into `vercel.json` `headers`.
- **S3 + CloudFront / nginx:** set the headers above on the distribution / server block; serve `404.html` for missing paths; `trailingSlash` URLs map to `dir/index.html`.

The CSP is also embedded as a `<meta>` tag in production HTML so it applies on hosts without header support (`frame-ancestors` only works as a real header).

## Environment

Only `NEXT_PUBLIC_MODEL_BASE_URL` (optional) — see `.env.example`. To self-host models, mirror `hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` and `pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` with CORS enabled, set the variable, and update `connect-src` in both `src/app/layout.tsx` and `public/_headers`.

## Updates

1. Deploy a new build. Its `sw-manifest.js` has a new version hash.
2. Open clients check for updates on load and whenever the tab becomes visible.
3. The new worker installs the full shell atomically (a failed download aborts the install; the browser retries later) and then **waits**.
4. The user sees “A new version of Aura is ready — Update”. Accepting saves a recovery draft of any unsaved studio work, activates the worker and reloads.
5. Old `aura-shell-*` caches are deleted on activation. The model cache is kept.

Rollback: redeploy the previous build; clients treat it as another update.

## Release checklist

- [ ] `npm run check` and `npm run test:e2e` pass
- [ ] Real-device pass on a current iPhone (Safari + Home Screen) and a mid/low-end Android (Chrome): camera permission, tracking, audio activation, safe areas, offline relaunch, background/foreground
- [ ] Performance sampled with Settings → Diagnostics (FPS, inference ms, quality) during 5-minute sessions
- [ ] `npm audit --omit=dev` clean
- [ ] Headers verified with `curl -I` on the deployed URL
