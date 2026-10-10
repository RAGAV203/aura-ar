import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/navigation/AppNav";
import styles from "./PageShell.module.css";

interface PageShellProps {
  title?: string;
  /** Visually hide the page title (still announced to screen readers). */
  hideTitle?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <Link href="/" className={`${styles.wordmark} ${size === "lg" ? styles.wordmarkLarge : ""}`} aria-label="Aura home">
      <span className={styles.wordmarkGlyph} aria-hidden="true" />
      <span className="display">Aura</span>
    </Link>
  );
}

export function PageShell({ title, hideTitle, actions, children }: PageShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Wordmark />
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        {title && (
          <div className={styles.titleRow}>
            <h1 className={hideTitle ? "visually-hidden" : styles.title}>{title}</h1>
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
        )}
        {children}
      </main>
      <AppNav />
    </div>
  );
}
