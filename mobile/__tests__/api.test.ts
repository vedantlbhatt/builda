/**
 * The transport contract of `Api`, against a mocked fetch.
 *
 * The case that matters most is (c): refresh tokens rotate, and redeeming one twice is
 * "reuse", which revokes every token for the device. Two requests that both see a 401 must
 * share ONE refresh call, or the app signs its own user out under load.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Neither native module exists in bun. The storage is injected, and expo-constants is
// only read for the app version, so both are stubbed at the module boundary.
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('expo-constants', () => ({
  default: { expoConfig: { version: '0.1.0-test' } },
}));

// Dynamic, not static: a static import is hoisted above the mock.module calls and would
// evaluate the real expo-secure-store, which pulls in react-native's Flow-typed source.
const { Api, ApiError } = await import('../src/data/api');
type TokenStorage = import('../src/data/api').TokenStorage;
type ApiError = import('../src/data/api').ApiError;
type SessionDetail = import('../src/data/api').SessionDetail;
type LiveState = import('../src/generated/live').LiveState;

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const storage: TokenStorage = {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    remove: async (k) => {
      m.delete(k);
    },
  };
  return { storage, map: m };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Records every call and answers via `handler`; refresh responses can be delayed. */
function installFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: Call = { url, method: init?.method ?? 'GET', headers, body };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
const BASE = 'https://api.test';

