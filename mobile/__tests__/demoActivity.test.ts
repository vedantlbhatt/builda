/**
 * The demo island on the phone (docs/demo-island.md): the card the phone computes, and the glue
 * that starts, moves and takes down a card.
 *
 *   * `demoState` is held to `spec/fixtures/demos/activity_state.json`, the file the server's
 *     `demo_push.content_state` is held to as well, so a card the server pushes and a card the
 *     phone draws from its own poll are the same card. Its constants are read out of the Python.
 *   * The phase is `demoStepFor`, the rule the in-app island reads, for every status the spec has.
 *   * The glue, with ActivityKit faked: nothing starts before the switches are heard or with the
 *     app away, a start is the request's own row, a card only moves forward, an answer comes down
 *     after the in-app island's beat, taken back comes down at once, and the foreground sweep
 *     ends an answer past its beat and anything past its stale date.
 *   * `trackDemo` hands the row it was asked with to the system island and moves it on each tick,
 *     while the in-app island behaves exactly as before.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DemoState } from '../modules/builder-live/src/BuilderLive.types';
import { SHIPKIT_ENUMS } from '../src/generated/shipkit';
import { DEMO_FOR_MS, DROP_DONE_HOLD_MS, demoStepFor } from '../src/island/model';
import {
  ANSWER_STALE_SECONDS,
  ASKED_STALE_SECONDS,
  DEMO_HOLD_MS,
  DEMO_PHASE_OF_STEP,
  DEMO_RANK,
  DEMO_RELEVANCE,
  FILMING_STALE_SECONDS,
  demoState,
  demosToEnd,
} from '../src/live/demoState';

const ROOT = join(import.meta.dir, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'spec/fixtures/demos/activity_state.json'), 'utf8')) as {
  cases: { name: string; now: number; request: { status: string; refusal: string | null; created_at: string }; expect: DemoState | null }[];
};
const PY = readFileSync(join(ROOT, 'server/builder/demo_push.py'), 'utf8');
/** `NAME = 30 * 60` or `NAME = 55` in demo_push.py, as a number. */
const pyNum = (name: string) => {
  const m = new RegExp(`^${name} = (\\d+)(?: \\* (\\d+))?$`, 'm').exec(PY);
  return m ? Number(m[1]) * Number(m[2] ?? 1) : NaN;
};

describe('the card, held to the file the server is held to', () => {
  for (const c of FIXTURE.cases) {
    test(c.name, () => {
      expect(demoState(c.request, { nowMs: c.now * 1000 })).toEqual(c.expect);
    });
  }

  test('no row is no card', () => {
    expect(demoState(null, { nowMs: 0 })).toBeNull();
    expect(demoState(undefined, { nowMs: 0 })).toBeNull();
  });

  test('the phase is the in-app island\'s step for every status the spec has, renamed, and the server\'s', () => {
    const pyMap = /^PHASE_OF_STATUS = \{([^}]+)\}/m.exec(PY)![1]!;
    for (const status of SHIPKIT_ENUMS.request_status) {
      const step = demoStepFor(status);
      const phase = step === 'clear' ? null : DEMO_PHASE_OF_STEP[step];
      expect(demoState({ status, refusal: null, created_at: '2025-09-13T08:00:00+00:00' }, { nowMs: 0 })?.phase ?? null).toBe(phase);
      if (phase) expect(pyMap).toContain(`"${status}": "${phase}"`);
      else expect(pyMap).not.toContain(`"${status}"`);
    }
  });

  test('the constants are the server\'s', () => {
    expect(ASKED_STALE_SECONDS).toBe(pyNum('ASKED_STALE_SECONDS'));
    expect(ASKED_STALE_SECONDS * 1000).toBe(DEMO_FOR_MS);
    expect(FILMING_STALE_SECONDS).toBe(pyNum('FILMING_STALE_SECONDS'));
    expect(ANSWER_STALE_SECONDS).toBe(pyNum('ANSWER_STALE_SECONDS'));
    expect(DEMO_RELEVANCE).toBe(pyNum('RELEVANCE'));
    const rank = /^RANK = \{([^}]+)\}/m.exec(PY)![1]!;
    for (const [phase, n] of Object.entries(DEMO_RANK)) expect(rank).toContain(`"${phase}": ${n}`);
    // The beat an answered card holds in front of you is the in-app island's for a ready kit.
    expect(DEMO_HOLD_MS).toBe(DROP_DONE_HOLD_MS);
  });

  test('the filming stale date is the worker\'s three ceilings end to end', () => {
    const watch = readFileSync(join(ROOT, 'capture/shipkit/watch.py'), 'utf8');
    const min = (n: string) => Number(new RegExp(`^${n} = (\\d+) \\* 60$`, 'm').exec(watch)![1]) * 60;
    expect(FILMING_STALE_SECONDS).toBe(min('CAPTURE_TIMEOUT') + min('SHIPPED_TIMEOUT') + min('KIT_TIMEOUT'));
  });
});

