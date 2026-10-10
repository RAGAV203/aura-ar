"use client";

import { PageShell } from "@/components/layout/PageShell";
import { useOfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import { InstrumentCard } from "./InstrumentCard";
import { INSTRUMENTS, instrumentsByCategory } from "./registry";
import styles from "./instruments.module.css";

export function InstrumentLibrary() {
  const offline = useOfflineReadiness();
  return (
    <PageShell title="Instruments">
      <p className={styles.intro}>
        {INSTRUMENTS.length} instruments, each with its own way of turning movement into sound and light. Every one works with touch; hand tracking is optional.
      </p>
      {instrumentsByCategory().map((category) => (
        <section key={category.id} className={styles.category} aria-labelledby={`cat-${category.id}`}>
          <h2 id={`cat-${category.id}`} className={styles.categoryTitle}>
            {category.label}
          </h2>
          <p className={styles.categoryDescription}>{category.description}</p>
          <div className={styles.grid}>
            {category.instruments.map((instrument) => (
              <InstrumentCard key={instrument.id} instrument={instrument} handsPack={offline.hands} />
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
