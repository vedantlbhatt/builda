/**
 * The live surfaces' rules: what the Lock Screen, the Dynamic Island and the Home Screen widget
 * say, and when. Every rule here fails as a plausible wrong surface rather than a crash (a card
 * that says "working" about a session that finished, an alert for news nobody watched happen,
 * a "0 commits" that was never counted), so each one is pinned.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionDetail } from '../src/data/api';
import { debugSessions, DEBUG_STATES, parseDebugLive } from '../src/live/fixtures';
import { livePresenceLine } from '../src/live/format';
import { DASH, hasDash, ordinal, renderLiveSentence, spoken, type LiveStateWire } from '../src/live/sentence';
import {
  buildWidgetSnapshot,
  clampSentence,
  contentKey,
  DISMISS_AFTER_SECONDS,
  MAX_ACTIVITIES,
  missionOrder,
  normalizeCreature,
  payloadBytes,
  PAYLOAD_LIMIT_BYTES,
  phaseOf,
  planSync,
  RELEVANCE_NEEDS_YOU,
  SENTENCE_MAX,
  STALE_SECONDS,
  toAttrs,
  toState,
  weekFromGraph,
  type SyncAction,
  type Tracked,
} from '../src/live/surface';
import { ANIMALS } from '../src/pixel/animals';
import { finishedNotification, needsYouNotification } from '../src/push/localCopy';
import { routeForNotification } from '../src/push/route';

const ROOT = join(import.meta.dir, '..');
const NOW = Date.parse('2026-09-13T09:41:00Z');
const MIN = 60_000;

// ------------------------------------------------------------------ helpers

function row(id: string, over: Partial<SessionDetail> = {}, statsOver: Record<string, unknown> = {}): SessionDetail {
  return {
    id,
    client_session_id: `${id}-c`,
    harness: 'claude_code',
    repo_name: 'builder',
    started_at: new Date(NOW - 22 * MIN).toISOString(),
    ended_at: new Date(NOW - 10_000).toISOString(),
    updated_at: new Date(NOW - 10_000).toISOString(),
    active_seconds: 22 * 60,
    idle_seconds: 0,
    local_date: '2026-09-13',
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'live',
    attended_seconds: 22 * 60,
    autonomous_seconds: 0,
    stats: {
      tokens_reported: true,
      tok_in: null,
      tok_out: null,
      tok_cache_read: null,
      tok_cache_w5m: null,
      tok_cache_w1h: null,
      models: null,
      model_state: 'known',
      human_prompt_count: 9,
      prompt_count_basis: 'typed',
      files_touched: 14,
      lines_added_agent: 420,
      commit_count: 3,
      agent_line_bucket: 'some',
      attrib_confidence: 'high',
      ...statsOver,
    },
    ...over,
  };
}

const working = (over: Partial<LiveStateWire> = {}): LiveStateWire => ({
  activity: { kind: 'editing', role: 'source', attempt: 3, since_s: 90, files: 1, calls: 3, file_id: 'f1' },
  verdict: { state: 'converging', evidence: {}, basis: 'error_rate_down_and_new_files', reason: null },
  eta: { elapsed_s: 720, typical_s: 1254, remaining_s: 534, reason: null },
  needs_you: { score: 5, reason: 'running_fine' },
  ...over,
});

const waiting = (sinceS = 240): LiveStateWire => ({
  activity: { kind: 'waiting_on_you', role: 'unknown', since_s: sinceS },
  verdict: { state: 'waiting', evidence: {}, basis: 'turn_ended', reason: null },
  eta: { elapsed_s: null, typical_s: null, remaining_s: null, reason: '5 finished sessions on this repository, 10 needed' },
  needs_you: { score: 84, reason: 'waiting_for_input' },
});

function kinds(actions: SyncAction[]): string[] {
  return actions.map((a) => `${a.kind}:${a.sessionId}${a.kind === 'notify' ? `:${a.which}` : ''}`);
}

/** Run a plan and pretend every start succeeded with a predictable id, as activity.ts does. */
function apply(plan: ReturnType<typeof planSync>): Map<string, Tracked> {
  const next = new Map(plan.tracked);
  for (const a of plan.actions) {
    if (a.kind === 'start') next.set(a.sessionId, { ...next.get(a.sessionId)!, activityId: `act-${a.sessionId}` });
  }
  return next;
}

// ------------------------------------------------------------------ the engine's sentence

