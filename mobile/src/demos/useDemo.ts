/**
 * A project's demo from the server, and the Projects tab's previews: read on focus (the rule the
 * tabs follow), every url made fetchable (`api.mediaSource`: a relative one gets the API's host
 * and the bearer; a presigned one gets nothing). An answer the server did not give is not "no
 * demo": a read that failed keeps what was shown, and a project the phone has not heard about
 * shows nothing at all, so the empty print only ever says what the server said.
 *
 * The bearer lives 15 minutes (server `access_token_ttl_seconds`). A picture or a video that
 * fails to load asks for `reload`, which reads the list again through `Api.request`, whose 401
 * path refreshes the token, and hands out new sources; at most once every 20 seconds, so a file
 * that is really gone does not spin the network.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { api } from '../data/client';
import type { MediaSourceRef, ProjectMediaItem } from '../data/api';
import { doorPrints, gallery, type GalleryEntry } from './model';

/** The preview route's cap on keys a request. */
export const PREVIEW_KEYS_MAX = 50;
const RELOAD_EVERY_MS = 20_000;

export interface DemoSources {
  /** By entry id: the file itself. */
  file: Record<string, MediaSourceRef>;
  /** By entry id: the video's still frame. */
  poster: Record<string, MediaSourceRef>;
}

export type DemoLoad =
  /** Not read yet, or signed out, or the read failed before anything was known: draw nothing. */
  | { kind: 'unknown' }
  /** The server holds no demo for this project. */
  | { kind: 'none' }
  | { kind: 'ready'; entries: GalleryEntry[]; sources: DemoSources };

async function sourcesOf(entries: readonly GalleryEntry[]): Promise<DemoSources> {
  const file: Record<string, MediaSourceRef> = {};
  const poster: Record<string, MediaSourceRef> = {};
  for (const e of entries) {
    file[e.id] = await api.mediaSource(e.url);
    if (e.posterUrl) poster[e.id] = await api.mediaSource(e.posterUrl);
  }
  return { file, poster };
}

/** What a list of files becomes on the phone: the gallery, or `none` for an empty one. */
export async function demoLoadOf(items: readonly ProjectMediaItem[]): Promise<DemoLoad> {
  const entries = gallery(items);
  if (!entries.length) return { kind: 'none' };
  return { kind: 'ready', entries, sources: await sourcesOf(entries) };
}

/** One project's demo for its page and its gallery. `key` is the full 64 hex key, or null to read nothing. */
export function useProjectDemo(key: string | null): { demo: DemoLoad; reload: () => void } {
  const [demo, setDemo] = useState<DemoLoad>({ kind: 'unknown' });
  const last = useRef(0);
  const live = useRef(true);

  const read = useCallback(async () => {
    if (!key || key.length !== 64) return;
    if (!(await api.isSignedIn())) return;
    try {
      const got = await demoLoadOf((await api.projectMedia(key)).items ?? []);
      if (live.current) setDemo(got);
    } catch {
      // A failed read is not "no demo": what was shown stays.
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      void read();
      return () => {
        live.current = false;
      };
    }, [read]),
  );

  const reload = useCallback(() => {
    const now = Date.now();
    if (now - last.current < RELOAD_EVERY_MS) return;
    last.current = now;
    void read();
  }, [read]);

  return { demo, reload };
}

export interface DoorDemo {
  /** The stills the door fans, top print last. Empty: the server holds no demo for it. */
  prints: GalleryEntry[];
  sources: DemoSources;
}

/**
 * The Projects tab's previews: up to three stills a project, one request for every door. A key
 * missing from the answer (or a failed read) is not known, and its door draws no print at all.
 */
export function useDemoPreviews(keys: readonly string[]): { previews: Record<string, DoorDemo>; reload: () => void } {
  const [previews, setPreviews] = useState<Record<string, DoorDemo>>({});
  const joined = keys.filter((k) => k.length === 64).slice(0, PREVIEW_KEYS_MAX).join(',');
  const last = useRef(0);

  const read = useCallback(
    async (alive: () => boolean) => {
      if (!joined) return;
      if (!(await api.isSignedIn())) return;
      try {
        const got = await api.projectMediaPreview(joined.split(','));
        const out: Record<string, DoorDemo> = {};
        for (const [k, items] of Object.entries(got.projects ?? {})) {
          const prints = doorPrints(items);
          out[k] = { prints, sources: await sourcesOf(prints) };
        }
        if (alive()) setPreviews(out);
      } catch {
        // Unknown, not empty: every door keeps what it showed.
      }
    },
    [joined],
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void read(() => alive);
      return () => {
        alive = false;
      };
    }, [read]),
  );

  const reload = useCallback(() => {
    const now = Date.now();
    if (now - last.current < RELOAD_EVERY_MS) return;
    last.current = now;
    void read(() => true);
  }, [read]);

  return { previews, reload };
}
