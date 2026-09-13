/**
 * The live → final transition in the cache.
 *
 * The server keeps ONE row per session and flips its state, so the id is stable. The trap
 * is the list call: it asks for notable finals only, so a live session that finalizes as
 * not-notable never comes back through it. A row that stops being live must be re-read by
 * id, or it pulses on the phone forever. bun:sqlite stands in for expo-sqlite.
 */
import { Database } from 'bun:sqlite';
import { beforeAll, describe, expect, mock, test } from 'bun:test';

const sqlite = new Database(':memory:');
const fakeHandle = {
  execAsync: async (sql: string) => {
    sqlite.exec(sql);
  },
  runAsync: async (sql: string, ...params: (string | number | null)[]) => {
    sqlite.query(sql).run(...params);
  },
  getAllAsync: async (sql: string, ...params: (string | number | null)[]) =>
    sqlite.query(sql).all(...params),
  getFirstAsync: async (sql: string, ...params: (string | number | null)[]) =>
    sqlite.query(sql).get(...params) ?? null,
};

mock.module('expo-sqlite', () => ({ openDatabaseSync: () => fakeHandle }));
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));

const cache = await import('../src/data/cache');
const { ApiError } = await import('../src/data/api');
type Api = import('../src/data/api').Api;
type SessionDetail = import('../src/data/api').SessionDetail;

function session(id: string, extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id,
    client_session_id: id,
    harness: 'claude_code',
    repo_name: 'gt-transit',
    started_at: '2026-09-05T09:00:00Z',
    ended_at: '2026-09-05T10:00:00Z',
    active_seconds: 3600,
    idle_seconds: 0,
    local_date: '2026-09-05',
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    post_id: null,
    ...extra,
  };
}

