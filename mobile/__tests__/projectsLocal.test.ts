/**
 * What the phone keeps about the owner's projects (`src/projects/nicknames.ts`), over a kv the
 * test hands it, and the one query that reads a project's saved sessions.
 *
 *   1. sign out forgets: the next account on this phone sees none of the last one's names or
 *      numbers, and its first save cannot write them back (review, 2026-09-13: the store was read
 *      once per launch and never reset, and a key is the same repository in every account)
 *   2. the register is saved once and read back the same, a number never given twice
 *   3. SQLite picks a project's saved rows by key, so a project page never parses the rest
 */
import { Database } from 'bun:sqlite';
import { describe, expect, mock, test } from 'bun:test';

mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));

const { projectsStore } = await import('../src/projects/nicknames');
const { NICKNAMES_KEY, REGISTRY_KEY } = await import('../src/projects/model');
const { SESSIONS_FOR_REPO_SQL } = await import('../src/data/cache');

function fakeKv() {
  const map = new Map<string, string>();
  return {
    map,
    getKv: async (k: string) => map.get(k) ?? null,
    setKv: async (k: string, v: string) => {
      map.set(k, v);
    },
    /** `cache.clear()`: every key but the device's. */
    clear() {
      map.clear();
    },
  };
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const p = (key: string, first: string) => ({ key, history: { first_at: first } });

describe('sign out forgets the last account\'s projects', () => {
  test('names and numbers are gone from memory, and the next save carries none of them', async () => {
    const kv = fakeKv();
    const store = projectsStore(kv);
    await store.read();
    await store.saveNickname(A, 'the one I call RideGT');
    await store.register([p(A, '2026-08-12T00:00:00Z'), p(B, '2026-08-16T00:00:00Z')]);
    expect(store.snapshot().nicknames[A]).toBe('the one I call RideGT');
    expect(store.snapshot().registry.projects[B]!.n).toBe(2);

    // Settings' sign out: the cache is cleared, then the store forgets.
    kv.clear();
    await store.forget();
    expect(store.snapshot()).toEqual({ nicknames: {}, registry: { next: 1, projects: {} }, read: true });

    // The next account names one of ITS projects (the same repository has the same key).
    await store.saveNickname(B, 'mine');
    expect(JSON.parse(kv.map.get(NICKNAMES_KEY)!)).toEqual({ [B]: 'mine' });
    await store.register([p(B, '2026-08-16T00:00:00Z')]);
    expect(JSON.parse(kv.map.get(REGISTRY_KEY)!).projects[B].n).toBe(1);
  });

  test('a register on its way when the account leaves writes nothing', async () => {
    const kv = fakeKv();
    kv.map.set(REGISTRY_KEY, JSON.stringify({ next: 2, projects: { [A]: { n: 1, hue: 'tide' } } }));
    const store = projectsStore(kv);
    const pending = store.register([p(A, '2026-08-12T00:00:00Z'), p(B, '2026-08-16T00:00:00Z')]);
    kv.clear();
    await store.forget();
    await pending;
    expect(kv.map.get(REGISTRY_KEY)).toBeUndefined();
    expect(store.snapshot().registry.projects).toEqual({});
  });

  test('the register is read back as it was saved, and a known project is never renumbered', async () => {
    const kv = fakeKv();
    const one = projectsStore(kv);
    await one.register([p(B, '2026-08-16T00:00:00Z'), p(A, '2026-08-12T00:00:00Z')]);
    // A second launch: a new store over the same kv.
    const two = projectsStore(kv);
    await two.read();
    expect(two.snapshot().registry).toEqual(one.snapshot().registry);
    expect([two.snapshot().registry.projects[A]!.n, two.snapshot().registry.projects[B]!.n]).toEqual([1, 2]);
  });
});

describe('a project page reads only its own saved sessions', () => {
  test('SQLite picks the rows by key, newest first, finished only, and a row with no key is nobody\'s', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at TEXT, json TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0)');
    const put = (id: string, at: string, repo: string | null, live = 0) =>
      db.query('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(id, at, JSON.stringify({ id, started_at: at, repo_key: repo }), live);
    put('s1', '2026-09-01T10:00:00Z', A);
    put('s2', '2026-09-02T10:00:00Z', A);
    put('s3', '2026-09-03T10:00:00Z', B);
    put('s4', '2026-09-04T10:00:00Z', null);
    put('s5', '2026-09-05T10:00:00Z', A, 1);
    const rows = db.query(SESSIONS_FOR_REPO_SQL).all(A, 10) as { json: string }[];
    expect(rows.map((r) => (JSON.parse(r.json) as { id: string }).id)).toEqual(['s2', 's1']);
    expect((db.query(SESSIONS_FOR_REPO_SQL).all(A, 1) as unknown[]).length).toBe(1);
  });
});
