"use client";

import { useEffect, useState } from "react";
import type { TrackingStatus } from "@/types/gestures";
import type { QualityLevel } from "@/types/instruments";
import styles from "../studio.module.css";

interface DiagnosticsProps {
  getFps: () => number;
  getInferenceMs: () => number;
  getInferenceMode: () => "worker" | "main" | null;
  tracking: TrackingStatus;
  quality: QualityLevel;
}

/** Developer diagnostics (Settings → Diagnostics, or ?debug=1). Samples at 2 Hz. */
export function Diagnostics({ getFps, getInferenceMs, getInferenceMode, tracking, quality }: DiagnosticsProps) {
  const [sample, setSample] = useState<{ fps: number; inference: number; mode: string | null }>({ fps: 0, inference: 0, mode: null });
  useEffect(() => {
    const id = setInterval(() => setSample({ fps: getFps(), inference: getInferenceMs(), mode: getInferenceMode() }), 500);
    return () => clearInterval(id);
  }, [getFps, getInferenceMs, getInferenceMode]);
  return (
    <div className={styles.diagnostics} aria-hidden="true">
      <span>{sample.fps.toFixed(0)} fps</span>
      <span>inference {tracking === "inactive" ? "—" : `${sample.inference.toFixed(1)} ms (${sample.mode ?? "…"})`}</span>
      <span>tracking {tracking}</span>
      <span>quality {quality}</span>
    </div>
  );
}
