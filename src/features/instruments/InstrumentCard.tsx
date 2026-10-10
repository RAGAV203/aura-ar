"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatBytes, HAND_MODEL, packSize, getAssetPack, type PackStatus } from "@/lib/offline/assetPacks";
import type { InstrumentDefinition } from "@/types/instruments";
import { InstrumentPreview } from "./InstrumentPreview";
import styles from "./instruments.module.css";

interface InstrumentCardProps {
  instrument: InstrumentDefinition;
  handsPack: PackStatus | null;
  compact?: boolean;
}

const HAND_PACK_BYTES = packSize(getAssetPack("hands", true)) || HAND_MODEL.approxBytes;

export function InstrumentCard({ instrument, handsPack, compact }: InstrumentCardProps) {
  const cameraReady = handsPack?.ready ?? false;
  return (
    <article className={`${styles.card} ${compact ? styles.cardCompact : ""}`} style={{ "--card-accent": instrument.palette[0], "--card-accent-2": instrument.palette[1] } as React.CSSProperties}>
      <InstrumentPreview instrumentId={instrument.id} className={styles.cardPreview} />
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>
          <Link href={`/studio/?instrument=${instrument.id}`} className={styles.cardLink}>
            {instrument.name}
          </Link>
        </h3>
        <p className={styles.cardTagline}>{instrument.tagline}</p>
        {!compact && <p className={styles.cardDescription}>{instrument.description}</p>}
        <ul className={styles.badges} aria-label="Supported input">
          <li className={styles.badge}>
            <Icon name="touch" size={16} /> Touch
          </li>
          {instrument.tracking.includes("hands") && (
            <li className={styles.badge}>
              <Icon name="hand" size={16} /> Hand gestures
            </li>
          )}
          {instrument.tracking.includes("pose") && (
            <li className={styles.badge}>
              <Icon name="sparkle" size={16} /> Body pose (optional)
            </li>
          )}
          {instrument.renderer === "webgl" && <li className={styles.badge}>3D · WebGL</li>}
        </ul>
        {!compact && (
          <p className={styles.downloadNote}>
            {cameraReady ? (
              <>
                <Icon name="check" size={16} /> Camera tracking downloaded
              </>
            ) : (
              <>
                <Icon name="download" size={16} /> Camera mode needs a one-time {formatBytes(HAND_PACK_BYTES)} download. Touch needs nothing extra.
              </>
            )}
          </p>
        )}
      </div>
    </article>
  );
}