beforeEach(() => {
  // Each test gets a fresh Api; the shared refresh promise is module-level, so every test
  // must drain its own refresh before the next one starts (they all await their requests).
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Api transport', () => {
  test('(a) attaches the bearer token from storage and parses JSON', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => json(200, { sessions: [], next_before: null }));
    const api = new Api(BASE, storage);

    const out = await api.sessions({ limit: 50, notable_only: true });

    expect(out).toEqual({ sessions: [], next_before: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions?limit=50&notable_only=true`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer A1');
    expect(await api.isSignedIn()).toBe(true);
  });

  test('liveSessions hits /v1/sessions/live with the bearer', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => json(200, { sessions: [{ id: 'l1', state: 'live' }] }));
    const api = new Api(BASE, storage);

    const out = await api.liveSessions();

    expect(out.sessions.map((s) => s.id)).toEqual(['l1']);
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/live`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers.Authorization).toBe('Bearer A1');
  });

  test('getMe / myFactions hit the account endpoints with the bearer', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const me = {
      id: 'u1',
      handle: 'ved',
      display_name: null,
      profile_public: false,
      created_at: '2026-08-01T00:00:00+00:00',
      factions: [],
    };
    const calls = installFetch((call) =>
      call.url.endsWith('/v1/factions/mine') ? json(200, { factions: [{ slug: 'gt' }] }) : json(200, me)
    );
    const api = new Api(BASE, storage);

    expect(await api.getMe()).toEqual(me);
    expect((await api.myFactions()).factions.map((f) => f.slug)).toEqual(['gt']);

    expect(calls.map((c) => [c.method, c.url.replace(BASE, '')])).toEqual([
      ['GET', '/v1/users/me'],
      ['GET', '/v1/factions/mine'],
    ]);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer A1')).toBe(true);
  });

  test('patchMe sends only the fields given, keeps a null display_name, and surfaces the 409 detail', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    let n = 0;
    const calls = installFetch(() => {
      n += 1;
      if (n === 1) return json(200, { id: 'u1', handle: 'ved', display_name: null, profile_public: true, created_at: '', factions: [] });
      return json(409, {
        detail: 'handle can be changed once every 30 days; next change allowed at 2026-10-05T14:03:22+00:00',
      });
    });
    const api = new Api(BASE, storage);

    const me = await api.patchMe({ display_name: null, profile_public: true });
    expect(me.profile_public).toBe(true);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe(`${BASE}/v1/users/me`);
    // `display_name: null` must travel (the server reads the field SET to clear it);
    // an omitted handle must NOT appear as `handle: undefined`.
    expect(calls[0]!.body).toEqual({ display_name: null, profile_public: true });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('handle');

    const err = (await api.patchMe({ handle: 'other' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toContain('next change allowed at 2026-10-05T14:03:22+00:00');
  });

  test('a 401 on patchMe refreshes and retries once like every other call', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch((call) => {
      if (call.url.endsWith('/v1/auth/refresh')) return json(200, { access_token: 'A2', refresh_token: 'R2' });
      if (call.headers.Authorization === 'Bearer A1') return json(401, { detail: 'expired' });
      return json(200, { id: 'u1', handle: 'ved', display_name: null, profile_public: false, created_at: '', factions: [] });
    });
    const api = new Api(BASE, storage);

    const me = await api.patchMe({ handle: 'ved' });

    expect(me.handle).toBe('ved');
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/v1/users/me', '/v1/auth/refresh', '/v1/users/me']);
    expect(calls[2]!.body).toEqual({ handle: 'ved' });
  });

  test('sign-in endpoints send no bearer and the documented body', async () => {
    const { storage } = memoryStorage();
    const calls = installFetch(() => json(200, { access_token: 'A', refresh_token: 'R' }));
    const api = new Api(BASE, storage);

    await api.signInWithApple('idtok', 'f'.repeat(64));
    await api.signInWithGoogle('gtok', 'e'.repeat(64), 'android');

    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/apple`);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({
      identity_token: 'idtok',
      machine_id: 'f'.repeat(64),
      label: 'iPhone',
      platform: 'ios',
      agent_version: '0.1.0-test',
    });
    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/google`);
    expect(calls[1]!.body).toEqual({
      id_token: 'gtok',
      machine_id: 'e'.repeat(64),
      label: 'Phone',
      platform: 'android',
      agent_version: '0.1.0-test',
    });
  });

  test('(b) a 401 refreshes, stores the rotated pair, and retries exactly once', async () => {
    const { storage, map } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch((call) => {
      if (call.url.endsWith('/v1/auth/refresh')) {
        expect(call.body).toEqual({ refresh_token: 'R1' });
        return json(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 900 });
      }
      if (call.headers.Authorization === 'Bearer A1') return json(401, { detail: 'expired' });
      return json(200, { id: 's1' });
    });
    const api = new Api(BASE, storage);

    const out: unknown = await api.session('s1');

    expect(out).toEqual({ id: 's1' });
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/v1/sessions/s1',
      '/v1/auth/refresh',
      '/v1/sessions/s1',
    ]);
    expect(calls[2]!.headers.Authorization).toBe('Bearer A2');
    expect(map.get('builder.access')).toBe('A2');
    expect(map.get('builder.refresh')).toBe('R2');
  });

  test('a 401 after a successful refresh is NOT retried again', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch((call) => {
      if (call.url.endsWith('/v1/auth/refresh')) {
        return json(200, { access_token: 'A2', refresh_token: 'R2' });
      }
      return json(401, { detail: 'device revoked' });
    });
    const api = new Api(BASE, storage);

    const err = await api.profile().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toBe('device revoked');
    expect(calls).toHaveLength(3);
  });

  test('(c) two concurrent 401s share ONE refresh call', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const calls = installFetch(async (call) => {
      if (call.url.endsWith('/v1/auth/refresh')) {
        await gate; // hold the refresh open so the second 401 arrives while it is in flight
        return json(200, { access_token: 'A2', refresh_token: 'R2' });
      }
      if (call.headers.Authorization === 'Bearer A1') return json(401, { detail: 'expired' });
      return json(200, { ok: call.url });
    });
    const api = new Api(BASE, storage);

    const p1 = api.session('one');
    const p2 = api.session('two');
    // Let both first attempts fail and both reach the refresh gate.
    await new Promise((r) => setTimeout(r, 10));
    releaseRefresh();
    const [r1, r2]: unknown[] = await Promise.all([p1, p2]);

    expect(r1).toEqual({ ok: `${BASE}/v1/sessions/one` });
    expect(r2).toEqual({ ok: `${BASE}/v1/sessions/two` });
    const refreshCalls = calls.filter((c) => c.url.endsWith('/v1/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    const retries = calls.filter((c) => c.headers.Authorization === 'Bearer A2');
    expect(retries).toHaveLength(2);
  });

  test('(d) refresh failure clears both tokens and throws ApiError', async () => {
    const { storage, map } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    installFetch((call) => {
      if (call.url.endsWith('/v1/auth/refresh')) {
        return json(401, { detail: 'refresh token reuse detected; all tokens for this device revoked' });
      }
      return json(401, { detail: 'expired' });
    });
    const api = new Api(BASE, storage);

    const err = await api.session('s1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toContain('reuse detected');
    expect(map.has('builder.access')).toBe(false);
    expect(map.has('builder.refresh')).toBe(false);
    expect(await api.isSignedIn()).toBe(false);
  });

  test('error message prefers detail, then error, then statusText', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    let n = 0;
    installFetch(() => {
      n += 1;
      if (n === 1) return json(422, { error: 'invalid visibility' });
      return new Response('', { status: 503, statusText: 'Service Unavailable' });
    });
    const api = new Api(BASE, storage);

    const e1 = (await api.setRepoVisibility('h', 'public').catch((e: unknown) => e)) as ApiError;
    expect(e1.status).toBe(422);
    expect(e1.message).toBe('invalid visibility');

    const e2 = (await api.profile().catch((e: unknown) => e)) as ApiError;
    expect(e2.status).toBe(503);
    expect(e2.message).toBe('Service Unavailable');
  });
});