describe('renderLiveSentence: the engine\'s words, from ids and numbers', () => {
  test('spoken and ordinal follow plain.py', () => {
    expect([0, 1, 6, 20, 21, 34].map(spoken)).toEqual(['zero', 'one', 'six', 'twenty', '21', '34']);
    expect([1, 3, 10, 11, 12, 13, 21, 22, 23, 111, 112].map(ordinal)).toEqual([
      'first', 'third', 'tenth', '11th', '12th', '13th', '21st', '22nd', '23rd', '111th', '112th',
    ]);
  });

  const cases: [string, LiveStateWire, string][] = [
    ['circling on a failing command', { verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 372 } } }, 'Stuck on the same failing command for six minutes'],
    ['circling, under a minute', { verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 30 } } }, 'Stuck on the same failing command'],
    ['circling, one minute', { verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 61 } } }, 'Stuck on the same failing command for one minute'],
    [
      'circling on churn, role from the map',
      { verdict: { state: 'circling', basis: 'causes:file_churn_with_failures', evidence: { churn_writes: 4 }, file_id: 'x' }, map: { files: [{ id: 'x', role: 'source' }] } },
      'Going back and forth on a source file, fourth pass',
    ],
    ['circling on churn, unmapped file', { verdict: { state: 'circling', basis: 'causes:file_churn_with_failures', evidence: { churn_writes: 2 }, file_id: 'y' } }, 'Going back and forth on a file, second pass'],
    ['circling on a repeat', { verdict: { state: 'circling', basis: 'causes:repeated_call', evidence: { repeats: 3 } } }, 'Running the same step over and over, three times'],
    ['lost', { verdict: { state: 'lost', basis: 'edits_to_unread_files', evidence: { blind_edits: 3 } } }, 'Editing three files it has not read yet'],
    ['done with files', { verdict: { state: 'done', evidence: { files_changed: 12, commits: 1 } } }, 'Finished, with twelve files changed'],
    ['done with one file', { verdict: { state: 'done', evidence: { files_changed: 1 } } }, 'Finished, with one file changed'],
    ['done with only a commit', { verdict: { state: 'done', evidence: { files_changed: 0, commits: 2 } } }, 'Finished, with a commit'],
    ['done with nothing counted', { verdict: { state: 'done', evidence: {} } }, 'Finished'],
    ['no activity', {}, 'Nothing has happened yet'],
    ['waiting four minutes', waiting(240), 'Waiting on you for four minutes'],
    ['waiting under a minute', waiting(30), 'Waiting on you'],
    ['idle', { activity: { kind: 'idle', since_s: 360 } }, 'No new output for six minutes'],
    ['thinking', { activity: { kind: 'thinking', since_s: 20 } }, 'Thinking about the next step'],
    ['reading three docs', { activity: { kind: 'reading', role: 'docs', files: 3 } }, 'Reading the docs'],
    ['reading two tests', { activity: { kind: 'reading', role: 'test', files: 2 } }, 'Reading two test files'],
    ['reading one', { activity: { kind: 'reading', role: 'source', files: 1 } }, 'Reading a source file'],
    ['rewriting', { activity: { kind: 'editing', role: 'source', attempt: 3, files: 1 } }, 'Rewriting a source file, third attempt'],
    ['editing two', { activity: { kind: 'editing', role: 'config', attempt: 1, files: 2 } }, 'Editing two config files'],
    ['testing', { activity: { kind: 'testing', role: 'test' } }, 'Running your test suite'],
    ['running', { activity: { kind: 'running' } }, 'Running a command'],
    ['searching', { activity: { kind: 'searching' } }, 'Searching the codebase'],
    ['delegating to four', { activity: { kind: 'delegating', calls: 4 } }, 'Handing work to four helper agents'],
    ['delegating to one', { activity: { kind: 'delegating', calls: 1 } }, 'Handing work to one helper agent'],
    ['a kind this build does not know', { activity: { kind: 'teleporting' } }, 'Running a command'],
    ['an unknown role is a file', { activity: { kind: 'editing', role: 'hologram', files: 1 } }, 'Editing a file'],
  ];
  for (const [name, state, want] of cases) {
    test(name, () => {
      expect(renderLiveSentence(state)).toBe(want);
      expect(hasDash(want)).toBe(false);
    });
  }

  test('the dash rule is plain.py\'s: em, en, and a spaced hyphen; a hyphen in a word is fine', () => {
    expect(hasDash('one \u2014 two')).toBe(true);
    expect(hasDash('9\u201310')).toBe(true);
    expect(hasDash('this - that')).toBe(true);
    expect(hasDash('cursor-agent')).toBe(false);
    expect(hasDash('\u221288 lines')).toBe(false);
  });
});

// ------------------------------------------------------------------ one session to ContentState

