/**
 * Signing a desktop in: the device grant (RFC 8628), the same flow the Mac agent walks
 * (`Packages/BuilderKit/Sources/BuilderSync/SyncClient.swift`, `server/builder/routes/auth_routes.py`).
 *
 *   1. the desktop asks for a code (`POST /v1/auth/device/start`, no auth),
 *   2. it shows the code and a QR of `builder://pair?code=XXXX-XXXX`, which the phone's camera
 *      opens straight into `app/pair.tsx`, where one tap approves it (`api.approveDevice`),
 *   3. it polls (`POST /v1/auth/device/poll`) at the interval the server asked for until the
 *      answer carries a token pair, which goes into the shell's safeStorage like any other pair.
 *
 * No password and no browser redirect: a desktop app is a public client, and the phone already
 * has a session. The pure parts (the QR payload, the poll's reading) are pinned in
 * `__tests__/desktop.test.ts`.
 */

export interface GrantStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type PollAnswer =
  | { kind: 'pending' }
  | { kind: 'ok'; access: string; refresh: string }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

/** What the QR carries: the link the phone's camera opens into the pairing screen. */
export function pairLink(userCode: string): string {
  return `builder://pair?code=${encodeURIComponent(userCode)}`;
}

/** The server's poll answer, read. `authorization_pending` is a 200 with a status, not an error. */
export function readPoll(status: number, body: unknown): PollAnswer {
  const b = (body ?? {}) as { status?: string; access_token?: string; refresh_token?: string; detail?: string };
  if (status === 200 && b.status === 'ok' && b.access_token && b.refresh_token) return { kind: 'ok', access: b.access_token, refresh: b.refresh_token };
  if (status === 200 && b.status === 'authorization_pending') return { kind: 'pending' };
  if (status === 400 && (b.detail === 'expired_token' || b.detail === 'unknown device_code')) return { kind: 'expired' };
  return { kind: 'error', message: typeof b.detail === 'string' ? b.detail : `the server answered ${status}` };
}

/** The platform a desktop device registers as, so the phone's device list can tell them apart. */
export function devicePlatform(os: string): string {
  if (os === 'darwin') return 'desktop-macos';
  if (os === 'win32') return 'desktop-windows';
  if (os === 'linux') return 'desktop-linux';
  return 'desktop-web';
}

/** The label the phone shows for this machine in its device list and on the approval screen. */
export function deviceLabel(os: string, host: string | null): string {
  const what = os === 'darwin' ? 'Builda for Mac' : os === 'win32' ? 'Builda for Windows' : os === 'linux' ? 'Builda for Linux' : 'Builda on the web';
  return host ? `${what} (${host})` : what;
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

export async function startGrant(base: string, o: { machineId: string; label: string; platform: string; version: string }): Promise<GrantStart> {
  const r = await post(base, '/v1/auth/device/start', { machine_id: o.machineId, label: o.label, platform: o.platform, agent_version: o.version });
  if (r.status !== 200) throw new Error(`could not start pairing (${r.status})`);
  return r.body as GrantStart;
}

export async function pollGrant(base: string, deviceCode: string): Promise<PollAnswer> {
  try {
    const r = await post(base, '/v1/auth/device/poll', { device_code: deviceCode });
    return readPoll(r.status, r.body);
  } catch {
    // Offline for a moment is not a failed pairing: the next poll asks again.
    return { kind: 'pending' };
  }
}
