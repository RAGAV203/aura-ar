# Architecture & technical decisions

## Data flow

```
camera ─▶ VisionEngine ──frames──▶ vision-worker.js (MediaPipe)        touch / mouse / pen ─▶ TouchInput
            (camera, models,  ◀─landmarks─┘                             keyboard ─────────────▶ KeyboardInput
             loop, fallback)                                                                         │
                 │ TrackingFrame (normalised, mirrored, 0..1)                                        │
                 ▼                                                                                   │
           GestureInterpreter ── GestureState (smoothed, hysteresis, events) ─▶ InputHub ◀────────────┘
                                                                                   │ ControlInput (points, spread, events)
                                                                                   ▼
                                       InstrumentStage loop (rAF, outside React renders)
                                         │ engine.frame(dt, input)
                                         ├─▶ Canvas 2D engine / Cosmic Garden model ─▶ canvas / R3F scene (invalidate)
                                         └─▶ AudioEngine.update(targets) + play(notes)   (~30 Hz, clamped)
```

Every input source produces the same `ControlPoint` vocabulary (`position`, `velocity`, `amount`, `engaged`, `lifted`) and `ControlEvent`s (`tap`, `accent`). This is what makes touch, keyboard and gestures equivalent: instruments never know about cameras.

## Module boundaries

| Boundary | Location | Notes |
| --- | --- | --- |
| Vision engine | `features/vision/visionEngine.ts`, `public/vision-worker.js` | Owns camera stream, model download, worker lifecycle, frame loop. Publishes `TrackingFrame`s only. Raw pixels never leave it. |
| Gesture interpreter | `features/vision/gestureInterpreter.ts` | Pure, timestamp-driven: One-Euro smoothing, pinch hysteresis (on 0.32 / off 0.48 of hand size), palm hold (450 ms), stability gate (160 ms), lost-tracking (350 ms), event cooldowns. Unit-tested with synthetic hands. |
| Instrument engine | `features/instruments/engines/*`, `registry.ts` | `InstrumentEngine` interface: resize, parameters, quality, reduced motion, frame, audio targets, notes, reset, serialise/restore, dispose. |
| Rendering | `features/studio/InstrumentStage.tsx`, `scenes/CosmicGardenScene.tsx` | One rAF loop drives both Canvas 2D and R3F (`frameloop="demand"` + `invalidate()`). Typed arrays, sprite caches, no per-frame allocations in hot loops. |
| Audio engine | `features/audio/*` | Single `AudioContext` created on a user gesture; master gain → limiter → destination; `setTargetAtTime` smoothing; polyphony 6; ≥70 ms between notes; all values clamped (`audioMath.ts`). |
| Persistence | `lib/persistence/db.ts`, `features/creations/*` | Small IndexedDB wrapper, validation on every read and write, versioned migrations, quota error mapping. |
| Application UI | `app/*`, `features/*/…Screen.tsx`, `components/*` | Navigation, permission/loading/error/offline states. Works without camera and (for 2D instruments) without WebGL. |

## Decisions