describe('toState: a SessionDetail and the engine\'s live_state become one ContentState', () => {
  const ctx = { nowMs: NOW, creature: 'owl', runningCount: 2 };

  test('a converging run with an ETA the engine stands behind', () => {
    const s = row('a');
    const st = toState(s, working(), ctx);
    expect(st.phase).toBe('working');
    expect(st.trajectory).toBe('converging');
    expect(st.sentence).toBe('Rewriting a source file, third attempt');
    expect(st.progress).toBeCloseTo(720 / 1254, 3);
    // anchored on updated_at, rounded to the minute
    const want = Math.round((Date.parse(s.updated_at!) / 1000 + 534) / 60) * 60;
    expect(st.etaEpoch).toBe(want);
    expect(st.creature).toBe('owl');
    expect(st.runningCount).toBe(2);
    expect(st.updatedEpoch).toBe(NOW / 1000);
  });

  test('a refused ETA is a dotted ring and "no ETA yet", never a guessed number', () => {
    const st = toState(row('a'), { ...working(), eta: waiting().eta }, ctx);
    expect(st.progress).toBe(-1);
    expect(st.etaEpoch).toBeNull();
  });

  test('no verdict yet is trajectory none, so the caption drops it', () => {
    expect(toState(row('a'), { ...working(), verdict: { state: 'starting', evidence: {} } }, ctx).trajectory).toBe('none');
    expect(toState(row('a'), { ...working(), verdict: { state: null, evidence: {} } }, ctx).trajectory).toBe('none');
  });

  test('the engine decides the phase when it spoke', () => {
    expect(phaseOf(row('a'), waiting(), NOW)).toBe('needsYou');
    expect(phaseOf(row('a'), { activity: { kind: 'idle', since_s: 400 } }, NOW)).toBe('stalled');
    expect(phaseOf(row('a'), { verdict: { state: 'done', evidence: {} }, activity: { kind: 'waiting_on_you' } }, NOW)).toBe('needsYou');
    expect(phaseOf(row('a'), { verdict: { state: 'done', evidence: {} } }, NOW)).toBe('done');
    expect(phaseOf(row('a', { state: 'final' }), working(), NOW)).toBe('done');
  });

  test('without the engine: presence line while fresh, the idle rule once quiet, the done rule when final', () => {
    const fresh = row('a');
    expect(toState(fresh, null, ctx).sentence).toBe(livePresenceLine(fresh));
    expect(toState(fresh, null, ctx).phase).toBe('working');
    const quiet = row('b', { ended_at: new Date(NOW - (STALE_SECONDS + 5 * 60) * 1000).toISOString() });
    expect(toState(quiet, null, ctx).phase).toBe('stalled');
    expect(toState(quiet, null, ctx).sentence).toBe('No new output for twenty minutes');
    const final = row('c', { state: 'final' });
    expect(toState(final, null, ctx).sentence).toBe('Finished, with fourteen files changed');
    expect(toState(final, null, ctx).etaEpoch).toBeNull();
  });

  test('nothing without the engine can say needs you', () => {
    expect(phaseOf(row('a', { autonomous_seconds: 9000 }), null, NOW)).not.toBe('needsYou');
  });

  test('absent is not zero: uncounted files are -1 and uncounted lines and commits are null', () => {
    const s = row('a', {}, { files_touched: undefined, commit_count: undefined, lines_added_agent: undefined });
    const st = toState(s, null, ctx);
    expect(st.filesTouched).toBe(-1);
    expect(st.linesAdded).toBeNull();
    expect(st.commits).toBeNull();
    // the server omits lines_removed_agent today (PROGRESS.md backlog): null, not 0
    expect(toState(row('b'), null, ctx).linesRemoved).toBeNull();
    expect(toState(row('c', {}, { lines_removed_agent: 88 }), null, ctx).linesRemoved).toBe(88);
  });

  test('creatures: the pack and Bit, and Bit for anything else', () => {
    for (const a of ANIMALS) expect(normalizeCreature(a)).toBe(a);
    expect(normalizeCreature('bit')).toBe('bit');
    expect(normalizeCreature('dragon')).toBe('bit');
    expect(normalizeCreature(null)).toBe('bit');
  });

  test('a private repo says so, and a long name is cut', () => {
    expect(toAttrs(row('a', { repo_name: null })).repo).toBe('private repo');
    expect(toAttrs(row('a', { repo_name: 'x'.repeat(200) })).repo.length).toBe(60);
    expect(toAttrs(row('a')).startedEpoch).toBe((NOW - 22 * MIN) / 1000);
  });

  test('a sentence is cut under 90 characters, at a word, with no dash', () => {
    const long = 'Rewriting the burn report so it names the dominant cause, and then the explain sentence that reads it back';
    const cut = clampSentence(long);
    expect(cut.length).toBeLessThanOrEqual(SENTENCE_MAX);
    expect(cut.endsWith('\u2026')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(hasDash(cut)).toBe(false);
    expect(clampSentence('Short and whole')).toBe('Short and whole');
  });
});

describe('the 4 KB budget ActivityKit enforces', () => {
  test('the worst case attributes and state are well under it', () => {
    const s = row('i'.repeat(128), { repo_name: 'r'.repeat(300), harness: 'h'.repeat(40) }, {
      files_touched: 99_999, lines_added_agent: 9_999_999, lines_removed_agent: 9_999_999, commit_count: 9_999,
    });
    const live = working({ activity: { kind: 'editing', role: 'dependency', attempt: 999, files: 1 } });
    const st = toState(s, live, { nowMs: NOW, creature: 'octopus', runningCount: 99 });
    st.sentence = 'w'.repeat(SENTENCE_MAX);
    expect(payloadBytes(toAttrs(s), st)).toBeLessThan(1024);
    expect(PAYLOAD_LIMIT_BYTES).toBe(4096);
  });

  test('every debug session fits', () => {
    for (const state of DEBUG_STATES) {
      const d = debugSessions(state, 4, NOW);
      for (const s of [...d.sessions, ...d.finished]) {
        const st = toState(s, d.liveStates[s.id], { nowMs: NOW, runningCount: 3 });
        expect(payloadBytes(toAttrs(s), st)).toBeLessThan(PAYLOAD_LIMIT_BYTES / 4);
      }
    }
  });
});

// ------------------------------------------------------------------ the plan

describe('planSync: start, update, end, alert, and never both', () => {
  const base = { liveStates: {}, activitiesEnabled: true, creature: 'crab' as const, nowMs: NOW };

  test('a first sighting starts an activity and never alerts, not even in needs you', () => {
    const plan = planSync({ ...base, sessions: [row('a'), row('b')], liveStates: { a: working(), b: waiting() }, tracked: new Map() });
    expect(kinds(plan.actions).sort()).toEqual(['start:a', 'start:b']);
    for (const a of plan.actions) expect('alertTitle' in (a as { opts: object }).opts).toBe(false);
    const b = plan.actions.find((a) => a.sessionId === 'b') as Extract<SyncAction, { kind: 'start' }>;
    expect(b.opts.relevance).toBe(RELEVANCE_NEEDS_YOU);
    expect(b.opts.staleInSeconds).toBe(STALE_SECONDS);
  });

  test('the same content again sends nothing', () => {
    const input = { ...base, sessions: [row('a')], liveStates: { a: working() } };
    const tracked = apply(planSync({ ...input, tracked: new Map() }));
    expect(planSync({ ...input, tracked }).actions).toEqual([]);
    // updatedEpoch moves every tick and is not content
    expect(planSync({ ...input, nowMs: NOW + 20_000, tracked }).actions).toEqual([]);
  });

  test('the next minute updates once, because "22m" is drawn', () => {
    const input = { ...base, sessions: [row('a')], liveStates: { a: working() } };
    const tracked = apply(planSync({ ...input, tracked: new Map() }));
    const next = planSync({ ...input, nowMs: NOW + 60_000, tracked });
    expect(kinds(next.actions)).toEqual(['update:a']);
    expect('alertTitle' in (next.actions[0] as { opts: object }).opts).toBe(false);
  });

  test('a new sentence updates', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const next = planSync({ ...base, sessions: [row('a')], liveStates: { a: working({ activity: { kind: 'testing', role: 'test' } }) }, tracked });
    expect(kinds(next.actions)).toEqual(['update:a']);
    expect((next.actions[0] as Extract<SyncAction, { kind: 'update' }>).state.sentence).toBe('Running your test suite');
  });

  test('the move INTO needs you alerts, with relevance 100, and staying there does not', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const into = planSync({ ...base, sessions: [row('a')], liveStates: { a: waiting(240) }, tracked });
    expect(kinds(into.actions)).toEqual(['update:a']);
    const u = into.actions[0] as Extract<SyncAction, { kind: 'update' }>;
    expect(u.opts.alertTitle).toBe('builder needs you');
    expect(u.opts.alertBody).toBe('Waiting on you for four minutes');
    expect(u.opts.relevance).toBe(RELEVANCE_NEEDS_YOU);
    const stay = planSync({ ...base, sessions: [row('a')], liveStates: { a: waiting(360) }, tracked: into.tracked });
    expect(kinds(stay.actions)).toEqual(['update:a']);
    expect((stay.actions[0] as Extract<SyncAction, { kind: 'update' }>).opts.alertTitle).toBeUndefined();
  });

  test('an activity found at launch is a first sighting: no alert', () => {
    const seeded = new Map<string, Tracked>([['a', { sessionId: 'a', activityId: 'act-a', phase: 'working', key: '', state: null, attrs: null }]]);
    const plan = planSync({ ...base, sessions: [row('a')], liveStates: { a: waiting() }, tracked: seeded });
    expect(kinds(plan.actions)).toEqual(['update:a']);
    expect((plan.actions[0] as Extract<SyncAction, { kind: 'update' }>).opts.alertTitle).toBeUndefined();
  });

  test('finishing ends the activity with the finished card and a 20 minute dismissal, and posts nothing', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const final = row('a', { state: 'final' }, { lines_removed_agent: 88 });
    const plan = planSync({ ...base, sessions: [], finished: [final], tracked });
    expect(kinds(plan.actions)).toEqual(['end:a']);
    const e = plan.actions[0] as Extract<SyncAction, { kind: 'end' }>;
    expect(e.opts.dismissAfterSeconds).toBe(DISMISS_AFTER_SECONDS);
    expect(DISMISS_AFTER_SECONDS).toBeGreaterThanOrEqual(15 * 60);
    expect(DISMISS_AFTER_SECONDS).toBeLessThanOrEqual(30 * 60);
    expect(e.state?.phase).toBe('done');
    expect(e.state?.linesAdded).toBe(420);
    expect(e.state?.linesRemoved).toBe(88);
    expect(e.state?.commits).toBe(3);
    expect(e.state?.sentence).toBe('Finished, with fourteen files changed');
    expect(plan.tracked.has('a')).toBe(false);
  });

  test('a session gone from the live list finished: its card ends as finished, from what it last showed', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const plan = planSync({ ...base, sessions: [], tracked });
    expect(kinds(plan.actions)).toEqual(['end:a']);
    const e = plan.actions[0] as Extract<SyncAction, { kind: 'end' }>;
    expect(e.state?.phase).toBe('done');
    expect(e.state?.sentence).toBe('Finished, with fourteen files changed');
    expect(e.opts.dismissAfterSeconds).toBe(DISMISS_AFTER_SECONDS);
  });

  test('an activity from before launch with nothing known about it is removed, not left claiming to run', () => {
    const seeded = new Map<string, Tracked>([['z', { sessionId: 'z', activityId: 'act-z', phase: 'working', key: '', state: null, attrs: null }]]);
    const plan = planSync({ ...base, sessions: [], tracked: seeded });
    expect(kinds(plan.actions)).toEqual(['end:z']);
    expect((plan.actions[0] as Extract<SyncAction, { kind: 'end' }>).opts.dismissAfterSeconds).toBe(0);
  });

  test('at most four activities, and the ones that need you most get them', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const live: Record<string, LiveStateWire> = Object.fromEntries(ids.map((id) => [id, working()]));
    live.f = waiting();
    live.e = { ...working(), needs_you: { score: 66, reason: 'circling' } };
    const plan = planSync({ ...base, sessions: ids.map((id) => row(id)), liveStates: live, tracked: new Map() });
    const started = plan.actions.filter((a) => a.kind === 'start').map((a) => a.sessionId);
    expect(started.length).toBe(MAX_ACTIVITIES);
    expect(started.slice(0, 2)).toEqual(['f', 'e']);
    // every state still counts the others running
    for (const a of plan.actions) expect((a as Extract<SyncAction, { kind: 'start' }>).state.runningCount).toBe(5);
  });

  test('with no activity, the move into needs you is a notification instead, and a first sighting is not', () => {
    const off = { ...base, activitiesEnabled: false };
    const first = planSync({ ...off, sessions: [row('a')], liveStates: { a: waiting() }, tracked: new Map() });
    expect(first.actions).toEqual([]);
    const seen = planSync({ ...off, sessions: [row('b')], liveStates: { b: working() }, tracked: new Map() });
    const into = planSync({ ...off, sessions: [row('b')], liveStates: { b: waiting() }, tracked: seen.tracked });
    expect(kinds(into.actions)).toEqual(['notify:b:needsYou']);
  });

  test('never both: with an activity running, needs you is its alert and finishing is its card', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const into = planSync({ ...base, sessions: [row('a')], liveStates: { a: waiting() }, tracked });
    expect(into.actions.some((a) => a.kind === 'notify')).toBe(false);
    const done = planSync({ ...base, sessions: [], finished: [row('a', { state: 'final' })], tracked: into.tracked });
    expect(done.actions.some((a) => a.kind === 'notify')).toBe(false);
  });

  test('with no activity, a finish is posted only when it is news by the server\'s rule and was watched', () => {
    const off = { ...base, activitiesEnabled: false };
    const seen = planSync({ ...off, sessions: [row('a'), row('b')], liveStates: { a: working(), b: working() }, tracked: new Map() });
    const plan = planSync({
      ...off,
      sessions: [],
      finished: [row('a', { state: 'final', notable: true }), row('b', { state: 'final', notable: false, unattended: false })],
      tracked: seen.tracked,
    });
    expect(kinds(plan.actions)).toEqual(['notify:a:finished']);
    const never = planSync({ ...off, sessions: [], finished: [row('c', { state: 'final' })], tracked: new Map() });
    expect(never.actions).toEqual([]);
  });

  test('a start that failed waits before it tries again', () => {
    const tracked = new Map<string, Tracked>([
      ['a', { sessionId: 'a', activityId: null, phase: 'working', key: 'k', state: null, attrs: null, retryAfterMs: NOW + 30_000 }],
    ]);
    expect(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked }).actions).toEqual([]);
    expect(kinds(planSync({ ...base, nowMs: NOW + 31_000, sessions: [row('a')], liveStates: { a: working() }, tracked }).actions)).toEqual(['start:a']);
  });

  test('the content key ignores updatedEpoch and includes the drawn minute', () => {
    const s = row('a');
    const a = toAttrs(s);
    const st = toState(s, working(), { nowMs: NOW, runningCount: 0 });
    expect(contentKey(a, { ...st, updatedEpoch: 1 }, NOW)).toBe(contentKey(a, st, NOW));
    expect(contentKey(a, st, NOW + 60_000)).not.toBe(contentKey(a, st, NOW));
  });
});