/**
 * The engine's live state for one running session as the detail endpoint serves it: every
 * block of `spec/live.v1.json`, the shape of the design's own example (section 2.6). Typed
 * as the GENERATED `LiveState`, so a spec change that this literal no longer satisfies is a
 * `tsc` failure here, not a surprise on a screen.
 */
const LIVE_STATE: LiveState = {
  live_version: 1,
  computed_at: '2026-09-13T07:41:05Z',
  activity: { kind: 'delegating', role: 'unknown', attempt: 0, since_s: 212, files: 0, calls: 3, file_id: null },
  verdict: {
    state: 'starting',
    basis: 'segment_tool_calls',
    reason: null,
    file_id: null,
    evidence: {
      window_calls: 3, errors_now: 0, errors_before: 0, new_files: 0, checkpoints: 0, repeats: 0,
      churn_writes: 0, fail_run: 0, blind_edits: 0, stuck_s: 0, files_changed: 0, commits: 0, background: 0,
    },
  },
  eta: {
    elapsed_s: 5412, typical_s: null, p25_s: null, p75_s: null, remaining_s: null, n: 5, needed: 10,
    unattended: false, basis: 'finished_sessions_same_repo_that_ran_at_least_this_long', reason: 'too_few_sessions',
  },
  decisions: [{ kind: 'reverted_changes', ts: 1757748660.2, event_n: 88, count: 1 }],
  needs_you: { score: 5, reason: 'running_fine' },
  map: {
    files: [{ id: '3f9a0c1d2e4b5a69', dir_id: null, role: 'docs', depth: 1, reads: 2, edits: 1, last_read_ts: 1757748660.2, last_edit_ts: 1757749001.9 }],
    files_total: 25,
  },
  timelapse: [{ t: 0, file_id: '3f9a0c1d2e4b5a69', kind: 'read' }],
  sample: { events: 412, tool_calls: 131, segments: 9, tokens: 12900311 },
};