1. **Static export (`output: "export"`, `trailingSlash: true`).** Nothing needs a server; deploys to any static host/CDN; makes the service-worker precache list deterministic (`scripts/generate-sw-manifest.mjs` hashes the build). Trade-off: CSP must be a `<meta>` tag (or host headers) and needs `'unsafe-inline'` for Next's inline hydration data.
2. **Hand-written service worker** instead of next-pwa/Workbox: those plugins lag Next 16/Turbopack. The worker is ~150 lines with explicit cache names and versions (see `public/sw.js`).
3. **MediaPipe in a classic Web Worker.** Next bundles module workers, but MediaPipe's loader needs `importScripts`. We copy the CommonJS bundle to `public/mediapipe/vision_bundle.js` and load it from `public/vision-worker.js` with an `exports` shim. Frames go over as transferable `ImageBitmap`s with one frame in flight. Measured in headless Chromium (CPU/SwiftShader): main-thread inference ≈170 ms dropped rendering to 5 fps; with the worker rendering stayed >20 fps. Fallback: main-thread inference with an adaptive gap (`max(interval, 2.5 × last inference)`).
4. **Models downloaded on demand**, not precached: hand pack ≈18.5 MB (WASM + bundle + model), pose ≈5.8 MB, loaded only when that instrument and setting need it. Stored in `aura-models-v1` by app code with byte-level progress and length verification; the SW serves it cache-first. A pack is "ready" only after `getPackStatus()` verifies every file.
5. **Canvas 2D for four instruments, WebGL only for Cosmic Garden** (the lightest renderer that fits). Three.js loads lazily (≈900 KB chunk) only when Cosmic Garden is used.
6. **No IndexedDB wrapper dependency, no schema library.** The needs are small; hand-written validators are explicit and fully tested.
7. **Creations are data plus a snapshot.** Parameters, seed, preset, mappings, audio settings and instrument state (e.g. orbs) are validated JSON. Instruments that accumulate marks (InkFlow, Light Trails) also store a PNG snapshot that is painted back on restore.
8. **Adaptive quality.** `estimateInitialQuality()` sets a conservative ceiling from cores/memory/pointer type; `QualityController` steps down after 3 s of sustained low FPS and cautiously back up. Quality scales particle budgets, pixel ratio caps, ribbon/star counts and (battery) caps rendering at 30 fps.
9. **Open palm is never destructive.** It lifts the brush or triggers a colour accent. Navigation, deletion and clearing are touch/click-only with confirmation when work is unsaved.
10. **Camera as the main view.** The artwork canvases are transparent (fades use `destination-out`, accumulated into ≥6% steps to avoid 8-bit ghost trails). The mirrored camera sits behind them with `object-fit: cover`, and `coverTransform()` maps tracked landmarks through the same crop so marks land on the fingertip. Snapshots and thumbnails never include camera pixels; exports add them only on explicit opt-in.
11. **Sustained voices** for melodic instruments (`features/audio/sustainedVoices.ts`): note on / update / off commands with per-family synthesis (piano partials + hammer, flute breath + vibrato, trumpet scoop + filter burst, strings, brass, woodwind), 16-voice cap with oldest-voice stealing. Drums are one-shot synth voices.
12. **three.js pinned to 0.182.0**: 0.183+ deprecates `THREE.Clock`, which React Three Fiber 9.8.1 still uses (console warning on every load). Upgrade three when R3F 10 is stable.
13. **Plucked strings are physical models.** `features/audio/pluckedString.ts` renders Karplus–Strong notes (noise burst, comb-filtered at the pick position, circulating in a delay line with averaging loss and an all-pass fractional delay; an in-loop cubic non-linearity gives sitar/veena jawari). Notes are rendered once per pitch into a cached AudioBuffer and played with `playbackRate` for meend and slides. Note the loop delay is L − 0.5 + all-pass, not L + 0.5 — getting this wrong makes high notes ~25 cents sharp (unit-tested by autocorrelation).
14. **Simulated drumsticks.** `engines/sticks.ts` gives each hand a stick whose angle is a damped spring driven by hand speed (wrist snap), so the tip outruns the hand and rebounds after a hit. Hits are swept along the tip's path each frame so fast strokes can't skip a drum. Shared by Drum Kit, Freestyle Drums and Marimba (mallets).
15. **Touch robustness.** Every press gets a unique control-point id (mice and pens reuse pointerId 1), and a press released before any frame saw it is still delivered for one frame, so very quick taps always register. The engine clock never runs backwards (rAF timestamps can precede `performance.now()`).
16. **Tooling pinned for Node 20.13** (the development machine): Vitest 3.2, jsdom 26, ESLint 9, TypeScript 5.9. Newer majors require Node 22. Upgrade together when moving to Node 22.

## Risks

- Real-device performance and thermal behaviour (especially low-end Android) are **not measured yet** — see `STATUS.md`.
- iOS Safari: worker GPU delegate needs OffscreenCanvas WebGL (Safari 17+); older versions fall back to main-thread inference automatically. Not yet verified on hardware.
- MediaPipe models come from Google's public bucket; self-host via `NEXT_PUBLIC_MODEL_BASE_URL` for production SLAs (update CSP `connect-src`).
