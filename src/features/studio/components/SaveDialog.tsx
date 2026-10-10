"use client";

import { useId, useState } from "react";
import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MAX_NAME_LENGTH } from "@/features/creations/schema";
import type { AppError } from "@/lib/errors/appErrors";
import styles from "../studio.module.css";

interface SaveDialogProps {
  open: boolean;
  initialName: string;
  isExisting: boolean;
  saving: boolean;
  error: AppError | null;
  onClose: () => void;
  onSave: (name: string, asNew: boolean) => void;
  onExportInstead: () => void;
}

export function SaveDialog({ open, initialName, isExisting, saving, error, onClose, onSave, onExportInstead }: SaveDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={isExisting ? "Save changes" : "Save creation"}
      description="Creations are stored only on this device. Export a file to keep a copy elsewhere."
    >
      {/* Mounted fresh each time the dialog opens, so the name resets. */}
      <SaveForm initialName={initialName} isExisting={isExisting} saving={saving} error={error} onSave={onSave} onExportInstead={onExportInstead} />
    </Dialog>
  );
}

function SaveForm({ initialName, isExisting, saving, error, onSave, onExportInstead }: Omit<SaveDialogProps, "open" | "onClose">) {
  const [name, setName] = useState(initialName);
  const inputId = useId();
  return (
      <form
        className={styles.saveForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name, false);
        }}
      >
        <label htmlFor={inputId} className={styles.inputLabel}>
          Name
        </label>
        <input
          id={inputId}
          className={styles.textInput}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
          required
        />
        {error && (
          <ErrorNotice error={error} compact>
            <Button variant="secondary" icon="export" onClick={onExportInstead}>
              Export file instead
            </Button>
          </ErrorNotice>
        )}
        <div className={styles.formActions}>
          {isExisting && (
            <Button variant="ghost" disabled={saving} onClick={() => onSave(name, true)}>
              Save as new
            </Button>
          )}
          <Button type="submit" variant="primary" icon="save" disabled={saving || name.trim().length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
  );
}
