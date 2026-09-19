/**
 * The two cards Builda makes by itself (`share/weekOffer.ts`, `share/milestoneOffer.ts`), the glue
 * around their pure rules: what is read and remembered in the kv table, what goes on the island,
 * and that a tap opens the card. The cache, the API and the two card modules are faked; the rules
 * (`session/week.ts`, `share/milestones.ts`) and the island store are the real ones.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Profile } from '../src/data/api';

const kv = new Map<string, string>();
let profileCalls = 0;
let graph: { date: string; active_seconds: number }[] = [];
const opened: string[] = [];

mock.module('../src/data/cache', () => ({
  getKv: async (k: string) => kv.get(k) ?? null,
  setKv: async (k: string, v: string) => {
    kv.set(k, v);
  },
  putProfile: async () => undefined,
  listSessions: async () => [],
}));
mock.module('../src/data/client', () => ({
  api: {
    profile: async () => {
      profileCalls += 1;
      return { graph, totals: { sessions: 0, active_seconds: 0 }, projects: [] };
    },
  },
}));
import { fakeNotifications } from './fakeNotifications';
mock.module('../src/share/WeekShare', () => ({ showWeekShare: () => opened.push('week') }));
mock.module('../src/share/MilestoneShare', () => ({ showMilestoneShare: (h: number) => opened.push(`milestone ${h}`) }));

// Dynamic, after the mocks, so the modules see them.
const { markWeekOffered, offerLastWeek } = await import('../src/share/weekOffer');
const { offerMilestone } = await import('../src/share/milestoneOffer');
const { island } = await import('../src/island/store');
const { WEEK_OFFERED_KEY } = await import('../src/session/week');
const { MILESTONE_KEY } = await import('../src/share/milestones');

type Notice = { kind: 'notice'; id: string; text: string; action?: () => void };
/** What the offers put on the island: the real store, read, never patched (it is shared by every test file). */
let posted: Notice[] = [];
const unsubscribe = island.subscribe(() => {
  for (const a of island.snapshot()) if (a.kind === 'notice' && !posted.some((p) => p.id === a.id)) posted.push(a as Notice);
});
afterAll(() => {
  unsubscribe();
  island.reset();
});

const H = 3600;
const profile = (hours: number): Profile =>
  ({ graph: [], totals: { sessions: 132, active_seconds: hours * H }, projects: [{ key: 'k', name: null, sessions: 1, active_seconds: 1, first_at: '2026-08-12T10:00:00Z', last_at: '2026-09-12T10:00:00Z' }] }) as unknown as Profile;

beforeEach(() => {
  fakeNotifications.reset();
  island.reset();
  kv.clear();
  posted = [];
  opened.length = 0;
  profileCalls = 0;
});

describe('last week, offered once', () => {
  // Each case its own Monday: the module remembers the Monday it checked for the life of the app,
  // and a case that reused one would pass on that memory instead of the kv row it is about.
  const MON_21 = new Date(2026, 8, 21, 10).getTime(); // last week: the 14th to the 20th
  const MON_28 = new Date(2026, 8, 28, 10).getTime(); // last week: the 21st to the 27th

  test('already offered for this week (the kv row): nothing posted, nothing fetched', async () => {
    graph = [{ date: '2026-09-16', active_seconds: 5 * H }];
    kv.set(WEEK_OFFERED_KEY, '2026-09-14');
    expect(await offerLastWeek('cat', MON_21)).toBe(false);
    expect(posted).toHaveLength(0);
    expect(profileCalls).toBe(0);
  });

  test('Monday with hours last week: one notice, the Monday remembered, a tap opens the card', async () => {
    graph = [{ date: '2026-09-23', active_seconds: 5 * H }];
    expect(await offerLastWeek('cat', MON_28)).toBe(true);
    expect(profileCalls).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toBe("Last week's card is made: 5 hours. Tap to see it.");
    expect(kv.get(WEEK_OFFERED_KEY)).toBe('2026-09-21');
    posted[0]!.action?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['week']);
  });

  test('the next pass of the same Monday asks nothing and says nothing', async () => {
    expect(await offerLastWeek('cat', MON_28 + 60_000)).toBe(false);
    expect(posted).toHaveLength(0);
    expect(profileCalls).toBe(0);
  });

  test("Monday's notification already delivered: the island stays quiet and the week is marked", async () => {
    const MON_OCT_5 = new Date(2026, 9, 5, 10).getTime(); // last week: Sep 28 to Oct 4
    graph = [{ date: '2026-09-30', active_seconds: 3 * H }];
    fakeNotifications.presented.push('week-card');
    expect(await offerLastWeek('cat', MON_OCT_5)).toBe(false);
    expect(posted).toHaveLength(0);
    expect(kv.get(WEEK_OFFERED_KEY)).toBe('2026-09-28');
  });
});

