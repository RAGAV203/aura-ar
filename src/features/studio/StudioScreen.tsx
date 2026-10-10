"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { clearDraft, getCreation, getMedia, loadDraft, type Draft } from "@/features/creations/repository";
import { formatDate } from "@/features/creations/useCreations";
import { defaultParameters, getInstrument, isInstrumentId } from "@/features/instruments/registry";
import { settingsStore } from "@/features/settings/settingsStore";
import { AppError, toAppError } from "@/lib/errors/appErrors";
import { randomSeed } from "@/lib/math";
import type { InstrumentId } from "@/types/instruments";
import { StudioSession, type StudioInitial } from "./StudioSession";
import styles from "./studio.module.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; initial: StudioInitial; key: string }
  | { kind: "recover"; draft: Draft; fallback: StudioInitial }
  | { kind: "not-found" }
  | { kind: "error"; error: AppError };

const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function freshSession(instrumentId: InstrumentId): StudioInitial {
  const definition = getInstrument(instrumentId);
  const preset = definition.presets[0];
  return {
    instrumentId,
    parameters: preset ? { ...defaultParameters(definition), ...preset.parameters } : defaultParameters(definition),
    presetId: preset?.id ?? null,
    seed: randomSeed(),
    state: {},
    snapshot: null,
    creation: null,
  };
}

/** Resolves what the studio should open (new session, saved creation or recovered draft). */
export function StudioScreen() {
  const params = useSearchParams();
  const creationId = params.get("creation");
  const requested = params.get("instrument");
  const debug = params.get("debug") === "1";
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lastInstrument = settingsStore.get().lastInstrument;
      const instrumentId: InstrumentId = isInstrumentId(requested) ? requested : isInstrumentId(lastInstrument) ? lastInstrument : "aurora";

      if (creationId) {
        try {
          const creation = await getCreation(creationId);
          if (cancelled) return;
          if (!creation) return setLoad({ kind: "not-found" });
          const media = await getMedia(creation.id).catch(() => null);
          if (cancelled) return;
          setLoad({
            kind: "ready",
            key: creation.id,
            initial: {
              instrumentId: creation.instrumentId,
              parameters: creation.parameters,
              presetId: creation.presetId,
              seed: creation.seed,
              state: creation.state,
              snapshot: media?.snapshot ?? null,
              creation: { id: creation.id, name: creation.name, createdAt: creation.createdAt },
            },
          });
        } catch (error) {
          if (!cancelled) setLoad({ kind: "error", error: toAppError(error, "storage-unavailable") });
        }
        return;
      }

      const fallback = freshSession(instrumentId);
      const draft = await loadDraft().catch(() => null);
      if (cancelled) return;
      if (draft && Date.now() - Date.parse(draft.savedAt) < DRAFT_MAX_AGE_MS) setLoad({ kind: "recover", draft, fallback });
      else setLoad({ kind: "ready", initial: fallback, key: `new-${instrumentId}` });
    })();
    return () => {
      cancelled = true;
    };
    // Resolve once per mount: the session itself rewrites the URL after saving
    // or switching instruments, which must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (load.kind === "loading") {
    return (
      <div className={styles.loading} role="status">
        <span className={styles.loadingOrb} aria-hidden="true" />
        Preparing the studio…
      </div>
    );
  }

  if (load.kind === "not-found" || load.kind === "error") {
    const error = load.kind === "error" ? load.error : new AppError("storage-write-failed");
    return (
      <main id="main" className={styles.loading}>
        <div className={styles.centerCard}>
          {load.kind === "not-found" ? (
            <>
              <h1>Creation not found</h1>
              <p>It may have been deleted, or it was saved in another browser.</p>
            </>
          ) : (
            <ErrorNotice error={error} />
          )}
          <div className={styles.formActions}>
            <ButtonLink href="/creations/" variant="ghost">
              Open library
            </ButtonLink>
            <ButtonLink href="/studio/?instrument=aurora" variant="primary">
              Start something new
            </ButtonLink>
          </div>
        </div>
      </main>
    );
  }

  if (load.kind === "recover") {
    const { draft, fallback } = load;
    return (
      <main id="main" className={styles.loading}>
        <div className={styles.centerCard} role="dialog" aria-labelledby="recover-title" aria-describedby="recover-desc">
          <h1 id="recover-title">Pick up where you left off?</h1>
          <p id="recover-desc">
            An unsaved {getInstrument(draft.creation.instrumentId).name} session from {formatDate(draft.savedAt)} was kept for you.
          </p>
          <div className={styles.formActions}>
            <Button
              variant="ghost"
              onClick={() => {
                void clearDraft().catch(() => undefined);
                setLoad({ kind: "ready", initial: fallback, key: "fresh" });
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              autoFocus
              onClick={() =>
                setLoad({
                  kind: "ready",
                  key: "draft",
                  initial: {
                    instrumentId: draft.creation.instrumentId,
                    parameters: draft.creation.parameters,
                    presetId: draft.creation.presetId,
                    seed: draft.creation.seed,
                    state: draft.creation.state,
                    snapshot: draft.snapshot,
                    creation: null,
                  },
                })
              }
            >
              Restore session
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className={styles.main}>
      <StudioSession key={load.key} initial={load.initial} debug={debug} />
    </main>
  );
}
