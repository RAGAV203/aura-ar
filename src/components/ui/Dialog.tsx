"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import styles from "./ui.module.css";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "sheet" slides from the bottom on phones; "dialog" is centred. */
  variant?: "dialog" | "sheet";
  /** Prevent closing via Escape / backdrop (used while an operation runs). */
  dismissible?: boolean;
}

/**
 * Modal built on the native <dialog> element: focus is trapped and restored
 * by the browser, Escape closes it, and it is announced as a dialog.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "dialog", dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${variant === "sheet" ? styles.sheet : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.dialogInner}>
          <header className={styles.dialogHeader}>
            <h2 id={titleId}>{title}</h2>
            {dismissible && <IconButton icon="close" label="Close" onClick={onClose} className={styles.dialogClose} />}
          </header>
          {description && (
            <div id={descId} className={styles.dialogDescription}>
              {description}
            </div>
          )}
          {children && <div className={styles.dialogBody}>{children}</div>}
          {footer && <footer className={styles.dialogFooter}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
