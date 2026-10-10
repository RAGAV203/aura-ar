import { AppError } from "@/lib/errors/appErrors";
import { deleteDatabase, idbClear, idbDelete, idbGet, idbGetAll, idbPut, STORES, transact } from "@/lib/persistence/db";
import type { Creation, CreationMedia } from "@/types/creations";
import { createId, sanitizeName, validateCreation } from "./schema";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to any change in the creations library. */
export function onCreationsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((l) => l());
}

export interface CreationListResult {
  creations: Creation[];
  /** Records that failed validation and were skipped. */
  skipped: number;
}

/** Lists creations newest first. Invalid records are skipped, never thrown. */
export async function listCreations(): Promise<CreationListResult> {
  const raw = await transact([STORES.creations], "readonly", (tx) => idbGetAll<unknown>(tx, STORES.creations));
  const creations: Creation[] = [];
  let skipped = 0;
  for (const record of raw) {
    const result = validateCreation(record);
    if (result.ok) creations.push(result.value);
    else skipped++;
  }
  creations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { creations, skipped };
}

export async function getCreation(id: string): Promise<Creation | null> {
  const raw = await transact([STORES.creations], "readonly", (tx) => idbGet<unknown>(tx, STORES.creations, id));
  if (!raw) return null;
  const result = validateCreation(raw);
  return result.ok ? result.value : null;
}

export async function getMedia(id: string): Promise<CreationMedia | null> {
  const media = await transact([STORES.media], "readonly", (tx) => idbGet<CreationMedia>(tx, STORES.media, id));
  return media ?? null;
}

/** Validates and writes a creation together with its media in one transaction. */
export async function saveCreation(creation: Creation, media?: { thumbnail: Blob | null; snapshot: Blob | null }): Promise<Creation> {
  const result = validateCreation(creation);
  if (!result.ok) throw new AppError("storage-write-failed", { cause: new Error(result.errors.join(", ")) });
  const value = result.value;
  await transact([STORES.creations, STORES.media], "readwrite", async (tx) => {
    await idbPut(tx, STORES.creations, value);
    if (media) await idbPut(tx, STORES.media, { id: value.id, thumbnail: media.thumbnail, snapshot: media.snapshot } satisfies CreationMedia);
  });
  notify();
  return value;
}

export async function renameCreation(id: string, name: string): Promise<Creation> {
  const existing = await getCreation(id);
  if (!existing) throw new AppError("storage-write-failed", { cause: new Error("not found") });
  return saveCreation({ ...existing, name: sanitizeName(name), updatedAt: new Date().toISOString() });
}

export async function duplicateCreation(id: string): Promise<Creation> {
  const existing = await getCreation(id);
  if (!existing) throw new AppError("storage-write-failed", { cause: new Error("not found") });
  const media = await getMedia(id);
  const now = new Date().toISOString();
  const copy: Creation = { ...existing, id: createId(), name: sanitizeName(`${existing.name} copy`), createdAt: now, updatedAt: now };
  return saveCreation(copy, { thumbnail: media?.thumbnail ?? null, snapshot: media?.snapshot ?? null });
}

export async function deleteCreation(id: string): Promise<void> {
  await transact([STORES.creations, STORES.media], "readwrite", async (tx) => {
    await idbDelete(tx, STORES.creations, id);
    await idbDelete(tx, STORES.media, id);
  });
  notify();
}

/* ---------- Interrupted-session recovery ---------- */

export interface Draft {
  id: "current";
  creation: Creation;
  snapshot: Blob | null;
  savedAt: string;
}

export async function saveDraft(creation: Creation, snapshot: Blob | null): Promise<void> {
  const draft: Draft = { id: "current", creation, snapshot, savedAt: new Date().toISOString() };
  await transact([STORES.drafts], "readwrite", (tx) => idbPut(tx, STORES.drafts, draft));
}

export async function loadDraft(): Promise<Draft | null> {
  const draft = await transact([STORES.drafts], "readonly", (tx) => idbGet<Draft>(tx, STORES.drafts, "current"));
  if (!draft) return null;
  const result = validateCreation(draft.creation);
  if (!result.ok) return null;
  return { ...draft, creation: result.value };
}

export async function clearDraft(): Promise<void> {
  await transact([STORES.drafts], "readwrite", (tx) => idbDelete(tx, STORES.drafts, "current"));
}

/* ---------- Storage management ---------- */

export async function clearAllCreations(): Promise<void> {
  await transact([STORES.creations, STORES.media, STORES.drafts], "readwrite", async (tx) => {
    await idbClear(tx, STORES.creations);
    await idbClear(tx, STORES.media);
    await idbClear(tx, STORES.drafts);
  });
  notify();
}

export async function destroyDatabase(): Promise<void> {
  await deleteDatabase();
  notify();
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage, quota, persisted };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict Aura's data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
