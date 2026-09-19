import { ApiError, type Api, type Profile, type SessionDetail } from './api';

/**
 * The on-device copy of what the server has told us.
 *
 * Cache first, always: on a cold launch over cellular the difference between this and a
 * spinner is the whole first impression, and offline, stale sessions are a far better
 * answer than an empty screen. It is a cache, not a store of record — `clear()` on sign-out
 * deletes it, because the sessions are the user's data and not ours to keep.
 *
 * Every SQLite access is guarded. If the database cannot be opened (a test runtime, a
 * corrupt file, a platform without the native module) the functions degrade to "nothing
 * cached" and the app still renders the sample session.
 */

type Row = { json: string };

// Loaded lazily: importing expo-sqlite at module scope would throw at import time in a
// runtime without the native module, before any try/catch could run.
type Db = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
};

let dbPromise: Promise<Db | null> | null = null;
let warned = false;

function warnOnce(where: string, e: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`[cache] sqlite unavailable (${where}); running without a cache`, e);
}

function db(): Promise<Db | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const sqlite = await import('expo-sqlite');
        const handle = sqlite.openDatabaseSync('builder-cache.db') as unknown as Db;
        await handle.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            started_at TEXT,
            json TEXT NOT NULL,
            live INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);
          CREATE TABLE IF NOT EXISTS profile (k TEXT PRIMARY KEY, json TEXT);
          CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
        `);
        // Databases created before live sessions existed lack the column. SQLite has no
        // ADD COLUMN IF NOT EXISTS; the duplicate-column error is the "already there" signal.
        try {
          await handle.execAsync(
            'ALTER TABLE sessions ADD COLUMN live INTEGER NOT NULL DEFAULT 0'
          );
        } catch {
          // column exists
        }
        try {
          await migrateKv(handle);
        } catch (e) {
          // Sessions still cache without it; only the kv stays as broken as it was.
          warnOnce('migrateKv', e);
        }
        return handle;
      } catch (e) {
        warnOnce('open', e);
        return null;
      }
    })();
  }
  return dbPromise;
}

/**
 * Give an old `kv` table the columns this file reads.
 *
 * The August build, whose data layer was never committed (1832f86 reconstructed it), created
 * `kv (key, value)`. `CREATE TABLE IF NOT EXISTS kv (k, v)` then skips over it, and every
 * `getKv`/`setKv` on that install fails with "no such column" into `guarded`, which returns
 * the fallback: the chosen creature, the cached profile and the onboarding flag were all
 * silently never stored. FOUND on the iOS simulator this build runs on. The old rows are
 * carried over when the old columns are recognisable and dropped otherwise.
 */
export async function migrateKv(d: Db): Promise<void> {
  const cols = (await d.getAllAsync<{ name: string }>('PRAGMA table_info(kv)')).map((c) => c.name);
  if (cols.includes('k') && cols.includes('v')) return;
  const carry = cols.includes('key') && cols.includes('value');
  try {
    await d.execAsync(`
      BEGIN;
      ALTER TABLE kv RENAME TO kv_legacy;
      CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);
      ${carry ? 'INSERT OR IGNORE INTO kv (k, v) SELECT key, value FROM kv_legacy;' : ''}
      DROP TABLE kv_legacy;
      COMMIT;
    `);
  } catch (e) {
    await d.execAsync('ROLLBACK;').catch(() => undefined);
    throw e;
  }
}

/** Run one guarded access; any failure logs once and yields the fallback. */
async function guarded<T>(where: string, fallback: T, fn: (d: Db) => Promise<T>): Promise<T> {
  const d = await db();
  if (!d) return fallback;
  try {
    return await fn(d);
  } catch (e) {
    warnOnce(where, e);
    return fallback;
  }
}

function parse(json: string): SessionDetail | null {
  try {
    return JSON.parse(json) as SessionDetail;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------- sessions

/** Finished sessions only. Live ones come from `listLive` and render as their own block. */
export async function listSessions(limit: number): Promise<SessionDetail[]> {
  return guarded('listSessions', [], async (d) => {
    const rows = await d.getAllAsync<Row>(
      'SELECT json FROM sessions WHERE live = 0 ORDER BY started_at DESC LIMIT ?',
      limit
    );
    return rows.map((r) => parse(r.json)).filter((s): s is SessionDetail => s !== null);
  });
}

/**
 * The Sessions list's rows (`session/listReach.ts`): finished, of one kind, newest first, and at or
 * after `from` when there is one. `julianday` compares the instants, not the strings: a stored
 * `-04:00` and a `-05:00` either side of a clock change sort as the times they are.
 */
export const FINISHED_SQL = {
  notable:
    "SELECT json FROM sessions WHERE live = 0 AND json_extract(json, '$.notable') = 1 AND (?1 IS NULL OR julianday(started_at) >= julianday(?1)) ORDER BY julianday(started_at) DESC LIMIT ?2",
  every:
    'SELECT json FROM sessions WHERE live = 0 AND (?1 IS NULL OR julianday(started_at) >= julianday(?1)) ORDER BY julianday(started_at) DESC LIMIT ?2',
} as const;

export async function listFinished(mode: 'notable' | 'every', from: string | null, limit: number): Promise<SessionDetail[]> {
  return guarded('listFinished', [], async (d) => {
    const rows = await d.getAllAsync<Row>(FINISHED_SQL[mode], from, limit);
    return rows.map((r) => parse(r.json)).filter((s): s is SessionDetail => s !== null);
  });
}

/**
 * One page of finished sessions from the server, saved: `before` is the cursor (the oldest row the
 * list has), null for the top. The rows are list rows, without a strip; `fillDetails` reads those.
 */
export async function readPage(
  api: Api,
  opts: { before: string | null; notableOnly: boolean; limit: number }
): Promise<{ rows: SessionDetail[]; next_before: string | null }> {
  const page = await api.sessions({ limit: opts.limit, before: opts.before, notable_only: opts.notableOnly });
  for (const s of page.sessions) await upsert(s, false);
  const next = page.next_before ?? null;
  await pruneCovered({ notableOnly: opts.notableOnly, before: opts.before, rows: page.sessions, last: next === null });
  return { rows: page.sessions, next_before: next };
}

/**
 * The saved rows a page of the list route has just answered for, that it did not return.
 *
 * The phone never dropped a finished session it had saved, while the server deletes one when its
 * repository is excluded (`routes/privacy.py`) and a sitting's `notable` can change when it is
 * re-cut; so "That is every session on your account: N", counted off the saved rows, could say
 * more than the account holds (FOUND IN REVIEW, 2026-09-14). A page covers the stretch of time
 * from just after its oldest row up to `before` (to the end, on the last page; from the newest,
 * on the first), and within it the server's answer is the whole answer: a row of every kind it
 * did not return is gone and is deleted; a row it did not return as one you were there for is
 * not one now, and keeps its place in every session. The page's oldest instant itself is left
 * alone, since `before` is exclusive and a second row at that instant is the next page's.
 */
export async function pruneCovered(opts: { notableOnly: boolean; before: string | null; rows: readonly { id: string; started_at: string }[]; last: boolean }): Promise<number> {
  const { notableOnly, before, rows, last } = opts;
  const oldest = rows.length ? rows[rows.length - 1]!.started_at : null;
  if (!last && oldest === null) return 0; // a page with more to come always has rows; nothing to answer for
  return guarded('pruneCovered', 0, async (d) => {
    const where = ['live = 0'];
    const params: (string | number | null)[] = [];
    if (notableOnly) where.push("json_extract(json, '$.notable') = 1");
    if (before) {
      where.push('julianday(started_at) < julianday(?)');
      params.push(before);
    }
    if (!last && oldest !== null) {
      where.push('julianday(started_at) > julianday(?)');
      params.push(oldest);
    }
    if (rows.length) {
      where.push(`id NOT IN (${rows.map(() => '?').join(', ')})`);
      params.push(...rows.map((r) => r.id));
    }
    const stale = await d.getAllAsync<{ id: string }>(`SELECT id FROM sessions WHERE ${where.join(' AND ')}`, ...params);
    for (const { id } of stale) {
      if (notableOnly) await d.runAsync("UPDATE sessions SET json = json_set(json, '$.notable', json('false')) WHERE id = ?", id);
      else await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
    }
    return stale.length;
  });
}

/**
 * The details (strip and stats) of the given sessions this phone has not read yet, six at a time.
 * A failure leaves that row's strip waiting; the rest still land.
 */
export async function fillDetails(api: Api, ids: readonly string[]): Promise<void> {
  const missing = await guarded('fillDetails', [] as string[], async (d) => {
    const out: string[] = [];
    for (const id of ids) {
      const row = await d.getFirstAsync<Row>('SELECT json FROM sessions WHERE id = ?', id);
      const s = row ? parse(row.json) : null;
      if (s && !('strip' in s)) out.push(id);
    }
    return out;
  });
  for (let i = 0; i < missing.length; i += DETAIL_BATCH) {
    const results = await Promise.allSettled(missing.slice(i, i + DETAIL_BATCH).map((id) => api.session(id)));
    for (const r of results) if (r.status === 'fulfilled') await upsert(r.value, true);
  }
}

/**
 * What the sync's first page of the list said (`listReach.reachOfPage`): the newest
 * `SYNC_LIST_LIMIT` sessions you were there for at least 20 minutes, and whether older ones exist.
 * Null until a sync has read it in this process.
 */
let firstPage: { startedAt: string[]; nextBefore: string | null } | null = null;

export function syncedFirstPage(): { startedAt: string[]; nextBefore: string | null } | null {
  return firstPage;
}

/**
 * Finished sessions in one project, newest first: the rows whose `repo_key` is `key`, picked by
 * SQLite from the saved JSON, so a project page reads its own rows and never parses the rest.
 */
export const SESSIONS_FOR_REPO_SQL =
  "SELECT json FROM sessions WHERE live = 0 AND json_extract(json, '$.repo_key') = ? ORDER BY started_at DESC LIMIT ?";

export async function listSessionsForRepo(key: string, limit: number): Promise<SessionDetail[]> {
  return guarded('listSessionsForRepo', [], async (d) => {
    const rows = await d.getAllAsync<Row>(SESSIONS_FOR_REPO_SQL, key, limit);
    return rows.map((r) => parse(r.json)).filter((s): s is SessionDetail => s !== null);
  });
}

/** Sessions the Mac is still uploading, most recently updated first. */
export async function listLive(): Promise<SessionDetail[]> {
  return guarded('listLive', [], async (d) => {
    const rows = await d.getAllAsync<Row>('SELECT json FROM sessions WHERE live = 1');
    return rows
      .map((r) => parse(r.json))
      .filter((s): s is SessionDetail => s !== null)
      .sort((a, b) => (b.updated_at ?? b.started_at).localeCompare(a.updated_at ?? a.started_at));
  });
}

async function liveIds(): Promise<string[]> {
  return guarded('liveIds', [] as string[], async (d) => {
    const rows = await d.getAllAsync<{ id: string }>('SELECT id FROM sessions WHERE live = 1');
    return rows.map((r) => r.id);
  });
}

async function remove(id: string): Promise<void> {
  await guarded('remove', undefined, async (d) => {
    await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
  });
}

export async function getDetail(id: string): Promise<SessionDetail | null> {
  return guarded('getDetail', null, async (d) => {
    const row = await d.getFirstAsync<Row>('SELECT json FROM sessions WHERE id = ?', id);
    return row ? parse(row.json) : null;
  });
}

/**
 * Upsert with a merge.
 *
 * A detail row replaces a summary row, but a summary must never overwrite a detail: the
 * list endpoint omits `strip` and `stats`, and a naive replace would strip every cached
 * timeline on every sync. Old then new, preserving old.strip/old.stats when the new row
 * lacks them.
 */
export async function putDetail(s: SessionDetail): Promise<void> {
  await upsert(s, true);
}

/**
 * The fields the DETAIL endpoint is the authority for (contract v4). A detail that omits
 * one, or sends null, means the server has none for this session now, so a value cached
 * from an earlier read must not outlive it: a burn block from a re-cut that no longer
 * produces one, file names the person has since turned off.
 */
const DETAIL_AUTHORITATIVE = ['burn', 'title_ids', 'call_tokens', 'live_state', 'live_names'] as const;

/**
 * Which of two live states to keep. The live list serves a SLIM body (no time lapse, the map
 * cut to the rows the sentence needs) and the detail the full one, so a sync that stores the
 * list row after the session screen fetched the detail would throw the map away and keep
 * nothing newer. The one that was computed later wins; at the same instant, the fuller one.
 * `computed_at` is ISO 8601 UTC from one server clock, so the strings compare as instants
 * only after parsing: a stored `+00:00` and a `Z` are the same moment.
 */
export function newerLiveState(
  old: SessionDetail['live_state'],
  next: SessionDetail['live_state']
): SessionDetail['live_state'] {
  if (next === undefined) return old;
  if (!old || !next) return next;
  const a = Date.parse(old.computed_at);
  const b = Date.parse(next.computed_at);
  if (Number.isNaN(a) || Number.isNaN(b) || a !== b) return Number.isNaN(b) || a > b ? old : next;
  const fuller = (s: NonNullable<SessionDetail['live_state']>) =>
    (s.timelapse ? 1 : 0) * 1e6 + (s.map?.files.length ?? 0);
  return fuller(next) >= fuller(old) ? next : old;
}

async function upsert(s: SessionDetail, isDetail: boolean): Promise<void> {
  await guarded('putDetail', undefined, async (d) => {
    const existing = await d.getFirstAsync<Row>('SELECT json FROM sessions WHERE id = ?', s.id);
    const old = existing ? parse(existing.json) : null;
    const merged: SessionDetail = { ...(old ?? {}), ...s } as SessionDetail;
    if (s.strip === undefined && old?.strip !== undefined) merged.strip = old.strip;
    if (s.stats === undefined && old?.stats !== undefined) merged.stats = old.stats;
    // A detail response omits `strip` when the server has none. Normalise to an explicit
    // null so `sync` can tell "fetched, and there is no strip" from "never fetched" and
    // does not re-request header-only sessions forever.
    if (isDetail) {
      if (merged.strip === undefined) merged.strip = null;
      if (merged.stats === undefined) merged.stats = null;
      // The detail endpoint is authoritative for the analysis. A live row may have cached
      // a checkpoint; once the final detail arrives without one, the checkpoint must not
      // outlive the session it was a snapshot of.
      merged.analysis = s.analysis ?? null;
      for (const k of DETAIL_AUTHORITATIVE) {
        if (s[k] === undefined) delete merged[k];
      }
      // Present on both sides: still the later computation, so a detail the session
      // screen fetched a minute ago cannot roll back a newer state the list brought.
      if (s.live_state && old?.live_state) merged.live_state = newerLiveState(old.live_state, s.live_state);
    } else {
      // A list row: its slim live state replaces a cached one only when it is newer.
      const kept = newerLiveState(old?.live_state, s.live_state);
      if (kept === undefined) delete merged.live_state;
      else merged.live_state = kept;
    }
    // A session that is not live has no live state: the server deletes the row when the
    // session finalises (docs/overnight-integration.md 3.3). A final LIST row does not
    // carry the key, so without this the last "Waiting on you" would ride on a finished
    // session forever, and so would its file names.
    if (merged.state !== 'live') {
      if (merged.live_state !== undefined) merged.live_state = null;
      if (merged.live_names !== undefined) merged.live_names = null;
    }
    // The server keeps one row per session and flips `state` when it finalizes, so the id
    // is stable: the same upsert that stored the live snapshot clears the flag.
    const live = merged.state === 'live' ? 1 : 0;
    await d.runAsync(
      `INSERT INTO sessions (id, started_at, json, live) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         started_at = excluded.started_at, json = excluded.json, live = excluded.live`,
      merged.id,
      merged.started_at,
      JSON.stringify(merged),
      live
    );
  });
}

const SYNC_LIST_LIMIT = 50;
const DETAIL_BATCH = 6;
const DETAIL_CAP_PER_SYNC = 30;

/**
 * Pull the notable sessions and fill in the ones we have no detail for.
 *
 * Whatever succeeded is persisted BEFORE an error is rethrown: the caller shows the error
 * as a banner over the saved sessions, and losing a half-finished sync to a dropped
 * connection would make the banner the only thing the user got.
 *
 * Live sessions are pulled on the same pass. The list call asks for notable finals only,
 * so a live session that finalizes as NOT notable would never come back through it — a
 * row that was live last time and is missing from the live list now is re-read by id, so
 * its cached copy flips to final (or is dropped on a 404) instead of pulsing forever.
 */
export function sync(api: Api): Promise<void> {
  // One pass at a time: the root's live surface poll and a focused tab's poll can fire in the
  // same second (FOUND IN INTEGRATION, 2026-09-13: the simulator's first launch fetched every
  // live detail twice). A caller that arrives mid-pass waits for that pass and reads its rows.
  if (!syncing) {
    syncing = runSync(api).finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

let syncing: Promise<void> | null = null;

async function runSync(api: Api): Promise<void> {
  let failure: unknown = null;

  // Which rows were live BEFORE this pass touches anything: a live session that arrives
  // in the finals page below would otherwise be upserted as final first, drop out of
  // `liveIds()`, and never be re-read — keeping its live-era strip, stats and checkpoint
  // analysis forever.
  const wasLive = await liveIds();
  const wasLiveSet = new Set(wasLive);
  const staleLive: string[] = [];

  const page = await api.sessions({ limit: SYNC_LIST_LIMIT, notable_only: true });
  for (const s of page.sessions) {
    await upsert(s, false);
    if (wasLiveSet.has(s.id) && (s.state ?? 'final') === 'final') staleLive.push(s.id);
  }
  // The Sessions list's top, and whether it goes further back (`session/listReach.ts`); and the
  // saved rows in the stretch it covers that it no longer lists as ones you were there for.
  firstPage = { startedAt: page.sessions.map((s) => s.started_at), nextBefore: page.next_before ?? null };
  await pruneCovered({ notableOnly: true, before: null, rows: page.sessions, last: (page.next_before ?? null) === null });
  let liveNow: SessionDetail[] | null = null;
  try {
    liveNow = (await api.liveSessions()).sessions;
  } catch (e) {
    // A server older than the split has no /live; that is not an error worth a banner.
    if (!(e instanceof ApiError && e.status === 404)) failure = e;
  }
  if (liveNow !== null) {
    for (const s of liveNow) {
      const cached = await getDetail(s.id);
      // A live row changes under us; re-read its detail whenever the snapshot moved (or
      // the server does not say, or we never had the detail).
      if (
        !cached ||
        !('strip' in cached) ||
        s.updated_at === undefined ||
        cached.updated_at !== s.updated_at
      ) {
        staleLive.push(s.id);
      }
      await upsert({ ...s, state: s.state ?? 'live' }, false);
    }
    const liveIdSet = new Set(liveNow.map((s) => s.id));
    for (const id of wasLive) {
      if (liveIdSet.has(id)) continue;
      try {
        await upsert(await api.session(id), true);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) await remove(id);
        else if (failure === null) failure = e;
      }
    }
  }

  const needDetail = await guarded('sync.needDetail', [] as string[], async (d) => {
    const rows = await d.getAllAsync<{ id: string; json: string }>(
      'SELECT id, json FROM sessions ORDER BY started_at DESC LIMIT ?',
      SYNC_LIST_LIMIT
    );
    return rows
      .filter((r) => {
        const s = parse(r.json);
        return s !== null && !('strip' in s);
      })
      .map((r) => r.id)
      .slice(0, DETAIL_CAP_PER_SYNC);
  });
  const ids = [...new Set([...staleLive, ...needDetail])];

  for (let i = 0; i < ids.length && failure === null; i += DETAIL_BATCH) {
    const batch = ids.slice(i, i + DETAIL_BATCH);
    const results = await Promise.allSettled(batch.map((id) => api.session(id)));
    for (const r of results) {
      if (r.status === 'fulfilled') await upsert(r.value, true);
      else if (failure === null) failure = r.reason;
    }
  }

  await setKv('last_sync_at', new Date().toISOString());
  if (failure !== null) throw failure;
}

// ----------------------------------------------------------------------- profile

export async function getProfile(): Promise<Profile | null> {
  return guarded('getProfile', null, async (d) => {
    const row = await d.getFirstAsync<{ json: string }>(
      "SELECT json FROM profile WHERE k = 'me'"
    );
    if (!row?.json) return null;
    try {
      return JSON.parse(row.json) as Profile;
    } catch {
      return null;
    }
  });
}

export async function putProfile(p: Profile): Promise<void> {
  await guarded('putProfile', undefined, async (d) => {
    await d.runAsync(
      "INSERT INTO profile (k, json) VALUES ('me', ?) ON CONFLICT(k) DO UPDATE SET json = excluded.json",
      JSON.stringify(p)
    );
  });
}

// ---------------------------------------------------------------------------- kv

export async function setKv(k: string, v: string): Promise<void> {
  await guarded('setKv', undefined, async (d) => {
    await d.runAsync(
      'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      k,
      v
    );
  });
}

export async function getKv(k: string): Promise<string | null> {
  return guarded('getKv', null, async (d) => {
    const row = await d.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k);
    return row?.v ?? null;
  });
}

export async function lastSyncAt(): Promise<string | null> {
  return guarded('lastSyncAt', null, async (d) => {
    const row = await d.getFirstAsync<{ v: string }>("SELECT v FROM kv WHERE k = 'last_sync_at'");
    return row?.v ?? null;
  });
}

/**
 * Keys under this prefix describe the install, not the person signed in to it (the onboarding
 * flag, `src/nav/rules.ts`), and survive `clear()`. Nothing about a person may use it.
 */
export const DEVICE_KEY_PREFIX = 'device.';

// ------------------------------------------------------------------ privacy on the phone

/**
 * Settings > Show details on Lock Screen (DESIGN-DIRECTION 7.2). The Lock Screen and the
 * Dynamic Island are public: anyone near the phone reads them. On, they carry the repository
 * (public repositories only; otherwise "private repo") and the one sentence; off, only
 * "Builda" and how many sessions are running. A property of THIS phone's screen, not of the
 * account, so it is a device key and survives sign out.
 */
export const LOCK_SCREEN_DETAILS_KEY = `${DEVICE_KEY_PREFIX}lock_screen_details`;

/**
 * On unless turned off. UNMEASURED JUDGEMENT CALL, with the reason: every field the Lock
 * Screen can show is safe by construction (docs/overnight-integration.md 2.5: role nouns,
 * counts and minutes, a repository name only when the repository is public), so the switch
 * hides what a person may not want seen, not what may not leave.
 */
export const LOCK_SCREEN_DETAILS_DEFAULT = true;

/** Whether the Lock Screen shows the repository and the sentence. */
export async function getLockScreenDetails(): Promise<boolean> {
  const v = await getKv(LOCK_SCREEN_DETAILS_KEY);
  return v === null ? LOCK_SCREEN_DETAILS_DEFAULT : v === '1';
}

export async function setLockScreenDetails(on: boolean): Promise<void> {
  await setKv(LOCK_SCREEN_DETAILS_KEY, on ? '1' : '0');
}

/**
 * Settings > Live Activities, this phone's too (a device key, so it outlives a sign out). OFF
 * unless turned on (2026-09-19, the owner: a card saying how a run is doing, up all the time, is
 * not what the Dynamic Island is for). Someone who turned it on keeps it; the switch is still in
 * Settings, and a card left up after the app is swiped away stays until the system retires it.
 */
export const LIVE_ACTIVITIES_KEY = `${DEVICE_KEY_PREFIX}live_activities`;
export const LIVE_ACTIVITIES_DEFAULT = false;

export async function getLiveActivities(): Promise<boolean> {
  const v = await getKv(LIVE_ACTIVITIES_KEY);
  return v === null ? LIVE_ACTIVITIES_DEFAULT : v === '1';
}

export async function setLiveActivities(on: boolean): Promise<void> {
  await setKv(LIVE_ACTIVITIES_KEY, on ? '1' : '0');
}

/**
 * Settings > File names went off: the server clears every stored name in the same request,
 * and this clears the phone's copy of them, so turning it off deletes them everywhere they
 * were. Returns how many cached sessions carried names.
 */
export async function forgetLiveNames(): Promise<number> {
  return guarded('forgetLiveNames', 0, async (d) => {
    const rows = await d.getAllAsync<{ id: string; json: string }>('SELECT id, json FROM sessions');
    let n = 0;
    for (const r of rows) {
      const s = parse(r.json);
      if (!s || s.live_names === undefined || s.live_names === null) continue;
      s.live_names = null;
      await d.runAsync('UPDATE sessions SET json = ? WHERE id = ?', JSON.stringify(s), r.id);
      n += 1;
    }
    return n;
  });
}

/** Sign-out: the cached sessions are the user's data, not ours to keep. */
export async function clear(): Promise<void> {
  firstPage = null;
  await guarded('clear', undefined, async (d) => {
    await d.execAsync('DELETE FROM sessions; DELETE FROM profile;');
    await d.runAsync("DELETE FROM kv WHERE substr(k, 1, ?) <> ?", DEVICE_KEY_PREFIX.length, DEVICE_KEY_PREFIX);
  });
}
