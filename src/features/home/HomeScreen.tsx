"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatDate, useCreations } from "@/features/creations/useCreations";
import { InstrumentCard } from "@/features/instruments/InstrumentCard";
import { InstrumentPreview } from "@/features/instruments/InstrumentPreview";
import { getInstrument, INSTRUMENTS, isInstrumentId } from "@/features/instruments/registry";
import { useHydrated, useSettings } from "@/features/settings/useSettings";
import { useOfflineReadiness } from "@/lib/offline/useOfflineReadiness";
import instrumentStyles from "@/features/instruments/instruments.module.css";
import styles from "./HomeScreen.module.css";

export function HomeScreen() {
  const [settings] = useSettings();
  const hydrated = useHydrated();
  const offline = useOfflineReadiness();
  const recent = useCreations(4);
  const heroRef = useRef<HTMLDivElement>(null);
  const [attractor, setAttractor] = useState<{ x: number; y: number } | null>(null);

  const lastInstrument = isInstrumentId(settings.lastInstrument) ? settings.lastInstrument : "aurora";
  const enterHref = hydrated && !settings.onboardingComplete ? "/welcome/" : `/studio/?instrument=${lastInstrument}`;

  return (
    <PageShell>
      <section
        ref={heroRef}
        className={styles.hero}
        aria-labelledby="hero-title"
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const rect = heroRef.current?.getBoundingClientRect();
          if (rect) setAttractor({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
        }}
        onPointerLeave={() => setAttractor(null)}
      >
        <InstrumentPreview instrumentId="aurora" seed={2024} quality="balanced" className={styles.heroArt} attractor={attractor} />
        <div className={styles.heroContent}>
          <h1 id="hero-title" className={`display ${styles.heroTitle}`}>
            Move your hands.
            <br />
            <em>Shape your world.</em>
          </h1>
          <p className={styles.heroLead}>An instrument of light and sound that answers to your gestures — or your fingertips. Everything happens on your device.</p>
          <div className={styles.heroActions}>
            <ButtonLink href={enterHref} variant="primary" size="lg" icon="sparkle">
              Enter the Garden
            </ButtonLink>
          </div>
          {offline.shell === "ready" && (
            <p className={styles.offlineBadge}>
              <Icon name="check" size={16} /> Ready offline
            </p>
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="instruments-title">
        <div className={styles.sectionHeader}>
          <h2 id="instruments-title">Instruments</h2>
          <Link href="/instruments/" className={styles.seeAll}>
            See all
          </Link>
        </div>
        <div className={instrumentStyles.scroller}>
          {INSTRUMENTS.map((instrument) => (
            <InstrumentCard key={instrument.id} instrument={instrument} handsPack={offline.hands} compact />
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recent-title">
        <div className={styles.sectionHeader}>
          <h2 id="recent-title">Recent creations</h2>
          {recent.creations.length > 0 && (
            <Link href="/creations/" className={styles.seeAll}>
              Library
            </Link>
          )}
        </div>
        {recent.status === "ready" && recent.creations.length === 0 && (
          <div className={styles.invitation}>
            <InstrumentPreview instrumentId="particle-bloom" seed={99} className={styles.invitationArt} />
            <div className={styles.invitationText}>
              <h3>Your garden is waiting</h3>
              <p>Make your first piece — a few seconds of movement is enough. Save it and it will bloom here.</p>
              <ButtonLink href={enterHref} variant="secondary" icon="play">
                Start creating
              </ButtonLink>
            </div>
          </div>
        )}
        {recent.status === "error" && (
          <p className={styles.muted}>
            <Icon name="info" size={16} /> Saved creations aren&apos;t available in this browser window. You can still create and export.
          </p>
        )}
        {recent.creations.length > 0 && (
          <ul className={styles.recentGrid}>
            {recent.creations.map((creation) => (
              <li key={creation.id}>
                <Link href={`/studio/?creation=${creation.id}`} className={styles.recentCard}>
                  {recent.thumbnails[creation.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob URL
                    <img src={recent.thumbnails[creation.id]} alt="" className={styles.recentThumb} />
                  ) : (
                    <span className={styles.recentThumb} aria-hidden="true" />
                  )}
                  <span className={styles.recentName}>{creation.name}</span>
                  <span className={styles.recentMeta}>
                    {getInstrument(creation.instrumentId).name} · {formatDate(creation.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
