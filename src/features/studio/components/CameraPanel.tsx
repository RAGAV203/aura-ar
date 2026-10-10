"use client";

import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { VisionController } from "@/features/vision/useVision";
import { formatBytes, getAssetPack, packSize, POSE_MODEL, type PackStatus } from "@/lib/offline/assetPacks";
import styles from "../studio.module.css";

interface CameraPanelProps {
  open: boolean;
  onClose: () => void;
  vision: Pick<VisionController, "phase" | "progress" | "error">;
  handsPack: PackStatus | null;
  poseEnabled: boolean;
  instrumentSupportsPose: boolean;
  onStart: () => void;
}

/**
 * Explains camera use before the browser permission prompt, then shows
 * download/initialisation progress and recoverable errors.
 */
export function CameraPanel({ open, onClose, vision, handsPack, poseEnabled, instrumentSupportsPose, onStart }: CameraPanelProps) {
  const busy = vision.phase === "requesting-camera" || vision.phase === "downloading" || vision.phase === "initializing";
  const needsDownload = !handsPack?.ready;
  const usePose = poseEnabled && instrumentSupportsPose;
  const downloadBytes = (needsDownload ? packSize(getAssetPack("hands", true)) : 0) + (usePose ? POSE_MODEL.approxBytes : 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      variant="sheet"
      title="Play with your hands"
      description="Aura uses your camera to follow your hands. Video is processed on this device in real time — it is never uploaded, recorded or stored."
      footer={
        vision.error ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Continue with touch
            </Button>
            <Button variant="primary" icon="refresh" onClick={onStart}>
              Try again
            </Button>
          </>
        ) : busy ? null : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" icon="camera" onClick={onStart}>
              Start camera
            </Button>
          </>
        )
      }
    >
      {!busy && !vision.error && (
        <ul className={styles.factList}>
          <li>Your browser will ask for camera permission. Microphone is never requested.</li>
          <li>{downloadBytes > 0 ? `First use downloads about ${formatBytes(downloadBytes)} of tracking data, kept on this device for offline use.` : "Tracking data is already on this device."}</li>
          <li>Turn the camera off at any time from the toolbar. Touch keeps working either way.</li>
        </ul>
      )}
      {busy && (
        <div className={styles.progressBlock}>
          <p role="status" aria-live="polite">
            {vision.phase === "requesting-camera" && "Waiting for camera permission…"}
            {vision.phase === "downloading" && `Downloading hand tracking… ${Math.round(vision.progress * 100)}%`}
            {vision.phase === "initializing" && "Starting hand tracking…"}
          </p>
          <progress className={styles.progress} max={1} value={vision.phase === "downloading" ? vision.progress : undefined} aria-label="Camera setup progress" />
        </div>
      )}
      {vision.error && <ErrorNotice error={vision.error} />}
    </Dialog>
  );
}