describe('which cards come down', () => {
  const now = 1_757_750_400_000;
  const card = (requestId: string, phase: string, agoMs: number, state = 'active') => ({ requestId, phase, state, updatedEpoch: (now - agoMs) / 1000 });

  test('an answer past the beat, and anything past its stale date; never an answer in its beat, never one still going', () => {
    expect(
      demosToEnd(
        [
          card('ready-old', 'ready', DEMO_HOLD_MS),
          card('failed-old', 'failed', DEMO_HOLD_MS + 1),
          card('ready-new', 'ready', DEMO_HOLD_MS - 1),
          card('filming-long', 'filming', 3_600_000),
          card('asked-stale', 'asked', 1_900_000, 'stale'),
          card('ended', 'ready', 3_600_000, 'ended'),
        ],
        now
      )
    ).toEqual(['ready-old', 'failed-old', 'asked-stale']);
  });
});

// ------------------------------------------------------------------ the glue, ActivityKit faked

const calls: { fn: string; args: unknown[] }[] = [];
let listed: { requestId: string; projectKey: string; state: string; phase: string; updatedEpoch: number; id: string }[] = [];
let appState = 'active';
let liveCards = new Set<string>();
let requestRows: { id: string; project_key: string; status: string; refusal: string | null; hue: string | null; created_at: string }[] = [];

mock.module('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  AppState: {
    get currentState() {
      return appState;
    },
  },
}));
mock.module('../modules/builder-live', () => ({
  default: {
    startDemo: async (...args: unknown[]) => {
      calls.push({ fn: 'startDemo', args });
      liveCards.add((args[0] as { requestId: string }).requestId);
      return 'card-1';
    },
    updateDemo: async (...args: unknown[]) => {
      calls.push({ fn: 'updateDemo', args });
      return liveCards.has(args[0] as string);
    },
    endDemo: async (...args: unknown[]) => {
      calls.push({ fn: 'endDemo', args });
      liveCards.delete(args[0] as string);
      return true;
    },
    listDemos: () => listed,
    setDemoPush: async (...args: unknown[]) => void calls.push({ fn: 'setDemoPush', args }),
    flushDemoTokens: async () => {
      calls.push({ fn: 'flushDemoTokens', args: [] });
      return {};
    },
  },
}));
// trackDemo's poll, answered from `requestRows`, and nothing else of the API.
mock.module('../src/data/client', () => ({
  api: { demoRequests: async () => ({ requests: requestRows }) },
}));

const glue = await import('../src/live/demoActivity');
const NOW = 1_757_750_400_000;
const KEY = 'ab'.repeat(32);
const row = (status: string, over: Partial<(typeof requestRows)[number]> = {}) => ({
  id: 'r-1',
  project_key: KEY,
  status,
  refusal: null as string | null,
  hue: 'orchid',
  created_at: '2025-09-13T08:00:00+00:00',
  ...over,
});

