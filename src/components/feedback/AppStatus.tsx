"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/features/settings/useSettings";
import { hasUnsavedWork, preserveUnsavedWork } from "@/lib/browser/unsavedGuard";
import { applyUpdate, onSwState, registerServiceWorker } from "@/lib/pwa/serviceWorkerClient";
import { useFeedback } from "./FeedbackProvider";

/**
 * App-level side effects: service worker registration, update prompt,
 * connectivity announcements and the reduced-motion root attribute.
 */
export function AppStatus() {
  const { toast, announce } = useFeedback();
  const reducedMotion = useReducedMotion();
  const updateShown = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    void registerServiceWorker();
    return onSwState((state) => {
      if (state === "update-available" && !updateShown.current) {
        updateShown.current = true;
        toast("A new version of Aura is ready.", {
          kind: "info",
          duration: 0,
          action: {
            label: "Update",
            onClick: async () => {
              // Keep unsaved work recoverable before the page reloads.
              if (hasUnsavedWork()) await preserveUnsavedWork();
              const ok = await applyUpdate();
              if (!ok) toast("The update didn't install. Reload the page to try again — your creations are safe.", { kind: "error" });
            },
          },
        });
      }
      if (state === "error") updateShown.current = false;
    });
  }, [toast]);

  useEffect(() => {
    const offline = () => {
      announce("You're offline. Downloaded instruments keep working.");
      toast("You're offline. Downloaded instruments keep working.", { kind: "warning" });
    };
    const online = () => announce("Back online.");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [announce, toast]);

  return null;
}
