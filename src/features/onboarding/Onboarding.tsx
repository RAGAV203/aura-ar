"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useAudio } from "@/features/audio/useAudio";
import { INSTRUMENTS } from "@/features/instruments/registry";
import { defaultParameters, getInstrument } from "@/features/instruments/registry";
import { useReducedMotion, useSettings } from "@/features/settings/useSettings";
import { InstrumentStage } from "@/features/studio/InstrumentStage";
import { InputHub } from "@/features/studio/input/inputHub";
import { formatBytes, getAssetPack, packSize } from "@/lib/offline/assetPacks";
import type { InstrumentId } from "@/types/instruments";
import { Calibration } from "./Calibration";
import styles from "./onboarding.module.css";

export type OnboardingStep = "intro" | "touch" | "camera" | "calibrate" | "sound" | "start";

const ORDER: OnboardingStep[] = ["intro", "touch", "camera", "calibrate", "sound", "start"];

/**
 * Short, skippable first-use flow. Camera permission is requested only if the
 * person chooses camera interaction in step 3.
 */
export function Onboarding() {
  const router = useRouter();
  const [settings, update] = useSettings();
  const reducedMotion = useReducedMotion();
  const audio = useAudio(settings.volume, settings.muted);
  const [step, setStep] = useState<OnboardingStep>("intro");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hub = useMemo(() => new InputHub(), []);
  const touchStage = useRef<HTMLDivElement>(null);
  const aurora = getInstrument("aurora");
  const parameters = useMemo(() => defaultParameters(aurora), [aurora]);

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== "touch" || !touchStage.current) return;
    return hub.touch.attach(touchStage.current);
  }, [step, hub]);

  const finish = (instrumentId: InstrumentId) => {
    update({ onboardingComplete: true, lastInstrument: instrumentId });
    router.push(`/studio/?instrument=${instrumentId}`);
  };

  const skip = () => {
    update({ onboardingComplete: true });
    router.push("/studio/?instrument=aurora");
  };

  const index = ORDER.indexOf(step);
  const handBytes = packSize(getAssetPack("hands", true));

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <Wordmark />
        <Button variant="ghost" onClick={skip}>
          Skip
        </Button>
      </header>

      <div className={styles.progressDots} aria-hidden="true">
        {ORDER.map((s, i) => (
          <span key={s} className={`${styles.dot} ${i <= index ? styles.dotActive : ""}`} />
        ))}
      </div>
      <p className="visually-hidden">
        Step {index + 1} of {ORDER.length}
      </p>

      <section className={styles.card} aria-labelledby="onboarding-heading">
        {step === "intro" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={`display ${styles.title}`}>
              Movement becomes light and sound.
            </h1>
            <p className={styles.lead}>Aura is a set of instruments you play with your hands — through the camera, or simply with touch. Nothing you do leaves this device.</p>
            <div className={styles.actions}>
              <Button variant="primary" size="lg" onClick={() => setStep("touch")}>
                Begin
              </Button>
            </div>
          </>
        )}

        {step === "touch" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={styles.title}>
              Try it with your finger
            </h1>
            <p className={styles.lead}>Drag across the light. Move up to brighten it, side to side to steer it.</p>
            <div ref={touchStage} className={styles.touchStage}>
              <InstrumentStage
                instrumentId="aurora"
                parameters={parameters}
                seed={11}
                quality="balanced"
                reducedMotion={reducedMotion}
                label="Interactive Aurora preview. Drag to play."
                getInput={(dt, now) => hub.collect(dt, now)}
              />
            </div>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => setStep("camera")}>
                Next
              </Button>
            </div>
          </>
        )}

        {step === "camera" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={styles.title}>
              Play with your hands?
            </h1>
            <ul className={styles.facts}>
              <li>
                <Icon name="camera" size={20} /> The camera lets Aura follow your hands in real time.
              </li>
              <li>
                <Icon name="check" size={20} /> Video is processed on this device. It is never uploaded, recorded or stored.
              </li>
              <li>
                <Icon name="download" size={20} /> First use downloads about {formatBytes(handBytes)}, kept for offline use.
              </li>
              <li>
                <Icon name="touch" size={20} /> You can always switch to touch, and change your mind in Settings.
              </li>
            </ul>
            <div className={styles.actions}>
              <Button
                variant="ghost"
                onClick={() => {
                  update({ cameraEnabled: false });
                  setStep("sound");
                }}
              >
                Continue without camera
              </Button>
              <Button variant="primary" icon="camera" onClick={() => setStep("calibrate")}>
                Use camera
              </Button>
            </div>
          </>
        )}

        {step === "calibrate" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={styles.title}>
              Quick gesture check
            </h1>
            <Calibration
              onComplete={() => setStep("sound")}
              onSkipCamera={() => {
                update({ cameraEnabled: false });
                setStep("sound");
              }}
            />
          </>
        )}

        {step === "sound" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={styles.title}>
              Turn on sound
            </h1>
            <p className={styles.lead}>Every instrument plays gentle, generated music that follows your movement. You can mute it any time.</p>
            {audio.state === "running" && (
              <p className={styles.success} role="status">
                <Icon name="check" size={18} /> Sound is on
              </p>
            )}
            {audio.error && (
              <p className={styles.warning} role="alert">
                <Icon name="warning" size={18} /> {audio.error.info.message} {audio.error.info.action}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                variant="ghost"
                onClick={() => {
                  update({ muted: true });
                  setStep("start");
                }}
              >
                Stay silent
              </Button>
              <Button
                variant="primary"
                icon="sound"
                onClick={async () => {
                  const ok = await audio.activate();
                  if (ok) {
                    update({ muted: false });
                    setStep("start");
                  }
                }}
              >
                Enable sound
              </Button>
            </div>
          </>
        )}

        {step === "start" && (
          <>
            <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className={styles.title}>
              Choose your first instrument
            </h1>
            <ul className={styles.choices}>
              {INSTRUMENTS.map((instrument) => (
                <li key={instrument.id}>
                  <button type="button" className={styles.choice} onClick={() => finish(instrument.id)}>
                    <span className={styles.choiceSwatch} style={{ background: `linear-gradient(135deg, ${instrument.palette.join(", ")})` }} aria-hidden="true" />
                    <span>
                      <strong>{instrument.name}</strong>
                      <span className={styles.choiceHint}>{instrument.tagline}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {index > 0 && step !== "start" && (
        <Button variant="ghost" className={styles.back} onClick={() => setStep(ORDER[step === "sound" && !settings.cameraEnabled ? 2 : index - 1] ?? "intro")}>
          Back
        </Button>
      )}
    </main>
  );
}
