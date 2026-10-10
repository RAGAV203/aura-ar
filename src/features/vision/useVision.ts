"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError } from "@/lib/errors/appErrors";
import type { GestureConfig, GestureState, TrackingFrame, TrackingStatus } from "@/types/gestures";
import type { QualityLevel } from "@/types/instruments";
import { GestureInterpreter } from "./gestureInterpreter";
import type { FacingMode } from "./camera";
import { VisionEngine, type VisionPhase } from "./visionEngine";

export interface VisionController {
  phase: VisionPhase;
  progress: number;
  error: AppError | null;
  tracking: TrackingStatus;
  /** Callback ref for the <video> element the camera stream plays into. */
  attachVideo: (element: HTMLVideoElement | null) => void;
  /** Last inference duration in ms (diagnostics). */
  getInferenceMs: () => number;
  getInferenceMode: () => "worker" | "main" | null;
  start: (options?: { pose?: boolean; facingMode?: FacingMode }) => Promise<boolean>;
  /** Camera currently in use (front cameras are shown mirrored). */
  facingMode: FacingMode;
  /** Intrinsic size of the camera frames, once known. */
  getVideoSize: () => { width: number; height: number } | null;
  stop: () => void;
}

/**
 * React binding for the vision engine + gesture interpreter. High-frequency
 * gesture state is delivered through `onGesture` (no React state); only the
 * coarse phase and tracking status are React state.
 */
export function useVision(options: {
  onGesture: (state: GestureState) => void;
  /** Raw (normalised) landmarks for overlays; called at inference rate. */
  onTrackingFrame?: (frame: TrackingFrame | null) => void;
  quality: QualityLevel;
  gesture: Partial<GestureConfig>;
}): VisionController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<VisionEngine | null>(null);
  const interpreterRef = useRef(new GestureInterpreter());
  const inferenceMs = useRef(0);
  const onGestureRef = useRef(options.onGesture);
  const onFrameRef = useRef(options.onTrackingFrame);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [phase, setPhase] = useState<VisionPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [tracking, setTracking] = useState<TrackingStatus>("inactive");

  useEffect(() => {
    onGestureRef.current = options.onGesture;
    onFrameRef.current = options.onTrackingFrame;
  });

  const { sensitivity, handedness } = options.gesture;
  useEffect(() => {
    interpreterRef.current.configure({ sensitivity, handedness });
  }, [sensitivity, handedness]);

  useEffect(() => {
    engineRef.current?.setQuality(options.quality);
  }, [options.quality]);

  useEffect(() => {
    const engine = new VisionEngine();
    engineRef.current = engine;
    const offStatus = engine.onStatus((status) => {
      setPhase(status.phase);
      setProgress(status.progress);
      setError(status.error);
      if (status.phase !== "running" && status.phase !== "paused") setTracking("inactive");
    });
    const offFrame = engine.onFrame((frame) => {
      inferenceMs.current = frame.inferenceMs;
      onFrameRef.current?.(frame);
      const state = interpreterRef.current.update(frame);
      setTracking((current) => (current === state.status ? current : state.status));
      onGestureRef.current(state);
    });
    return () => {
      offStatus();
      offFrame();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
  }, []);
  const getInferenceMs = useCallback(() => inferenceMs.current, []);
  const getInferenceMode = useCallback(() => engineRef.current?.inferenceMode() ?? null, []);
  const getVideoSize = useCallback(() => {
    const video = videoRef.current;
    return video && video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null;
  }, []);

  const start = useCallback(async (startOptions: { pose?: boolean; facingMode?: FacingMode } = {}) => {
    const engine = engineRef.current;
    const video = videoRef.current;
    if (!engine || !video) return false;
    interpreterRef.current.reset();
    const facing = startOptions.facingMode ?? "user";
    setFacingMode(facing);
    try {
      await engine.start(video, { pose: startOptions.pose ?? false, facingMode: facing });
      setTracking("acquiring");
      return true;
    } catch {
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    interpreterRef.current.reset();
    setTracking("inactive");
    onGestureRef.current(interpreterRef.current.inactiveState());
    onFrameRef.current?.(null);
  }, []);

  return { phase, progress, error, tracking, attachVideo, getInferenceMs, getInferenceMode, getVideoSize, facingMode, start, stop };
}
