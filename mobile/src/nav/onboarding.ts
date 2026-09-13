import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { onGoogleSignIn } from '../auth/googleFlow';
import * as cache from '../data/cache';
import { api } from '../data/client';
import { setGateSnapshot } from './gateSnapshot';
import { syncPendingName, type NameSync } from './name';
import { decideOnboarded, LOCAL_NAME_KEY, NAME_PENDING_KEY, ONBOARDED_KEY } from './rules';

/**
 * The onboarding gate: one boolean, read once from the kv, shared by the root layout's
 * `Stack.Protected` guards, the last onboarding step and `app/dev-auth.tsx`.
 *
 * null means "not read yet". The root layout renders the canvas colour and no navigator until
 * it is known, so a cold start never flashes onboarding at someone who finished it (or the
 * tabs at someone who has not). Reading is a single SQLite row; it lands inside the first
 * frame or two.
 *
 * Flipping the flag re-renders the root stack with the other group of screens, and React
 * Navigation drops every route of the group that closed. That is the one-way door: after
 * onboarding finishes there is no onboarding route left for back, a swipe or a link to reach.
 */

let snapshot: boolean | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(v: boolean): void {
  if (snapshot === v) return;
  snapshot = v;
  setGateSnapshot(v);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): boolean | null {
  return snapshot;
}

/**
 * Read the flag once per launch and resolve to the gate's CURRENT value (a later
 * `setOnboarded` is reflected, not the value first read). An install that predates onboarding
 * and is signed in is migrated to onboarded, and the answer is written so a later sign-out
 * does not undo it.
 */
export function loadOnboarded(): Promise<boolean> {
  if (!loading) {
    loading = (async () => {
      let v = false;
      try {
        const stored = await cache.getKv(ONBOARDED_KEY);
        const signedIn = stored === null ? await api.isSignedIn() : false;
        v = decideOnboarded(stored, signedIn);
        if (stored === null && v) await cache.setKv(ONBOARDED_KEY, '1');
      } catch {
        // cache and api both degrade instead of throwing; this is the belt to their braces.
        // An unreadable flag is a fresh install: onboarding, never a blank screen forever.
      }
      // A set that landed while this was reading is newer than what was read.
      if (snapshot === null) publish(v);
    })();
  }
  return loading.then(() => snapshot ?? false);
}

/** The gate, for a component. null until the first read lands. */
export function useOnboarded(): boolean | null {
  const v = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void loadOnboarded();
  }, []);
  return v;
}

export async function setOnboarded(v: boolean): Promise<void> {
  await cache.setKv(ONBOARDED_KEY, v ? '1' : '0');
  publish(v);
}

/**
 * The end of onboarding. Writes the flag and flips the gate: the root stack swaps the
 * onboarding group for the tabs in one render and lands on the first tab, so there is nothing
 * to replace and nothing for back to return to. The name goes to the server now if there is a
 * session, otherwise at the next sign-in.
 */
export async function completeOnboarding(): Promise<void> {
  await setOnboarded(true);
  void sendPendingName();
}

/**
 * Back to a fresh install as far as onboarding knows: the flag and the local name. Dev only
 * (`builder://dev-auth?reset=1`); nothing in the product un-onboards a person.
 */
export async function resetOnboarding(): Promise<void> {
  await cache.setKv(LOCAL_NAME_KEY, '');
  await cache.setKv(NAME_PENDING_KEY, '0');
  await setOnboarded(false);
}

/** `syncPendingName` wired to the app's own api and kv. */
export function sendPendingName(): Promise<NameSync> {
  return syncPendingName(api, cache);
}

/**
 * Send a name typed while signed out as soon as there is an account: at launch, whenever the
 * app returns to the front, and after a Google sign-in (Settings calls `sendPendingName` after
 * Apple's itself, and dev-auth after storing tokens). Mount once, at the root.
 */
export function usePendingNameSync(): void {
  useEffect(() => {
    void sendPendingName();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sendPendingName();
    });
    const off = onGoogleSignIn((r) => {
      if (r.ok) void sendPendingName();
    });
    return () => {
      sub.remove();
      off();
    };
  }, []);
}
