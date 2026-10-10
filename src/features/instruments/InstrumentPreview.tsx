"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/features/settings/useSettings";
import { InstrumentStage } from "@/features/studio/InstrumentStage";
import { Autopilot } from "@/features/studio/input/autopilot";
import { useWebGLSupport } from "@/lib/browser/useWebGLSupport";
import type { InstrumentId, QualityLevel } from "@/types/instruments";
import { defaultParameters, getInstrument } from "./registry";
import styles from "./instruments.module.css";

interface InstrumentPreviewProps {
  instrumentId: InstrumentId;
  seed?: number;
  quality?: QualityLevel;
  className?: string;
  /** Pointer position (0..1) the autopilot should drift toward. */
  attractor?: { x: number; y: number } | null;
}

/**
 * A genuine, live rendering of an instrument played by the autopilot. Runs
 * only while on screen; with reduced motion it renders a short warm-up and
 * then holds a still frame.
 */
export function InstrumentPreview({ instrumentId, seed = 7, quality = "battery", className, attractor = null }: InstrumentPreviewProps) {
  const definition = getInstrument(instrumentId);
  const parameters = useMemo(() => defaultParameters(definition), [definition]);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const webglSupported = useWebGLSupport();
  const webglOk = definition.renderer !== "webgl" || webglSupported;
  const autopilot = useMemo(() => new Autopilot(seed + instrumentId.length), [seed, instrumentId]);
  const elapsed = useRef(0);

  useEffect(() => {
    autopilot.setAttractor(attractor);
  }, [autopilot, attractor]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!webglOk) {
    return (
      <div ref={containerRef} className={`${styles.preview} ${styles.previewFallback} ${className ?? ""}`}>
        <p>3D preview unavailable on this device</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`${styles.preview} ${className ?? ""}`}>
      {visible && (
        <InstrumentStage
          instrumentId={instrumentId}
          parameters={parameters}
          seed={seed}
          quality={quality}
          reducedMotion={reducedMotion}
          interactive={false}
          paused={frozen && reducedMotion}
          label={`Live preview of ${definition.name}`}
          getInput={(dt) => autopilot.next(dt)}
          onFrame={({ dt }) => {
            elapsed.current += dt;
            if (reducedMotion && elapsed.current > 2.5) setFrozen(true);
          }}
        />
      )}
    </div>
  );
}