/** The three calls sync makes, scripted per test. */
function fakeApi(script: {
  finals: SessionDetail[];
  live: SessionDetail[] | Error;
  detail: (id: string) => SessionDetail | Error;
}) {
  const detailCalls: string[] = [];
  const api = {
    sessions: async () => ({ sessions: script.finals, next_before: null }),
    liveSessions: async () => {
      if (script.live instanceof Error) throw script.live;
      return { sessions: script.live };
    },
    session: async (id: string) => {
      detailCalls.push(id);
      const r = script.detail(id);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as Api;
  return { api, detailCalls };
}

const ANALYSIS = { headline: 'checkpoint', confidence: 0.5 } as unknown as SessionDetail['analysis'];

beforeAll(async () => {
  await cache.clear();
});

describe('cache live sessions', () => {
  test('a live row is kept out of listSessions and returned by listLive, with detail fetched', async () => {
    const s1 = session('s1');
    const s2 = session('s2', { state: 'live', end_reason: 'still_running', updated_at: 'u1', notable: false });
    const { api, detailCalls } = fakeApi({
      finals: [s1],
      live: [s2],
      detail: (id) => (id === 's2' ? { ...s2, analysis: ANALYSIS } : { ...s1, strip: null }),
    });

    await cache.sync(api);

    expect((await cache.listSessions(50)).map((s) => s.id)).toEqual(['s1']);
    expect((await cache.listLive()).map((s) => s.id)).toEqual(['s2']);
    expect(detailCalls).toContain('s2');
    const d = await cache.getDetail('s2');
    expect(d?.analysis).toEqual(ANALYSIS);
    expect(d?.strip).toBeNull();
  });

  test('an unchanged live snapshot is not re-read; a moved one is', async () => {
    const s2 = session('s2', { state: 'live', updated_at: 'u1', notable: false });
    const same = fakeApi({ finals: [], live: [s2], detail: (id) => session(id) });
    await cache.sync(same.api);
    expect(same.detailCalls).toEqual([]);

    const moved = fakeApi({
      finals: [],
      live: [{ ...s2, updated_at: 'u2' }],
      detail: () => ({ ...s2, updated_at: 'u2', analysis: ANALYSIS }),
    });
    await cache.sync(moved.api);
    expect(moved.detailCalls).toEqual(['s2']);
  });

  test('a row that leaves the live list is re-read by id and flips to final on the SAME id', async () => {
    const s2final = session('s2', {
      state: 'final',
      end_reason: 'idle_gap',
      updated_at: 'u3',
      notable: false,
      // The final detail carries no analysis: the checkpoint must not outlive the run.
    });
    const { api, detailCalls } = fakeApi({
      finals: [], // not notable, so the list never mentions it
      live: [],
      detail: (id) => (id === 's2' ? s2final : new ApiError(404, 'nope')),
    });

    await cache.sync(api);

    expect(detailCalls).toEqual(['s2']);
    expect(await cache.listLive()).toEqual([]);
    const ids = (await cache.listSessions(50)).map((s) => s.id).sort();
    expect(ids).toEqual(['s1', 's2']);
    const d = await cache.getDetail('s2');
    expect(d?.state).toBe('final');
    expect(d?.end_reason).toBe('idle_gap');
    expect(d?.analysis).toBeNull();
  });

  test('a live row the server no longer knows is dropped on 404', async () => {
    const ghost = session('s9', { state: 'live', notable: false });
    await cache.sync(fakeApi({ finals: [], live: [ghost], detail: () => ghost }).api);
    expect((await cache.listLive()).map((s) => s.id)).toEqual(['s9']);

    await cache.sync(fakeApi({ finals: [], live: [], detail: () => new ApiError(404, 'gone') }).api);
    expect(await cache.listLive()).toEqual([]);
    expect(await cache.getDetail('s9')).toBeNull();
  });

  test('a server without /v1/sessions/live is not an error', async () => {
    const { api } = fakeApi({
      finals: [session('s1')],
      live: new ApiError(404, 'Not Found'),
      detail: (id) => session(id),
    });
    await expect(cache.sync(api)).resolves.toBeUndefined();
  });

  test('any other live failure is reported after the finals were saved', async () => {
    const { api } = fakeApi({
      finals: [session('s3', { notable: true })],
      live: new ApiError(503, 'Service Unavailable'),
      detail: (id) => session(id),
    });
    await expect(cache.sync(api)).rejects.toBeInstanceOf(ApiError);
    expect((await cache.listSessions(50)).map((s) => s.id)).toContain('s3');
  });
});

/** A live state computed at `at`: `full` is the detail's body, else the live list's slim one. */
function liveState(at: string, full: boolean): NonNullable<SessionDetail['live_state']> {
  return {
    live_version: 1,
    computed_at: at,
    activity: { kind: 'editing', role: 'source', attempt: 2, since_s: 40, files: 1, calls: 3, file_id: 'aaaaaaaaaaaaaaaa' },
    verdict: {
      state: null, basis: null, reason: 'no_rule_fired', file_id: null,
      evidence: {
        window_calls: 8, errors_now: 0, errors_before: 0, new_files: 1, checkpoints: 2, repeats: 0, churn_writes: 1,
        fail_run: 0, blind_edits: 0, stuck_s: 0, files_changed: 3, commits: 0, background: 0,
      },
    },
    eta: { n: null, needed: 10, unattended: false, basis: 'finished_sessions_same_repo_that_ran_at_least_this_long', reason: 'repo_unresolved' },
    decisions: [],
    needs_you: { score: 5, reason: 'running_fine' },
    map: full
      ? {
          files: [
            { id: 'aaaaaaaaaaaaaaaa', role: 'source', reads: 1, edits: 2 },
            { id: 'bbbbbbbbbbbbbbbb', role: 'test', reads: 3, edits: 0 },
          ],
          files_total: 2,
        }
      : { files: [{ id: 'aaaaaaaaaaaaaaaa', role: 'source', reads: 1, edits: 2 }], files_total: 2 },
    timelapse: full ? [{ t: 0, file_id: 'aaaaaaaaaaaaaaaa', kind: 'read' }] : null,
    sample: { events: 30, tool_calls: 12, segments: 2, tokens: null },
  };
}

const NAMES = { files: [{ id: 'aaaaaaaaaaaaaaaa', name: 'auth.py' }] };
const BURN = {
  tokens: 120000, cache_read_share: 0.8, barren_share: 0, unreadable_share: 0, segments: 2,
  lines_added: 40, lines_removed: 2, files_changed: 1, commits: 0, reason: null, spikes: null, spikes_needed: 5,
} as SessionDetail['burn'];

describe('contract v4 in the cache', () => {
  test('the live list\'s slim state never replaces a full one computed at the same instant', async () => {
    const full = liveState('2026-09-13T07:41:05Z', true);
    await cache.putDetail(session('v1', { state: 'live', updated_at: 'u1', live_state: full, live_names: NAMES }));
    // The same state, slim, and spelled with an offset: one instant, so the fuller body stays.
    const slim = { ...liveState('2026-09-13T07:41:05+00:00', false) };
    const run = fakeApi({ finals: [], live: [session('v1', { state: 'live', updated_at: 'u1', live_state: slim })], detail: (id) => session(id, { strip: null }) });
    await cache.sync(run.api);
    expect(run.detailCalls).not.toContain('v1');

    const d = await cache.getDetail('v1');
    expect(d?.live_state?.timelapse).toHaveLength(1);
    expect(d?.live_state?.map?.files).toHaveLength(2);
    // The list never carries names; a row without the key keeps the ones the detail brought.
    expect(d?.live_names).toEqual(NAMES);
  });

  test('a newer slim state replaces an older full one: what the session is doing now wins', async () => {
    await cache.putDetail(session('v2', { state: 'live', updated_at: 'u1', live_state: liveState('2026-09-13T07:41:05Z', true) }));
    const newer = liveState('2026-09-13T07:42:05Z', false);
    const run = fakeApi({ finals: [], live: [session('v2', { state: 'live', updated_at: 'u1', live_state: newer })], detail: (id) => session(id, { strip: null }) });
    await cache.sync(run.api);
    expect(run.detailCalls).not.toContain('v2');

    const d = await cache.getDetail('v2');
    expect(d?.live_state?.computed_at).toBe('2026-09-13T07:42:05Z');
    expect(d?.live_state?.timelapse).toBeNull();
  });

  test('an older detail cannot roll back a newer state the list brought', async () => {
    await cache.putDetail(session('v3', { state: 'live', live_state: liveState('2026-09-13T08:00:00Z', false) }));
    await cache.putDetail(session('v3', { state: 'live', live_state: liveState('2026-09-13T07:59:00Z', true) }));
    expect((await cache.getDetail('v3'))?.live_state?.computed_at).toBe('2026-09-13T08:00:00Z');
  });

  test('a session that finalises drops its live state and file names, even from a list row', async () => {
    await cache.putDetail(session('v4', { state: 'live', live_state: liveState('2026-09-13T07:41:05Z', true), live_names: NAMES }));
    // The finals list: `state: final`, and no live keys at all.
    await cache.sync(fakeApi({ finals: [session('v4', { state: 'final', strip: null })], live: [], detail: (id) => session(id, { state: 'final', strip: null }) }).api);

    const d = await cache.getDetail('v4');
    expect(d?.state).toBe('final');
    expect(d?.live_state ?? null).toBeNull();
    expect(d?.live_names ?? null).toBeNull();
  });

  test('the detail is the authority for burn and title_ids; a list row without them keeps them', async () => {
    const titled = { verb: 'shipped', object: 'source', n: 3, modules: 2 } as SessionDetail['title_ids'];
    await cache.putDetail(session('v5', { burn: BURN, title_ids: titled, strip: null }));
    const run = fakeApi({ finals: [session('v5')], live: [], detail: (id) => session(id, { strip: null }) });
    await cache.sync(run.api);
    expect(run.detailCalls).not.toContain('v5');
    let d = await cache.getDetail('v5');
    expect(d?.burn).toEqual(BURN);
    expect(d?.title_ids).toEqual(titled);

    // A re-read detail that no longer carries them: the stale block must not outlive it.
    await cache.putDetail(session('v5', { strip: null, title_ids: null }));
    d = await cache.getDetail('v5');
    expect(d?.burn).toBeUndefined();
    expect(d?.title_ids).toBeNull();
  });

  test('forgetLiveNames clears every cached file name and says how many sessions had one', async () => {
    await cache.clear();
    await cache.putDetail(session('n1', { state: 'live', live_state: liveState('2026-09-13T07:41:05Z', true), live_names: NAMES }));
    await cache.putDetail(session('n2', { state: 'live', live_state: liveState('2026-09-13T07:41:05Z', true), live_names: NAMES }));
    await cache.putDetail(session('n3', { state: 'live', live_state: liveState('2026-09-13T07:41:05Z', true) }));

    expect(await cache.forgetLiveNames()).toBe(2);
    for (const id of ['n1', 'n2', 'n3']) {
      const d = await cache.getDetail(id);
      expect(d?.live_names ?? null).toBeNull();
      expect(d?.live_state?.map?.files).toHaveLength(2);
    }
    expect(await cache.forgetLiveNames()).toBe(0);
  });

  test('Show details on Lock Screen is on until turned off, and outlives sign out', async () => {
    sqlite.query('DELETE FROM kv WHERE k = ?').run(cache.LOCK_SCREEN_DETAILS_KEY);
    expect(await cache.getLockScreenDetails()).toBe(cache.LOCK_SCREEN_DETAILS_DEFAULT);
    expect(cache.LOCK_SCREEN_DETAILS_DEFAULT).toBe(true);

    await cache.setLockScreenDetails(false);
    expect(await cache.getLockScreenDetails()).toBe(false);
    // A property of this phone's screen, not of the person: sign out keeps it.
    await cache.clear();
    expect(await cache.getLockScreenDetails()).toBe(false);
    expect(cache.LOCK_SCREEN_DETAILS_KEY.startsWith(cache.DEVICE_KEY_PREFIX)).toBe(true);

    await cache.setLockScreenDetails(true);
    expect(await cache.getLockScreenDetails()).toBe(true);
  });
});

describe('sign-out keeps what describes the install', () => {
  test('clear() drops the person\'s kv and sessions and keeps device.* keys', async () => {
    await cache.setKv('device.onboarded.v1', '1');
    await cache.setKv('profile.name.v1', 'Ada');
    await cache.setKv('profile.animal.v1', 'fox');
    await cache.setKv('devicex', 'not a device key');
    await cache.putDetail(session('s-clear'));

    await cache.clear();

    expect(await cache.getKv('device.onboarded.v1')).toBe('1');
    expect(await cache.getKv('profile.name.v1')).toBeNull();
    expect(await cache.getKv('profile.animal.v1')).toBeNull();
    expect(await cache.getKv('devicex')).toBeNull();
    expect(await cache.getDetail('s-clear')).toBeNull();
    expect(cache.DEVICE_KEY_PREFIX).toBe('device.');
  });
});

describe('an install whose kv predates this cache', () => {
  function handleFor(db: Database) {
    return {
      execAsync: async (sql: string) => {
        db.exec(sql);
      },
      runAsync: async (sql: string, ...params: (string | number | null)[]) => {
        db.query(sql).run(...params);
      },
      getAllAsync: async (sql: string, ...params: (string | number | null)[]) => db.query(sql).all(...params),
      getFirstAsync: async (sql: string, ...params: (string | number | null)[]) => db.query(sql).get(...params) ?? null,
    };
  }

  test('kv(key, value) from the August build becomes kv(k, v), rows carried over', async () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO kv VALUES ('profile.animal.v1', 'fox');");
    await cache.migrateKv(handleFor(db) as never);
    const cols = (db.query('PRAGMA table_info(kv)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['k', 'v']);
    expect(db.query("SELECT v FROM kv WHERE k = 'profile.animal.v1'").get()).toEqual({ v: 'fox' });
    // And the table the old schema lived in is gone, not left beside it.
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'kv_legacy'").get()).toBeNull();
  });

  test('a current kv is left alone', async () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); INSERT INTO kv VALUES ('a', '1');");
    await cache.migrateKv(handleFor(db) as never);
    expect(db.query('SELECT k, v FROM kv').all()).toEqual([{ k: 'a', v: '1' }]);
  });

  test('an unrecognisable kv is replaced, not copied', async () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE kv (name TEXT, blob TEXT); INSERT INTO kv VALUES ('x', 'y');");
    await cache.migrateKv(handleFor(db) as never);
    expect(db.query('SELECT * FROM kv').all()).toEqual([]);
    const cols = (db.query('PRAGMA table_info(kv)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['k', 'v']);
  });
});

describe('one sync at a time', () => {
  test('two passes asked for at once share one: every detail is fetched once, not twice', async () => {
    await cache.clear();
    const { api, detailCalls } = fakeApi({
      finals: [],
      live: [session('one-pass', { state: 'live', updated_at: '2026-09-05T10:00:00Z' })],
      detail: (id) => session(id, { state: 'live', updated_at: '2026-09-05T10:00:00Z', strip: null, stats: null }),
    });
    await Promise.all([cache.sync(api), cache.sync(api)]);
    expect(detailCalls.filter((id) => id === 'one-pass')).toHaveLength(1);
    // and a pass asked for after it finished is a pass of its own
    await cache.sync(api);
    expect(detailCalls.filter((id) => id === 'one-pass').length).toBeGreaterThanOrEqual(1);
  });
});
