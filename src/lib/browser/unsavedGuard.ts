/**
 * Tracks whether the studio holds unsaved work, so app-level flows (service
 * worker updates, navigation) can avoid discarding it.
 */
type Checker = () => boolean;

let checker: Checker | null = null;
let saver: (() => Promise<void>) | null = null;

export function registerUnsavedWork(check: Checker, saveDraft: () => Promise<void>): () => void {
  checker = check;
  saver = saveDraft;
  return () => {
    if (checker === check) {
      checker = null;
      saver = null;
    }
  };
}

export function hasUnsavedWork(): boolean {
  return checker?.() ?? false;
}

/** Persists a recovery draft of the unsaved work, if any. */
export async function preserveUnsavedWork(): Promise<void> {
  if (hasUnsavedWork() && saver) await saver();
}
