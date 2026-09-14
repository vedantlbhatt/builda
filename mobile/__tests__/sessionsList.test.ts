/**
 * The Sessions list reaches every session and says what it holds (`src/session/listReach.ts`).
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2/03-sessions-13): the list kept the 50 rows the
 * sync reads and stopped at Aug 21 with nothing under it, while the server held 81 sessions of that
 * kind and 183 in all. These hold:
 *
 *   1. the reach: a first page, a page further back, the last page, and a fresh first page that
 *      touches the old reach keeping it (coming back from a session page never cuts the list)
 *   2. the end of the list: a count only once the server has said there is nothing older, the
 *      count is the rows shown, the kind of session in words, never a dash
 *   3. the saved rows of each kind, down to the reach, in time order across a clock change
 *   4. the whole walk over an account shaped like the capture's: 81 and 185, both reached
 */
import { Database } from 'bun:sqlite';
import { describe, expect, mock, test } from 'bun:test';

import { extendReach, LIST_MAX, LIST_PAGE, listEnd, mergeReach, reachOfPage, type ListMode, type Reach } from '../src/session/listReach';

mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));
const { FINISHED_SQL } = await import('../src/data/cache');

const NOW = Date.parse('2026-09-14T03:00:00-04:00');
const at = (iso: string) => ({ started_at: iso });
const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/;

describe('how far back the list has read', () => {
  test('a first page with a cursor reaches its oldest row; one without is everything', () => {
    expect(reachOfPage([at('2026-09-13T10:00:00-04:00'), at('2026-08-21T09:00:00-04:00')], '2026-08-21T09:00:00-04:00')).toEqual({ from: '2026-08-21T09:00:00-04:00', more: true });
    expect(reachOfPage([at('2026-09-13T10:00:00-04:00')], null)).toEqual({ from: null, more: false });
    expect(reachOfPage([], undefined)).toEqual({ from: null, more: false });
  });

  test('a page further back moves the reach to its oldest row, and the last page to everything', () => {
    const r: Reach = { from: '2026-08-21T09:00:00-04:00', more: true };
    expect(extendReach(r, [at('2026-08-20T09:00:00-04:00'), at('2026-08-15T09:00:00-04:00')], '2026-08-15T09:00:00-04:00')).toEqual({ from: '2026-08-15T09:00:00-04:00', more: true });
    expect(extendReach(r, [at('2026-08-11T09:00:00-04:00')], null)).toEqual({ from: null, more: false });
  });

  test('a fresh first page that touches the old reach keeps it; one with a gap stands alone', () => {
    const deep: Reach = { from: '2026-08-11T09:00:00-04:00', more: true };
    const top: Reach = { from: '2026-08-22T09:00:00-04:00', more: true };
    // The list showed back to Aug 11 with Sep 13 at the top; the new first page reaches Aug 22.
    expect(mergeReach(deep, top, '2026-09-13T10:00:00-04:00')).toBe(deep);
    // More sessions arrived than a page holds: the new page's oldest is newer than the old top.
    expect(mergeReach(deep, { from: '2026-09-14T01:00:00-04:00', more: true }, '2026-09-13T10:00:00-04:00')).toEqual({ from: '2026-09-14T01:00:00-04:00', more: true });
    // Nothing known before: the page is the reach. The server's first page is all of it: everything.
    expect(mergeReach(null, top, null)).toBe(top);
    expect(mergeReach(deep, { from: null, more: false }, '2026-09-13T10:00:00-04:00')).toEqual({ from: null, more: false });
    // Compared as instants: 01:30 at -05:00 is after 01:10 at -04:00.
    expect(mergeReach(deep, { from: '2026-11-01T01:30:00-05:00', more: true }, '2026-11-01T01:10:00-04:00')).toEqual({ from: '2026-11-01T01:30:00-05:00', more: true });
  });
});

describe('the end of the list', () => {
  const base = { now: NOW, oldest: '2026-08-11T21:00:00-04:00' };

  test('all of them, counted from the rows shown, once the server says there is nothing older', () => {
    const e = listEnd({ ...base, mode: 'notable', shown: 81, reach: { from: null, more: false } })!;
    expect(e.words).toBe('That is all 81 sessions you were there for at least 20 minutes, back to Aug 11.');
    expect(e.note).toContain('count toward your hours');
    expect(e.door).toEqual({ title: 'Show every session', line: 'The shorter ones and the runs without you too', act: 'every' });
    const every = listEnd({ ...base, mode: 'every', shown: 185, reach: { from: null, more: false } })!;
    expect(every.words).toBe('That is every session on your account: 185, back to Aug 11.');
    expect(every.door?.act).toBe('notable');
  });

  test('while the server holds more, it says so and never states a total', () => {
    const e = listEnd({ ...base, oldest: '2026-08-21T21:00:00-04:00', mode: 'notable', shown: 50, reach: { from: '2026-08-21T21:00:00-04:00', more: true } })!;
    expect(e.words).toBe('These are the 50 newest sessions you were there for at least 20 minutes, back to Aug 21. There are older ones.');
    expect(e.door).toEqual({ title: 'Show older sessions', line: null, act: 'older' });
    expect(e.words).not.toContain('all');
  });

  test('saved rows the server has not answered for are said to be saved rows', () => {
    const e = listEnd({ ...base, mode: 'notable', shown: 50, reach: null })!;
    expect(e.words).toBe('These are the 50 newest sessions you were there for at least 20 minutes saved on this phone, back to Aug 11.');
    expect(e.door?.act).toBe('older');
  });

  test('a failed page says so and the door tries again', () => {
    const e = listEnd({ ...base, mode: 'every', shown: 50, reach: { from: base.oldest, more: true }, failed: 'the server did not answer' })!;
    expect(e.note).toBe('Could not read older sessions. The server did not answer.');
    expect(e.door?.title).toBe('Try again');
  });

  test('one session is one, today is not "back to today", no rows is no end, and never a dash', () => {
    expect(listEnd({ ...base, mode: 'notable', shown: 1, reach: { from: null, more: false } })!.words).toBe('That is the one session you were there for at least 20 minutes, back to Aug 11.');
    expect(listEnd({ now: NOW, oldest: '2026-09-14T01:00:00-04:00', mode: 'every', shown: 3, reach: { from: null, more: false } })!.words).toBe('That is every session on your account: 3, all from today.');
    expect(listEnd({ ...base, mode: 'notable', shown: 0, reach: { from: null, more: false } })).toBeNull();
    for (const mode of ['notable', 'every'] as ListMode[]) {
      for (const reach of [null, { from: base.oldest, more: true }, { from: null, more: false }] as (Reach | null)[]) {
        for (const shown of [1, 2, 1234]) {
          const e = listEnd({ ...base, mode, shown, reach, failed: reach?.more ? 'offline' : null })!;
          for (const s of [e.words, e.note ?? '', e.door?.title ?? '', e.door?.line ?? '']) expect(s).not.toMatch(DASHES);
        }
      }
    }
    expect(listEnd({ ...base, mode: 'every', shown: 1234, reach: { from: null, more: false } })!.words).toContain('1,234');
  });
});

