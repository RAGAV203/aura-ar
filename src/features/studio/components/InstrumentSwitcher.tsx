"use client";

import { Dialog } from "@/components/ui/Dialog";
import { instrumentsByCategory } from "@/features/instruments/registry";
import type { InstrumentId } from "@/types/instruments";
import styles from "../studio.module.css";

interface InstrumentSwitcherProps {
  open: boolean;
  current: InstrumentId;
  onClose: () => void;
  onSelect: (id: InstrumentId) => void;
}

export function InstrumentSwitcher({ open, current, onClose, onSelect }: InstrumentSwitcherProps) {
  return (
    <Dialog open={open} onClose={onClose} variant="sheet" title="Choose an instrument">
      {instrumentsByCategory().map((category) => (
        <section key={category.id} className={styles.sheetSection} aria-labelledby={`switch-${category.id}`}>
          <h3 id={`switch-${category.id}`} className={styles.sheetHeading}>
            {category.label}
          </h3>
      <ul className={styles.switcherList}>
        {category.instruments.map((instrument) => (
          <li key={instrument.id}>
            <button
              type="button"
              className={`${styles.switcherItem} ${instrument.id === current ? styles.switcherActive : ""}`}
              aria-current={instrument.id === current ? "true" : undefined}
              onClick={() => onSelect(instrument.id)}
            >
              <span className={styles.switcherSwatch} style={{ background: `linear-gradient(135deg, ${instrument.palette.join(", ")})` }} aria-hidden="true" />
              <span className={styles.switcherText}>
                <span className={styles.switcherName}>{instrument.name}</span>
                <span className={styles.switcherTagline}>{instrument.tagline}</span>
              </span>
              {instrument.id === current && <span className={styles.switcherCurrent}>Playing</span>}
            </button>
          </li>
        ))}
      </ul>
        </section>
      ))}
    </Dialog>
  );
}
