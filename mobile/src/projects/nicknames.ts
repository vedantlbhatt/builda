/**
 * The owner's own names for their projects, on this phone and nowhere else.
 *
 * A private repository arrives as its key alone ("Private project b093f9"): its name never
 * leaves the Mac, and the server never has it to send. So the builder can name it here. The
 * name is kept in the cache kv under `NICKNAMES_KEY` and read by every screen that shows a
 * project (the tab, the page, the rivers, the race) through `useNicknames()`. Nothing here
 * talks to the server, and `__tests__/projectsScreens.test.ts` holds that nothing that reads
 * the key can: the file imports the cache and the model and nothing else.
 *
 * One small store, the accent's pattern (`src/theme/accent.tsx`): every screen that asks gets
 * the same object and re-renders together when a name changes, so renaming a project on its
 * page repaints the tab under it before the back swipe lands.
 */
import { useSyncExternalStore } from 'react';

import * as cache from '../data/cache';
import { NICKNAMES_KEY, parseNicknames, withNickname } from './model';

let current: Readonly<Record<string, string>> = {};
let reading: Promise<void> | null = null;
let read = false;
const listeners = new Set<() => void>();

function publish(next: Readonly<Record<string, string>>): void {
  current = next;
  for (const l of listeners) l();
}

/** Read the saved names again. A kv that cannot be read keeps the names already shown. */
export function readNicknames(): Promise<void> {
  if (reading) return reading;
  reading = (async () => {
    try {
      publish(parseNicknames(await cache.getKv(NICKNAMES_KEY)));
    } catch {
      // No names is a fine answer: every project still has its label from the key.
    } finally {
      read = true;
      reading = null;
    }
  })();
  return reading;
}

/**
 * Name the project `key` (its full 64 hex key), or take its name away with null or a blank.
 * Shown at once; written to the kv behind it.
 */
export async function saveNickname(key: string, name: string | null): Promise<void> {
  const next = withNickname(current, key, name);
  publish(next);
  await cache.setKv(NICKNAMES_KEY, JSON.stringify(next));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!read) void readNicknames();
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Readonly<Record<string, string>> {
  return current;
}

/** The owner's names by key. The same object on every screen until one changes. */
export function useNicknames(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
