"use client";

import { useCallback, useEffect, useState } from "react";
import { getShellStatus, onSwState } from "@/lib/pwa/serviceWorkerClient";
import { getAssetPack, getPackStatus, type PackStatus } from "./assetPacks";

export interface OfflineReadiness {
  /** App shell (all instruments in touch mode) verified in the cache. */
  shell: "ready" | "partial" | "unavailable" | "checking";
  shellVersion: string | null;
  hands: PackStatus | null;
  pose: PackStatus | null;
  refresh: () => void;
}

async function detectSimd(): Promise<boolean> {
  try {
    const { FilesetResolver } = await import("@mediapipe/tasks-vision");
    return await FilesetResolver.isSimdSupported();
  } catch {
    return true;
  }
}

/**
 * Reports what is genuinely available offline. Nothing is reported ready
 * until the service worker or the model cache has verified the files.
 */
export function useOfflineReadiness(options: { packs?: boolean } = {}): OfflineReadiness {
  const checkPacks = options.packs ?? true;
  const [shell, setShell] = useState<OfflineReadiness["shell"]>("checking");
  const [shellVersion, setShellVersion] = useState<string | null>(null);
  const [hands, setHands] = useState<PackStatus | null>(null);
  const [pose, setPose] = useState<PackStatus | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => onSwState(() => refresh()), [refresh]);

  // On a first visit the worker takes control (clients.claim) after
  // registration resolves; re-check then, or the shell would look uncached
  // until the next page load.
  useEffect(() => {
    const container = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!container) return;
    container.addEventListener("controllerchange", refresh);
    return () => container.removeEventListener("controllerchange", refresh);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await getShellStatus().catch(() => null);
      if (cancelled) return;
      if (!status) setShell("unavailable");
      else setShell(status.cached >= status.total && status.total > 0 ? "ready" : "partial");
      setShellVersion(status?.version ?? null);
      if (!checkPacks) return;
      const simd = await detectSimd();
      const [h, p] = await Promise.all([getPackStatus(getAssetPack("hands", simd)), getPackStatus(getAssetPack("pose", simd))]);
      if (cancelled) return;
      setHands(h);
      setPose(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick, checkPacks]);

  return { shell, shellVersion, hands, pose, refresh };
}
