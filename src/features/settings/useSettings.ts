"use client";

import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/lib/browser/capabilities";
import { settingsStore, type Settings } from "./settingsStore";

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.getServerSnapshot);
  return [settings, settingsStore.update];
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** Effective reduced-motion preference: explicit setting wins over the OS preference. */
export function useReducedMotion(): boolean {
  const [settings] = useSettings();
  const system = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  if (settings.reducedMotion === "on") return true;
  if (settings.reducedMotion === "off") return false;
  return system;
}

/** True after hydration; use to gate browser-only UI and avoid hydration mismatches. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
