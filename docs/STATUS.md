# Implementation status — 2026-10-10

## Verified in this environment (Windows, Node 20.13, headless Chromium)

| Check | Result |
| --- | --- |
| `npm run lint` (ESLint 9 + Next + React Compiler rules) | Pass, 0 warnings |
| `npm run typecheck` (strict, `noUncheckedIndexedAccess`) | Pass |
| `npm test` — 103 unit/component tests | Pass |
| `npm run build` — static export, 87-file / 2.91 MB precache | Pass |
| `npm run test:e2e` — 25 Playwright tests (desktop + Pixel 7 emulation), incl. hydration checks, camera backdrop, tools and all 23 instruments (switching, touch response, sound-on playback without errors) | Pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

E2E coverage: first visit without camera, touch-only session, camera denied / busy recovery, switching all five instruments, unsaved-work guard, save → reopen with snapshot restore, project export → import, corrupted import rejection, PNG export, failed model download recovery, pause, offline launch after caching, service-worker update with consent and draft preservation, and the **real** MediaPipe pipeline (fake camera → model download → worker inference → camera released).

## Definition of Done

| Item | Status |
| --- | --- |
| Production build succeeds | ✅ |
| Type checking and linting pass | ✅ |
| Critical automated tests pass | ✅ |
| All 23 instruments functional | ✅ (touch verified e2e; gesture paths unit-tested and the inference pipeline verified with a fake camera) |
| Touch-only operation works | ✅ |
| Camera permission requested at the correct time | ✅ (e2e asserts zero requests until the user chooses camera) |
| Camera and audio resources cleaned up | ✅ camera verified e2e; audio layer swapped/stopped on instrument change and studio exit (code-reviewed, not instrumented in tests) |
| Save, restore, rename, duplicate, delete | ✅ |
| PNG and project export | ✅ |
| Invalid imports safely rejected | ✅ |
| Previously cached instruments work offline | ✅ in Chromium |
| Failed downloads / storage errors have recovery paths | ✅ |
| Mobile layouts respect safe areas | ⚠️ implemented with `env(safe-area-inset-*)`; checked only in emulation |
| Reduced-motion and mute controls work | ✅ implemented; mute unit-tested via gain mapping |
| No critical interaction is a placeholder | ✅ |
| Performance measured on real mobile hardware | ❌ **not done** — no devices available here |
| Privacy and third-party documentation | ✅ `docs/PRIVACY_AND_LICENSES.md`, `/privacy` |
| Deployment and update procedures documented | ✅ `docs/DEPLOYMENT.md` |

## Known limitations

0. **Sound quality is synthesised, not sampled.** Strings use physical models; piano, winds, brass, orchestra, drums, tabla and the tuned percussion are built from oscillators and noise on the device (no downloads). They are expressive but not a substitute for sampled instruments; this has only been judged by ear in desktop Chromium.

1. **No real-device testing yet.** iPhone Safari, iOS Home Screen mode and Android Chrome have not been tested on hardware: camera orientation, front/rear switching (rear camera isn't exposed in the UI yet), thermals, memory, audio unlock with the silent switch, gesture accuracy in real lighting. These are release blockers per the plan.
2. **Gesture thresholds are tuned on synthetic landmarks.** Pinch (0.32/0.48 of hand size), palm hold and smoothing defaults need tuning with real hands; sensitivity is user-adjustable meanwhile.
3. **Performance numbers are headless-only.** Main-thread CPU inference ≈170 ms vs worker mode keeping rendering >20 fps (SwiftShader). Real-GPU figures are unknown.
4. **Video recording** uses MediaRecorder + `canvas.captureStream`; verified only to be offered where supported. Safari MP4 output is untested. PNG export is the fallback.
5. **Pose model** loads only when the camera starts; switching to a pose-capable instrument mid-session doesn't load it until the camera is restarted.
6. **Recovery drafts** don't capture Aurora/Particle Bloom visuals (they aren't accumulated artwork); only parameters/seed are restored for those, by design.
7. **Dev-tool advisories:** `npm audit` (including dev dependencies) reports advisories in Vitest 3 and `eslint-config-next`'s glob dependency. Fixes require Vitest 5 / Node 22. They don't ship to users.
8. **CSP** needs `'unsafe-inline'` scripts because of the static export's inline hydration data.

## Suggested next steps

1. Real-device pass using the release checklist in `DEPLOYMENT.md`, with Settings → Diagnostics on.
2. Tune gesture thresholds from recorded (local, opt-in) landmark traces in a dev build.
3. Move to Node 22 and upgrade Vitest/jsdom/ESLint to clear dev advisories.
4. Add a rear-camera toggle and self-host models.
