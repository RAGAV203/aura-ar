"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog, type ConfirmAction } from "@/components/ui/ConfirmDialog";
import { getAudioEngine } from "@/features/audio/audioEngine";
import { useAudio } from "@/features/audio/useAudio";
import { clearDraft, saveCreation, saveDraft } from "@/features/creations/repository";
import { createId, sanitizeName, serializeProjectFile } from "@/features/creations/schema";
import { defaultParameters, getInstrument } from "@/features/instruments/registry";
import { useReducedMotion, useSettings } from "@/features/settings/useSettings";
import { useVision } from "@/features/vision/useVision";
import { estimateInitialQuality, supportsVideoRecording } from "@/lib/browser/capabilities";
import { useWebGLSupport } from "@/lib/browser/useWebGLSupport";
import { registerUnsavedWork } from "@/lib/browser/unsavedGuard";
import { AppError, toAppError } from "@/lib/errors/appErrors";
import { blobToDataUrl, canvasToBlob, composeArtwork, createThumbnail, downloadBlob, fileSafeName, loadImage, startRecording, type CameraLayer, type RecordingHandle } from "@/lib/export/exporters";
import { coverTransform, IDENTITY_TRANSFORM } from "@/lib/browser/viewTransform";
import { countCameras } from "@/features/vision/camera";
import type { TrackingFrame } from "@/types/gestures";
import { useOfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import { QualityController } from "@/lib/performance/qualityController";
import { CURRENT_SCHEMA_VERSION, type Creation } from "@/types/creations";
import type { InstrumentEngine, InstrumentId, InstrumentParameters, QualityLevel } from "@/types/instruments";
import { CameraPanel } from "./components/CameraPanel";
import { ControlsSheet } from "./components/ControlsSheet";
import { Diagnostics } from "./components/Diagnostics";
import { ExportSheet } from "./components/ExportSheet";
import { GridPanel } from "./components/GridPanel";
import { HandOverlay } from "./components/HandOverlay";
import { HelpSheet } from "./components/HelpSheet";
import { InstrumentSwitcher } from "./components/InstrumentSwitcher";
import { SaveDialog } from "./components/SaveDialog";
import { ToolsSheet } from "./components/ToolsSheet";
import { TrackingPill } from "./components/TrackingPill";
import { applySymmetry, type SymmetryMode } from "./input/symmetry";
import { InputHub } from "./input/inputHub";
import { InstrumentStage, type StageHandle } from "./InstrumentStage";
import styles from "./studio.module.css";

export interface StudioInitial {
  instrumentId: InstrumentId;
  parameters: InstrumentParameters;
  presetId: string | null;
  seed: number;
  state: Record<string, unknown>;
  snapshot: Blob | null;
  creation: { id: string; name: string; createdAt: string } | null;
}

type Sheet = "controls" | "instruments" | "save" | "more" | "help" | "camera" | "tools" | null;

interface PendingConfirm {
  title: string;
  description: string;
  actions: ConfirmAction[];
}

const DRAFT_INTERVAL_MS = 15_000;

export function StudioSession({ initial, debug }: { initial: StudioInitial; debug: boolean }) {
  const router = useRouter();
  const { toast, announce } = useFeedback();
  const [settings, updateSettings] = useSettings();
  const reducedMotion = useReducedMotion();
  const offline = useOfflineReadiness();

  const [instrumentId, setInstrumentId] = useState(initial.instrumentId);
  const [parameters, setParameters] = useState(initial.parameters);
  const [presetId, setPresetId] = useState(initial.presetId);
  const [seed] = useState(initial.seed);
  const [meta, setMeta] = useState(initial.creation);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<AppError | null>(null);
  const [recording, setRecording] = useState<RecordingHandle | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [stageKey, setStageKey] = useState(0);
  const [showSelfView, setShowSelfView] = useState(true);
  const [symmetry, setSymmetry] = useState<SymmetryMode>(1);
  const [eraser, setEraser] = useState(false);
  const [eraserSize, setEraserSize] = useState(36);
  const [canUndo, setCanUndo] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [includeCamera, setIncludeCamera] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);
  const [gridCollapsed, setGridCollapsed] = useState(false);
  const [insets, setInsets] = useState<{ top: number; bottom: number }>({ top: 0.1, bottom: 0.12 });
  const webglOk = useWebGLSupport();

  const definition = getInstrument(instrumentId);
  const hub = useMemo(() => new InputHub(), []);
  const stageRef = useRef<StageHandle>(null);
  const stageElement = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const draftDirty = useRef(false);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const surfacePanel = useRef<HTMLDivElement | null>(null);
  const dockElement = useRef<HTMLElement | null>(null);
  const latestFrame = useRef<{ frame: TrackingFrame; receivedAt: number } | null>(null);
  const stageAspect = useRef(1);
  const pendingRestore = useRef<{ state: Record<string, unknown>; snapshot: Blob | null } | null>({ state: initial.state, snapshot: initial.snapshot });

  /* ---------- Quality ---------- */
  const qualityController = useMemo(() => new QualityController(settings.performanceMode, estimateInitialQuality()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [quality, setQuality] = useState<QualityLevel>(() => qualityController.getQuality());
  useEffect(() => qualityController.onChange(setQuality), [qualityController]);
  useEffect(() => qualityController.setMode(settings.performanceMode), [qualityController, settings.performanceMode]);
  const getFps = useCallback(() => qualityController.getFps(), [qualityController]);

  /* ---------- Audio & vision ---------- */
  const audio = useAudio(settings.volume, settings.muted);
  const { attachVideo, ...vision } = useVision({
    quality,
    gesture: { sensitivity: settings.gestureSensitivity, handedness: settings.handedness },
    onGesture: (state) => hub.pushGesture(state),
    onTrackingFrame: (frame) => {
      latestFrame.current = frame ? { frame, receivedAt: performance.now() } : null;
    },
  });
  const cameraActive = vision.phase !== "idle" && vision.phase !== "error";
  const backdropVisible = cameraActive && settings.cameraBackdrop;
  const mirrored = vision.facingMode === "user";
  const setVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      videoElement.current = element;
      attachVideo(element);
    },
    [attachVideo],
  );

  const startCamera = useCallback(async () => {
    setSheet("camera");
    const ok = await vision.start({ pose: settings.poseEnabled && definition.tracking.includes("pose"), facingMode: vision.facingMode });
    if (ok) {
      updateSettings({ cameraEnabled: true });
      setSheet((s) => (s === "camera" ? null : s));
      announce("Camera on. Show your hands to the camera.");
      offline.refresh();
    }
  }, [vision, settings.poseEnabled, definition.tracking, updateSettings, announce, offline]);

  const stopCamera = useCallback(() => {
    vision.stop();
    hub.clearGesture();
    updateSettings({ cameraEnabled: false });
    announce("Camera off.");
  }, [vision, hub, updateSettings, announce]);

  // Resume camera mode automatically only if the person chose it before.
  // The panel opens only if that fails, so a working camera starts silently.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (!settings.cameraEnabled || settings.touchOnly) return;
    void vision.start({ pose: settings.poseEnabled && definition.tracking.includes("pose") }).then((ok) => {
      if (!ok) setSheet("camera");
    });
  }, [settings.cameraEnabled, settings.touchOnly, settings.poseEnabled, definition.tracking, vision]);

  useEffect(() => {
    if (settings.touchOnly && cameraActive) stopCamera();
  }, [settings.touchOnly, cameraActive, stopCamera]);

  /* ---------- Creation data ---------- */
  const buildCreation = useCallback(
    (name: string, asNew = false): Creation => {
      const now = new Date().toISOString();
      const existing = asNew ? null : meta;
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: existing?.id ?? createId(),
        name: sanitizeName(name),
        instrumentId,
        presetId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        parameters,
        gestureMappings: Object.fromEntries(definition.gestureMappings.map((m) => [m.input, m.effect])),
        audioSettings: { volume: settings.volume, muted: settings.muted },
        seed,
        state: stageRef.current?.getEngine()?.serializeState() ?? {},
      };
    },
    [meta, instrumentId, presetId, parameters, definition, settings.volume, settings.muted, seed],
  );

  const defaultName = meta?.name ?? `${definition.name} Study`;

  const persistDraft = useCallback(async () => {
    const canvas = stageRef.current?.getCanvas();
    try {
      const snapshot = canvas && definition.persistentCanvas ? await canvasToBlob(canvas) : null;
      await saveDraft(buildCreation(defaultName), snapshot);
      draftDirty.current = false;
    } catch {
      /* Recovery is best effort; explicit saves report errors. */
    }
  }, [buildCreation, defaultName, definition.persistentCanvas]);

  const persistDraftRef = useRef(persistDraft);
  useEffect(() => {
    persistDraftRef.current = persistDraft;
  });

  useEffect(() => registerUnsavedWork(() => dirty.current, () => persistDraftRef.current()), []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (draftDirty.current) void persistDraftRef.current();
    }, DRAFT_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden" && draftDirty.current) void persistDraftRef.current();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const markDirty = () => {
    dirty.current = true;
    draftDirty.current = true;
  };

  /* ---------- Engine lifecycle ---------- */
  const toolState = useRef({ eraser, eraserSize });
  useEffect(() => {
    toolState.current = { eraser, eraserSize };
    stageRef.current?.getEngine()?.setEraser?.(eraser, eraserSize);
  }, [eraser, eraserSize]);

  const onEngineReady = useCallback(
    (engine: InstrumentEngine) => {
      engine.setEraser?.(toolState.current.eraser, toolState.current.eraserSize);
      const restore = pendingRestore.current;
      pendingRestore.current = null;
      if (!restore) return;
      engine.restoreState(restore.state);
      if (restore.snapshot && engine.restoreSnapshot) {
        loadImage(restore.snapshot)
          .then((image) => engine.restoreSnapshot?.(image))
          .catch(() => toast("The saved artwork image couldn't be restored; settings were loaded.", { kind: "warning" }));
      }
    },
    [toast],
  );

  // Align tracked hands with the camera as it is shown (cropped to fill the view).
  useEffect(() => {
    const stage = stageElement.current;
    const video = videoElement.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      stageAspect.current = rect.height > 0 ? rect.width / rect.height : 1;
      const size = vision.getVideoSize();
      hub.setViewTransform(backdropVisible && size ? coverTransform(size.width, size.height, rect.width, rect.height) : IDENTITY_TRANSFORM);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    video?.addEventListener("loadedmetadata", update);
    video?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", update);
      video?.removeEventListener("resize", update);
    };
  }, [hub, backdropVisible, vision.phase, vision]);

  // Surface instruments (Pitch Grid) lay out their playing area between the control panel and the dock.
  const hasSurface = !!definition.surface;
  useEffect(() => {
    const stage = stageElement.current;
    if (!stage || !hasSurface) return;
    const measure = () => {
      const area = stage.getBoundingClientRect();
      if (area.height <= 0) return;
      const panel = chromeHidden ? null : surfacePanel.current?.getBoundingClientRect();
      const dock = chromeHidden ? null : dockElement.current?.getBoundingClientRect();
      const top = panel ? (panel.bottom - area.top) / area.height : 0.02;
      const bottom = dock ? (area.bottom - dock.top) / area.height : 0.02;
      setInsets((current) => (Math.abs(current.top - top) < 0.002 && Math.abs(current.bottom - bottom) < 0.002 ? current : { top, bottom }));
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    if (surfacePanel.current) observer.observe(surfacePanel.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hasSurface, chromeHidden, gridCollapsed, instrumentId]);

  useEffect(() => {
    if (vision.phase !== "running") return;
    void countCameras().then(setCameraCount);
  }, [vision.phase]);

  // Undo availability changes at stroke boundaries; a light poll keeps React out of the frame loop.
  useEffect(() => {
    const id = setInterval(() => {
      const available = stageRef.current?.getEngine()?.canUndo?.() ?? false;
      setCanUndo((current) => (current === available ? current : available));
    }, 300);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!chromeHidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChromeHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chromeHidden]);

  useEffect(() => {
    hub.touch.setAmount(0.5);
    const element = stageElement.current;
    if (!element) return;
    return hub.touch.attach(element);
  }, [hub, stageKey, instrumentId]);

  useEffect(() => {
    if (!audio.state || audio.state === "locked") return;
    if (paused) void getAudioEngine().suspend();
    else void getAudioEngine().resume();
  }, [paused, audio.state]);

  useEffect(() => {
    updateSettings({ lastInstrument: instrumentId });
  }, [instrumentId, updateSettings]);

  // Release camera and silence audio when leaving the studio.
  useEffect(
    () => () => {
      getAudioEngine().setInstrument(null);
      hub.reset();
    },
    [hub],
  );

  /* ---------- Actions ---------- */
  const afterSave = useRef<(() => void) | null>(null);
  const guardUnsaved = (title: string, proceed: () => void) => {
    if (!dirty.current) return proceed();
    setConfirm({
      title,
      description: "Your current artwork hasn't been saved. Save it first, or discard it?",
      actions: [
        {
          label: "Discard",
          variant: "danger",
          onSelect: () => {
            setConfirm(null);
            dirty.current = draftDirty.current = false;
            void clearDraft().catch(() => undefined);
            proceed();
          },
        },
        {
          label: "Save first",
          variant: "primary",
          onSelect: () => {
            setConfirm(null);
            afterSave.current = proceed;
            setSheet("save");
          },
        },
      ],
    });
  };

  const switchInstrument = (id: InstrumentId) => {
    setSheet(null);
    if (id === instrumentId) return;
    guardUnsaved("Switch instrument?", () => {
      const next = getInstrument(id);
      setInstrumentId(id);
      setParameters(next.presets[0]?.parameters ?? defaultParameters(next));
      setPresetId(next.presets[0]?.id ?? null);
      setMeta(null);
      setContextLost(false);
      setEraser(false);
      pendingRestore.current = null;
      dirty.current = draftDirty.current = false;
      router.replace(`/studio/?instrument=${id}`, { scroll: false });
      announce(`${next.name}. ${next.tagline}.`);
    });
  };

  const exitStudio = () => guardUnsaved("Leave the studio?", () => router.push("/"));

  const handleSave = async (name: string, asNew: boolean) => {
    const canvas = stageRef.current?.getCanvas();
    setSaving(true);
    setSaveError(null);
    try {
      const creation = buildCreation(name, asNew);
      const thumbnail = canvas ? await createThumbnail(canvas).catch(() => null) : null;
      const snapshot = canvas && definition.persistentCanvas ? await canvasToBlob(canvas) : null;
      const saved = await saveCreation(creation, { thumbnail, snapshot });
      setMeta({ id: saved.id, name: saved.name, createdAt: saved.createdAt });
      dirty.current = draftDirty.current = false;
      void clearDraft().catch(() => undefined);
      setSheet(null);
      toast(`Saved “${saved.name}”`, { kind: "success" });
      announce(`Saved ${saved.name}`);
      router.replace(`/studio/?creation=${saved.id}`, { scroll: false });
      const next = afterSave.current;
      afterSave.current = null;
      next?.();
    } catch (error) {
      setSaveError(toAppError(error, "storage-write-failed"));
    } finally {
      setSaving(false);
    }
  };

  /** Camera layer for exports — only when shown and the person opted in. */
  const exportCamera = (): CameraLayer | null =>
    backdropVisible && includeCamera && videoElement.current ? { video: videoElement.current, mirrored, opacity: settings.backdropOpacity } : null;

  const exportPng = async () => {
    setSheet(null);
    const canvas = stageRef.current?.getCanvas();
    try {
      if (!canvas) throw new AppError("export-failed");
      downloadBlob(await canvasToBlob(composeArtwork(canvas, exportCamera())), `${fileSafeName(defaultName)}.png`);
      toast("Image exported", { kind: "success" });
    } catch (error) {
      toast(toAppError(error, "export-failed").info.message, { kind: "error" });
    }
  };

  const exportProject = async () => {
    setSheet(null);
    const canvas = stageRef.current?.getCanvas();
    try {
      const snapshot = canvas && definition.persistentCanvas ? await blobToDataUrl(await canvasToBlob(canvas)) : null;
      const json = serializeProjectFile(buildCreation(defaultName), snapshot);
      downloadBlob(new Blob([json], { type: "application/json" }), `${fileSafeName(defaultName)}.aura.json`);
      toast("Project file exported", { kind: "success" });
    } catch (error) {
      toast(toAppError(error, "export-failed").info.message, { kind: "error" });
    }
  };

  const startClip = () => {
    setSheet(null);
    const canvas = stageRef.current?.getCanvas();
    const handle = canvas ? startRecording(canvas, getAudioEngine().getRecordingStream(), exportCamera()) : null;
    if (!handle) {
      toast("Recording isn't available here. Try exporting an image.", { kind: "warning" });
      return;
    }
    setRecording(handle);
    announce("Recording started. Up to 15 seconds.");
    handle.result
      .then(({ blob, extension }) => {
        downloadBlob(blob, `${fileSafeName(defaultName)}.${extension}`);
        toast("Clip saved", { kind: "success" });
      })
      .catch(() => toast("The recording failed. Try exporting an image instead.", { kind: "error" }))
      .finally(() => setRecording(null));
  };

  const clearCanvas = () => {
    setSheet(null);
    const doClear = () => {
      const engine = stageRef.current?.getEngine();
      engine?.reset();
      dirty.current = draftDirty.current = meta !== null;
      announce("Canvas cleared");
      if (engine?.supportsUndo) toast("Canvas cleared", { action: { label: "Undo", onClick: () => undo() } });
    };
    if (!dirty.current) return doClear();
    setConfirm({
      title: "Clear the canvas?",
      description: "This removes the current artwork. Saved creations are not affected.",
      actions: [{ label: "Clear", variant: "danger", onSelect: () => (setConfirm(null), doClear()) }],
    });
  };

  const undo = () => {
    if (stageRef.current?.getEngine()?.undo?.()) {
      markDirty();
      announce("Undone");
      setCanUndo(stageRef.current?.getEngine()?.canUndo?.() ?? false);
    }
  };

  const flipCamera = async () => {
    const next = vision.facingMode === "user" ? "environment" : "user";
    setSheet(null);
    const ok = await vision.start({ pose: settings.poseEnabled && definition.tracking.includes("pose"), facingMode: next });
    announce(ok ? `Using the ${next === "user" ? "front" : "back"} camera` : "Couldn't switch camera");
    if (!ok) setSheet("camera");
  };

  const toggleSound = async () => {
    if (audio.state !== "running" && audio.state !== "suspended") {
      const ok = await audio.activate();
      if (ok) {
        if (settings.muted) updateSettings({ muted: false });
        announce("Sound on");
      } else toast("Sound couldn't start. Tap again — on iPhone, check that silent mode is off.", { kind: "error" });
      return;
    }
    updateSettings({ muted: !settings.muted });
    announce(settings.muted ? "Sound on" : "Sound muted");
  };

  const togglePause = useCallback(() => {
    setPaused((p) => {
      announce(p ? "Resumed" : "Paused. Animation and sound stopped.");
      return !p;
    });
  }, [announce]);

  // Space pauses from anywhere in the studio (except while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, dialog")) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause]);

  const soundOn = audio.state === "running" && !settings.muted;
  const presetName = definition.presets.find((p) => p.id === presetId)?.name ?? "Custom";
  const showWebGLError = definition.renderer === "webgl" && (!webglOk || contextLost);

  return (
    <div className={styles.studio} style={{ "--studio-accent": definition.palette[0] } as React.CSSProperties}>
      <h1 className="visually-hidden">
        {definition.name} studio{meta ? ` — ${meta.name}` : ""}
      </h1>

      <div
        ref={stageElement}
        className={styles.stageHost}
        tabIndex={0}
        aria-label={`${definition.name} canvas. Drag to play; arrow keys draw, Enter taps, Space pauses.`}
        aria-describedby="stage-help"
        onKeyDown={(e) => {
          if (hub.keyboard.keyDown(e.key, e.shiftKey)) e.preventDefault();
        }}
        onKeyUp={(e) => hub.keyboard.keyUp(e.key)}
        onBlur={() => hub.keyboard.reset()}
      >
        {showWebGLError ? (
          <div className={styles.stageError}>
            <ErrorNotice error={new AppError(contextLost ? "webgl-context-lost" : "webgl-unavailable")}>
              {contextLost && (
                <Button
                  variant="primary"
                  icon="refresh"
                  onClick={() => {
                    setContextLost(false);
                    setStageKey((k) => k + 1);
                  }}
                >
                  Restore
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSheet("instruments")}>
                Choose another instrument
              </Button>
            </ErrorNotice>
          </div>
        ) : (
          <InstrumentStage
            key={stageKey}
            ref={stageRef}
            instrumentId={instrumentId}
            parameters={parameters}
            seed={seed}
            quality={quality}
            reducedMotion={reducedMotion}
            paused={paused}
            audio
            intensity={settings.visualIntensity}
            transparent={backdropVisible}
            insets={hasSurface ? insets : undefined}
            label={`${definition.name} artwork`}
            getInput={(dt, now) => applySymmetry(hub.collect(dt, now), symmetry, stageAspect.current)}
            onEngineReady={onEngineReady}
            onFrame={({ now, input }) => {
              qualityController.tick(now);
              if (input.points.length > 0 || input.events.length > 0) markDirty();
            }}
            onWebGLContextLost={() => {
              pendingRestore.current = { state: stageRef.current?.getEngine()?.serializeState() ?? {}, snapshot: null };
              setContextLost(true);
            }}
          />
        )}
        <p id="stage-help" className="visually-hidden">
          {definition.touchMappings.map((m) => `${m.input}: ${m.effect}.`).join(" ")}
        </p>
      </div>

      {cameraActive && settings.handSkeleton && <HandOverlay getFrame={() => latestFrame.current} getView={() => hub.getViewTransform()} color={definition.palette[0]} />}
      {cameraActive && !backdropVisible && !chromeHidden && (
        <button type="button" className={styles.selfViewToggle} onClick={() => setShowSelfView((v) => !v)}>
          {showSelfView ? "Hide camera view" : "Show camera view"}
        </button>
      )}

      {/* Camera frames stay on this device. Shown full-screen behind the artwork, or as a small self-view. */}
      <video
        ref={setVideo}
        className={`${styles.selfView} ${backdropVisible ? styles.backdrop : cameraActive && showSelfView ? styles.selfViewVisible : ""}`}
        style={backdropVisible ? { opacity: settings.backdropOpacity, transform: mirrored ? "scaleX(-1)" : "none" } : undefined}
        playsInline
        muted
        aria-hidden="true"
      />

      {chromeHidden && (
        <button type="button" className={styles.showChrome} onClick={() => setChromeHidden(false)}>
          Show controls
        </button>
      )}

      <header className={styles.topBar} hidden={chromeHidden}>
        <IconButton icon="back" label="Exit studio" onClick={exitStudio} className={styles.glassButton} />
        <button type="button" className={styles.titleButton} onClick={() => setSheet("instruments")} aria-label={`${definition.name}, preset ${presetName}. Change instrument`}>
          <span className={styles.titleName}>{meta?.name ?? definition.name}</span>
          <span className={styles.titlePreset}>
            {meta ? `${definition.name} · ` : ""}
            {presetName}
          </span>
        </button>
        <div className={styles.topRight}>
          <TrackingPill phase={vision.phase} tracking={vision.tracking} progress={vision.progress} />
          <IconButton
            icon={soundOn ? "sound" : "mute"}
            label={audio.state === "running" || audio.state === "suspended" ? (settings.muted ? "Unmute sound" : "Mute sound") : "Turn sound on"}
            pressed={soundOn}
            onClick={toggleSound}
            className={styles.glassButton}
          />
        </div>
      </header>

      {audio.state === "locked" && !paused && !chromeHidden && (
        <button type="button" className={`${styles.soundPrompt} ${hasSurface ? styles.soundPromptLow : ""}`} onClick={toggleSound}>
          Tap for sound
        </button>
      )}

      {paused && (
        <div className={styles.pausedBanner} role="status">
          Paused — animation and sound stopped
          <Button variant="primary" icon="play" onClick={togglePause}>
            Resume
          </Button>
        </div>
      )}

      {recording && (
        <div className={styles.recordingBanner} role="status">
          <span className={styles.recordDot} aria-hidden="true" /> Recording
          <Button variant="danger" icon="stop" onClick={() => recording.stop()}>
            Stop
          </Button>
        </div>
      )}

      {(debug || settings.diagnostics) && <Diagnostics getFps={getFps} getInferenceMs={vision.getInferenceMs} getInferenceMode={vision.getInferenceMode} tracking={vision.tracking} quality={quality} />}

      {canUndo && !chromeHidden && (
        <button type="button" className={styles.undoChip} onClick={undo}>
          Undo
        </button>
      )}

      {hasSurface && !chromeHidden && (
        <GridPanel
          ref={surfacePanel}
          definition={definition}
          parameters={parameters}
          presetId={presetId}
          collapsed={gridCollapsed}
          onToggleCollapsed={() => setGridCollapsed((c) => !c)}
          onParameterChange={(key, value) => {
            setParameters((p) => ({ ...p, [key]: value }));
            setPresetId(null);
            markDirty();
          }}
          onPreset={(id) => {
            const preset = definition.presets.find((p) => p.id === id);
            if (!preset) return;
            setParameters({ ...defaultParameters(definition), ...preset.parameters });
            setPresetId(id);
            announce(`Preset ${preset.name}`);
          }}
        />
      )}

      <nav ref={dockElement} className={styles.dock} aria-label="Studio tools" hidden={chromeHidden}>
        <IconButton icon="instruments" label="Instruments" showLabel onClick={() => setSheet("instruments")} />
        <IconButton icon="sliders" label="Controls" showLabel onClick={() => setSheet("controls")} />
        <IconButton icon="sparkle" label="Tools" showLabel pressed={symmetry !== 1 || eraser} onClick={() => setSheet("tools")} />
        <IconButton
          icon={cameraActive ? "camera" : "cameraOff"}
          label={cameraActive ? "Camera on" : "Camera"}
          visibleLabel="Camera"
          showLabel
          pressed={cameraActive}
          disabled={settings.touchOnly}
          title={settings.touchOnly ? "Touch-only mode is on (Settings)" : undefined}
          onClick={() => (cameraActive ? stopCamera() : setSheet("camera"))}
        />
        <IconButton icon={paused ? "play" : "pause"} label={paused ? "Resume" : "Pause"} showLabel pressed={paused} onClick={togglePause} />
        <IconButton icon="save" label="Save" showLabel onClick={() => (setSaveError(null), setSheet("save"))} />
        <IconButton icon="more" label="More" showLabel onClick={() => setSheet("more")} />
      </nav>

      <InstrumentSwitcher open={sheet === "instruments"} current={instrumentId} onClose={() => setSheet(null)} onSelect={switchInstrument} />
      <ControlsSheet
        open={sheet === "controls"}
        onClose={() => setSheet(null)}
        definition={definition}
        parameters={parameters}
        presetId={presetId}
        onParameterChange={(key, value) => {
          setParameters((p) => ({ ...p, [key]: value }));
          setPresetId(null);
          markDirty();
        }}
        onPreset={(id) => {
          const preset = definition.presets.find((p) => p.id === id);
          if (!preset) return;
          setParameters({ ...defaultParameters(definition), ...preset.parameters });
          setPresetId(id);
          markDirty();
          announce(`Preset ${preset.name}`);
        }}
        volume={settings.volume}
        muted={settings.muted}
        onVolume={(volume) => updateSettings({ volume })}
        onMuted={(muted) => updateSettings({ muted })}
        intensity={settings.visualIntensity}
        onIntensity={(visualIntensity) => updateSettings({ visualIntensity })}
      />
      <CameraPanel
        open={sheet === "camera"}
        onClose={() => {
          if (vision.phase === "error") vision.stop();
          setSheet(null);
        }}
        vision={vision}
        handsPack={offline.hands}
        poseEnabled={settings.poseEnabled}
        instrumentSupportsPose={definition.tracking.includes("pose")}
        onStart={startCamera}
      />
      <SaveDialog
        open={sheet === "save"}
        initialName={defaultName}
        isExisting={meta !== null}
        saving={saving}
        error={saveError}
        onClose={() => {
          afterSave.current = null;
          setSheet(null);
        }}
        onSave={handleSave}
        onExportInstead={exportProject}
      />
      <ExportSheet
        open={sheet === "more"}
        onClose={() => setSheet(null)}
        onPng={exportPng}
        onProject={exportProject}
        onVideo={supportsVideoRecording() && !recording ? startClip : null}
        onClear={clearCanvas}
        onHelp={() => setSheet("help")}
        cameraAvailable={backdropVisible}
        includeCamera={includeCamera}
        onIncludeCamera={setIncludeCamera}
      />
      <ToolsSheet
        open={sheet === "tools"}
        onClose={() => setSheet(null)}
        supportsDrawingTools={definition.persistentCanvas}
        canUndo={canUndo}
        onUndo={undo}
        eraser={eraser}
        onEraser={(on) => {
          setEraser(on);
          announce(on ? "Eraser on" : "Drawing");
        }}
        eraserSize={eraserSize}
        onEraserSize={setEraserSize}
        symmetry={symmetry}
        onSymmetry={(mode) => {
          setSymmetry(mode);
          announce(mode === 1 ? "Symmetry off" : `Symmetry ${mode === 2 ? "mirror" : mode === 4 ? "quad" : `${mode}-fold`}`);
        }}
        cameraActive={cameraActive}
        backdrop={settings.cameraBackdrop}
        onBackdrop={(cameraBackdrop) => updateSettings({ cameraBackdrop })}
        backdropOpacity={settings.backdropOpacity}
        onBackdropOpacity={(backdropOpacity) => updateSettings({ backdropOpacity })}
        skeleton={settings.handSkeleton}
        onSkeleton={(handSkeleton) => updateSettings({ handSkeleton })}
        canFlipCamera={cameraActive && cameraCount > 1}
        facing={vision.facingMode}
        onFlipCamera={flipCamera}
        onHideInterface={() => {
          setSheet(null);
          setChromeHidden(true);
          announce("Interface hidden. Press Escape or use Show controls to bring it back.");
        }}
      />
      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} definition={definition} />
      <ConfirmDialog open={confirm !== null} title={confirm?.title ?? ""} description={confirm?.description ?? ""} actions={confirm?.actions ?? []} onCancel={() => setConfirm(null)} />
    </div>
  );
}