describe('missionOrder: who needs you most, then who has waited longest', () => {
  test('the engine\'s score first, then since, then id', () => {
    const live: Record<string, LiveStateWire> = {
      a: working(),
      b: waiting(600),
      c: waiting(120),
      d: { ...working(), needs_you: { score: 66, reason: 'circling' } },
    };
    const order = missionOrder(['a', 'b', 'c', 'd'].map((id) => row(id)), live, NOW).map((s) => s.id);
    expect(order).toEqual(['b', 'c', 'd', 'a']);
  });

  test('without the engine: finished and quiet rows above running ones, by the engine\'s table', () => {
    const quiet = row('q', { ended_at: new Date(NOW - 20 * MIN).toISOString() });
    const order = missionOrder([row('r'), quiet], undefined, NOW).map((s) => s.id);
    expect(order).toEqual(['q', 'r']);
  });
});

// ------------------------------------------------------------------ the widget

function swiftStructVars(src: string, name: string): string[] {
  const start = src.indexOf(`struct ${name}: Codable, Hashable {`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}' && --depth === 0) break;
  }
  const body = src.slice(from + 1, i);
  // only this struct's own properties, not a nested struct's
  const own = body.replace(/struct \w+: Codable, Hashable \{[\s\S]*?\n {2}\}/g, '');
  return [...own.matchAll(/^\s+var (\w+):/gm)].map((m) => m[1]!).sort();
}

