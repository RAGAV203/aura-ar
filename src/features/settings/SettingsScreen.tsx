"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Segmented, Slider, Toggle } from "@/components/ui/controls";
import { destroyDatabase, estimateStorage, requestPersistentStorage, type StorageEstimate } from "@/features/creations/repository";
import { formatBytes } from "@/lib/offline/assetPacks";
import { useOfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import { checkForUpdate, clearAllCaches, onSwState, type SwState } from "@/lib/pwa/serviceWorkerClient";
import { OfflinePacks } from "./OfflinePacks";
import { settingsStore } from "./settingsStore";
import { useSettings } from "./useSettings";
import styles from "./settings.module.css";

const SW_LABEL: Record<SwState, string> = {
  unsupported: "Offline support isn't active in this browser or build",
  installing: "Installing offline support…",
  ready: "Up to date",
  "update-available": "Update available — use the prompt to install",
  error: "Update check failed — reload to try again",
};

export function SettingsScreen() {
  const [settings, update] = useSettings();
  const { toast, announce } = useFeedback();
  const offline = useOfflineReadiness();
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [swState, setSwState] = useState<SwState>("unsupported");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => onSwState(setSwState), []);
  useEffect(() => {
    void estimateStorage().then(setStorage);
  }, [offline.hands, offline.pose]);

  const clearEverything = async () => {
    setConfirmClear(false);
    try {
      await destroyDatabase();
      await clearAllCaches();
      settingsStore.reset();
      try {
        window.localStorage.clear();
      } catch {
        /* ignore */
      }
      announce("All local data cleared");
      toast("All local data cleared. Aura is back to a fresh start.", { kind: "success" });
      offline.refresh();
      setStorage(await estimateStorage());
    } catch {
      toast("Some data couldn't be cleared. Close other Aura tabs and try again.", { kind: "error" });
    }
  };

  return (
    <PageShell title="Settings">
      <div className={styles.sections}>
        <section className={styles.section} aria-labelledby="s-interaction">
          <h2 id="s-interaction">Interaction</h2>
          <Toggle
            label="Touch-only mode"
            description="Never use the camera. Every instrument stays fully playable with touch, mouse or keyboard."
            checked={settings.touchOnly}
            onChange={(touchOnly) => update({ touchOnly, cameraEnabled: touchOnly ? false : settings.cameraEnabled })}
          />
          <Toggle
            label="Start camera automatically"
            description="Resume hand tracking when you open the studio. Off means you start it yourself each time."
            checked={settings.cameraEnabled}
            disabled={settings.touchOnly}
            onChange={(cameraEnabled) => update({ cameraEnabled })}
          />
          <Toggle
            label="Body pose"
            description="Also track your arms for Aurora and Particle Bloom. Needs an extra 5.8 MB download."
            checked={settings.poseEnabled}
            disabled={settings.touchOnly}
            onChange={(poseEnabled) => update({ poseEnabled })}
          />
          <Toggle
            label="Show camera behind artwork"
            description="While the camera is on, your graphics are drawn over the live view."
            checked={settings.cameraBackdrop}
            disabled={settings.touchOnly}
            onChange={(cameraBackdrop) => update({ cameraBackdrop })}
          />
          <Toggle
            label="Hand skeleton"
            description="Draw a glowing outline over the hands being tracked."
            checked={settings.handSkeleton}
            disabled={settings.touchOnly}
            onChange={(handSkeleton) => update({ handSkeleton })}
          />
          <Slider
            label="Gesture sensitivity"
            description="Higher reacts faster; lower is smoother and steadier."
            min={0}
            max={1}
            step={0.05}
            value={settings.gestureSensitivity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(gestureSensitivity) => update({ gestureSensitivity })}
          />
          <Segmented
            label="Hands"
            value={settings.handedness}
            onChange={(handedness) => update({ handedness })}
            options={[
              { value: "both", label: "Both" },
              { value: "left", label: "Left only" },
              { value: "right", label: "Right only" },
            ]}
          />
        </section>

        <section className={styles.section} aria-labelledby="s-sound">
          <h2 id="s-sound">Sound</h2>
          <Toggle label="Mute" description="Silent mode keeps every visual behaviour." checked={settings.muted} onChange={(muted) => update({ muted })} />
          <Slider label="Volume" min={0} max={1} step={0.05} value={settings.volume} disabled={settings.muted} format={(v) => `${Math.round(v * 100)}%`} onChange={(volume) => update({ volume })} />
        </section>

        <section className={styles.section} aria-labelledby="s-visuals">
          <h2 id="s-visuals">Visuals & performance</h2>
          <Slider
            label="Visual intensity"
            min={0.2}
            max={1}
            step={0.05}
            value={settings.visualIntensity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(visualIntensity) => update({ visualIntensity })}
          />
          <Segmented
            label="Reduced motion"
            description="Slows animation, shortens trails and freezes previews."
            value={settings.reducedMotion}
            onChange={(reducedMotion) => update({ reducedMotion })}
            options={[
              { value: "system", label: "System" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
          <Segmented
            label="Performance"
            description="Auto adapts to your device. Battery saver uses fewer particles and 30 fps."
            value={settings.performanceMode}
            onChange={(performanceMode) => update({ performanceMode })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "high", label: "High" },
              { value: "balanced", label: "Balanced" },
              { value: "battery", label: "Battery" },
            ]}
          />
        </section>

        <section className={styles.section} aria-labelledby="s-offline">
          <h2 id="s-offline">Offline & downloads</h2>
          <OfflinePacks offline={offline} />
        </section>

        <section className={styles.section} aria-labelledby="s-storage">
          <h2 id="s-storage">Storage</h2>
          <p className={styles.hint}>
            {storage
              ? `Aura is using ${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} available on this device.${storage.persisted ? " Storage is protected from automatic clean-up." : ""}`
              : "Storage usage isn't available in this browser."}
          </p>
          <div className={styles.buttonRow}>
            {storage && !storage.persisted && (
              <Button
                onClick={async () => {
                  const granted = await requestPersistentStorage();
                  toast(granted ? "Your creations are protected from automatic clean-up." : "The browser declined; export important creations to be safe.", {
                    kind: granted ? "success" : "warning",
                  });
                  setStorage(await estimateStorage());
                }}
              >
                Protect my creations
              </Button>
            )}
            <Button variant="danger" icon="trash" onClick={() => setConfirmClear(true)}>
              Clear all local data
            </Button>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="s-privacy">
          <h2 id="s-privacy">Privacy</h2>
          <p className={styles.hint}>
            Camera video is processed on this device and never uploaded, recorded or stored. Sound is synthesised locally. Creations stay in this browser unless you export them. Aura has no
            accounts, analytics or trackers.
          </p>
          <Link href="/privacy/" className={styles.link}>
            Read the full privacy notice
          </Link>
        </section>

        <section className={styles.section} aria-labelledby="s-about">
          <h2 id="s-about">About</h2>
          <dl className={styles.aboutList}>
            <div>
              <dt>Version</dt>
              <dd>{process.env.NEXT_PUBLIC_APP_VERSION}</dd>
            </div>
            <div>
              <dt>Updates</dt>
              <dd>{SW_LABEL[swState]}</dd>
            </div>
          </dl>
          <div className={styles.buttonRow}>
            <Button
              icon="refresh"
              disabled={swState === "unsupported"}
              onClick={async () => {
                await checkForUpdate().catch(() => undefined);
                toast("Checked for updates", { kind: "info" });
              }}
            >
              Check for updates
            </Button>
            <Button onClick={() => update({ onboardingComplete: false })} variant="ghost">
              Show welcome again
            </Button>
          </div>
          <Toggle label="Diagnostics" description="Show frame rate, inference time and quality level in the studio (for testing)." checked={settings.diagnostics} onChange={(diagnostics) => update({ diagnostics })} />
        </section>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all local data?"
        description="This permanently deletes every saved creation, downloaded tracking data and your preferences on this device. It can't be undone — export creations you want to keep first."
        onCancel={() => setConfirmClear(false)}
        actions={[{ label: "Delete everything", variant: "danger", onSelect: clearEverything }]}
      />
    </PageShell>
  );
}
