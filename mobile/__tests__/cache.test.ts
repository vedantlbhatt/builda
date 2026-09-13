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
