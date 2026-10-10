"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useSettings } from "@/features/settings/useSettings";
import { useVision } from "@/features/vision/useVision";
import type { GestureState } from "@/types/gestures";
import styles from "./onboarding.module.css";

type CalibrationStep = "hand" | "pinch" | "palm" | "done";

const STEPS: Array<{ id: Exclude<CalibrationStep, "done">; title: string; hint: string }> = [
  { id: "hand", title: "Raise one hand", hint: "Hold it about an arm's length from the camera, palm facing the screen." },
  { id: "pinch", title: "Pinch", hint: "Touch your thumb and index fingertip together, then release." },
  { id: "palm", title: "Open your palm", hint: "Spread your fingers wide and hold for a moment." },
];

interface CalibrationProps {
  onComplete: () => void;
  onSkipCamera: () => void;
}

/**
 * Guided gesture check. Each step waits for the real interpreter to report
 * the gesture, so the person knows tracking works before they start.
 */
export function Calibration({ onComplete, onSkipCamera }: CalibrationProps) {
  const [settings, update] = useSettings();
  const [step, setStep] = useState<CalibrationStep>("hand");
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const handle = (state: GestureState) => {
    const current = stepRef.current;
    if (current === "hand" && state.status === "tracking") setStep("pinch");
    else if (current === "pinch" && state.events.some((e) => e.type === "pinch-start")) setStep("palm");
    else if (current === "palm" && state.events.some((e) => e.type === "palm-open")) setStep("done");
  };

  const { attachVideo, ...vision } = useVision({ quality: "balanced", gesture: { sensitivity: settings.gestureSensitivity, handedness: settings.handedness }, onGesture: handle });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void vision.start().then((ok) => ok && update({ cameraEnabled: true }));
  }, [vision, update]);

  const busy = vision.phase === "requesting-camera" || vision.phase === "downloading" || vision.phase === "initializing";
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className={styles.calibration}>
      <div className={styles.videoFrame}>
        <video ref={attachVideo} className={styles.video} playsInline muted aria-label="Your camera view, processed only on this device" />
        {busy && (
          <div className={styles.videoOverlay} role="status" aria-live="polite">
            {vision.phase === "requesting-camera" && "Waiting for camera permission…"}
            {vision.phase === "downloading" && `Downloading hand tracking… ${Math.round(vision.progress * 100)}%`}
            {vision.phase === "initializing" && "Starting hand tracking…"}
            <progress className={styles.progress} max={1} value={vision.phase === "downloading" ? vision.progress : undefined} aria-hidden="true" />
          </div>
        )}
      </div>

      {vision.error ? (
        <ErrorNotice error={vision.error}>
          <Button variant="primary" icon="refresh" onClick={() => void vision.start()}>
            Try again
          </Button>
          <Button onClick={onSkipCamera}>Continue without camera</Button>
        </ErrorNotice>
      ) : (
        <>
          <ol className={styles.checklist} aria-label="Gesture check">
            {STEPS.map((s, i) => {
              const done = step === "done" || i < currentIndex;
              const active = s.id === step;
              return (
                <li key={s.id} className={`${styles.checkItem} ${active ? styles.checkActive : ""} ${done ? styles.checkDone : ""}`} aria-current={active ? "step" : undefined}>
                  <span className={styles.checkMark} aria-hidden="true">
                    {done ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span>
                    <strong>{s.title}</strong>
                    <span className={styles.checkHint}>{s.hint}</span>
                  </span>
                  <span className="visually-hidden">{done ? "(done)" : active ? "(current)" : ""}</span>
                </li>
              );
            })}
          </ol>
          <p className="visually-hidden" role="status" aria-live="polite">
            {step === "done" ? "All gestures recognised." : `Next: ${STEPS[currentIndex]?.title}`}
          </p>
          <div className={styles.actions}>
            {step === "done" ? (
              <Button variant="primary" icon="check" onClick={onComplete}>
                Looks great — continue
              </Button>
            ) : (
              <Button variant="ghost" onClick={onComplete}>
                Skip check
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
