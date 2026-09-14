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
import type { LiveState } from '../src/generated/live';
import { lockScreenWithoutDetails } from '../src/copy/live';
import { HARNESS_GLYPHS } from '../src/pixel/harness';
import { havePython, python } from './pythonRef';
import { debugSessions, DEBUG_STATES, parseDebugLive } from '../src/live/fixtures';
import { livePresenceLine } from '../src/live/format';
import { DASH as PLAIN_DASH } from '../src/copy/plain';
import { BACKGROUND_BASIS, DASH, hasDash, ordinal, renderLiveSentence, spoken, type LiveStateWire } from '../src/live/sentence';
import {
  alertFor,
  anchorOf,
  buildWidgetSnapshot,
  clampSentence,
  contentKey,
  DETAILS_OFF_TITLE,
  DISMISS_AFTER_SECONDS,
  endedKey,
  filesChangedOf,
  finishedSince,
  MAX_ACTIVITIES,
  missionOrder,
  normalizeCreature,
  payloadBytes,
  PAYLOAD_LIMIT_BYTES,
  phaseOf,
  planSync,
  PRIVATE_REPO,
  RELEVANCE_DEFAULT,
  RELEVANCE_DONE,
  RELEVANCE_NEEDS_YOU,
  relevanceOf,
  sentenceOf,
  SENTENCE_MAX,
  sinceEpochOf,
  STALE_SECONDS,
  toAttrs,
  todayFromProfile,
  toState,
  weekFromGraph,
  type SyncAction,
  type Tracked,
} from '../src/live/surface';
import { crewCreatures } from '../src/live/crew';
import { ANIMALS } from '../src/pixel/animals';
import { finishedNotification, needsYouNotification } from '../src/push/localCopy';
import { CREW_RING, creatureHue, HUE_NAMES, hue } from '../src/theme';
import { tokens as designTokens } from '../src/generated/tokens';
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

/**
 * The engine's live_state for live-self-1 (2026-09-13 04:23), the fields the phone reads: the
 * turn ended while one background task it launched was still out. `analysis/live.py` scores
 * it 10 (`waiting_on_background`) and says "Waiting on one background task it started".
 */
