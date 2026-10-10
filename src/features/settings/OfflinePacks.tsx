"use client";

import { useState } from "react";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { toAppError } from "@/lib/errors/appErrors";
import { deletePack, downloadPack, formatBytes, getAssetPack, packSize, type AssetPackId, type PackStatus } from "@/lib/offline/assetPacks";
import type { OfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import styles from "./settings.module.css";

async function simd(): Promise<boolean> {
  const { FilesetResolver } = await import("@mediapipe/tasks-vision");
  return FilesetResolver.isSimdSupported();
}

function PackRow({ id, status, onChanged }: { id: AssetPackId; status: PackStatus | null; onChanged: () => void }) {
  const { toast, announce } = useFeedback();
  const [progress, setProgress] = useState<number | null>(null);
  const pack = getAssetPack(id, true);
  const ready = status?.ready ?? false;

  const download = async () => {
    setProgress(0);
    try {
      const resolved = getAssetPack(id, await simd());
      await downloadPack(resolved, (loaded, total) => setProgress(loaded / total));
      announce(`${pack.name} downloaded and available offline`);
      toast(`${pack.name} is ready offline`, { kind: "success" });
    } catch (error) {
      toast(toAppError(error, "model-download-failed").info.message, { kind: "error" });
    } finally {
      setProgress(null);
      onChanged();
    }
  };

  const remove = async () => {
    await deletePack(getAssetPack(id, await simd()));
    announce(`${pack.name} removed`);
    onChanged();
  };

  return (
    <div className={styles.packRow}>
      <div className={styles.packText}>
        <span className={styles.packName}>{pack.name}</span>
        <span className={styles.hint}>{pack.description}</span>
        <span className={`${styles.status} ${ready ? styles.statusGood : ""}`}>
          <Icon name={ready ? "check" : "download"} size={16} />
          {status === null
            ? "Checking…"
            : ready
              ? `Downloaded · ${formatBytes(status.cachedBytes)} · available offline`
              : `Not downloaded · about ${formatBytes(packSize(pack))}`}
        </span>
        {progress !== null && <progress className={styles.progress} max={1} value={progress} aria-label={`Downloading ${pack.name}`} />}
      </div>
      {ready ? (
        <Button variant="ghost" icon="trash" onClick={remove}>
          Remove
        </Button>
      ) : (
        <Button icon="download" onClick={download} disabled={progress !== null}>
          {progress !== null ? `${Math.round(progress * 100)}%` : "Download"}
        </Button>
      )}
    </div>
  );
}

export function OfflinePacks({ offline }: { offline: OfflineReadiness }) {
  return (
    <div className={styles.stack}>
      <p className={`${styles.status} ${offline.shell === "ready" ? styles.statusGood : ""}`}>
        <Icon name={offline.shell === "ready" ? "check" : "info"} size={16} />
        {offline.shell === "ready" && "All five instruments are cached and work offline with touch."}
        {offline.shell === "partial" && "Some app files are still downloading. Stay online a moment longer."}
        {offline.shell === "unavailable" && "Offline mode activates after the app has been installed by your browser (reload once over HTTPS)."}
        {offline.shell === "checking" && "Checking offline files…"}
      </p>
      <PackRow id="hands" status={offline.hands} onChanged={offline.refresh} />
      <PackRow id="pose" status={offline.pose} onChanged={offline.refresh} />
    </div>
  );
}
