/**
 * The app's ACCESS token, copied for the share extension and the island's Start button
 * (docs/drop-island.md, "The token model").
 *
 * `Api` keeps its two secrets through an injected `TokenStorage`; this wraps that storage so that
 * every time the access token is read at launch, written by a sign in or a refresh, or removed by
 * a sign out, the App Group's keychain copy (`BuilderDropsCredential.swift`) follows it. So
 * "every time the app refreshes" is not a second schedule to keep in step: it is the same write.
 *
 * THE REFRESH TOKEN NEVER PASSES THROUGH HERE. Only `ACCESS_KEY` is mirrored, and a test holds
 * that a refresh token written through this storage reaches the sink as nothing at all. The
 * reason is the rotation rule (`api.ts refreshing`, `auth.redeem_refresh_token`): a second
 * redeemer of a refresh token is reuse and revokes every token the phone holds, so the extension
 * must not be able to refresh, and a leaked copy is worth fifteen minutes at most.
 *
 * Pure but for the sink, which is injected: `__tests__/dropActivity.test.ts` pins every rule.
 */
import type { TokenStorage } from '../data/api';

/** `api.ts ACCESS_KEY`. A test reads api.ts and fails when the two differ. */
export const ACCESS_KEY = 'builder.access';

/** The two calls `modules/builder-drops` makes available. Optional: null on web, in Expo Go and
 * in a build from before they existed. */
export interface CredentialSink {
  mirrorCredential?(token: string, expiresEpoch: number, baseURL: string): number;
  clearCredential?(): void;
}

/** The JWT's `exp`, Unix seconds, read without verifying anything; null for a token that is not
 * a JWT with one. The server is the only judge of a token; this is only when to stop using it. */
export function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const body = JSON.parse(globalThis.atob(b64)) as { exp?: unknown };
    return typeof body.exp === 'number' && Number.isFinite(body.exp) ? body.exp : null;
  } catch {
    return null;
  }
}

/**
 * `inner`, with the access token mirrored into `sink` on every read, write and removal. A mirror
 * that fails never fails the storage: the extension then finds nothing and queues, as it always
 * could.
 */
export function mirroredStorage(inner: TokenStorage, sink: CredentialSink | null | undefined, baseURL: string): TokenStorage {
  const mirror = (token: string | null) => {
    if (!sink) return;
    try {
      const exp = token ? jwtExpiry(token) : null;
      if (token && exp !== null) sink.mirrorCredential?.(token, exp, baseURL);
      else sink.clearCredential?.();
    } catch {
      // A keychain refusal is the extension's fallback, not the app's problem.
    }
  };
  return {
    async get(key) {
      const value = await inner.get(key);
      if (key === ACCESS_KEY) mirror(value);
      return value;
    },
    async set(key, value) {
      await inner.set(key, value);
      if (key === ACCESS_KEY) mirror(value);
    },
    async remove(key) {
      await inner.remove(key);
      if (key === ACCESS_KEY) mirror(null);
    },
  };
}
