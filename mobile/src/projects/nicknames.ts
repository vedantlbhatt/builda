/**
 * What this phone keeps about the owner's projects, and nowhere else: the names the owner gave
 * them, and the register of the number each private project is called by and the hue it wears.
 *
 * A private repository arrives as its key alone, and its name never leaves the Mac, so the phone
 * calls it "Private project" and a number of its own (`model.registerProjects`), and the builder
 * can give it a name here. Both live in the cache kv (`NICKNAMES_KEY`, `REGISTRY_KEY`) and are read
 * by every screen that shows a project (the tab, the page, the rivers, the race, the money flow)
 * through `useNicknames()` and `useProjectRegistry()`. Nothing here talks to the server, and
 * `__tests__/projectsScreens.test.ts` holds that nothing that reads the keys can: the file imports
 * the cache and the model and nothing else.
 *
 * One small store, the accent's pattern (`src/theme/accent.tsx`): every screen that asks gets the
 * same objects and re-renders together when one changes, so renaming a project on its page
 * repaints the tab under it before the back swipe lands. The store is built over a kv it is
 * handed (`projectsStore`), so `__tests__/projectsLocal.test.ts` runs it with no SQLite.
 *
 * SIGN OUT FORGETS THEM. `cache.clear()` empties the kv, and `forgetProjectsOnThisPhone()` empties
 * what is held in memory, so the next account on this phone never sees the last one's names, and
 * its first save cannot write them back (a key is the same repository in every account).
 * FOUND IN REVIEW (2026-09-13): the store was read once per launch and never reset.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import * as cache from '../data/cache';
import {
  EMPTY_REGISTRY,
  NICKNAMES_KEY,
  parseNicknames,
  parseRegistry,
  REGISTRY_KEY,
  registerProjects,
  withNickname,
  type ProjectRegistry,
} from './model';

export interface HeldProjects {
  nicknames: Readonly<Record<string, string>>;
  registry: ProjectRegistry;
  /** Whether the kv has been read since launch or since the last sign out. */
  read: boolean;
}

export interface ProjectsKv {
  getKv(k: string): Promise<string | null>;
  setKv(k: string, v: string): Promise<void>;
}

type Listed = readonly { key: string; history: { first_at: string } }[];

/** The store over one kv: what it holds, and how it reads, saves, registers and forgets. */
export function projectsStore(kv: ProjectsKv) {
  let current: HeldProjects = { nicknames: {}, registry: EMPTY_REGISTRY, read: false };
  let reading: Promise<void> | null = null;
  /** Bumped by `forget`, so a read or a register that started before it writes nothing. */
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (next: HeldProjects) => {
    current = next;
    for (const l of listeners) l();
  };

  const read = (): Promise<void> => {
    if (reading) return reading;
    const gen = generation;
    const p = (async () => {
      try {
        const [names, reg] = await Promise.all([kv.getKv(NICKNAMES_KEY), kv.getKv(REGISTRY_KEY)]);
        if (gen === generation) publish({ nicknames: parseNicknames(names), registry: parseRegistry(reg), read: true });
      } catch {
        // No names is a fine answer: every project still has its label.
        if (gen === generation) publish({ ...current, read: true });
      }
    })();
    reading = p;
    void p.finally(() => {
      if (reading === p) reading = null;
    });
    return p;
  };

  return {
    snapshot: (): HeldProjects => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!current.read) void read();
      return () => {
        listeners.delete(listener);
      };
    },
    read,
    /** Name `key` (its full 64 hex key), or take its name away with null or a blank. Shown at once, written behind. */
    async saveNickname(key: string, name: string | null): Promise<void> {
      const nicknames = withNickname(current.nicknames, key, name);
      publish({ ...current, nicknames });
      await kv.setKv(NICKNAMES_KEY, JSON.stringify(nicknames));
    },
    /** Give every project its number and hue, if the register has not, and save when anything was given. */
    async register(projects: Listed): Promise<void> {
      const gen = generation;
      if (!current.read) await read();
      // Signed out while the read was on its way: this account's projects are not the next one's.
      if (gen !== generation) return;
      const { registry, changed } = registerProjects(current.registry, projects);
      if (!changed) return;
      publish({ ...current, registry });
      await kv.setKv(REGISTRY_KEY, JSON.stringify(registry));
    },
    /**
     * Forget every name and number held in memory. Call it AFTER the kv was cleared: it reads the
     * kv again at once and finds it empty, so a screen that stays mounted (a tab) is ready again
     * for whoever signs in next, with nothing of the last account.
     */
    forget(): Promise<void> {
      generation += 1;
      reading = null;
      publish({ nicknames: {}, registry: EMPTY_REGISTRY, read: false });
      return read();
    },
  };
}

const store = projectsStore(cache);

/** Read the saved names and register again. */
export const readProjectsOnThisPhone = store.read;
/** Name the project `key`, or take its name away with null or a blank. */
export const saveNickname = store.saveNickname;
/** Give every project in `projects` its number and hue, if the register has not already. */
export const registerOnThisPhone = store.register;
/** At sign out and at account deletion, after `cache.clear()`: forget every name and number. */
export const forgetProjectsOnThisPhone = store.forget;

/** The owner's names by key. The same object on every screen until one changes. */
export function useNicknames(): Readonly<Record<string, string>> {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot).nicknames;
}

/**
 * The register with `projects` in it: numbered and coloured at once, the same way the phone then
 * saves it, so a label never waits on a write and never changes when the write lands. `ready` is
 * false until the saved register has been read: a screen waits for it rather than show a number
 * the saved register might contradict a moment later.
 */
export function useProjectRegistry(projects: Listed | null | undefined): { registry: ProjectRegistry; ready: boolean } {
  const held = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const list = projects ?? null;
  const registry = useMemo(() => (list ? registerProjects(held.registry, list).registry : held.registry), [held.registry, list]);
  useEffect(() => {
    if (held.read && list && registry !== held.registry) void store.register(list);
  }, [held.read, list, registry, held.registry]);
  return { registry, ready: held.read };
}
