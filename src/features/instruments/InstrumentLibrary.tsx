"use client";

import { PageShell } from "@/components/layout/PageShell";
import { useOfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import { InstrumentCard } from "./InstrumentCard";
import { INSTRUMENTS } from "./registry";
import styles from "./instruments.module.css";

export function InstrumentLibrary() {
  const offline = useOfflineReadiness();
  return (
    <PageShell title="Instruments">
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)", maxWidth: "60ch" }}>
        Five instruments, each with its own way of turning movement into light and sound. Every one works with touch; hand tracking is optional.
      </p>
      <div className={styles.grid}>
        {INSTRUMENTS.map((instrument) => (
          <InstrumentCard key={instrument.id} instrument={instrument} handsPack={offline.hands} />
        ))}
      </div>
    </PageShell>
  );
}
