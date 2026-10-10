"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { InstrumentDefinition } from "@/types/instruments";
import styles from "../studio.module.css";

export function HelpSheet({ open, onClose, definition }: { open: boolean; onClose: () => void; definition: InstrumentDefinition }) {
  return (
    <Dialog open={open} onClose={onClose} variant="sheet" title={`How to play ${definition.name}`} description={definition.description}>
      <section className={styles.sheetSection} aria-labelledby="help-hands">
        <h3 id="help-hands" className={styles.sheetHeading}>
          <Icon name="hand" size={18} /> With your hands
        </h3>
        <dl className={styles.mappingList}>
          {definition.gestureMappings.map((m) => (
            <div key={m.input}>
              <dt>{m.input}</dt>
              <dd>{m.effect}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.sheetSection} aria-labelledby="help-touch">
        <h3 id="help-touch" className={styles.sheetHeading}>
          <Icon name="touch" size={18} /> With touch or mouse
        </h3>
        <dl className={styles.mappingList}>
          {definition.touchMappings.map((m) => (
            <div key={m.input}>
              <dt>{m.input}</dt>
              <dd>{m.effect}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.sheetSection} aria-labelledby="help-keys">
        <h3 id="help-keys" className={styles.sheetHeading}>
          Keyboard
        </h3>
        <dl className={styles.mappingList}>
          <div>
            <dt>Arrow keys (with the artwork focused)</dt>
            <dd>Move and draw</dd>
          </div>
          <div>
            <dt>Enter / Shift + Enter</dt>
            <dd>Tap / colour accent</dd>
          </div>
          <div>
            <dt>Space</dt>
            <dd>Pause or resume animation and sound</dd>
          </div>
        </dl>
      </section>
    </Dialog>
  );
}