describe('starting, moving and ending a card', () => {
  beforeEach(() => {
    calls.length = 0;
    listed = [];
    appState = 'active';
    liveCards = new Set();
    glue.resetDemoSurfacesForTests();
  });

  const allow = (push = true) => glue.syncDemoSurfaces({ enabled: true, push, environment: 'sandbox', nowMs: NOW });

  test('nothing starts before a sync has heard the switches, or while the app is not in front', async () => {
    expect(await glue.demoAsked(row('queued'), 'builda', NOW)).toBe(false);
    await allow();
    appState = 'background';
    expect(await glue.demoAsked(row('queued'), 'builda', NOW)).toBe(false);
    expect(calls.filter((c) => c.fn === 'startDemo')).toEqual([]);
  });

  test('switches off: no card, and the server is told to push to none', async () => {
    await glue.syncDemoSurfaces({ enabled: false, push: true, environment: 'production', nowMs: NOW });
    expect(calls).toEqual([{ fn: 'setDemoPush', args: [false, 'production'] }]);
    expect(await glue.demoAsked(row('queued'), 'builda', NOW)).toBe(false);
  });

  test('an ask starts as asked, with the request\'s own ids and hue, the stale date and a push token asked for', async () => {
    await allow();
    expect(await glue.demoAsked(row('queued'), 'builda', NOW)).toBe(true);
    const start = calls.find((c) => c.fn === 'startDemo')!;
    expect(start.args[0]).toEqual({ requestId: 'r-1', projectKey: KEY, title: 'builda', hue: 'orchid' });
    expect(start.args[1]).toEqual({ phase: 'asked', sinceEpoch: 1_757_750_400, failure: null, updatedEpoch: NOW / 1000 });
    expect(start.args[2]).toEqual({ relevance: DEMO_RELEVANCE, staleInSeconds: ASKED_STALE_SECONDS, push: true });
  });

  test('without push (signed out) the card starts with no token asked for', async () => {
    await allow(false);
    await glue.demoAsked(row('queued'), 'builda', NOW);
    expect((calls.find((c) => c.fn === 'startDemo')!.args[2] as { push: boolean }).push).toBe(false);
    expect(calls.some((c) => c.fn === 'flushDemoTokens')).toBe(false);
  });

  test('the poll moves it forward once per phase, never back, each with its stale date', async () => {
    await allow();
    await glue.demoAsked(row('queued'), 'builda', NOW);
    expect((await glue.demoMoved(row('claimed'), NOW + 20_000))?.phase).toBe('filming');
    expect(await glue.demoMoved(row('claimed'), NOW + 40_000)).toBeNull(); // nothing new
    expect(await glue.demoMoved(row('queued'), NOW + 50_000)).toBeNull(); // never back
    const ready = await glue.demoMoved(row('done'), NOW + 60_000);
    expect(ready).toMatchObject({ phase: 'ready', failure: null });
    expect(calls.filter((c) => c.fn === 'updateDemo').map((c) => (c.args[2] as { staleInSeconds: number }).staleInSeconds)).toEqual([
      FILMING_STALE_SECONDS,
      ANSWER_STALE_SECONDS,
    ]);
  });

  test('an answer comes down after the in-app island\'s beat, not before', async () => {
    await allow();
    await glue.demoAsked(row('claimed'), 'builda', NOW);
    await glue.demoMoved(row('failed', { refusal: 'no_checkout' }), NOW);
    expect(calls.some((c) => c.fn === 'endDemo')).toBe(false);
    await new Promise((r) => setTimeout(r, DEMO_HOLD_MS + 50));
    expect(calls.filter((c) => c.fn === 'endDemo').map((c) => c.args)).toEqual([['r-1', null, { dismissAfterSeconds: 0 }]]);
  }, DEMO_HOLD_MS + 2000);

  test('a failure carries the kit screen\'s words', async () => {
    await allow();
    await glue.demoAsked(row('claimed'), 'builda', NOW);
    const failed = await glue.demoMoved(row('failed', { refusal: 'capture_failed' }), NOW);
    expect(failed?.failure).toBe('the Mac could not film it');
  });

  test('taken back: the card comes down at once, found by its project even if this process never started it', async () => {
    await allow();
    await glue.demoAsked(row('queued'), 'builda', NOW);
    listed = [{ id: 'x', requestId: 'r-0', projectKey: KEY, state: 'active', phase: 'ready', updatedEpoch: NOW / 1000 }];
    await glue.demoTakenBack(KEY);
    expect(calls.filter((c) => c.fn === 'endDemo').map((c) => c.args[0]).sort()).toEqual(['r-0', 'r-1']);
    expect(glue.shownDemos().size).toBe(0);
  });

  test('a cancelled row read by the poll ends its card', async () => {
    await allow();
    await glue.demoAsked(row('queued'), 'builda', NOW);
    expect(await glue.demoMoved(row('cancelled'), NOW)).toBeNull();
    expect(calls.filter((c) => c.fn === 'endDemo').map((c) => c.args[0])).toEqual(['r-1']);
  });

  test('swiped away: the poll stops moving it', async () => {
    await allow();
    await glue.demoAsked(row('queued'), 'builda', NOW);
    liveCards.clear();
    expect(await glue.demoMoved(row('claimed'), NOW)).toBeNull();
    expect(glue.shownDemos().has('r-1')).toBe(false);
  });

  test('the foreground sweep ends an answer past its beat and a card past its stale date', async () => {
    listed = [
      { id: 'a', requestId: 'r-ready', projectKey: KEY, state: 'active', phase: 'ready', updatedEpoch: (NOW - DEMO_HOLD_MS) / 1000 },
      { id: 'b', requestId: 'r-stale', projectKey: KEY, state: 'stale', phase: 'filming', updatedEpoch: NOW / 1000 },
      { id: 'c', requestId: 'r-going', projectKey: KEY, state: 'active', phase: 'filming', updatedEpoch: NOW / 1000 },
    ];
    await allow();
    expect(calls.filter((c) => c.fn === 'endDemo').map((c) => c.args[0])).toEqual(['r-ready', 'r-stale']);
    expect(calls.some((c) => c.fn === 'flushDemoTokens')).toBe(true);
  });
});