// ─── the saved rows ────────────────────────────────────────────────────────────────────────

function db() {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at TEXT, json TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0)');
  return d;
}
function put(d: Database, id: string, startedAt: string, notable: boolean, live = 0) {
  d.query('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)').run(id, startedAt, JSON.stringify({ id, started_at: startedAt, notable }), live);
}
function ids(d: Database, mode: ListMode, from: string | null, limit = LIST_MAX): string[] {
  return (d.query(FINISHED_SQL[mode]).all(from, limit) as { json: string }[]).map((r) => (JSON.parse(r.json) as { id: string }).id);
}

describe('the saved rows of each kind', () => {
  test('finished only, of the kind, at or after the reach, newest first', () => {
    const d = db();
    put(d, 'a', '2026-09-01T10:00:00-04:00', true);
    put(d, 'b', '2026-09-02T10:00:00-04:00', false);
    put(d, 'c', '2026-09-03T10:00:00-04:00', true);
    put(d, 'live', '2026-09-04T10:00:00-04:00', true, 1);
    expect(ids(d, 'notable', null)).toEqual(['c', 'a']);
    expect(ids(d, 'every', null)).toEqual(['c', 'b', 'a']);
    expect(ids(d, 'every', '2026-09-02T10:00:00-04:00')).toEqual(['c', 'b']);
    expect(ids(d, 'notable', null, 1)).toEqual(['c']);
  });

  test('in time order across a clock change, not string order', () => {
    const d = db();
    // 01:10 EDT is 05:10Z; 01:05 EST is 06:05Z, the later of the two though its string is smaller.
    put(d, 'edt', '2026-11-01T01:10:00-04:00', true);
    put(d, 'est', '2026-11-01T01:05:00-05:00', true);
    expect(ids(d, 'notable', null)).toEqual(['est', 'edt']);
    expect(ids(d, 'notable', '2026-11-01T01:30:00-04:00')).toEqual(['est']);
  });
});

describe('the whole walk, over an account shaped like the capture', () => {
  test('81 sessions you were there for and 185 in all are every one reached, a page at a time', () => {
    // 185 sessions four hours apart from Aug 11, 81 of them ones you were there for, as the capture's.
    const server: { id: string; started_at: string; notable: boolean }[] = [];
    let notable = 0;
    for (let i = 0; i < 185; i++) {
      const t = Date.parse('2026-08-11T21:00:00-04:00') + i * 4 * 3_600_000;
      const isNotable = notable < 81 && i % 9 < 4;
      if (isNotable) notable += 1;
      server.push({ id: `s${i}`, started_at: new Date(t).toISOString(), notable: isNotable });
    }
    const topNotable = server.filter((s) => s.notable).length;
    expect(topNotable).toBe(81);
    const newestFirst = [...server].reverse();
    // The route: newest first, `before` exclusive, `next_before` only when the page is full.
    const route = (before: string | null, notableOnly: boolean, limit: number) => {
      const rows = newestFirst.filter((s) => (!notableOnly || s.notable) && (!before || Date.parse(s.started_at) < Date.parse(before))).slice(0, limit);
      return { rows, next_before: rows.length === limit ? rows[rows.length - 1]!.started_at : null };
    };
    for (const mode of ['notable', 'every'] as ListMode[]) {
      const d = db();
      const save = (rows: typeof server) => rows.forEach((s) => put(d, s.id, s.started_at, s.notable));
      const first = route(null, mode === 'notable', LIST_PAGE);
      save(first.rows);
      let reach = reachOfPage(first.rows, first.next_before);
      let pages = 1;
      while (reach.more) {
        const next = route(reach.from, mode === 'notable', LIST_PAGE);
        save(next.rows);
        reach = extendReach(reach, next.rows, next.next_before);
        pages += 1;
        expect(pages).toBeLessThan(10);
      }
      const shown = ids(d, mode, reach.from);
      expect(shown.length).toBe(mode === 'notable' ? 81 : 185);
      expect(shown[shown.length - 1]).toBe(mode === 'notable' ? server.find((s) => s.notable)!.id : 's0');
      const end = listEnd({ mode, shown: shown.length, oldest: server.find((s) => s.id === shown[shown.length - 1])!.started_at, reach, now: NOW })!;
      expect(end.words).toContain(mode === 'notable' ? 'all 81 sessions' : 'on your account: 185');
    }
  });
});
