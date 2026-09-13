/**
 * The five states every You page can be in, decided in one pure function so the pages cannot
 * each decide them a little differently (`__tests__/you.test.ts`).
 *
 *   loading     nothing saved yet, and the first answer is on its way: a skeleton shaped
 *               like the page
 *   signed out  no account on this phone: Bit, two lines, and Sign in
 *   error       the request failed and nothing was saved to fall back on: what failed and
 *               Try again
 *   ready       the page; STALE when the refresh failed and it is showing what was saved,
 *               which it says in one line at the top with the time it was saved
 *
 * A signed in person is never told to sign in because the network dropped, and a saved page is
 * never thrown away because a refresh failed (the rules `app/(tabs)/you.tsx` had before).
 */
import { clockOf, dayOf } from './numbers';

export interface Stale {
  /** When the page on screen was saved. Null when the phone does not know (an older save). */
  savedAt: number | null;
  /** What went wrong with the refresh, as the api said it. */
  message: string;
}

export type YouLoad<T> =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T; stale: Stale | null };

export interface LoadInputs<T> {
  data: T | null;
  savedAt: number | null;
  /** Null until asked. */
  signedIn: boolean | null;
  /** The last refresh's failure, null when it worked or has not finished. */
  error: string | null;
}

export function resolveLoad<T>(s: LoadInputs<T>): YouLoad<T> {
  if (s.signedIn === false) return { kind: 'signedOut' };
  if (s.data !== null) return { kind: 'ready', data: s.data, stale: s.error ? { savedAt: s.savedAt, message: s.error } : null };
  if (s.error) return { kind: 'error', message: s.error };
  return { kind: 'loading' };
}

/** "Builder is not reachable right now. Showing what was saved at 9:41." */
export function staleLine(stale: Stale, now: number = Date.now()): string {
  const lead = stale.message.trim().replace(/\.?$/, '.');
  if (stale.savedAt === null) return `${lead} Showing what was saved last.`;
  const sameDay = dayOf(new Date(stale.savedAt).toISOString(), now) === dayOf(new Date(now).toISOString(), now);
  const when = sameDay ? `at ${clockOf(stale.savedAt)}` : `on ${dayOf(new Date(stale.savedAt).toISOString(), now)}`;
  return `${lead} Showing what was saved ${when}.`;
}

/** A saved time as the kv holds it: epoch milliseconds, or null for anything else. */
export function parseSavedAt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
