/**
 * A project's demo from the server, and the Projects tab's previews: read on focus (the rule the
 * tabs follow), every url made fetchable (`api.mediaSource`: a relative one gets the API's host
 * and the bearer; a presigned one gets nothing). An answer the server did not give is not "no
 * demo": a read that failed keeps what was shown FOR THAT PROJECT, and a project the phone has not
 * heard about shows nothing at all, so the empty print only ever says what the server said.
 *
 * Every answer carries the key it was asked for and the order it was asked in (`demoReducer`): a
 * new key starts from nothing, and an answer for another key, or older than the one shown, is
 * dropped. FOUND IN REVIEW (2026-09-14): opening project A's gallery and then B's showed A's
 * pictures under B's name.
 *
 * The bearer lives 15 minutes (server `access_token_ttl_seconds`). A picture or a video that
 * fails to load asks for `reload`, which reads the list again through `Api.request`, whose 401
 * path refreshes the token, and hands out new sources; at most once every 20 seconds, so a file
 * that is really gone does not spin the network.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { api } from '../data/client';
import type { ProjectMediaItem } from '../data/api';
import { demoFor, demoReducer, doorPrints, gallery, UNKNOWN, type DemoLoad, type DemoSources, type GalleryEntry } from './model';

export type { DemoLoad, DemoSources } from './model';

/** The preview route's cap on keys a request. */
export const PREVIEW_KEYS_MAX = 50;
const RELOAD_EVERY_MS = 20_000;

async function sourcesOf(entries: readonly GalleryEntry[]): Promise<DemoSources> {
  const file: DemoSources['file'] = {};
  const poster: DemoSources['poster'] = {};
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

/** One request number for the whole app: an answer is newer than another when it was asked later. */
let asked = 0;
function nextSeq(): number {
  asked += 1;
  return asked;
}

/**
 * One project's demo for its page. `key` is the full 64 hex key, or null to read nothing.
 * `deleted()` says the phone deleted it, so nothing is shown whatever a read in flight answers.
 */
export function useProjectDemo(key: string | null): { demo: DemoLoad; reload: () => void; deleted: () => void } {
  const [state, dispatch] = useReducer(demoReducer, { key, seq: 0, demo: UNKNOWN });
  const last = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    dispatch({ type: 'key', key });
  }, [key]);

  const read = useCallback(async () => {
    const k = key;
    if (!k || k.length !== 64) return;
    if (!(await api.isSignedIn())) return;
    const seq = nextSeq();
    try {
      const got = await demoLoadOf((await api.projectMedia(k)).items ?? []);
      if (live.current) dispatch({ type: 'answer', key: k, seq, demo: got });
    } catch {
      // A failed read is not "no demo": what was shown for this key stays, and a new key shows nothing.
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

  const deleted = useCallback(() => {
    if (key) dispatch({ type: 'deleted', key, seq: nextSeq() });
  }, [key]);

  // Never another key's demo, not even for the frame before the key's own state arrives.
  return { demo: demoFor(state, key), reload, deleted };
}

export interface DoorDemo {
  /** The stills the door fans, top print last. Empty: the server holds no demo for it. */
  prints: GalleryEntry[];
  sources: DemoSources;
}

/**
 * Many projects' demos at once, each held under its own key by the same rule as `useProjectDemo`:
 * the Projects tab reads the whole list of every project whose preview has prints, so a door can
 * say what its demo holds and the gallery opens on the whole of it, counted once.
 */
export function useDemoLists(keys: readonly string[]): { lists: Record<string, DemoLoad>; reload: () => void } {
  const [states, setStates] = useState<Record<string, { seq: number; demo: DemoLoad }>>({});
  const joined = keys.filter((k) => k.length === 64).join(',');
  const last = useRef(0);

  const read = useCallback(
    async (alive: () => boolean) => {
      if (!joined || !(await api.isSignedIn())) return;
      await Promise.all(
        joined.split(',').map(async (k) => {
          const seq = nextSeq();
          try {
            const got = await demoLoadOf((await api.projectMedia(k)).items ?? []);
            if (!alive()) return;
            setStates((s) => ((s[k]?.seq ?? 0) < seq ? { ...s, [k]: { seq, demo: got } } : s));
          } catch {
            // Unknown, not empty: this key keeps what it had.
          }
        }),
      );
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

  const lists: Record<string, DemoLoad> = {};
  for (const k of joined ? joined.split(',') : []) lists[k] = states[k]?.demo ?? UNKNOWN;
  return { lists, reload };
}

/**
 * The Projects tab's previews: up to three stills a project, one request for every door. A key
 * missing from the answer (or a failed read) is not known, and its door draws no print at all. An
 * answer older than the one shown for a key is dropped, key by key.
 */
export function useDemoPreviews(keys: readonly string[]): { previews: Record<string, DoorDemo>; reload: () => void } {
  const [states, setStates] = useState<Record<string, { seq: number; door: DoorDemo }>>({});
  const joined = keys.filter((k) => k.length === 64).slice(0, PREVIEW_KEYS_MAX).join(',');
  const last = useRef(0);

  const read = useCallback(
    async (alive: () => boolean) => {
      if (!joined) return;
      if (!(await api.isSignedIn())) return;
      const seq = nextSeq();
      try {
        const got = await api.projectMediaPreview(joined.split(','));
        const out: Record<string, DoorDemo> = {};
        for (const [k, items] of Object.entries(got.projects ?? {})) {
          const prints = doorPrints(items);
          out[k] = { prints, sources: await sourcesOf(prints) };
        }
        if (!alive()) return;
        setStates((s) => {
          const next = { ...s };
          for (const [k, door] of Object.entries(out)) if ((s[k]?.seq ?? 0) < seq) next[k] = { seq, door };
          return next;
        });
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

  // Only the doors on the tab now: a key that left the list shows nothing if it comes back unread.
  const previews: Record<string, DoorDemo> = {};
  for (const k of joined ? joined.split(',') : []) if (states[k]) previews[k] = states[k]!.door;
  return { previews, reload };
}
