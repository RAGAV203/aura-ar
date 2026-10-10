"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { PageShell } from "@/components/layout/PageShell";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { getInstrument } from "@/features/instruments/registry";
import { InstrumentPreview } from "@/features/instruments/InstrumentPreview";
import { toAppError, type AppError } from "@/lib/errors/appErrors";
import type { Creation } from "@/types/creations";
import { exportCreationFile, importCreationFile } from "./importExport";
import { deleteCreation, duplicateCreation, renameCreation } from "./repository";
import { MAX_NAME_LENGTH } from "./schema";
import { formatDate, useCreations } from "./useCreations";
import { useStoredChoice } from "@/lib/browser/useStoredChoice";
import styles from "./creations.module.css";

type Layout = "grid" | "list";
const LAYOUT_KEY = "aura.library.layout";

export function CreationsLibrary() {
  const { creations, thumbnails, status, error, skipped, reload } = useCreations();
  const { toast, announce } = useFeedback();
  const [layout, setLayout] = useStoredChoice<Layout>(LAYOUT_KEY, ["grid", "list"], "grid");
  const [renaming, setRenaming] = useState<Creation | null>(null);
  const [deleting, setDeleting] = useState<Creation | null>(null);
  const [importError, setImportError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const changeLayout = setLayout;

  const run = async (action: () => Promise<unknown>, success: string, fallback: Parameters<typeof toAppError>[1] = "storage-write-failed") => {
    setBusy(true);
    try {
      await action();
      toast(success, { kind: "success" });
      announce(success);
    } catch (e) {
      toast(toAppError(e, fallback).info.message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setBusy(true);
    try {
      const creation = await importCreationFile(file);
      toast(`Imported “${creation.name}”`, { kind: "success" });
      announce(`Imported ${creation.name}`);
    } catch (e) {
      setImportError(toAppError(e, "import-invalid"));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <PageShell
      title="Creations"
      actions={
        <>
          <Button icon="import" onClick={() => fileInput.current?.click()} disabled={busy || status === "error"}>
            Import
          </Button>
          {creations.length > 0 && (
            <div className={styles.layoutToggle} role="group" aria-label="Layout">
              <IconButton icon="grid" label="Grid view" pressed={layout === "grid"} onClick={() => changeLayout("grid")} />
              <IconButton icon="list" label="List view" pressed={layout === "list"} onClick={() => changeLayout("list")} />
            </div>
          )}
        </>
      }
    >
      <input ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => onImport(e.target.files?.[0])} />

      {importError && (
        <div className={styles.notice}>
          <ErrorNotice error={importError}>
            <Button onClick={() => setImportError(null)}>Dismiss</Button>
          </ErrorNotice>
        </div>
      )}

      {status === "loading" && (
        <p role="status" className={styles.muted}>
          Loading your creations…
        </p>
      )}

      {status === "error" && error && (
        <ErrorNotice error={error}>
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
          <ButtonLink href="/studio/" variant="secondary">
            Create without saving
          </ButtonLink>
        </ErrorNotice>
      )}

      {skipped > 0 && (
        <p className={styles.muted} role="note">
          {skipped} saved {skipped === 1 ? "item couldn't" : "items couldn't"} be read and {skipped === 1 ? "is" : "are"} hidden.
        </p>
      )}

      {status === "ready" && creations.length === 0 && (
        <div className={styles.empty}>
          <InstrumentPreview instrumentId="light-trails" seed={5} className={styles.emptyArt} />
          <div className={styles.emptyText}>
            <h2>Nothing saved yet</h2>
            <p>Creations you save in the studio appear here, ready to reopen, rename, duplicate or export. You can also import an .aura.json project.</p>
            <ButtonLink href="/studio/" variant="primary" icon="sparkle">
              Open the studio
            </ButtonLink>
          </div>
        </div>
      )}

      {creations.length > 0 && (
        <ul className={layout === "grid" ? styles.grid : styles.list}>
          {creations.map((creation) => {
            const instrument = getInstrument(creation.instrumentId);
            return (
              <li key={creation.id} className={styles.item}>
                <Link href={`/studio/?creation=${creation.id}`} className={styles.thumbLink} aria-label={`Open ${creation.name}`}>
                  {thumbnails[creation.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob URL
                    <img src={thumbnails[creation.id]} alt="" className={styles.thumb} />
                  ) : (
                    <span className={styles.thumb} style={{ background: `linear-gradient(135deg, ${instrument.palette.join(", ")})` }} aria-hidden="true" />
                  )}
                </Link>
                <div className={styles.info}>
                  <h2 className={styles.name}>{creation.name}</h2>
                  <p className={styles.meta}>
                    {instrument.name} · <time dateTime={creation.updatedAt}>Edited {formatDate(creation.updatedAt)}</time>
                  </p>
                </div>
                <div className={styles.itemActions}>
                  <IconButton icon="edit" label={`Rename ${creation.name}`} onClick={() => setRenaming(creation)} disabled={busy} />
                  <IconButton icon="copy" label={`Duplicate ${creation.name}`} onClick={() => run(() => duplicateCreation(creation.id), "Duplicated")} disabled={busy} />
                  <IconButton icon="export" label={`Export ${creation.name}`} onClick={() => run(() => exportCreationFile(creation.id), "Project file exported", "export-failed")} disabled={busy} />
                  <IconButton icon="trash" label={`Delete ${creation.name}`} onClick={() => setDeleting(creation)} disabled={busy} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RenameDialog
        creation={renaming}
        onClose={() => setRenaming(null)}
        onRename={(name) => {
          const target = renaming;
          setRenaming(null);
          if (target) void run(() => renameCreation(target.id, name), "Renamed");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this creation?"
        description={`“${deleting?.name ?? ""}” will be permanently removed from this device. Export it first if you want to keep a copy.`}
        onCancel={() => setDeleting(null)}
        actions={[
          {
            label: "Delete",
            variant: "danger",
            onSelect: () => {
              const target = deleting;
              setDeleting(null);
              if (target) void run(() => deleteCreation(target.id), `Deleted “${target.name}”`);
            },
          },
        ]}
      />
    </PageShell>
  );
}

function RenameDialog({ creation, onClose, onRename }: { creation: Creation | null; onClose: () => void; onRename: (name: string) => void }) {
  return (
    <Dialog open={creation !== null} onClose={onClose} title="Rename creation">
      {creation && <RenameForm key={creation.id} initialName={creation.name} onClose={onClose} onRename={onRename} />}
    </Dialog>
  );
}

function RenameForm({ initialName, onClose, onRename }: { initialName: string; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  const id = useId();
  return (
      <form
        className={styles.renameForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onRename(name);
        }}
      >
        <label htmlFor={id} className={styles.label}>
          Name
        </label>
        <input id={id} className={styles.input} value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        <div className={styles.formActions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Rename
          </Button>
        </div>
      </form>
  );
}
