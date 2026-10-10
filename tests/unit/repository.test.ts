import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllCreations,
  clearDraft,
  deleteCreation,
  duplicateCreation,
  getCreation,
  getMedia,
  listCreations,
  loadDraft,
  renameCreation,
  saveCreation,
  saveDraft,
} from "@/features/creations/repository";
import { idbPut, STORES, transact } from "@/lib/persistence/db";
import { sampleCreation } from "./creationFixtures";

beforeEach(async () => {
  await clearAllCreations();
});

describe("creation repository (IndexedDB)", () => {
  it("saves and restores a creation with media", async () => {
    const thumbnail = new Blob(["thumb"], { type: "image/jpeg" });
    await saveCreation(sampleCreation(), { thumbnail, snapshot: null });
    const restored = await getCreation("abc123def456");
    expect(restored).toEqual(sampleCreation());
    const media = await getMedia("abc123def456");
    expect(media?.thumbnail).toBeTruthy();
  });

  it("lists newest first and skips corrupted records", async () => {
    await saveCreation(sampleCreation({ id: "older0001", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await saveCreation(sampleCreation({ id: "newer0001", updatedAt: "2026-06-01T00:00:00.000Z" }));
    await transact([STORES.creations], "readwrite", (tx) => idbPut(tx, STORES.creations, { id: "broken01", schemaVersion: 1 }));
    const { creations, skipped } = await listCreations();
    expect(creations.map((c) => c.id)).toEqual(["newer0001", "older0001"]);
    expect(skipped).toBe(1);
  });

  it("renames, duplicates and deletes", async () => {
    await saveCreation(sampleCreation(), { thumbnail: null, snapshot: new Blob(["png"]) });
    const renamed = await renameCreation("abc123def456", "Evening Light");
    expect(renamed.name).toBe("Evening Light");

    const copy = await duplicateCreation("abc123def456");
    expect(copy.id).not.toBe("abc123def456");
    expect(copy.name).toBe("Evening Light copy");
    expect((await getMedia(copy.id))?.snapshot).toBeTruthy();

    await deleteCreation("abc123def456");
    expect(await getCreation("abc123def456")).toBeNull();
    expect(await getMedia("abc123def456")).toBeNull();
    expect((await listCreations()).creations).toHaveLength(1);
  });

  it("refuses to save invalid data", async () => {
    await expect(saveCreation({ ...sampleCreation(), instrumentId: "nope" as never })).rejects.toMatchObject({ code: "storage-write-failed" });
  });

  it("keeps a single recovery draft", async () => {
    expect(await loadDraft()).toBeNull();
    await saveDraft(sampleCreation({ name: "First" }), null);
    await saveDraft(sampleCreation({ name: "Second" }), null);
    expect((await loadDraft())?.creation.name).toBe("Second");
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });
});
