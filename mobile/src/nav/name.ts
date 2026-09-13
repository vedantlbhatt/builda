import type { Me, MePatch } from '../data/api';
import { LOCAL_NAME_KEY, NAME_PENDING_KEY, nameProblem, normalizeName } from './rules';

/**
 * The name picked during onboarding, which has to work signed out.
 *
 * It is written to the local kv first, with a pending mark, and sent as `display_name` in
 * `PATCH /v1/users/me` the first time there is an account to send it to: at launch, when the
 * app comes back to the front, and right after any sign-in. The pending mark is cleared only
 * by a successful PATCH, so a failed attempt is retried on the next occasion rather than lost.
 *
 * Dependencies are passed in (the kv is `src/data/cache`, the api is `src/data/client`) so
 * bun can drive every branch without SQLite or a keychain.
 */

export interface NameKv {
  getKv(k: string): Promise<string | null>;
  setKv(k: string, v: string): Promise<void>;
}

export interface NameApi {
  isSignedIn(): Promise<boolean>;
  patchMe(body: MePatch): Promise<Me>;
}

/** Store the name and mark it as not yet sent. Throws on a name onboarding would refuse. */
export async function saveLocalName(raw: string, kv: NameKv): Promise<string> {
  const problem = nameProblem(raw);
  if (problem) throw new Error(`name refused: ${problem}`);
  const name = normalizeName(raw);
  await kv.setKv(LOCAL_NAME_KEY, name);
  await kv.setKv(NAME_PENDING_KEY, '1');
  return name;
}

export async function getLocalName(kv: NameKv): Promise<string | null> {
  const v = await kv.getKv(LOCAL_NAME_KEY);
  return v && v.length > 0 ? v : null;
}

export type NameSync = 'sent' | 'nothing_pending' | 'signed_out' | 'failed';

// Launch, foreground and a sign-in can all fire within a second of each other; one PATCH.
let inFlight: Promise<NameSync> | null = null;

/**
 * Send the pending name if there is one and an account to send it to. Never throws: a failure
 * is reported as 'failed' and the name stays pending.
 */
export function syncPendingName(api: NameApi, kv: NameKv): Promise<NameSync> {
  if (!inFlight) {
    inFlight = run(api, kv).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(api: NameApi, kv: NameKv): Promise<NameSync> {
  try {
    if ((await kv.getKv(NAME_PENDING_KEY)) !== '1') return 'nothing_pending';
    const name = await getLocalName(kv);
    if (!name) {
      await kv.setKv(NAME_PENDING_KEY, '0');
      return 'nothing_pending';
    }
    if (!(await api.isSignedIn())) return 'signed_out';
    await api.patchMe({ display_name: name });
    await kv.setKv(NAME_PENDING_KEY, '0');
    return 'sent';
  } catch {
    return 'failed';
  }
}
