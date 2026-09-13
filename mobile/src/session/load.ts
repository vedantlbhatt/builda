/**
 * The states the session screen can be in, decided in one pure function so the screen cannot
 * decide them a little differently in each branch (`__tests__/sessionScreen.test.ts`).
 *
 *   loading     nothing saved on this phone yet and the first answer is on its way: a
 *               skeleton shaped like the screen
 *   signedOut   the server needs an account this phone does not hold: Bit, two lines, Sign in
 *   missing     the server answered that there is no such session (deleted, excluded, or
 *               not this account's): Bit, two lines, back to the list
 *   error       any other failure with nothing saved to show instead: what failed, Try again
 *   ready       the session; STALE when a refresh failed and this is the copy the phone
 *               saved, which the screen says in one line at the top
 *
 * A saved session is never thrown away because a refresh failed, and a person who is signed
 * in is never told to sign in because the network dropped (status 0 is the phone's side of
 * the wire, `ApiError`).
 */

import type { SessionDetail } from '../data/api';

export interface LoadFailure {
  /** `ApiError.status`: 0 for no answer at all (offline, timed out), else the HTTP status. */
  status: number;
  /** A sentence a person can act on, as the api said it. */
  message: string;
}

export type SessionLoad =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: SessionDetail; stale: string | null };

export function resolveSessionLoad(session: SessionDetail | null, failure: LoadFailure | null): SessionLoad {
  if (session) return { kind: 'ready', session, stale: failure ? staleLine(failure.message) : null };
  if (!failure) return { kind: 'loading' };
  if (failure.status === 401) return { kind: 'signedOut' };
  if (failure.status === 404 || failure.status === 403) return { kind: 'missing' };
  return { kind: 'error', message: sentence(failure.message) };
}

/** A message as a sentence: its first letter up, one full stop at the end. */
function sentence(message: string): string {
  const t = message.trim();
  if (!t) return 'Something went wrong on the way.';
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/** "Builder is not reachable right now. Showing what this phone saved." */
export function staleLine(message: string): string {
  return `${sentence(message)} Showing what this phone saved.`;
}
