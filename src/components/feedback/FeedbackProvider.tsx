"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./feedback.module.css";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  kind?: ToastKind;
  /** Optional action button. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number;
}

interface Toast extends Required<Pick<ToastOptions, "kind">> {
  id: number;
  message: string;
  action?: ToastOptions["action"];
}

interface FeedbackApi {
  /** Screen-reader announcement (polite). */
  announce: (message: string) => void;
  toast: (message: string, options?: ToastOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const KIND_ICON: Record<ToastKind, IconName> = { info: "info", success: "check", warning: "warning", error: "warning" };
const KIND_LABEL: Record<ToastKind, string> = { info: "Info", success: "Done", warning: "Warning", error: "Error" };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const announce = useCallback((text: string) => {
    // Clear first so repeating the same message is announced again.
    setMessage("");
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (text: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const kind = options.kind ?? "info";
      setToasts((list) => [...list.slice(-2), { id, message: text, kind, action: options.action }]);
      const duration = options.duration ?? (options.action ? 8000 : 4000);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ announce, toast }), [announce, toast]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      <div className={styles.toastRegion} role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`} role={t.kind === "error" ? "alert" : "status"}>
            <Icon name={KIND_ICON[t.kind]} size={20} />
            <span className="visually-hidden">{KIND_LABEL[t.kind]}:</span>
            <span className={styles.toastMessage}>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className={styles.toastAction}
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className={styles.toastDismiss} aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside FeedbackProvider");
  return context;
}