describe('the widget snapshot', () => {
  const d = debugSessions('needsYou', 4, NOW);
  const extra = row('x', { ended_at: new Date(NOW - 5_000).toISOString() });
  const snap = buildWidgetSnapshot({
    sessions: [...d.sessions, extra, row('done', { state: 'final' })],
    liveStates: d.liveStates,
    creature: 'fox',
    today: { attendedSeconds: 8040.4, week: [0, 1, 2, 9, -1, 5, 3] },
    nowMs: NOW,
  });

  test('at most four sessions, needs you first, every running one counted, finished ones out', () => {
    expect(snap.sessions.length).toBe(4);
    expect(snap.sessions[0]!.phase).toBe('needsYou');
    expect(snap.sessions[0]!.sentence).toBe('Waiting on you for four minutes');
    expect(snap.runningCount).toBe(5);
    expect(snap.sessions.some((s) => s.id === 'done')).toBe(false);
    expect(snap.creature).toBe('fox');
  });

  test('it goes stale when the Lock Screen does, and today is clamped to the ramp', () => {
    expect(snap.staleEpoch - snap.updatedEpoch).toBe(STALE_SECONDS);
    expect(snap.today).toEqual({ attendedSeconds: 8040, week: [0, 1, 2, 5, 0, 5, 3] });
    const noWeek = buildWidgetSnapshot({ sessions: [], today: { attendedSeconds: null, week: [1, 2] }, nowMs: NOW });
    expect(noWeek.today).toEqual({ attendedSeconds: null, week: [] });
    expect(buildWidgetSnapshot({ sessions: [], nowMs: NOW }).today).toBeNull();
  });

  test('its keys are exactly the Swift WidgetSnapshot the widget decodes', () => {
    const swift = readFileSync(join(ROOT, 'targets/widget/_shared/HomeWidgetViews.swift'), 'utf8');
    expect(Object.keys(snap).sort()).toEqual(swiftStructVars(swift, 'WidgetSnapshot'));
    expect(Object.keys(snap.sessions[0]!).sort()).toEqual(swiftStructVars(swift, 'Session'));
    expect(Object.keys(snap.today!).sort()).toEqual(swiftStructVars(swift, 'Today'));
  });

  test('the week row comes from the profile graph by the contribution buckets', () => {
    const graph = [
      { date: '2026-09-13', active_seconds: 9 * 3600 },
      { date: '2026-09-11', active_seconds: 3 * 3600 },
      { date: '2026-09-07', active_seconds: 20 * 60 },
      { date: '2026-09-01', active_seconds: 9 * 3600 },
    ];
    expect(weekFromGraph(graph, '2026-09-13')).toEqual([1, 0, 0, 0, 3, 0, 5]);
    expect(weekFromGraph(graph, 'not a date')).toEqual([]);
  });
});