describe('said where it will be seen, and only once', () => {
  const MON_OCT_12 = new Date(2026, 9, 12, 10).getTime(); // last week: Oct 5 to Oct 11
  const MON_OCT_19 = new Date(2026, 9, 19, 10).getTime(); // last week: Oct 12 to Oct 18
  const MON_OCT_26 = new Date(2026, 9, 26, 10).getTime(); // last week: Oct 19 to Oct 25
  const waiting = { kind: 'needsYou' as const, id: 'wait:a', sessionId: 'a', repo: 'a', animal: 'cat' as const, ink: '#000000', sentence: 'asks', sinceMs: 0 };

  test('a run waiting on you outranks the notice: nothing marked, and it is said once the island is free', async () => {
    graph = [{ date: '2026-10-07', active_seconds: 2 * H }];
    island.post(waiting);
    expect(await offerLastWeek('cat', MON_OCT_12)).toBe(false);
    expect(kv.get(WEEK_OFFERED_KEY)).toBeUndefined();
    island.clear('wait:a');
    const calls = profileCalls;
    expect(await offerLastWeek('cat', MON_OCT_12 + 60_000)).toBe(true);
    expect(profileCalls).toBe(calls);
    expect(posted.map((p) => p.text)).toEqual(["Last week's card is made: 2 hours. Tap to see it."]);
    expect(kv.get(WEEK_OFFERED_KEY)).toBe('2026-10-05');
  });

  test("a tap on Monday's notification counts at once: a pass running beside it says nothing", async () => {
    graph = [{ date: '2026-10-14', active_seconds: 2 * H }];
    markWeekOffered('2026-10-12');
    expect(await offerLastWeek('cat', MON_OCT_19)).toBe(false);
    expect(posted).toHaveLength(0);
    expect(profileCalls).toBe(0);
  });

  test('two passes at the same moment say it once', async () => {
    graph = [{ date: '2026-10-21', active_seconds: 2 * H }];
    const both = await Promise.all([offerLastWeek('cat', MON_OCT_26), offerLastWeek('cat', MON_OCT_26)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });
});

describe('an hours milestone, offered once', () => {
  test('the first reading only remembers what is behind them', async () => {
    expect(await offerMilestone(profile(300), 'cat')).toBe(false);
    expect(kv.get(MILESTONE_KEY)).toBe('250');
    expect(posted).toHaveLength(0);
  });

  test('a milestone crossed after that: the notice, the new value remembered, a tap opens its card', async () => {
    kv.set(MILESTONE_KEY, '50');
    expect(await offerMilestone(profile(101), 'cat')).toBe(true);
    expect(kv.get(MILESTONE_KEY)).toBe('100');
    expect(posted[0]!.text).toBe('100 hours of building. Your card is made. Tap to see it.');
    posted[0]!.action?.();
    expect(opened).toEqual(['milestone 100']);
    posted = [];
    expect(await offerMilestone(profile(102), 'cat')).toBe(false);
    expect(posted).toHaveLength(0);
  });

  test('under a run waiting on you it waits, unmarked, and is said on a later pass', async () => {
    kv.set(MILESTONE_KEY, '100');
    island.post({ kind: 'needsYou', id: 'wait:b', sessionId: 'b', repo: 'b', animal: 'cat', ink: '#000000', sentence: 'asks', sinceMs: 0 });
    expect(await offerMilestone(profile(251), 'cat')).toBe(false);
    expect(kv.get(MILESTONE_KEY)).toBe('100');
    island.clear('wait:b');
    expect(await offerMilestone(profile(251), 'cat')).toBe(true);
    expect(kv.get(MILESTONE_KEY)).toBe('250');
  });

  test('no profile, no reading', async () => {
    expect(await offerMilestone(null, 'cat')).toBe(false);
    expect(kv.size).toBe(0);
  });
});
