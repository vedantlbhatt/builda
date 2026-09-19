/**
 * The island's trackers and its tour, held to what a review of the overnight code found
 * (2026-09-19): a demo tracked by project alone ran twice after a take back and ask again; an old
 * request flashed up every five minutes; a failed kit read said "not published"; the tour lost or
 * froze what the live feeds said during it; and signing out left pills up for half an hour.
 *
 * A manual clock stands in for time (the trackers tick every 3.5 and 20 seconds), installed before
 * and taken back after this file, because the globals are shared by every file in the process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
let now = 1_790_000_000_000;
type Timer = { id: number; at: number; fn: () => void };
let timers: Timer[] = [];
let nextId = 1;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    now = t.at;
    t.fn();
    await flush();
  }
  now = end;
  await flush();
}

let calls: string[] = [];
let requestRows: unknown[] = [];
let allRows: unknown[] = [];
let kit: unknown = null;
let dropRow: unknown = null;
mock.module('react-native', () => ({
  Platform: { OS: 'ios', select: (o: { ios?: unknown }) => o.ios },
  AppState: { currentState: 'active' },
}));
mock.module('../modules/builder-live', () => ({ default: null }));
mock.module('../src/data/client', () => ({
  api: {
    demoRequests: async (k: string) => {
      calls.push(`demoRequests:${k}`);
      return { requests: requestRows };
    },
    allDemoRequests: async () => ({ requests: allRows }),
    shipKit: async () => {
      calls.push('shipKit');
      if (!kit) throw new Error('offline');
      return kit;
    },
    drop: async (id: string) => {
      calls.push(`drop:${id}`);
      return dropRow;
    },
  },
}));

const { island } = await import('../src/island/store');
const feeds = await import('../src/island/feeds');
const tour = await import('../src/island/demo');

const KEY = 'ab'.repeat(32);
const row = (id: string, status: string, created: number) => ({
  id,
  project_key: KEY,
  status,
  refusal: null,
  hue: null,
  created_at: new Date(created).toISOString(),
  claimed_at: status === 'queued' ? null : new Date(created + 1000).toISOString(),
});
const demoUp = () => island.snapshot().some((a) => a.kind === 'demo');

beforeAll(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = (fn: () => void, ms = 0) => {
    const t = { id: nextId++, at: now + ms, fn };
    timers.push(t);
    return t.id;
  };
  (globalThis as { clearTimeout: unknown }).clearTimeout = (id: number) => {
    timers = timers.filter((t) => t.id !== id);
  };
  Date.now = () => now;
});

afterAll(() => {
  feeds.resetIslandFeeds();
  island.reset();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realNow;
});

beforeEach(() => {
  feeds.resetIslandFeeds();
  timers = [];
  calls = [];
  kit = null;
  island.reset();
  island.setShowsStanding(true);
});

describe('a demo is tracked once per request', () => {
  test('taken back and asked again: one poll chain, not two', async () => {
    requestRows = [row('r1', 'queued', now)];
    feeds.trackDemo(KEY, 'builda', row('r1', 'queued', now) as never);
    await advance(1600);
    feeds.untrackDemo(KEY);
    await advance(1000);
    requestRows = [row('r2', 'queued', now)];
    feeds.trackDemo(KEY, 'builda', row('r2', 'queued', now) as never);
    calls = [];
    await advance(60_000);
    // One chain polls every 20 s: three in a minute.
    expect(calls.filter((c) => c.startsWith('demoRequests')).length).toBe(3);
  });

  test('an old request is not put back up on every resume', async () => {
    allRows = [row('r9', 'queued', now - 45 * 60_000)];
    requestRows = allRows;
    await feeds.resumeDemos(null, now);
    await flush();
    expect(demoUp()).toBe(false);
  });

  test('a failed kit read decides nothing: no "not published", and it asks again', async () => {
    requestRows = [row('r5', 'done', now - 60_000)];
    kit = null;
    feeds.trackDemo(KEY, 'builda');
    await advance(1600);
    expect(island.snapshot().some((a) => a.kind === 'notice')).toBe(false);
    kit = { kit: { published_at: new Date(now).toISOString() } };
    await advance(20_000);
    expect(calls.filter((c) => c === 'shipKit').length).toBe(2);
  });
});

describe('the tour gives back what it borrowed', () => {
  test('what the feeds said during it lands after it, and what was leaving still leaves', async () => {
    dropRow = { drop: { id: 'd1', status: 'waiting', title: null, thumbnail_url: null, kind: null }, moves: [] };
    feeds.trackDrop('d1', 'https://www.tiktok.com/@x/video/1');
    feeds.notice('Link copied', 'done', 'cat', '#ffffff');
    tour.playIslandTour();
    dropRow = { drop: { id: 'd1', status: 'planned', title: 'T', thumbnail_url: null, kind: null }, moves: [] };
    await advance(40_000);
    const ids = island.snapshot().map((a) => `${a.id}${'phase' in a ? `:${a.phase}` : ''}`);
    // The Mac's answer during the tour is what shows, not the "sent" saved before it.
    expect(ids).toContain('drop:d1:planned');
    await advance(10 * 60_000);
    // And nothing is left up without a timer: the planned drop and the notice both left.
    expect(island.snapshot().filter((a) => a.kind === 'drop' || a.kind === 'notice')).toEqual([]);
  });

  test('a tour does not change what this device can show', () => {
    island.setShowsStanding(false);
    tour.playIslandTour(['crew']);
    tour.stopIslandDemo();
    island.replaceKind('crew', [{ kind: 'crew', id: 'crew', members: [] }]);
    expect(island.visible().map((a) => a.kind)).toEqual([]);
  });
});

describe('signing out', () => {
  test('every tracker stops and the island is cleared', async () => {
    requestRows = [row('r6', 'queued', now)];
    feeds.trackDemo(KEY, 'builda', row('r6', 'queued', now) as never);
    dropRow = { drop: { id: 'd2', status: 'waiting', title: null, thumbnail_url: null, kind: null }, moves: [] };
    feeds.trackDrop('d2', 'https://www.tiktok.com/@x/video/2');
    await advance(1600);
    feeds.resetIslandFeeds();
    expect(island.snapshot()).toEqual([]);
    calls = [];
    await advance(5 * 60_000);
    expect(calls).toEqual([]);
    expect(island.snapshot()).toEqual([]);
  });
});
