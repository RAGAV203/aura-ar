"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Small per-viewer UI preference (e.g. grid vs list) kept in localStorage.
 * Falls back to the default during server rendering and when storage is blocked.
 */
export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T): [T, (value: T) => void] {
  const subscribe = useCallback((callback: () => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }, []);
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = stored !== null && (options as readonly string[]).includes(stored) ? (stored as T) : fallback;
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage unavailable: preference lasts for this render only */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
