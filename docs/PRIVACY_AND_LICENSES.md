# Privacy model & third-party licences

The user-facing notice lives at `/privacy` (`src/app/privacy/page.tsx`). This document records the engineering guarantees behind it.

## Guarantees and where they are enforced

| Guarantee | Enforcement |
| --- | --- |
| Camera only after explicit choice | `getUserMedia` is called only from the camera panel / calibration after an explanation (`features/vision/camera.ts`); e2e test asserts zero requests on first visit |
| No microphone | `audio: false` in constraints; `Permissions-Policy: microphone=()` |
| Frames never leave the device | Frames go only to `vision-worker.js` as transferred `ImageBitmap`s and are closed after inference; no network code touches them |
| No biometric profiles | Only per-frame landmark positions exist in memory; nothing about hands is persisted or logged (`logDiagnostic` is dev-only and never receives landmarks) |
| Camera released | `VisionEngine.stop()` stops tracks on camera-off, studio exit and unmount; tracks are disabled while the tab is hidden; e2e verifies zero live tracks after stopping |
| No recording without action | MediaRecorder runs only after “Record a clip”, max 15 s, saved locally |
| Imports are data | `parseProjectFile` validates everything; snapshots must be PNG data URLs; no code paths evaluate file content |
| No tracking/analytics | No third-party scripts; CSP `default-src 'self'` |
| Network | Same origin, plus `storage.googleapis.com` for optional model downloads (CSP `connect-src`) |

## Third-party software

| Component | Licence | Use |
| --- | --- | --- |
| Next.js, React, React DOM | MIT | Framework |
| three.js | MIT | Cosmic Garden rendering |
| @react-three/fiber | MIT | React renderer for three.js |
| @mediapipe/tasks-vision (runtime + WASM) | Apache-2.0 | Hand / pose inference |
| MediaPipe Hand Landmarker & Pose Landmarker Lite models | Apache-2.0 (Google model cards) | Downloaded on demand |
| Manrope, Instrument Serif | SIL OFL 1.1 | Fonts, self-hosted by `next/font` |

Development-only: Vitest, Testing Library, Playwright, ESLint, TypeScript, fake-indexeddb, jsdom (all MIT/Apache-2.0/BSD).

## Assets

All visuals, icons (`scripts/generate-icons.mjs`, `public/icons/icon.svg`, inline SVG icon set) and sounds (Web Audio synthesis) are original to this project. No sampled audio or stock imagery is used.
