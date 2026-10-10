"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toAppError, type AppError } from "@/lib/errors/appErrors";
import type { Creation } from "@/types/creations";
import { getMedia, listCreations, onCreationsChanged } from "./repository";

export interface CreationsState {
  status: "loading" | "ready" | "error";
  creations: Creation[];
  thumbnails: Record<string, string>;
  skipped: number;
  error: AppError | null;
  reload: () => void;
}

/** Loads the library and object URLs for thumbnails (revoked on change/unmount). */
export function useCreations(limit?: number): CreationsState {
  const [status, setStatus] = useState<CreationsState["status"]>("loading");
  const [creations, setCreations] = useState<Creation[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [version, setVersion] = useState(0);
  const urls = useRef<string[]>([]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => onCreationsChanged(reload), [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listCreations();
        const list = limit ? result.creations.slice(0, limit) : result.creations;
        const entries = await Promise.all(
          list.map(async (c) => {
            const media = await getMedia(c.id).catch(() => null);
            return [c.id, media?.thumbnail ? URL.createObjectURL(media.thumbnail) : null] as const;
          }),
        );
        if (cancelled) {
          entries.forEach(([, url]) => url && URL.revokeObjectURL(url));
          return;
        }
        urls.current.forEach((u) => URL.revokeObjectURL(u));
        urls.current = entries.flatMap(([, url]) => (url ? [url] : []));
        setThumbnails(Object.fromEntries(entries.filter((e): e is readonly [string, string] => e[1] !== null)));
        setCreations(list);
        setSkipped(result.skipped);
        setError(null);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(toAppError(e, "storage-unavailable"));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, limit]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    },
    [],
  );

  return { status, creations, thumbnails, skipped, error, reload };
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