const background = (n = 1, sinceS = 75): LiveStateWire => ({
  activity: { kind: 'waiting_on_you', role: 'unknown', since_s: sinceS },
  verdict: { state: 'waiting', evidence: { background: n }, basis: BACKGROUND_BASIS, reason: null },
  eta: { elapsed_s: null, typical_s: null, remaining_s: null, reason: 'no finished sessions on this repository' },
  needs_you: { score: 10, reason: 'waiting_on_background' },
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
    ['waiting on one background task', background(1), 'Waiting on one background task it started'],
    ['waiting on three background tasks', background(3, 900), 'Waiting on three background tasks it started'],
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

  test('the dash rule is plain.py\'s, the one copy in src/copy/plain.ts: em, en, bar, minus sign, a spaced hyphen', () => {
    expect(DASH).toBe(PLAIN_DASH);
    expect(hasDash('one \u2014 two')).toBe(true);
    expect(hasDash('9\u201310')).toBe(true);
    expect(hasDash('a \u2015 bar')).toBe(true);
    expect(hasDash('\u221288 lines')).toBe(true);
    expect(hasDash('this - that')).toBe(true);
    expect(hasDash('this -- that')).toBe(true);
    // a hyphen in a word, a flag, or a sign before a number is not a dash
    expect(hasDash('cursor-agent')).toBe(false);
    expect(hasDash('--json')).toBe(false);
    expect(hasDash('+420 -88 lines')).toBe(false);
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
    expect(phaseOf(row('a'), { verdict: { state: 'done', evidence: {} } }, NOW)).toBe('done');
    expect(phaseOf(row('a', { state: 'final' }), working(), NOW)).toBe('done');
  });

  test('a turn the engine called done is finished, not looked at yet, never needs you (the owner, 2026-09-13)', () => {
    // The engine only says done while the activity is the wait that followed the turn, so the
    // wait must not win: this was needs you, with an alert, on the Lock Screen and the widget.
    const finished: LiveStateWire = {
      activity: { kind: 'waiting_on_you', role: 'unknown', since_s: 180 },
      verdict: { state: 'done', evidence: { files_changed: 2, commits: 1 }, basis: 'turn_ended', reason: null },
      needs_you: { score: 31, reason: 'finished_unreviewed' },
    };
    expect(phaseOf(row('a'), finished, NOW)).toBe('done');
    const st = toState(row('a'), finished, ctx);
    expect([st.phase, st.sentence, st.etaEpoch]).toEqual(['done', 'Finished, with two files changed', null]);
    // the card counts "ran" to the moment the turn finished: the wait's start
    expect(st.sinceEpoch).toBe(Math.floor((Date.parse(row('a').updated_at!) / 1000 - 180) / 60) * 60);
    expect(relevanceOf(st, finished)).toBe(RELEVANCE_DONE);
    // on the Lock Screen its card ends as finished; it never alerts
    const base = { activitiesEnabled: true, nowMs: NOW };
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const plan = planSync({ ...base, sessions: [row('a')], liveStates: { a: finished }, tracked });
    expect(kinds(plan.actions)).toEqual(['end:a']);
    const e = plan.actions[0] as Extract<SyncAction, { kind: 'end' }>;
    expect(e.state?.phase).toBe('done');
    expect(e.opts.dismissAfterSeconds).toBe(DISMISS_AFTER_SECONDS);
    // and the next pass, still live and still done, says nothing more
    expect(planSync({ ...base, sessions: [row('a')], liveStates: { a: finished }, tracked: plan.tracked }).actions).toEqual([]);
    // the agent waiting on its own background job is still working, as before
    expect(phaseOf(row('a'), { ...finished, verdict: { ...finished.verdict!, basis: BACKGROUND_BASIS } }, NOW)).toBe('working');
  });

  test('an agent waiting on its own background job is working, not needs you (live-self-1)', () => {
    expect(phaseOf(row('a'), background(), NOW)).toBe('working');
    const st = toState(row('a'), background(), ctx);
    expect(st.phase).toBe('working');
    expect(st.sentence).toBe('Waiting on one background task it started');
    expect(st.sinceEpoch).toBeNull();
    // either signal is enough: the basis, or the needs_you reason from a server that sends only it
    expect(phaseOf(row('a'), { ...background(), verdict: { state: 'waiting', evidence: {}, basis: null } }, NOW)).toBe('working');
    expect(phaseOf(row('a'), { ...background(), needs_you: null }, NOW)).toBe('working');
  });

  test('without the engine: presence line while fresh, the idle rule once quiet, the done rule when final', () => {
    const fresh = row('a');
    expect(toState(fresh, null, ctx).sentence).toBe(livePresenceLine(fresh));
    expect(toState(fresh, null, ctx).phase).toBe('working');
    const quiet = row('b', { ended_at: new Date(NOW - (STALE_SECONDS + 5 * 60) * 1000).toISOString() });
    expect(toState(quiet, null, ctx).phase).toBe('stalled');
    // the surface drops the duration and says when the quiet began; the alert keeps it
    expect(toState(quiet, null, ctx).sentence).toBe('No new output');
    expect(sentenceOf(quiet, null, 'stalled', NOW)).toBe('No new output for twenty minutes');
    expect(toState(quiet, null, ctx).sinceEpoch).toBe(Math.floor((NOW / 1000 - STALE_SECONDS - 5 * 60) / 60) * 60);
    const final = row('c', { state: 'final' });
    expect(toState(final, null, ctx).etaEpoch).toBeNull();
    expect(toState(final, null, ctx).endedEpoch).toBe(Math.round(Date.parse(final.ended_at) / 1000));
  });

  test('a finished row never calls the files it only READ "changed" (live-self-2)', () => {
    // files_touched counts every file any event named, reads included: it is not a change count
    const read = row('c', { state: 'final' }, { files_touched: 2, lines_added_agent: 0, commit_count: 0 });
    expect(toState(read, null, ctx).sentence).toBe('Finished');
    // and leaves the commits to the line under it: "a commit" above "3 commits" contradicted it
    expect(toState(row('d', { state: 'final' }), null, ctx).sentence).toBe('Finished');
    expect(toState(row('d', { state: 'final' }), null, ctx).commits).toBe(3);
    // the engine's own done verdict still speaks, with its own count
    const engineDone = { verdict: { state: 'done', evidence: { files_changed: 3, commits: 0 } } };
    expect(toState(row('e', { state: 'final' }), engineDone, ctx).sentence).toBe('Finished, with three files changed');
  });

  test('files changed are the map rows with an edit, never the reads', () => {
    const map = (rows: { reads: number; edits: number }[]): LiveStateWire => ({
      ...working(),
      map: { files: rows.map((r, i) => ({ id: `f${i}`, role: 'source', ...r })) },
    });
    expect(filesChangedOf(map([{ reads: 1, edits: 0 }, { reads: 1, edits: 0 }]))).toBe(0);
    expect(filesChangedOf(map([{ reads: 2, edits: 3 }, { reads: 1, edits: 0 }, { reads: 0, edits: 1 }]))).toBe(2);
    // no map, or rows that do not say how many edits, is not counted: -1, never 0
    expect(filesChangedOf(working())).toBe(-1);
    expect(filesChangedOf({ ...working(), map: { files: [{ id: 'x', role: 'source' }] } })).toBe(-1);
    expect(toState(row('a'), map([{ reads: 0, edits: 2 }]), ctx).filesChanged).toBe(1);
  });

  test('no duration on a surface: the sentence drops it and sinceEpoch says when it began', () => {
    const s = row('a');
    const base = Date.parse(s.updated_at!) / 1000;
    const minute = (x: number) => Math.floor(x / 60) * 60;
    const need = toState(s, waiting(240), ctx);
    expect(need.sentence).toBe('Waiting on you');
    expect(need.sinceEpoch).toBe(minute(base - 240));
    const idle = toState(s, { ...working(), activity: { kind: 'idle', since_s: 360 } }, ctx);
    expect(idle.sentence).toBe('No new output');
    expect(idle.sinceEpoch).toBe(minute(base - 360));
    const stuck: LiveStateWire = { ...working(), verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 372 } } };
    const circ = toState(s, stuck, ctx);
    expect(circ.sentence).toBe('Stuck on the same failing command');
    expect(circ.sinceEpoch).toBe(minute(base - 372));
    // the moment an alert or a notification is sent, it carries the duration as it stands
    expect(sentenceOf(s, waiting(240), 'needsYou', NOW)).toBe('Waiting on you for four minutes');
    // nothing to count from: null, and a working session has none
    expect(sinceEpochOf(s, working(), 'working', NOW)).toBeNull();
    expect(sinceEpochOf(s, { ...stuck, verdict: { ...stuck.verdict!, evidence: { stuck_s: 30 } } }, 'working', NOW)).toBeNull();
  });

  test('no sentence any surface shows carries a duration', () => {
    for (const state of DEBUG_STATES) {
      const d = debugSessions(state, 4, NOW);
      for (const s of [...d.sessions, ...d.finished]) {
        const st = toState(s, d.liveStates[s.id], { nowMs: NOW, runningCount: 0 });
        expect({ s: st.sentence, timed: /\bfor (one|two|three|four|five|six|seven|eight|nine|ten|\d+) (minute|hour)/.test(st.sentence) }).toEqual({ s: st.sentence, timed: false });
      }
    }
  });

  test('nothing without the engine can say needs you', () => {
    expect(phaseOf(row('a', { autonomous_seconds: 9000 }), null, NOW)).not.toBe('needsYou');
  });

  test('absent is not zero: uncounted files are -1 and uncounted lines and commits are null', () => {
    const s = row('a', {}, { files_touched: undefined, commit_count: undefined, lines_added_agent: undefined });
    const st = toState(s, null, ctx);
    expect(st.filesChanged).toBe(-1);
    expect(st.linesAdded).toBeNull();
    expect(st.commits).toBeNull();
    // the server omits lines_removed_agent today (PROGRESS.md backlog): null, not 0
    expect(toState(row('b'), null, ctx).linesRemoved).toBeNull();
    expect(toState(row('c', {}, { lines_removed_agent: 88 }), null, ctx).linesRemoved).toBe(88);
    // a running session has not ended
    expect(toState(row('d'), working(), ctx).endedEpoch).toBeNull();
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
    expect(e.opts.relevance).toBe(RELEVANCE_DONE);
    expect(DISMISS_AFTER_SECONDS).toBeGreaterThanOrEqual(15 * 60);
    expect(DISMISS_AFTER_SECONDS).toBeLessThanOrEqual(30 * 60);
    expect(e.state?.phase).toBe('done');
    expect(e.state?.linesAdded).toBe(420);
    expect(e.state?.linesRemoved).toBe(88);
    expect(e.state?.commits).toBe(3);
    expect(e.state?.sentence).toBe('Finished');
    expect(e.state?.endedEpoch).toBe(Math.round(Date.parse(final.ended_at) / 1000));
    expect(plan.tracked.has('a')).toBe(false);
    // it stays on the Lock Screen, remembered apart from the running sessions
    expect(plan.tracked.get(endedKey('act-a'))?.endedAtMs).toBe(NOW);
  });

  test('a session gone from the live list finished: its card ends as finished, from what it last showed', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const plan = planSync({ ...base, sessions: [], tracked });
    expect(kinds(plan.actions)).toEqual(['end:a']);
    const e = plan.actions[0] as Extract<SyncAction, { kind: 'end' }>;
    expect(e.state?.phase).toBe('done');
    expect(e.state?.sentence).toBe('Finished');
    expect(e.state?.commits).toBe(3);
    // when it ended is not known, so the card does not claim how long it ran
    expect(e.state?.endedEpoch).toBeNull();
    expect(e.opts.dismissAfterSeconds).toBe(DISMISS_AFTER_SECONDS);
  });

  test('a finished card is taken down the moment another session runs, so it never sits on a running one (live-self-3)', () => {
    const one = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const ended = planSync({ ...base, sessions: [], finished: [row('a', { state: 'final' })], tracked: one });
    expect(ended.tracked.has(endedKey('act-a'))).toBe(true);
    // nothing running: it stays, until the system dismisses it
    expect(planSync({ ...base, sessions: [], tracked: ended.tracked }).actions).toEqual([]);
    expect(planSync({ ...base, nowMs: NOW + (DISMISS_AFTER_SECONDS + 1) * 1000, sessions: [], tracked: ended.tracked }).tracked.size).toBe(0);
    // a new sitting starts: its card starts and the finished one is taken down now
    const next = planSync({ ...base, sessions: [row('b')], liveStates: { b: working() }, tracked: ended.tracked });
    expect(kinds(next.actions)).toEqual(['start:b', 'end:a']);
    const down = next.actions[1] as Extract<SyncAction, { kind: 'end' }>;
    expect(down.activityId).toBe('act-a');
    expect(down.opts.dismissAfterSeconds).toBe(0);
    expect(next.tracked.has(endedKey('act-a'))).toBe(false);
  });

  test('finishing while another session runs takes the card down now; a finish that is news is then a notification', () => {
    const both = apply(planSync({ ...base, sessions: [row('a'), row('b')], liveStates: { a: working(), b: working() }, tracked: new Map() }));
    const plan = planSync({
      ...base,
      sessions: [row('b')],
      liveStates: { b: working() },
      finished: [row('a', { state: 'final', notable: true })],
      tracked: both,
    });
    expect(kinds(plan.actions).sort()).toEqual(['end:a', 'notify:a:finished']);
    const e = plan.actions.find((a) => a.kind === 'end') as Extract<SyncAction, { kind: 'end' }>;
    expect(e.opts.dismissAfterSeconds).toBe(0);
    expect(plan.tracked.has(endedKey('act-a'))).toBe(false);
    // not news: taken down, and quiet
    const quiet = planSync({ ...base, sessions: [row('b')], liveStates: { b: working() }, finished: [row('a', { state: 'final', notable: false })], tracked: both });
    expect(kinds(quiet.actions)).toEqual(['end:a']);
  });

  test('an agent waiting on its own background job never alerts, and ranks by the engine\'s 10', () => {
    const tracked = apply(planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }));
    const plan = planSync({ ...base, sessions: [row('a')], liveStates: { a: background() }, tracked });
    expect(kinds(plan.actions)).toEqual(['update:a']);
    const u = plan.actions[0] as Extract<SyncAction, { kind: 'update' }>;
    expect(u.state.phase).toBe('working');
    expect(u.opts.alertTitle).toBeUndefined();
    expect(u.opts.relevance).toBe(10);
    const off = planSync({ ...base, activitiesEnabled: false, sessions: [row('a')], liveStates: { a: background() }, tracked: planSync({ ...base, activitiesEnabled: false, sessions: [row('a')], liveStates: { a: working() }, tracked: new Map() }).tracked });
    expect(off.actions).toEqual([]);
  });

  test('every card wears its own session\'s crew creature, never the builder\'s, never Bit', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const rows = ids.map((id, i) => row(id, { started_at: new Date(NOW - (40 - i * 5) * MIN).toISOString() }));
    const plan = planSync({ ...base, sessions: rows, liveStates: Object.fromEntries(ids.map((id) => [id, working()])), tracked: new Map() });
    const worn = plan.actions.map((a) => (a as Extract<SyncAction, { kind: 'start' }>).state.creature);
    expect(worn).not.toContain('bit');
    expect(new Set(worn).size).toBe(4);
    const crew = crewCreatures(rows);
    for (const a of plan.actions) expect((a as Extract<SyncAction, { kind: 'start' }>).state.creature).toBe(crew.get(a.sessionId)!);
    // a creature the caller remembers (`crewFor`) is the one the card wears
    const kept = planSync({ ...base, sessions: [row('a')], liveStates: { a: working() }, crew: new Map([['a', 'octopus']]), tracked: new Map() });
    expect((kept.actions[0] as Extract<SyncAction, { kind: 'start' }>).state.creature).toBe('octopus');
  });

  test('"N more running" counts only the sessions with no card of their own', () => {
    const plan = planSync({ ...base, sessions: [row('a'), row('b')], liveStates: { a: working(), b: waiting() }, tracked: new Map() });
    for (const a of plan.actions) expect((a as Extract<SyncAction, { kind: 'start' }>).state.runningCount).toBe(0);
    const off = planSync({ ...base, activitiesEnabled: false, sessions: [row('a'), row('b')], liveStates: { a: working(), b: working() }, tracked: new Map() });
    expect(off.actions).toEqual([]);
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
    // every card counts the two that got no card: "2 more running"
    for (const a of plan.actions) expect((a as Extract<SyncAction, { kind: 'start' }>).state.runningCount).toBe(2);
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
  const done = row('done', { state: 'final' });
  const snap = buildWidgetSnapshot({
    sessions: [...d.sessions, extra, done],
    liveStates: d.liveStates,
    creature: 'fox',
    today: { attendedSeconds: 8040.4, week: [0, 1, 2, 9, -1, 5, 3] },
    nowMs: NOW,
  });

  test('at most four sessions, needs you first, every running one counted, finished ones out', () => {
    expect(snap.sessions.length).toBe(4);
    expect(snap.sessions[0]!.phase).toBe('needsYou');
    expect(snap.sessions[0]!.sentence).toBe('Waiting on you');
    // the widget draws "4m" from this at each timeline entry, so it moves by itself
    expect(snap.sessions[0]!.sinceEpoch).toBe(Math.floor((Date.parse(d.sessions[0]!.updated_at!) / 1000 - 240) / 60) * 60);
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

  test('every row wears its own crew creature, never the builder\'s and never Bit', () => {
    // The rule over the rows the snapshot was handed, the finished one included: it steps a
    // creature past one a session running at its start wears, and which ids collide is the hash's.
    const rows = [...d.sessions, extra, done];
    const crew = crewCreatures(rows);
    for (const r of snap.sessions) {
      expect(r.creature).toBe(crew.get(r.id)!);
      expect(r.creature).not.toBe('bit');
    }
    // four sessions running at once: four different creatures, so four different hues
    expect(new Set(snap.sessions.map((r) => r.creature)).size).toBe(snap.sessions.length);
    expect(new Set(snap.sessions.map((r) => creatureHue(r.creature).name)).size).toBe(snap.sessions.length);
    // the caller's memory wins (`crew.crewFor`), so a row wears the colour its tile wears
    const kept = new Map(snap.sessions.map((r) => [r.id, 'owl']));
    const again = buildWidgetSnapshot({ sessions: d.sessions, liveStates: d.liveStates, crew: kept, nowMs: NOW });
    expect(again.sessions.every((r) => r.creature === 'owl')).toBe(true);
  });

  test('a turn the engine called done is listed as finished, in mission control\'s order, and never counted as running', () => {
    const finished: LiveStateWire = {
      activity: { kind: 'waiting_on_you', role: 'unknown', since_s: 180 },
      verdict: { state: 'done', evidence: { files_changed: 12, commits: 1 }, basis: 'turn_ended', reason: null },
      needs_you: { score: 31, reason: 'finished_unreviewed' },
    };
    const w = buildWidgetSnapshot({
      sessions: [row('run'), row('fin')],
      liveStates: { run: working(), fin: finished },
      creature: 'bit',
      nowMs: NOW,
    });
    expect(w.sessions.map((r) => [r.id, r.phase])).toEqual([['fin', 'done'], ['run', 'working']]);
    expect(w.runningCount).toBe(1);
    const fin = w.sessions[0]!;
    expect(fin.sentence).toBe('Finished, with twelve files changed');
    // "ran 47m" counts to when the turn finished
    expect(fin.sinceEpoch).toBe(Math.floor((Date.parse(row('fin').updated_at!) / 1000 - 180) / 60) * 60);
    expect(fin.creature).not.toBe('bit');
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
 * A Swift `\u{2212}` escape as the character it draws. FOUND IN INTEGRATION (2026-09-13): the
 * scan read the literal `"\u{2212}"` as its escape text, so the Lock Screen's minus sign passed
 * a test whose whole job was to find a dash on a surface.
 */
function unescapeSwift(literal: string): string {
  return literal.replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/**
 * Every string literal in a Swift file, as the words it can put on a surface: full line comments
 * dropped first (a URL's `//` lives inside a string, so trailing comments are left alone), then
 * each literal's interpolations, then its `\u{...}` escapes turned into the characters they
 * draw. A literal that nests quotes inside an interpolation is read from its outer quotes, which
 * is enough to find a dash typed into the words around it.
 */
function swiftStrings(src: string): string[] {
  const code = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  return [...code.matchAll(/"((?:[^"\\\n]|\\\((?:[^()]|\([^()]*\))*\)|\\.)*)"/g)].map((m) =>
    unescapeSwift(withoutInterpolation(m[1]!))
  );
}

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f.endsWith('.xcassets') ? [] : swiftFiles(p);
    return f.endsWith('.swift') ? [p] : [];
  });
}

describe('no dashes on any live surface', () => {
  test('the scan decodes a Swift escape, so a minus sign spelled as one is still found', () => {
    expect(swiftStrings('let m = "\\u{2212}"\nlet s = "\\u{00B7}"')).toEqual(['\u2212', '\u00b7']);
    expect(DASH.test(swiftStrings('let m = "\\u{2212}"')[0]!)).toBe(true);
  });

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
      'Waiting on you',
      'No new output',
      'Finished',
      'Rewriting a source file, third attempt',
      'Stuck on the same failing command',
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
    // what a surface shows: the engine's words with the durations taken out (surfaceSentenceOf)
    const producible = new Set([
      renderLiveSentence({ activity: { kind: 'editing', role: 'source', attempt: 3 } }),
      renderLiveSentence({ activity: { kind: 'editing', role: 'source', files: 2 } }),
      renderLiveSentence({ activity: { kind: 'testing', role: 'test' } }),
      renderLiveSentence(waiting(0)),
      renderLiveSentence(background(1)),
      renderLiveSentence({ verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 0 } } }),
      renderLiveSentence({ verdict: { state: 'circling', basis: 'causes:file_churn_with_failures', evidence: { churn_writes: 4 }, file_id: 'x' }, map: { files: [{ id: 'x', role: 'source' }] } }),
      // the longest sentence a surface can show, 58 characters (LiveFixtures.widgetLongest)
      renderLiveSentence({ verdict: { state: 'circling', basis: 'causes:file_churn_with_failures', evidence: { churn_writes: 7 }, file_id: 'x' }, map: { files: [{ id: 'x', role: 'migration' }] } }),
      renderLiveSentence({ verdict: { state: 'lost', evidence: { blind_edits: 3 } } }),
      renderLiveSentence({ activity: { kind: 'idle', since_s: 0 } }),
      renderLiveSentence({ verdict: { state: 'done', evidence: { files_changed: 12 } } }),
      renderLiveSentence({ verdict: { state: 'done', evidence: { files_changed: 0, commits: 0 } } }),
      renderLiveSentence({ activity: { kind: 'reading', role: 'docs', files: 3 } }),
      renderLiveSentence({}),
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

// ------------------------------------------------------------------ the two halves, pinned

/**
 * `spec/fixtures/live/content_state.json`: real engine states, cut from scenario transcripts
 * through the producer's own path (capture's cut, `attach_live`), and the card the SERVER
 * computes from each (`server/builder/live_push.content_state`, the Python half, which is the
 * reference: docs/overnight-integration.md section 0, rule 4). The phone's `toState` must say
 * exactly the same thing, key for key, or a pushed update and a foreground update of one card
 * disagree on the Lock Screen. Generated by `scripts/gen_live_fixtures.py`.
 */
interface FixtureCase {
  name: string;
  variant: 'live' | 'names' | 'map_cut' | 'final';
  row: SessionDetail & { live_names?: { files: { id: string; name: string }[] } };
  live: LiveState | null;
  ctx: { nowMs: number; creature: string; runningCount: number };
  sentence: string | null;
  spoken: string;
  content_state: Record<string, unknown>;
  relevance: number;
  alert: { title: string; body: string; sound: string } | null;
}

const FIXTURE = JSON.parse(readFileSync(join(ROOT, '..', 'spec/fixtures/live/content_state.json'), 'utf8')) as {
  keys: string[];
  constants: Record<string, number | string>;
  cases: FixtureCase[];
};

/**
 * Compile time: a generated `LiveState` IS a `LiveStateWire` (docs/overnight-integration.md
 * section 6). A field the spec adds or renames that the surfaces read would stop this file
 * compiling, which `bunx tsc --noEmit` runs; nothing here converts one into the other.
 */
const assignable = (s: LiveState): LiveStateWire => s;

describe('content_state.json: the phone\'s card equals the server\'s, case by case', () => {
  test('the fixture covers every phase, a refused and an answered ETA, and each variant', () => {
    const phases = new Set(FIXTURE.cases.map((c) => c.content_state.phase));
    expect([...phases].sort()).toEqual(['done', 'needsYou', 'stalled', 'working']);
    expect(new Set(FIXTURE.cases.map((c) => c.variant))).toEqual(new Set(['live', 'names', 'map_cut', 'final']));
    expect(FIXTURE.cases.some((c) => c.content_state.etaEpoch === null && c.live !== null)).toBe(true);
    expect(FIXTURE.cases.some((c) => typeof c.content_state.etaEpoch === 'number')).toBe(true);
    expect(FIXTURE.cases.some((c) => c.live?.verdict.basis === BACKGROUND_BASIS)).toBe(true);
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(15);
  });

  test('the card\'s keys are the Swift ContentState\'s and the constants are the phone\'s', () => {
    const st = toState(row('k'), working(), { nowMs: NOW, runningCount: 0 });
    expect(Object.keys(st).sort()).toEqual([...FIXTURE.keys].sort());
    expect(FIXTURE.constants.SENTENCE_MAX).toBe(SENTENCE_MAX);
    expect(FIXTURE.constants.STALE_SECONDS).toBe(STALE_SECONDS);
    expect(FIXTURE.constants.DISMISS_AFTER_SECONDS).toBe(DISMISS_AFTER_SECONDS);
    expect(FIXTURE.constants.RELEVANCE_NEEDS_YOU).toBe(RELEVANCE_NEEDS_YOU);
    expect(FIXTURE.constants.RELEVANCE_DEFAULT).toBe(RELEVANCE_DEFAULT);
    expect(FIXTURE.constants.RELEVANCE_DONE).toBe(RELEVANCE_DONE);
    expect(FIXTURE.constants.PRIVATE_REPO).toBe(PRIVATE_REPO);
  });

  for (const c of FIXTURE.cases) {
    const label = `${c.name} (${c.variant})`;
    test(`${label}: toState, the sentence, the spoken sentence, relevance and the alert`, () => {
      const live = c.live === null ? null : assignable(c.live);
      const st = toState(c.row, live, c.ctx);
      expect(st as unknown as Record<string, unknown>).toEqual(c.content_state);
      if (live !== null) expect(renderLiveSentence(live)).toBe(c.sentence!);
      expect(clampSentence(sentenceOf(c.row, live, st.phase, c.ctx.nowMs))).toBe(c.spoken);
      expect(relevanceOf(st, live)).toBe(c.relevance);
      if (st.phase === 'needsYou') {
        expect(c.alert).not.toBeNull();
        expect(alertFor(c.row, c.spoken)).toEqual({ alertTitle: c.alert!.title, alertBody: c.alert!.body });
      } else {
        expect(c.alert).toBeNull();
      }
    });
  }

  test('etaEpoch and sinceEpoch anchor on computed_at, not on the older session row', () => {
    const lagged = FIXTURE.cases.filter((c) => c.live && typeof c.content_state.etaEpoch === 'number');
    expect(lagged.length).toBeGreaterThan(3);
    for (const c of lagged) {
      const computed = Date.parse(c.live!.computed_at) / 1000;
      const updated = Date.parse(c.row.updated_at!) / 1000;
      expect(computed - updated).toBe(FIXTURE.constants.ROW_LAG_SEC as number);
      expect(anchorOf(c.row, c.live, c.ctx.nowMs)).toBe(computed);
      expect(c.content_state.etaEpoch).toBe(Math.round((computed + c.live!.eta.remaining_s!) / 60) * 60);
    }
    // with no state, the row's own clock, then now
    expect(anchorOf(row('a'), null, NOW)).toBe(Date.parse(row('a').updated_at!) / 1000);
    expect(anchorOf(row('a', { updated_at: undefined }), null, NOW)).toBe(NOW / 1000);
  });

  test('a cut map is not counted: filesChanged is -1, never the rows that were kept', () => {
    const cut = FIXTURE.cases.find((c) => c.variant === 'map_cut')!;
    expect(cut.live!.map!.files_total).toBeGreaterThan(cut.live!.map!.files.length);
    expect(filesChangedOf(cut.live)).toBe(-1);
    const whole = FIXTURE.cases.find((c) => c.name === cut.name && c.variant === 'live')!;
    expect(filesChangedOf(whole.live)).toBeGreaterThanOrEqual(0);
  });

  test('the lock screen state never carries a basename, even when live_names is on the row', () => {
    const named = FIXTURE.cases.filter((c) => c.row.live_names?.files.length);
    expect(named.length).toBeGreaterThan(0);
    for (const c of named) {
      const card = JSON.stringify([toAttrs(c.row), toState(c.row, c.live, c.ctx)]);
      for (const f of c.row.live_names!.files) expect(card.includes(f.name)).toBe(false);
    }
  });
});

describe('the live sentence against live.sentence itself', () => {
  /**
   * Every branch `live.sentence` has, over the counts that change its words (one against many,
   * spoken against digits, under and over a minute), rendered by the engine and by the phone.
   * Skipped only without a python3 that can import `analysis` (pythonRef.ts).
   */
  test('the engine and the phone say the same words for every activity and verdict', () => {
    if (!havePython()) return;
    const states = python<{ state: LiveStateWire; sentence: string }[]>(`
import json
from analysis import live, plain
out = []
def add(state):
    out.append({"state": state, "sentence": live.sentence(state)})
ev0 = {k: 0 for k in live.EVIDENCE_KEYS}
def verdict(state, basis=None, **ev):
    return {"state": state, "basis": basis, "reason": None, "file_id": "f1", "evidence": {**ev0, **ev}}
for kind in live.ACTIVITY_KINDS:
    for role in plain.ROLES:
        for files in (0, 1, 2, 3, 21):
            for since in (0, 59, 60, 61, 119, 120, 1260):
                for attempt in (0, 1, 2, 11):
                    for calls in (0, 1, 4, 25):
                        add({"activity": {"kind": kind, "role": role, "attempt": attempt, "since_s": since,
                                          "files": files, "calls": calls, "file_id": "f1"},
                             "verdict": verdict(None), "map": {"files": [], "files_total": 0}})
for stuck in (0, 59, 60, 360, 1320):
    add({"verdict": verdict("circling", "consecutive_failures", stuck_s=stuck)})
for n in (2, 4, 11, 22):
    for role in plain.ROLES:
        add({"verdict": verdict("circling", "causes:file_churn_with_failures", churn_writes=n),
             "map": {"files": [{"id": "f1", "role": role, "reads": 1, "edits": n}], "files_total": 1}})
    add({"verdict": verdict("circling", "causes:file_churn_with_failures", churn_writes=n)})
    add({"verdict": verdict("circling", "causes:repeated_call", repeats=n)})
    add({"verdict": verdict("lost", "edits_to_unread_files", blind_edits=n)})
for files, commits in ((0, 0), (0, 1), (1, 0), (1, 3), (2, 0), (21, 2)):
    add({"verdict": verdict("done", "turn_ended", files_changed=files, commits=commits)})
for n in (0, 1, 2, 3, 21):
    for since in (0, 75, 900):
        add({"activity": {"kind": "waiting_on_you", "role": "unknown", "attempt": 0, "since_s": since,
                          "files": 0, "calls": 0, "file_id": None},
             "verdict": verdict("waiting", live.BACKGROUND_BASIS, background=n)})
        add({"activity": {"kind": "waiting_on_you", "role": "unknown", "attempt": 0, "since_s": since,
                          "files": 0, "calls": 0, "file_id": None},
             "verdict": verdict("waiting", "turn_ended", background=n)})
add({})
add({"verdict": verdict(None)})
print(json.dumps(out))
`);
    expect(states!.length).toBeGreaterThan(20_000);
    const wrong = states!.filter((s) => renderLiveSentence(s.state) !== s.sentence).slice(0, 5);
    expect(wrong.map((w) => [w.sentence, renderLiveSentence(w.state)])).toEqual([]);
    for (const s of new Set(states!.map((x) => x.sentence))) expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
  });
});

describe('Show details on Lock Screen, off', () => {
  const ctx = { nowMs: NOW, creature: 'owl', runningCount: 1, details: false, runningTotal: 2 };

  test('the card says Builda and how many are running, and nothing a session is doing', () => {
    const s = row('a', {}, { lines_removed_agent: 88 });
    const st = toState(s, waiting(240), ctx);
    expect(toAttrs(s, false).repo).toBe(DETAILS_OFF_TITLE);
    expect(st.sentence).toBe(lockScreenWithoutDetails(2));
    expect(st.sentence).toBe('Builda · 2 running');
    expect(st.phase).toBe('working');
    expect([st.trajectory, st.progress, st.filesChanged, st.etaEpoch, st.sinceEpoch]).toEqual(['none', -1, -1, null, null]);
    expect([st.linesAdded, st.linesRemoved, st.commits]).toEqual([null, null, null]);
    expect(JSON.stringify([toAttrs(s, false), st]).includes('builder needs you')).toBe(false);
    const circling = toState(s, { ...working(), verdict: { state: 'circling', basis: 'consecutive_failures', evidence: { stuck_s: 400 } } }, ctx);
    expect(circling.trajectory).toBe('none');
    // a finished card still says it finished, and no more
    const final = toState(row('f', { state: 'final' }), null, ctx);
    expect([final.phase, final.sentence, final.commits]).toEqual(['done', 'Finished', null]);
  });

  test('the plan starts cards named Builda and never alerts with the repository or the sentence', () => {
    const base = { liveStates: {}, activitiesEnabled: true, creature: 'crab' as const, nowMs: NOW, details: false };
    const first = planSync({ ...base, sessions: [row('a'), row('b')], liveStates: { a: working(), b: working() }, tracked: new Map() });
    for (const a of first.actions) {
      const start = a as Extract<SyncAction, { kind: 'start' }>;
      expect(start.attrs.repo).toBe(DETAILS_OFF_TITLE);
      expect(start.state.sentence).toBe('Builda · 2 running');
    }
    const tracked = apply(first);
    // a minute later (the drawn minute moves the content key, so the card does update) and in
    // needs you: the update goes out, with no alert
    const into = planSync({ ...base, nowMs: NOW + 60_000, sessions: [row('a'), row('b')], liveStates: { a: waiting(240), b: working() }, tracked });
    expect(into.actions.some((a) => a.kind === 'update' && a.sessionId === 'a')).toBe(true);
    for (const a of into.actions) expect('alertTitle' in (a as { opts: object }).opts).toBe(false);
    // details on: the same move alerts, as before
    const on = planSync({ ...base, details: true, sessions: [row('a'), row('b')], liveStates: { a: waiting(240), b: working() }, tracked: apply(planSync({ ...base, details: true, sessions: [row('a'), row('b')], liveStates: { a: working(), b: working() }, tracked: new Map() })) });
    expect(on.actions.some((a) => a.kind === 'update' && a.opts.alertTitle === 'builder needs you')).toBe(true);
  });
});

describe('the native palette is the tokens, generated', () => {
  const palette = readFileSync(join(ROOT, 'targets/widget/_shared/Palette.swift'), 'utf8');
  const srgb = (hex: string) => `srgb(0x${hex.slice(1, 3)}, 0x${hex.slice(3, 5)}, 0x${hex.slice(5, 7)})`;

  test('Palette.swift is emitted by gen_tokens.py, never written by hand', () => {
    expect(palette.startsWith('// GENERATED by scripts/gen_tokens.py from design/tokens.json')).toBe(true);
    // the only constructor is the sRGB one: the bare Color(red:green:blue:) is Display P3
    const code = palette.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(code).not.toMatch(/Color\(red:/);
    expect(palette).toContain('Color(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: 1)');
  });

  test('every hue, dark and light, and every creature\'s hue, as the app resolves them', () => {
    for (const name of HUE_NAMES) {
      const t = designTokens.spectrum.hues[name];
      for (const tone of [t.dark, t.partner, t.light, t.lightText, t.lightPartner]) expect(palette).toContain(srgb(tone));
      expect(palette).toContain(`case .${name}:`);
      // the light widget's word is the 4.5:1 text tone, its mark the 3:1 tone
      expect(hue(name, 'light').text).toBe(t.lightText);
      expect(hue(name, 'light').ink).toBe(t.light);
    }
    for (const [creature, name] of Object.entries(designTokens.spectrum.creature)) {
      if (creature === 'bit') continue;
      expect(palette).toContain(`case "${creature}": return hue(.${name}, dark: dark)`);
    }
    expect(palette).toContain(`static let crewRing: [String] = [${CREW_RING.map((c) => `"${c}"`).join(', ')}]`);
  });

  test('the surfaces draw sessions in their hue, never the brand\'s amber', () => {
    for (const f of ['LiveActivityViews.swift', 'HomeWidgetViews.swift', 'LiveMarks.swift']) {
      const src = readFileSync(join(ROOT, 'targets/widget/_shared', f), 'utf8');
      expect({ f, amber: src.includes('BuilderPalette.amber') }).toEqual({ f, amber: false });
    }
    const island = readFileSync(join(ROOT, 'targets/widget/BuilderLiveActivity.swift'), 'utf8');
    expect(island).toContain('.keylineTint(d.hue.ink)');
  });

  test('the widget says Builda in the gallery', () => {
    const widget = readFileSync(join(ROOT, 'targets/widget/BuilderHomeWidget.swift'), 'utf8');
    expect(widget).toContain('.configurationDisplayName("Builda")');
    expect(readFileSync(join(ROOT, 'targets/widget/expo-target.config.js'), 'utf8')).toContain("displayName: 'Builda'");
  });

  test('the harness marks are the owner\'s SVGs, generated for SwiftUI', () => {
    const marks = readFileSync(join(ROOT, 'targets/widget/_shared/HarnessMarks.swift'), 'utf8');
    expect(marks.startsWith('// GENERATED by scripts/gen_harness_logos.py')).toBe(true);
    for (const id of ['claude_code', 'codex', 'cursor_ide', 'cursor_agent', 'gemini_cli', 'cline', 'opencode']) {
      expect(marks).toContain(`case "${id}": return`);
    }
    // Aider has no mark of its own: the native surfaces draw the phone's pixel glyph for it, the
    // same `>_` frame (HARNESS_GLYPHS.aider), one rectangle per run of drawn cells at 1.5 units a
    // cell. FOUND IN THE CAPTURE PASS (2026-09-14): its Lock Screen card had no mark at all.
    expect(marks).toContain('case "aider": return "aider-pixel"');
    const body = marks.split('case 11: // aider-pixel, layer 1')[1]!.split(/\n\s*case \d+:|\n\s*default:/)[0]!;
    const runs = HARNESS_GLYPHS.aider.flatMap((row, y) => [...row.matchAll(/b+/g)].map((m) => [m.index! * 1.5, y * 1.5]));
    expect(body.match(/p\.move\(to:/g)?.length).toBe(runs.length);
    for (const [x, y] of runs) expect(body).toContain(`p.move(to: CGPoint(x: ${x}, y: ${y}))`);
  });
});

describe('the foreground poll\'s pure halves', () => {
  test('a row gone from the live list since the last pass finished', () => {
    expect(finishedSince(['a', 'b', 'c'], [row('b')])).toEqual(['a', 'c']);
    expect(finishedSince([], [row('a')])).toEqual([]);
  });

  test('the widget\'s week comes from the graph, and attended time it does not have is null, not the active figure', () => {
    const graph = [{ date: '2026-09-13', active_seconds: 9 * 3600 }, { date: '2026-09-12', active_seconds: 3 * 3600 }];
    // 09:41 UTC is 05:41 in New York and past 04:00 in every US zone, so the builder day is the 13th here
    const t = todayFromProfile(graph, Date.parse('2026-09-13T15:00:00Z'))!;
    expect(t.attendedSeconds).toBeNull();
    expect(t.week).toHaveLength(7);
    expect(t.week[6]).toBe(5);
    expect(todayFromProfile(null, NOW)).toBeNull();
  });

  test('the poll runs at mission control\'s cadence, one constant in two files held equal', () => {
    const hook = readFileSync(join(ROOT, 'src/live/useLiveSurfaces.ts'), 'utf8');
    const mission = readFileSync(join(ROOT, 'src/live/LiveSessions.tsx'), 'utf8');
    const a = /export const LIVE_SURFACE_MS = ([\d_]+);/.exec(hook)![1];
    const b = /export const LIVE_REFRESH_MS = ([\d_]+);/.exec(mission)![1];
    expect(a).toBe(b);
    // and it is mounted once, at the root, where every screen shares it
    expect(readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8')).toContain('useLiveSurfaces(onboarded === true)');
  });
});