describe('contract v4 on the phone', () => {
  test('builderProfile sends window_days, the name the server reads', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => json(200, { builder_profile: null, window_days: 90, corpus: null }));
    const api = new Api(BASE, storage);

    await api.builderProfile();
    await api.builderProfile(365);

    // `?days=` is what the graph route reads; this route reads `window_days` and ignored
    // `days` entirely, so the phone always got the 90 day default (section 5.3).
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/v1/profile/builder?window_days=90',
      '/v1/profile/builder?window_days=365',
    ]);
    expect(calls.every((c) => !/[?&]days=/.test(c.url))).toBe(true);
  });

  test('profile still sends days, the name the graph route reads', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => json(200, { graph: [] }));
    await new Api(BASE, storage).profile(30);
    expect(calls[0]!.url).toBe(`${BASE}/v1/profile?days=30`);
  });

  test('a session detail decodes live_state, live_names, burn, title_ids and lines_removed_agent', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const detail = {
      id: 's1',
      state: 'live',
      stats: { tokens_reported: true, lines_added_agent: 1840, lines_removed_agent: 212, commit_count: 3 },
      live_state: LIVE_STATE,
      live_names: { files: [{ id: '3f9a0c1d2e4b5a69', name: 'overnight-integration.md' }] },
      burn: {
        tokens: 12900311, cache_read_share: 0.945, barren_share: 0, unreadable_share: 0.1, segments: 9,
        lines_added: 1840, lines_removed: 212, files_changed: 12, commits: 3, reason: null, spikes: [], spikes_needed: 5,
      },
      title_ids: { verb: 'shipped', object: 'source', n: 3, modules: 2 },
    };
    installFetch(() => json(200, detail));

    const s: SessionDetail = await new Api(BASE, storage).session('s1');

    expect(s.live_state?.computed_at).toBe('2026-09-13T07:41:05Z');
    expect(s.live_state?.eta.reason).toBe('too_few_sessions');
    expect(s.live_state?.timelapse).toHaveLength(1);
    expect(s.live_names?.files[0]?.name).toBe('overnight-integration.md');
    expect(s.stats?.lines_removed_agent).toBe(212);
    expect(s.burn?.segments).toBe(9);
    expect(s.title_ids?.verb).toBe('shipped');
  });

  test('a detail from a server older than v4 leaves every new field undefined, not zero', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    installFetch(() => json(200, { id: 's1', stats: { lines_added_agent: 10 } }));

    const s = await new Api(BASE, storage).session('s1');

    expect(s.live_state).toBeUndefined();
    expect(s.burn).toBeUndefined();
    expect(s.title_ids).toBeUndefined();
    expect(s.stats?.lines_removed_agent).toBeUndefined();
  });

  test('privacy prefs: GET, then a PUT that sends only the key it was given', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch((call) =>
      call.method === 'GET'
        ? json(200, { quotes: false, live_names: false })
        : json(200, { quotes: false, live_names: true, quotes_deleted: 2 })
    );
    const api = new Api(BASE, storage);

    expect(await api.privacyPrefs()).toEqual({ quotes: false, live_names: false });
    const out = await api.setPrivacyPrefs({ live_names: true, quotes: undefined });

    expect(out.quotes_deleted).toBe(2);
    expect(calls.map((c) => [c.method, c.url.replace(BASE, '')])).toEqual([
      ['GET', '/v1/privacy/prefs'],
      ['PUT', '/v1/privacy/prefs'],
    ]);
    // An explicit undefined must not travel as a key: the server reads the keys SET.
    expect(calls[1]!.body).toEqual({ live_names: true });
    expect(Object.keys(calls[1]!.body as object)).toEqual(['live_names']);
  });

  test('deleteQuotes and forgetLiveActivity accept a 204 with no body', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => new Response(null, { status: 204 }));
    const api = new Api(BASE, storage);

    await api.deleteQuotes();
    await api.forgetLiveActivity('ABC/def 1');

    expect(calls.map((c) => [c.method, c.url.replace(BASE, '')])).toEqual([
      ['DELETE', '/v1/profile/quotes'],
      ['DELETE', '/v1/push/live-activity/ABC%2Fdef%201'],
    ]);
  });

  test('registerLiveActivity posts the token with its session, activity, environment and creature', async () => {
    const { storage } = memoryStorage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls = installFetch(() => json(200, { status: 'ok' }));

    await new Api(BASE, storage).registerLiveActivity({
      kind: 'activity',
      session_id: '8f1d2c3b-0000-4000-8000-000000000001',
      activity_id: 'act-1',
      token: 'ab12cd',
      environment: 'sandbox',
      creature: 'owl',
    });

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/v1/push/live-activity`);
    expect(calls[0]!.body).toEqual({
      kind: 'activity',
      session_id: '8f1d2c3b-0000-4000-8000-000000000001',
      activity_id: 'act-1',
      token: 'ab12cd',
      environment: 'sandbox',
      creature: 'owl',
    });
  });
});
