# Aura

**Move your hands. Shape your world.**

Aura is a mobile-first creative web app: 24 instruments that turn hand gestures (via the camera) or touch into sound and generative visuals. When the camera is on, the live view fills the screen and the instruments are drawn over it, aligned with your hands. Everything — camera processing, audio synthesis, storage — runs on the device. It installs as a PWA and works offline once cached.

| Category | Instruments |
| --- | --- |
| **Performance surfaces** | **Pitch Grid** — an isomorphic note grid in the style of GeoShred (rows in fourths, roots highlighted, diatonic or chromatic), with a hardware-style control panel: octave, auto-tune, expression XY pad, whammy / vibrato / filter faders, 2nd harmonic, pinch harmonic on release, piano / guitar / slide transitions, backing track, track and amp volume, 10 sounds and a preset browser |
| **Strings** | **Guitar** (acoustic, nylon, electric, ukulele — chord pads, strumming, palm mute) · **Veena** (Carnatic ragas, meend, slides, tanpura) · **Sitar** (Hindustani ragas, jawari buzz, sympathetic strings) · **Violin & Cello** (bow speed = volume) · **String Harp** |
| **Percussion** | **Drum Kit** (realistic kit, simulated sticks in both hands) · **Freestyle Drums** (air drumming with sticks + looper) · **Tabla** (bols, Dha/Dhin, bayan glide) · **Marimba** (mallets) · **Handpan** |
| **Keys, winds & ensemble** | **Piano** · **Flute** · **Trumpet** · **Orchestra** (conduct strings, winds, brass, timpani) · **Kalimba** |
| **Electronic** | **Theremin** (pitch antenna + volume loop, live tuner) |
| **Light & space** | Aurora · InkFlow · Light Trails · Particle Bloom · Cosmic Garden (3D) · Ripple Pond · Magnetic Field |

Sound is synthesised on the device: Karplus–Strong physical models for plucked strings (in tune to within a few cents, with real pitch bends), additive/FM synthesis for bars, tines, steel and bells, and native Web Audio voices for bowed, wind and brass sounds.

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
| `npm run icons` | Regenerates the logo, app icons and favicon from `scripts/generate-icons.mjs` (uses Playwright Chromium) |

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
