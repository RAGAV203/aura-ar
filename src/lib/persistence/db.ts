import { AppError } from "@/lib/errors/appErrors";
import { supportsIndexedDB } from "@/lib/browser/capabilities";

/**
 * Minimal promise wrapper around IndexedDB. Aura only needs a handful of
 * object stores, so a dependency isn't justified.
 *
 * Schema (version 1):
 *   creations  keyPath "id"   – validated Creation records
 *   media      keyPath "id"   – { id, thumbnail: Blob|null, snapshot: Blob|null }
 *   drafts     keyPath "id"   – single "current" record for session recovery
 */
export const DB_NAME = "aura";
export const DB_VERSION = 1;
export const STORES = { creations: "creations", media: "media", drafts: "drafts" } as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (!supportsIndexedDB()) return Promise.reject(new AppError("storage-unavailable"));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new AppError("storage-unavailable", { cause: error }));
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      // Structural migrations go here, keyed by the version being upgraded from.
      if (oldVersion < 1) {
        db.createObjectStore(STORES.creations, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
        db.createObjectStore(STORES.media, { keyPath: "id" });
        db.createObjectStore(STORES.drafts, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(new AppError("storage-unavailable", { cause: request.error }));
    request.onblocked = () => reject(new AppError("storage-unavailable", { cause: new Error("blocked") }));
  }).catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export function mapStorageError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return new AppError("storage-quota-exceeded", { cause: error });
  if (name === "InvalidStateError" || name === "SecurityError") return new AppError("storage-unavailable", { cause: error });
  return new AppError("storage-write-failed", { cause: error });
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs `work` in a transaction and resolves after the transaction commits. */
export async function transact<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    throw mapStorageError(error);
  }
}

export const idbGet = <T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> =>
  wrap(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);

export const idbGetAll = <T>(tx: IDBTransaction, store: StoreName): Promise<T[]> => wrap(tx.objectStore(store).getAll() as IDBRequest<T[]>);

export const idbPut = (tx: IDBTransaction, store: StoreName, value: unknown): Promise<IDBValidKey> => wrap(tx.objectStore(store).put(value));

export const idbDelete = (tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<undefined> => wrap(tx.objectStore(store).delete(key));

export const idbClear = (tx: IDBTransaction, store: StoreName): Promise<undefined> => wrap(tx.objectStore(store).clear());

/** Closes and deletes the database. Used by "Clear all local data". */
export async function deleteDatabase(): Promise<void> {
  if (!supportsIndexedDB()) return;
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

/** Test helper: forget the cached connection. */
export function resetDatabaseConnection(): void {
  dbPromise = null;
}