// ------------------------------------------------------------------ copy and fixtures

/** A Swift literal's text with its `\( ... )` interpolations removed: those are code, not words. */
function withoutInterpolation(literal: string): string {
  let out = '';
  for (let i = 0; i < literal.length; i += 1) {
    if (literal[i] === '\\' && literal[i + 1] === '(') {
      let depth = 0;
      for (i += 1; i < literal.length; i += 1) {
        if (literal[i] === '(') depth += 1;
        else if (literal[i] === ')' && --depth === 0) break;
      }
      continue;
    }
    out += literal[i];
  }
  return out;
}

/**
 * Every string literal in a Swift file, as the words it can put on a surface: full line comments
 * dropped first (a URL's `//` lives inside a string, so trailing comments are left alone), then
 * each literal's interpolations. A literal that nests quotes inside an interpolation is read
 * from its outer quotes, which is enough to find a dash typed into the words around it.
 */
function swiftStrings(src: string): string[] {
  const code = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  return [...code.matchAll(/"((?:[^"\\\n]|\\\((?:[^()]|\([^()]*\))*\)|\\.)*)"/g)].map((m) => withoutInterpolation(m[1]!));
}

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f.endsWith('.xcassets') ? [] : swiftFiles(p);
    return f.endsWith('.swift') ? [p] : [];
  });
}