const { island } = await import('../src/island/store');
const feeds = await import('../src/island/feeds');

describe('trackDemo carries the row to the system island and the in-app island is unchanged', () => {

  beforeEach(() => {
    calls.length = 0;
    listed = [];
    appState = 'active';
    liveCards = new Set();
    glue.resetDemoSurfacesForTests();
    island.reset();
  });

  test('asked: the in-app island posts the demo and the system island starts from the same row', async () => {
    await glue.syncDemoSurfaces({ enabled: true, push: true, environment: 'sandbox', nowMs: NOW });
    requestRows = [row('queued')];
    feeds.trackDemo(KEY, 'builda', row('queued'));
    await new Promise((r) => setTimeout(r, 10));
    const posted = island.snapshot().find((a) => a.kind === 'demo');
    expect(posted).toMatchObject({ kind: 'demo', projectKey: KEY, title: 'builda', filming: false, ready: false });
    expect(calls.filter((c) => c.fn === 'startDemo').length).toBe(1);
    feeds.untrackDemo(KEY);
    await new Promise((r) => setTimeout(r, 10));
    expect(island.snapshot().some((a) => a.kind === 'demo')).toBe(false);
    expect(calls.some((c) => c.fn === 'endDemo' && c.args[0] === 'r-1')).toBe(true);
  });

  test('without a row (an older caller) the in-app island still carries it and no system card starts', async () => {
    await glue.syncDemoSurfaces({ enabled: true, push: true, environment: 'sandbox', nowMs: NOW });
    feeds.trackDemo('cd'.repeat(32), 'other');
    expect(island.snapshot().some((a) => a.kind === 'demo')).toBe(true);
    expect(calls.some((c) => c.fn === 'startDemo')).toBe(false);
    feeds.untrackDemo('cd'.repeat(32));
  });
});
