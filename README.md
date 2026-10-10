# Aura

**Move your hands. Shape your world.**

Aura is a mobile-first creative web app: fourteen instruments that turn hand gestures (via the camera) or touch into generative visuals and sound. When the camera is on, the live view fills the screen and the artwork is drawn over it, aligned with your hands. Everything — camera processing, audio synthesis, storage — runs on the device. It installs as a PWA and works offline once cached.

| Instrument | What you do | Sound |
| --- | --- | --- |
| Aurora | Steer luminous curtains; height brightens, two hands widen | Ambient pad |
| InkFlow | Paint fluid ink; pinch sets brush width | Soft percussion |
| Light Trails | Long-exposure light painting with sparks | Plucked accents |
| Particle Bloom | Flower-shaped particle bursts | Filtered texture + swells |
| Cosmic Garden | 3D star field; plant glowing orbs (Three.js / R3F) | Evolving drone |
| String Harp | Sweep across strings of light to pluck them | Plucked harp |
| Ripple Pond | Drop stones and leave wakes on a pane of water | Droplets + water wash |
| Magnetic Field | Push and pull a field of glowing filings | FM bells |
| Piano | Play a glass keyboard; notes rise as light bars | Synthesised piano |
| Flute | Hold to blow; slide between notes, height = breath | Breathy flute (legato) |
| Trumpet | Tongued notes, golden bell-flare rings, fanfares | Brass |
| Orchestra | Conduct: beat the tempo, height = dynamics, point at sections | Strings, woodwinds, brass, timpani |
| Drum Kit | Nine pads; tap or strike down through them | Synth kit |
| Freestyle Drums | Air-drum anywhere; the zone picks the drum; built-in looper | Synth kit + looper |

Studio tools: camera backdrop with hand skeleton, front/back camera, undo, eraser, symmetry (mirror, quad, 6×, 8×), hide interface, PNG / project / video export (camera included only on explicit opt-in).

## Requirements

- Node.js **20.9+** (the dev tooling is pinned to versions that support Node 20; see `docs/ARCHITECTURE.md`).
- npm 10+.
- Network access at first build (Google Fonts are downloaded and self-hosted by `next/font`).

## Setup

```bash
npm install
cp .env.example .env.local   # optional — no secrets are needed
npm run dev                  # http://localhost:3000
```

The camera needs a secure context: `localhost` works; for a phone on your LAN use an HTTPS tunnel or deploy a preview.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Copies the MediaPipe runtime into `public/mediapipe/` and starts Next.js dev server |
| `npm run build` | Static export to `out/` + generates the service-worker precache manifest |
| `npm start` | Serves `out/` locally (`scripts/serve-static.mjs`) on port 3000 |
| `npm run lint` / `npm run typecheck` | ESLint (incl. React Compiler rules) / `tsc --noEmit` |
| `npm test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright against the production build (run `npm run build` first) |
| `npm run check` | lint + typecheck + unit tests + build |
| `npm run icons` | Regenerates the PNG app icons procedurally |

### End-to-end tests

```bash
npx playwright install chromium   # once
npm run build
npm run test:e2e
```

The camera spec downloads the real hand model (needs network; set `AURA_E2E_OFFLINE=1` to skip). Chromium's fake camera provides the video, so it verifies the full permission → download → worker inference → release pipeline, not gesture recognition accuracy (that is unit-tested and needs real devices).

## Project layout

```
src/
  app/                 Routes (static): / · /welcome · /studio · /instruments · /creations · /settings · /privacy
  components/          Layout, navigation, accessible UI primitives, feedback (toasts, errors, SW status)
  features/
    vision/            Camera, MediaPipe engine (worker + fallback), landmark normalisation, gesture interpreter
    audio/             Web Audio engine, voices, parameter limits
    instruments/       Registry (definitions/presets), engines (Canvas 2D + Cosmic Garden model), R3F scene, previews
    studio/            Studio session, instrument stage + loop, input (touch/keyboard/gesture/autopilot), sheets
    creations/         Schema/validation/migrations, IndexedDB repository, import/export, library UI
    onboarding/        First-use flow + gesture calibration
    settings/          Settings store and screen, offline packs
    home/              Home screen
  lib/                 browser capabilities, errors, persistence (IndexedDB), export, offline packs, PWA client, performance
  types/               Shared types: gestures, instruments, creations
public/                manifest, icons, sw.js, vision-worker.js, _headers
scripts/               build helpers (wasm copy, SW manifest, icons, static server)
tests/unit, tests/e2e  Vitest and Playwright suites
docs/                  Architecture, data schema, deployment, privacy & licences, status report
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module boundaries and technical decisions
- [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) — local data schema, project file format, migrations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting, headers, updates, release checklist
- [docs/PRIVACY_AND_LICENSES.md](docs/PRIVACY_AND_LICENSES.md) — privacy model and third-party licences
- [docs/STATUS.md](docs/STATUS.md) — what's done, what's verified, known limitations
