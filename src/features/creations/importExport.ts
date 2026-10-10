import { AppError } from "@/lib/errors/appErrors";
import { blobToDataUrl, createThumbnail, dataUrlToBlob, downloadBlob, fileSafeName, loadImage } from "@/lib/export/exporters";
import type { Creation } from "@/types/creations";
import { getCreation, getMedia, saveCreation } from "./repository";
import { createId, MAX_PROJECT_BYTES, parseProjectFile, serializeProjectFile } from "./schema";

export async function exportCreationFile(id: string): Promise<void> {
  const creation = await getCreation(id);
  if (!creation) throw new AppError("export-failed");
  const media = await getMedia(id).catch(() => null);
  const snapshot = media?.snapshot ? await blobToDataUrl(media.snapshot) : null;
  const json = serializeProjectFile(creation, snapshot);
  downloadBlob(new Blob([json], { type: "application/json" }), `${fileSafeName(creation.name)}.aura.json`);
}

async function thumbnailFromBlob(blob: Blob): Promise<Blob | null> {
  try {
    const image = await loadImage(blob);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return await createThumbnail(canvas);
  } catch {
    return null;
  }
}

/**
 * Validates an imported project file and stores it as a new creation. The
 * import always receives a fresh id so it can never overwrite existing work.
 */
export async function importCreationFile(file: File): Promise<Creation> {
  if (file.size > MAX_PROJECT_BYTES) throw new AppError("import-too-large");
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    throw new AppError("import-invalid", { cause: error });
  }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) throw new AppError("import-invalid", { cause: new Error(parsed.errors.join("; ")) });

  let snapshot: Blob | null = null;
  if (parsed.value.snapshot) {
    snapshot = await dataUrlToBlob(parsed.value.snapshot).catch(() => null);
    // Verify the image actually decodes before storing it.
    if (snapshot && !(await loadImage(snapshot).then(() => true, () => false))) snapshot = null;
  }
  const thumbnail = snapshot ? await thumbnailFromBlob(snapshot) : null;
  const now = new Date().toISOString();
  return saveCreation({ ...parsed.value.creation, id: createId(), updatedAt: now }, { thumbnail, snapshot });
}
