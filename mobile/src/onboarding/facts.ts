import { useEffect, useSyncExternalStore } from 'react';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { BUILDER_PROFILE_KEY } from './keys';
import { archetypeFrom, harnessCounts, type HarnessCounts } from './selection';

/**
 * What the app already knows about the person going through onboarding, loaded once when the
 * flow opens (Bit's hello gives it a second or two) and shared by every step: whether there is
 * an account, the display name on it, how many sessions each tool produced, and the archetype.
 *
 * Nothing here is required. Signed out, or offline, every field stays at its "unknown" value
 * and the steps read as they do on a fresh install. The api client is used as it is: every
 * call below is a method `src/data/api.ts` already has.
 */
export interface Facts {
  /** null until the keychain has answered. */
  signedIn: boolean | null;
  /** `display_name` on `GET /v1/users/me`. */
  serverName: string | null;
  /** Sessions per harness on the account, or null when not counted (signed out, offline). */
  counts: HarnessCounts | null;
  /** How many sessions were counted. */
  total: number | null;
  /** More sessions exist than were counted: every count is a lower bound. */
  partial: boolean;
  /** The corpus rules' archetype, else the analyses' modal one. */
  archetype: string | null;
}

const EMPTY: Facts = { signedIn: null, serverName: null, counts: null, total: null, partial: false, archetype: null };

/** Pages of `GET /v1/sessions` read for the counts: at most 1,000 sessions. */
const PAGE = 200;
const MAX_PAGES = 5;

/** A forced reload this soon after the last one, with the same account, reuses it. */
const FRESH_MS = 15_000;

let facts: Facts = EMPTY;
let loading: Promise<Facts> | null = null;
let loadedAt = 0;
/** A load is still running (the layout and hello both ask on mount; one set of requests). */
let inFlight = false;
const listeners = new Set<() => void>();

function set(patch: Partial<Facts>): void {
  facts = { ...facts, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot(): Facts {
  return facts;
}

async function countSessions(): Promise<{ counts: HarnessCounts; total: number; partial: boolean }> {
  const all: { harness: string }[] = [];
  let before: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.sessions({ limit: PAGE, before });
    all.push(...res.sessions);
    before = res.next_before;
    if (!before) return { counts: harnessCounts(all), total: all.length, partial: false };
  }
  return { counts: harnessCounts(all), total: all.length, partial: true };
}

/**
 * Load (once; `force` after a sign in) and resolve to what is known. Never throws: a field
 * that could not be read keeps its unknown value.
 */
export function loadFacts(force = false): Promise<Facts> {
  if (loading && !force) return loading;
  const previous = loading;
  const previousRunning = inFlight;
  loading = (async () => {
    // Walking back to hello and on again should not refetch a thousand sessions: a forced
    // reload of a load still running, or of one inside FRESH_MS, reuses it unless the
    // account changed under it.
    if (previous && (previousRunning || Date.now() - loadedAt < FRESH_MS)) {
      const was = await previous;
      if ((await api.isSignedIn().catch(() => false)) === was.signedIn) return was;
    }
    const [signedIn, builderJson, profile] = await Promise.all([
      api.isSignedIn().catch(() => false),
      cache.getKv(BUILDER_PROFILE_KEY).catch(() => null),
      cache.getProfile().catch(() => null),
    ]);
    // A different account (or none) than the last load: nothing it said still holds.
    if (facts.signedIn !== null && facts.signedIn !== signedIn) {
      set({ serverName: null, counts: null, total: null, partial: false, archetype: null });
    }
    set({ signedIn, archetype: facts.archetype ?? archetypeFrom(builderJson, profile) });
    if (!signedIn) {
      loadedAt = Date.now();
      return facts;
    }
    await Promise.all([
      api
        .getMe()
        .then((me) => set({ serverName: me.display_name }))
        .catch(() => undefined),
      countSessions()
        .then((r) => set(r))
        .catch(() => undefined),
      facts.archetype
        ? Promise.resolve()
        : api
            .builderProfile()
            .then((b) => set({ archetype: archetypeFrom(b) }))
            .catch(() => undefined),
    ]);
    loadedAt = Date.now();
    return facts;
  })();
  const mine = loading;
  inFlight = true;
  void mine.finally(() => {
    if (loading === mine) inFlight = false;
  });
  return mine;
}

/**
 * The archetype alone, for the creature picker outside onboarding (`app/icon.tsx`): what the
 * app has cached (the You tab's builder profile, then the profile's analyses), else, signed
 * in, the same `GET /v1/profile/builder` the You tab makes. Null when there is none yet.
 */
export async function loadArchetype(): Promise<string | null> {
  const [builderJson, profile] = await Promise.all([
    cache.getKv(BUILDER_PROFILE_KEY).catch(() => null),
    cache.getProfile().catch(() => null),
  ]);
  const cached = archetypeFrom(builderJson, profile);
  if (cached) return cached;
  if (!(await api.isSignedIn().catch(() => false))) return null;
  try {
    return archetypeFrom(await api.builderProfile());
  } catch {
    return null;
  }
}

/** The facts, for a component. Starts loading on first use. */
export function useFacts(): Facts {
  const v = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void loadFacts();
  }, []);
  return v;
}

/** The current value, outside React. */
export function currentFacts(): Facts {
  return facts;
}
