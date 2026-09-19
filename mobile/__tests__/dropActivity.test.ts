/**
 * The drop island on the phone (docs/drop-island.md): the card the phone computes, the token it
 * lends the share extension, and the glue that starts, moves and takes down a card.
 *
 *   * `dropState` is held to `spec/fixtures/drops/activity_state.json`, the file the server's
 *     `drop_push.content_state` is held to as well, so a card the server pushes and a card the
 *     phone draws from its own poll are the same card. Its constants are read out of the Python.
 *   * The credential mirror copies the ACCESS token and never the refresh token: the rotation
 *     rule means a second refresher signs the phone out, so the extension must not hold one.
 *   * The glue, with ActivityKit faked: nothing starts before the switches are heard, a start
 *     is `sent` with the host the in-app island names, a card only moves forward, and an answered
 *     card past the beat comes down on the next sync.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DropState } from '../modules/builder-live/src/BuilderLive.types';
import { ACCESS_KEY, jwtExpiry, mirroredStorage } from '../src/drops/shareCredential';
import { DROP_DONE_HOLD_MS } from '../src/island/model';
import {
  DROP_HOLD_MS,
  DROP_RANK,
  DROP_RELEVANCE,
  NEEDS_A_REPO,
  READING_STALE_SECONDS,
  dropHost,
  dropState,
  dropsToEnd,
} from '../src/live/dropState';

const ROOT = join(import.meta.dir, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'spec/fixtures/drops/activity_state.json'), 'utf8')) as {
  cases: { name: string; now: number; started_move_id?: string; drop: { status: string; title: string | null; kind: string | null }; moves: { id: string; position: number; status: string; title: string; target: string }[]; expect: DropState | null }[];
  hosts: [string, string][];
};
const PY = readFileSync(join(ROOT, 'server/builder/drop_push.py'), 'utf8');
const pyInt = (name: string) => Number(new RegExp(`^${name} = (\\d+)`, 'm').exec(PY)?.[1]);

describe('the card, held to the file the server is held to', () => {
  for (const c of FIXTURE.cases) {
    test(c.name, () => {
      expect(dropState(c.drop, c.moves, { nowMs: c.now * 1000, startedMoveId: c.started_move_id })).toEqual(c.expect);
    });
  }

  test('the host a card names', () => {
    for (const [url, host] of FIXTURE.hosts) expect(dropHost(url)).toBe(host);
  });

  test('the constants are the server\'s', () => {
    expect(READING_STALE_SECONDS).toBe(pyInt('READING_STALE_SECONDS'));
    expect(DROP_RELEVANCE).toBe(pyInt('RELEVANCE'));
    expect(PY).toContain(`NEEDS_A_REPO = "${NEEDS_A_REPO}"`);
    const rank = /^RANK = \{([^}]+)\}/m.exec(PY)![1]!;
    for (const [phase, n] of Object.entries(DROP_RANK)) expect(rank).toContain(`"${phase}": ${n}`);
    // The beat an answered card holds is the in-app island's, and the Start intent's.
    expect(DROP_HOLD_MS).toBe(DROP_DONE_HOLD_MS);
    const intent = readFileSync(join(ROOT, 'mobile/targets/widget/_shared/DropStartIntent.swift'), 'utf8');
    expect(intent).toContain(`static let holdSeconds: Double = ${DROP_DONE_HOLD_MS / 1000}`);
  });
});

describe('which cards come down', () => {
  const now = 1_757_750_400_000;
  const card = (dropId: string, phase: string, agoMs: number, state = 'active') => ({ dropId, phase, state, updatedEpoch: (now - agoMs) / 1000 });

  test('an answer past the beat, and anything past its stale date; never an answer still in its beat, never one still being read', () => {
    expect(
      dropsToEnd(
        [
          card('planned-old', 'planned', DROP_HOLD_MS),
          card('refused-old', 'refused', DROP_HOLD_MS + 1),
          card('started-old', 'started', 60_000, 'stale'),
          card('planned-new', 'planned', DROP_HOLD_MS - 1),
          card('reading-now', 'reading', 3_600_000),
          card('waiting-stale', 'reading', 700_000, 'stale'),
          card('ended', 'planned', 3_600_000, 'ended'),
        ],
        now
      )
    ).toEqual(['planned-old', 'refused-old', 'started-old', 'waiting-stale']);
  });
});

describe('the credential the extension borrows', () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (claims: object) => `${b64url({ alg: 'EdDSA' })}.${b64url(claims)}.sig`;

  function memory() {
    const m = new Map<string, string>();
    return {
      m,
      storage: {
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string) => void m.set(k, v),
        remove: async (k: string) => void m.delete(k),
      },
    };
  }

  function sink() {
    const calls: (['mirror', string, number, string] | ['clear'])[] = [];
    return {
      calls,
      mirrorCredential: (t: string, e: number, b: string) => {
        calls.push(['mirror', t, e, b]);
        return 0;
      },
      clearCredential: () => void calls.push(['clear']),
    };
  }

  test('the key is api.ts\'s own', () => {
    const api = readFileSync(join(ROOT, 'mobile/src/data/api.ts'), 'utf8');
    expect(api).toContain(`const ACCESS_KEY = '${ACCESS_KEY}';`);
    expect(api).toContain("const REFRESH_KEY = 'builder.refresh';");
  });

  test('exp is read from the token, and anything that is not a JWT with one is null', () => {
    expect(jwtExpiry(jwt({ sub: 'u', exp: 1_757_751_300 }))).toBe(1_757_751_300);
    // A payload whose base64url needs its padding put back and carries the characters - and _.
    expect(jwtExpiry(jwt({ sub: '??>>~~', exp: 42, n: 'ÿÿ' }))).toBe(42);
    expect(jwtExpiry(jwt({ sub: 'u' }))).toBeNull();
    expect(jwtExpiry('opaque-refresh-token')).toBeNull();
    expect(jwtExpiry('a.!!!.c')).toBeNull();
  });

  test('the access token is mirrored on read, write and removal, and the refresh token never is', async () => {
    const { storage, m } = memory();
    const s = sink();
    const store = mirroredStorage(storage, s, 'https://api.example');
    const access = jwt({ exp: 1_757_751_300 });
    await store.set('builder.refresh', 'r-1-secret');
    await store.set(ACCESS_KEY, access);
    await store.get(ACCESS_KEY);
    await store.get('builder.refresh');
    await store.remove('builder.refresh');
    await store.remove(ACCESS_KEY);
    expect(s.calls).toEqual([['mirror', access, 1_757_751_300, 'https://api.example'], ['mirror', access, 1_757_751_300, 'https://api.example'], ['clear']]);
    expect(JSON.stringify(s.calls)).not.toContain('r-1-secret');
    // And the storage itself is untouched by the mirror.
    expect(m.size).toBe(0);
  });

  test('a mirror that fails never fails the storage, and no sink (web, Expo Go) is fine', async () => {
    const { storage, m } = memory();
    const broken = mirroredStorage(storage, { mirrorCredential: () => { throw new Error('keychain'); } }, 'https://api.example');
    await broken.set(ACCESS_KEY, jwt({ exp: 1 }));
    expect(m.get(ACCESS_KEY)).toBeDefined();
    const none = mirroredStorage(storage, null, 'https://api.example');
    expect(await none.get(ACCESS_KEY)).toBe(m.get(ACCESS_KEY) ?? null);
  });

  test('an access token that is not a JWT clears the copy rather than lending it with no expiry', async () => {
    const s = sink();
    await mirroredStorage(memory().storage, s, 'https://api.example').set(ACCESS_KEY, 'not-a-jwt');
    expect(s.calls).toEqual([['clear']]);
  });
});

// ------------------------------------------------------------------ the glue, ActivityKit faked

const calls: { fn: string; args: unknown[] }[] = [];
let listed: { dropId: string; state: string; phase: string; updatedEpoch: number; id: string }[] = [];
let appState = 'active';
let liveCards = new Set<string>();

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
    startDrop: async (...args: unknown[]) => {
      calls.push({ fn: 'startDrop', args });
      liveCards.add((args[0] as { dropId: string }).dropId);
      return 'card-1';
    },
    updateDrop: async (...args: unknown[]) => {
      calls.push({ fn: 'updateDrop', args });
      return liveCards.has(args[0] as string);
    },
    endDrop: async (...args: unknown[]) => {
      calls.push({ fn: 'endDrop', args });
      liveCards.delete(args[0] as string);
      return true;
    },
    listDrops: () => listed,
    setDropPush: async (...args: unknown[]) => void calls.push({ fn: 'setDropPush', args }),
    flushDropTokens: async () => {
      calls.push({ fn: 'flushDropTokens', args: [] });
      return {};
    },
  },
}));

const glue = await import('../src/live/dropActivity');
const REEL = 'https://www.instagram.com/reel/DGxvBNzR8vC';
const NOW = 1_757_750_400_000;

describe('starting, moving and ending a card', () => {
  beforeEach(() => {
    calls.length = 0;
    listed = [];
    appState = 'active';
    liveCards = new Set();
    glue.resetDropSurfacesForTests();
  });

  const allow = (push = true) => glue.syncDropSurfaces({ enabled: true, push, environment: 'sandbox', nowMs: NOW });

  test('nothing starts before a sync has heard the switches, or while the app is not in front', async () => {
    expect(await glue.dropLanded('d-1', REEL, NOW)).toBe(false);
    await allow();
    appState = 'background';
    expect(await glue.dropLanded('d-1', REEL, NOW)).toBe(false);
    expect(calls.filter((c) => c.fn === 'startDrop')).toEqual([]);
  });

  test('switches off: no card, and the server is told to push to none', async () => {
    await glue.syncDropSurfaces({ enabled: false, push: true, environment: 'production', nowMs: NOW });
    expect(calls).toEqual([{ fn: 'setDropPush', args: [false, 'production'] }]);
    expect(await glue.dropLanded('d-1', REEL, NOW)).toBe(false);
  });

  test('a landed drop starts as sent, with the host the in-app island names and a push token asked for', async () => {
    await allow();
    expect(await glue.dropLanded('d-1', REEL, NOW)).toBe(true);
    const start = calls.find((c) => c.fn === 'startDrop')!;
    expect(start.args[0]).toEqual({ dropId: 'd-1', host: 'instagram.com', platform: 'instagram' });
    expect((start.args[1] as DropState).phase).toBe('sent');
    expect(start.args[2]).toEqual({ relevance: DROP_RELEVANCE, staleInSeconds: READING_STALE_SECONDS, push: true });
  });

  test('without push (the debug route, signed out) the card starts with no token asked for', async () => {
    await allow(false);
    await glue.dropLanded('d-1', REEL, NOW);
    expect((calls.find((c) => c.fn === 'startDrop')!.args[2] as { push: boolean }).push).toBe(false);
    expect(calls.some((c) => c.fn === 'flushDropTokens')).toBe(false);
  });

  test('the poll moves it forward once per phase, never back, and an answer has no stale date', async () => {
    await allow();
    await glue.dropLanded('d-1', REEL, NOW);
    const drop = { id: 'd-1', status: 'resolving', title: null, kind: null };
    expect((await glue.dropMoved(drop, [], NOW))?.phase).toBe('reading');
    expect(await glue.dropMoved(drop, [], NOW + 3500)).toBeNull(); // nothing new
    const planned = { ...drop, status: 'planned', title: '5 beginner Claude Skills to install', kind: 'skill' };
    const moves = [{ id: 'm-1', position: 0, status: 'offered', title: 'Go find the 5 skills', target: 'this_machine' }];
    const answer = await glue.dropMoved(planned, moves, NOW + 7000);
    expect(answer).toMatchObject({ phase: 'planned', moves: 1, firstMoveId: 'm-1', kind: 'skill' });
    expect(calls.filter((c) => c.fn === 'updateDrop').map((c) => (c.args[2] as { staleInSeconds?: number }).staleInSeconds)).toEqual([READING_STALE_SECONDS, undefined]);
    // A claim retried after a stale lease reads as resolving again: not a step back.
    expect(await glue.dropMoved(drop, [], NOW + 9000)).toBeNull();
  });

  test('a drop this process never started a card for is not moved', async () => {
    await allow();
    expect(await glue.dropMoved({ id: 'd-9', status: 'resolving', title: null, kind: null }, [], NOW)).toBeNull();
    expect(calls.some((c) => c.fn === 'updateDrop')).toBe(false);
  });

  test('the sync takes down answered cards past the beat, the server moved ones included', async () => {
    listed = [
      { id: 'a', dropId: 'old-answer', state: 'active', phase: 'planned', updatedEpoch: (NOW - DROP_HOLD_MS - 1000) / 1000 },
      { id: 'b', dropId: 'still-reading', state: 'active', phase: 'reading', updatedEpoch: (NOW - 3_600_000) / 1000 },
    ];
    await allow();
    expect(calls.filter((c) => c.fn === 'endDrop').map((c) => c.args[0])).toEqual(['old-answer']);
    expect(calls.find((c) => c.fn === 'endDrop')!.args[2]).toEqual({ dismissAfterSeconds: 0 });
  });
});
