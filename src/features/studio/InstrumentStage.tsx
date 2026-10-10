"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { getAudioEngine } from "@/features/audio/audioEngine";
import { createCanvasEngine, createCosmicGardenModel } from "@/features/instruments/createEngine";
import type { CosmicGardenModel } from "@/features/instruments/engines/cosmicGarden";
import { getInstrument } from "@/features/instruments/registry";
import { FRAME_INTERVAL_MS } from "@/lib/performance/qualityController";
import type { ControlInput, InstrumentEngine, InstrumentId, InstrumentParameters, QualityLevel } from "@/types/instruments";
import styles from "./InstrumentStage.module.css";

const CosmicGardenScene = dynamic(() => import("@/features/instruments/scenes/CosmicGardenScene"), { ssr: false });

const PIXEL_RATIO_CAP: Record<QualityLevel, number> = { high: 2, balanced: 1.5, battery: 1 };

export interface StageHandle {
  getCanvas(): HTMLCanvasElement | null;
  getEngine(): InstrumentEngine | null;
}

export interface FrameInfo {
  dt: number;
  now: number;
  input: ControlInput;
}

export interface InstrumentStageProps {
  instrumentId: InstrumentId;
  parameters: InstrumentParameters;
  seed: number;
  quality: QualityLevel;
  reducedMotion: boolean;
  /** Supplies input every frame (InputHub.collect or an Autopilot). */
  getInput: (dt: number, now: number) => ControlInput;
  /** Push continuous targets and notes to the shared audio engine. */
  audio?: boolean;
  paused?: boolean;
  /** Called after each frame (performance metering, dirty tracking). */
  onFrame?: (info: FrameInfo) => void;
  /** Called once the engine exists (e.g. to restore saved state). */
  onEngineReady?: (engine: InstrumentEngine) => void;
  onWebGLContextLost?: () => void;
  /** 0..1 display intensity. */
  intensity?: number;
  /** Non-interactive stages (previews) let touches scroll the page. */
  interactive?: boolean;
  /** Let whatever is behind the stage (the camera backdrop) show through. */
  transparent?: boolean;
  className?: string;
  label: string;
  ref?: Ref<StageHandle>;
}

const AUDIO_INTERVAL_MS = 33;

/**
 * Hosts one instrument and runs its animation loop outside React renders.
 * Canvas 2D instruments draw straight into a <canvas>; Cosmic Garden renders
 * through React Three Fiber with frameloop="demand", driven by this same loop.
 */
export function InstrumentStage(props: InstrumentStageProps) {
  const { instrumentId, seed, quality, reducedMotion, paused = false, audio = false, intensity = 1, interactive = true, transparent = false, className, label, ref } = props;
  const definition = getInstrument(instrumentId);
  const isWebGL = definition.renderer === "webgl";
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InstrumentEngine | null>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  const [cosmicModel, setCosmicModel] = useState<CosmicGardenModel | null>(null);

  // Latest props for the loop without restarting it.
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });

  useImperativeHandle(ref, () => ({
    getCanvas: () => (isWebGL ? webglCanvasRef.current : canvasRef.current),
    getEngine: () => engineRef.current,
  }));

  // Create / dispose the engine when the instrument or seed changes.
  useEffect(() => {
    let engine: InstrumentEngine;
    if (instrumentId === "cosmic-garden") {
      const model = createCosmicGardenModel(live.current.parameters, seed);
      engine = model;
      setCosmicModel(model);
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;
      engine = createCanvasEngine(instrumentId, canvas, live.current.parameters, seed);
    }
    engine.setQuality(live.current.quality);
    engine.setReducedMotion(live.current.reducedMotion);
    engineRef.current = engine;
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      engine.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[live.current.quality]));
    }
    live.current.onEngineReady?.(engine);
    if (live.current.audio) getAudioEngine().setInstrument(definition.audio);
    return () => {
      if (live.current.audio) getAudioEngine().allVoicesOff();
      engine.dispose();
      engineRef.current = null;
      if (instrumentId === "cosmic-garden") setCosmicModel(null);
    };
    // definition is derived from instrumentId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId, seed]);

  useEffect(() => {
    engineRef.current?.setParameters(props.parameters);
  }, [props.parameters]);

  useEffect(() => {
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // Quality affects the backing-store resolution, so resize too.
  useEffect(() => {
    const engine = engineRef.current;
    const container = containerRef.current;
    if (!engine || !container) return;
    engine.setQuality(quality);
    const rect = container.getBoundingClientRect();
    engine.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[quality]));
  }, [quality, instrumentId, seed]);

  useEffect(() => {
    if (!audio) return;
    getAudioEngine().setInstrument(definition.audio);
    return () => getAudioEngine().setInstrument(null);
  }, [audio, definition.audio]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      engineRef.current?.resize(width, height, Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[live.current.quality]));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The animation loop.
  useEffect(() => {
    if (paused) {
      if (audio) {
        getAudioEngine().update({ level: 0, brightness: 0.3, pitch: 0, pan: 0.5, texture: 0 });
        getAudioEngine().allVoicesOff();
      }
      return;
    }
    let handle = 0;
    let last = performance.now();
    let lastRender = 0;
    let lastAudio = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      const current = live.current;
      const minInterval = FRAME_INTERVAL_MS[current.quality];
      if (minInterval > 0 && now - lastRender < minInterval - 2) return;
      lastRender = now;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const engine = engineRef.current;
      if (!engine) return;
      const input = current.getInput(dt, now);
      engine.frame(dt, input);
      invalidateRef.current?.();
      // Held notes are latency-sensitive, so they're dispatched every frame.
      const voiceCommands = engine.drainVoiceCommands?.() ?? [];
      if (current.audio) for (const command of voiceCommands) getAudioEngine().voice(command);
      if (current.audio && now - lastAudio > AUDIO_INTERVAL_MS) {
        lastAudio = now;
        const audioEngine = getAudioEngine();
        audioEngine.update(engine.audioTargets());
        for (const note of engine.drainNotes()) audioEngine.play(note);
      } else if (!current.audio) {
        engine.drainNotes();
      }
      current.onFrame?.({ dt, now, input });
    };
    handle = requestAnimationFrame(tick);
    const onVisibility = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, audio]);

  const onSceneReady = useCallback((invalidate: () => void, canvas: HTMLCanvasElement) => {
    invalidateRef.current = invalidate;
    webglCanvasRef.current = canvas;
    invalidate();
  }, []);

  const onContextLost = useCallback(() => live.current.onWebGLContextLost?.(), []);

  const filter = intensity < 0.999 ? `saturate(${0.55 + intensity * 0.45}) brightness(${0.6 + intensity * 0.4})` : undefined;

  return (
    <div ref={containerRef} className={`${styles.stage} ${interactive ? styles.interactive : styles.passive} ${className ?? ""}`} role="img" aria-label={label} style={{ filter, background: transparent ? "transparent" : undefined }}>
      {isWebGL ? (
        cosmicModel && <CosmicGardenScene model={cosmicModel} quality={quality} transparent={transparent} onReady={onSceneReady} onContextLost={onContextLost} className={styles.canvas} />
      ) : (
        <canvas ref={canvasRef} className={styles.canvas} />
      )}
    </div>
  );
}
