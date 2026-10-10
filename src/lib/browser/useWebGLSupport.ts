"use client";

import { useSyncExternalStore } from "react";
import { supportsWebGL } from "./capabilities";

const noopSubscribe = () => () => {};

/**
 * WebGL availability that is safe to use during render. The server snapshot
 * (also used while hydrating) optimistically reports support so the
 * prerendered HTML matches the first client render; React then re-renders
 * with the real answer, showing the fallback only where WebGL is missing.
 */
export function useWebGLSupport(): boolean {
  return useSyncExternalStore(noopSubscribe, supportsWebGL, () => true);
}