describe('no dashes on any live surface', () => {
  test('in every string the widget extension can draw', () => {
    const files = swiftFiles(join(ROOT, 'targets/widget'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      for (const s of swiftStrings(readFileSync(f, 'utf8'))) {
        expect({ file: f, s, dash: DASH.test(s) }).toEqual({ file: f, s, dash: false });
      }
    }
  });

  test('in every sentence, alert and notification the app builds', () => {
    for (const state of DEBUG_STATES) {
      for (const n of [1, 2, 3, 4]) {
        const d = debugSessions(state, n, NOW);
        const plan = planSync({ sessions: d.sessions, liveStates: d.liveStates, finished: d.finished, tracked: new Map(), activitiesEnabled: true, nowMs: NOW });
        for (const a of plan.actions) {
          const text = [
            'state' in a && a.state ? a.state.sentence : '',
            a.kind === 'update' ? (a.opts.alertTitle ?? '') + (a.opts.alertBody ?? '') : '',
          ].join(' ');
          expect(hasDash(text)).toBe(false);
        }
      }
    }
    const s = row('a');
    for (const n of [needsYouNotification(s, 'Waiting on you for four minutes'), finishedNotification(s), finishedNotification({ ...s, unattended: true })]) {
      expect(hasDash(n.title) || hasDash(n.body)).toBe(false);
    }
  });
});

describe('the fallback notifications', () => {
  const s = row('a', { attended_seconds: 102 * 60 });

  test('needs you names the repo, says what it waits for, and opens the session', () => {
    const n = needsYouNotification(s, 'Waiting on you for four minutes');
    expect(n.title).toBe('builder needs you');
    expect(n.body).toBe('Waiting on you for four minutes');
    expect(routeForNotification(n.data)).toBe('/session/a');
    expect(needsYouNotification({ id: 'b', repo_name: null }).body).toBe('Waiting on you');
  });

  test('finished reads like the server\'s banner, opens the recap, and shares its collapse id', () => {
    const n = finishedNotification(s);
    expect(n.title).toBe('Session finished: 1h 42m in builder');
    expect(n.body).toBe('+420 lines \u00b7 9 prompts');
    expect(routeForNotification(n.data)).toBe('/session/a?recap=1');
    expect(n.identifier).toBe('a');
    const run = finishedNotification({ ...s, unattended: true, active_seconds: 130 * 60 });
    expect([run.title, run.body]).toEqual(['Agent run finished', 'ran 2h 10m unattended']);
    expect(routeForNotification(run.data)).toBe('/session/a?recap=1');
  });
});

describe('the debug route\'s sessions and link', () => {
  test('every state and count plans cleanly, with the engine\'s sentences', () => {
    const want = new Set([
      'Running your test suite',
      'Waiting on you for four minutes',
      'No new output for six minutes',
      'Finished, with twelve files changed',
      'Rewriting a source file, third attempt',
      'Stuck on the same failing command for six minutes',
      'Reading the docs',
    ]);
    for (const state of DEBUG_STATES) {
      const d = debugSessions(state, 4, NOW);
      expect(d.sessions.length + d.finished.length).toBe(4);
      for (const s of [...d.sessions, ...d.finished]) {
        const st = toState(s, d.liveStates[s.id], { nowMs: NOW, runningCount: 3 });
        expect(want.has(st.sentence)).toBe(true);
      }
    }
  });

  test('the Swift preview fixtures only say things the phone\'s renderer can produce', () => {
    const swift = readFileSync(join(ROOT, 'targets/widget/_shared/LiveFixtures.swift'), 'utf8');
    const sentences = [...swift.matchAll(/(?:state\("\w+", |"(?:working|needsYou)", )"([A-Z][^"]+)"/g)].map((m) => m[1]!);
    expect(sentences.length).toBeGreaterThan(8);
    const producible = new Set([
      renderLiveSentence({ activity: { kind: 'editing', role: 'source', attempt: 3 } }),
      renderLiveSentence({ activity: { kind: 'testing', role: 'test' } }),
      renderLiveSentence(waiting(240)),
      renderLiveSentence({ verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 360 } } }),
      renderLiveSentence({ verdict: { state: 'circling', basis: 'causes:file_churn_with_failures', evidence: { churn_writes: 4 }, file_id: 'x' }, map: { files: [{ id: 'x', role: 'source' }] } }),
      renderLiveSentence({ verdict: { state: 'lost', evidence: { blind_edits: 3 } } }),
      renderLiveSentence({ activity: { kind: 'idle', since_s: 360 } }),
      renderLiveSentence({ verdict: { state: 'done', evidence: { files_changed: 12 } } }),
      renderLiveSentence({ activity: { kind: 'reading', role: 'docs', files: 3 } }),
    ]);
    for (const s of sentences) expect({ s, ok: producible.has(s) }).toEqual({ s, ok: true });
  });

  test('parseDebugLive', () => {
    expect(parseDebugLive({ state: 'needsYou', n: '3', widget: '1' })).toMatchObject({ state: 'needsYou', n: 3, widget: true, render: false, problem: null });
    expect(parseDebugLive({ state: 'end' }).state).toBe('end');
    expect(parseDebugLive({ state: 'working', n: '9' }).n).toBe(4);
    expect(parseDebugLive({ state: 'working', n: 'x' }).n).toBe(1);
    expect(parseDebugLive({ state: 'sideways' }).problem).toContain('state must be');
    expect(parseDebugLive({}).problem).toContain('nothing to do');
    expect(parseDebugLive({ widget: '1' }).problem).toBeNull();
    expect(parseDebugLive({ state: 'working', creature: 'owl', stale: '10' })).toMatchObject({ creature: 'owl', staleInSeconds: 10 });
    expect(parseDebugLive({ state: 'working', stale: '0' }).staleInSeconds).toBeNull();
  });
});

