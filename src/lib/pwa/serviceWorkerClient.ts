import { supportsServiceWorker } from "@/lib/browser/capabilities";
import { logDiagnostic } from "@/lib/errors/appErrors";

export type SwState = "unsupported" | "installing" | "ready" | "update-available" | "error";

type Listener = (state: SwState) => void;

let registration: ServiceWorkerRegistration | null = null;
let state: SwState = "unsupported";
const listeners = new Set<Listener>();

function setState(next: SwState): void {
  state = next;
  listeners.forEach((l) => l(next));
}

export function getSwState(): SwState {
  return state;
}

export function onSwState(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/**
 * Registers /sw.js (production builds only). A new worker waits until the
 * user accepts the update, so an in-progress creation is never reloaded away.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!supportsServiceWorker() || process.env.NODE_ENV !== "production") return;
  try {
    setState("installing");
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    if (registration.waiting && navigator.serviceWorker.controller) setState("update-available");
    else setState("ready");

    registration.addEventListener("updatefound", () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") setState(navigator.serviceWorker.controller ? "update-available" : "ready");
        if (worker.state === "redundant" && state === "installing") setState("error");
      });
    });

    // Check for updates when the app regains focus.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => undefined);
    });
  } catch (error) {
    logDiagnostic("sw", "registration failed", error);
    setState("error");
  }
}

/** Activates the waiting worker and reloads once it takes control. */
export async function applyUpdate(): Promise<boolean> {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  return new Promise((resolve) => {
    let reloaded = false;
    const timer = setTimeout(() => {
      if (!reloaded) {
        setState("error");
        resolve(false);
      }
    }, 10_000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      clearTimeout(timer);
      resolve(true);
      window.location.reload();
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

export async function checkForUpdate(): Promise<void> {
  await registration?.update();
}

/** Asks the worker which app-shell entries are cached (offline readiness). */
export async function getShellStatus(): Promise<{ cached: number; total: number; version: string } | null> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (event: MessageEvent<{ cached: number; total: number; version: string }>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    controller.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
  });
}

/** Removes every Aura cache (used by "clear all local data"). */
export async function clearAllCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("aura-")).map((k) => caches.delete(k)));
}