// ------------------------------------------------------------------ the creature art

describe('the widget creatures', () => {
  const catalog = join(ROOT, 'targets/widget/Assets.xcassets');
  const art = readFileSync(join(ROOT, 'targets/widget/_shared/CreatureArt.swift'), 'utf8');
  const ids = JSON.parse(/static let ids: \[String\] = (\[[^\]]*\])/.exec(art)![1]!) as string[];

  test('every animal in the pack, then Bit awake and asleep', () => {
    expect(ids).toEqual([...ANIMALS, 'bit', 'bit-sleeping']);
  });

  test('each is a 1-bit template at 16, 32, 48 and 64pt, @2x and @3x, whole pixels per cell', () => {
    for (const id of ids) {
      for (const pt of [16, 32, 48, 64]) {
        const dir = join(catalog, `creature-${id}-${pt}.imageset`);
        const contents = JSON.parse(readFileSync(join(dir, 'Contents.json'), 'utf8'));
        expect(contents.properties['template-rendering-intent']).toBe('template');
        for (const scale of [2, 3]) {
          const png = readFileSync(join(dir, `creature-${id}-${pt}@${scale}x.png`));
          const w = png.readUInt32BE(16);
          const h = png.readUInt32BE(20);
          expect([w, h]).toEqual([pt * scale, pt * scale]);
          expect((pt * scale) % 16).toBe(0);
        }
      }
    }
  });

  test('the catalog has a root Contents.json for actool', () => {
    expect(existsSync(join(catalog, 'Contents.json'))).toBe(true);
  });
});
