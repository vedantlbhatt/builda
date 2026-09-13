/**
 * Mission control's rules (`src/live/mission.ts`, DESIGN-DIRECTION 7.1): the order and that it is
 * the Lock Screen's order, the 15 second hold and the finger rule, the ten minutes a finished
 * tile stays, every word a tile and the live bar say, the five screen states, and no dashes.
 *
 * Rows are built as the server serves them: `SessionDetail` with the GENERATED `LiveState` on
 * it, so a spec change that these literals no longer satisfy is a tsc failure here.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import type { LiveEta, LiveEvidence, LiveState } from '../src/generated/live';
import {
  ageSecondsOf,
  agedWire,
  barModel,
  countsOf,
  elapsedLabel,
  EMPTY_HOLD,
  etaDetail,
  etaLine,
  FINISHED_HORIZON_SECONDS,
  FINISHED_SHOW_MS,
  finishedMeta,
  holdOrder,
  HOLD_MAX_MS,
  isHeld,
  isStale,
  landedCommits,
  landedLines,
  lastFinished,
  leftLabel,
  missionOrderIds,
  missionSample,
  missionScreen,
  noteFinishes,
  parseSample,
  refusalLine,
  RESORT_MIN_MS,
  SAMPLE_KINDS,
  summaryLine,
  summaryParts,
  TILE_HEIGHT,
  tileHeight,
  tileModel,
  tileWidth,
  topNeedsYou,
  toWire,
  visibleRows,
  type HeldOrder,
  type TileModel,
} from '../src/live/mission';
import { planSync } from '../src/live/surface';
import { clockOf } from '../src/you/numbers';

const NOW = Date.parse('2026-09-13T09:41:00Z');
const MIN = 60_000;

// ------------------------------------------------------------------ helpers

const EVIDENCE: LiveEvidence = {
  window_calls: 25,
  errors_now: 0,
  errors_before: 0,
  new_files: 0,
  checkpoints: 0,
  repeats: 0,
  churn_writes: 0,
  fail_run: 0,
  blind_edits: 0,
  stuck_s: 0,
  files_changed: 0,
  commits: 0,
  background: 0,
};

const REFUSED: LiveEta = {
  elapsed_s: null,
  typical_s: null,
  p25_s: null,
  p75_s: null,
  remaining_s: null,
  n: 5,
  needed: 10,
  unattended: false,
  basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
  reason: 'too_few_sessions',
};

/** RideGT's measured median run, 20.9 active minutes, twelve minutes in. */
const ANSWERED: LiveEta = {
  elapsed_s: 720,
  typical_s: 1254,
  p25_s: 540,
  p75_s: 2646,
  remaining_s: 534,
  n: 61,
  needed: 10,
  unattended: false,
  basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
  reason: null,
};

function live(over: Partial<LiveState> = {}, computedAgoS = 20): LiveState {
  return {
    live_version: 1,
    computed_at: new Date(NOW - computedAgoS * 1000).toISOString(),
    activity: { kind: 'editing', role: 'source', attempt: 3, since_s: 95, files: 1, calls: 3, file_id: null },
    verdict: { state: 'converging', basis: 'error_rate_down_and_new_files', reason: null, file_id: null, evidence: EVIDENCE },
    eta: ANSWERED,
    decisions: [],
    needs_you: { score: 5, reason: 'running_fine' },
    map: { files: [], files_total: 9 },
    timelapse: null,
    sample: { events: 400, tool_calls: 120, segments: 6, tokens: null },
    ...over,
  };
}

const waitingState = (sinceS: number, computedAgoS = 20): LiveState =>
  live(
    {
      activity: { kind: 'waiting_on_you', role: 'unknown', attempt: 0, since_s: sinceS, files: 0, calls: 0, file_id: null },
      verdict: { state: 'waiting', basis: 'turn_ended', reason: null, file_id: null, evidence: EVIDENCE },
      eta: REFUSED,
      needs_you: { score: 80 + Math.min(20, Math.floor(sinceS / 60)), reason: 'waiting_for_input' },
    },
    computedAgoS
  );

const circlingState = (): LiveState =>
  live({
    activity: { kind: 'testing', role: 'test', attempt: 0, since_s: 20, files: 0, calls: 1, file_id: null },
    verdict: { state: 'circling', basis: 'consecutive_failures', reason: null, file_id: null, evidence: { ...EVIDENCE, fail_run: 5, stuck_s: 372 } },
    needs_you: { score: 66, reason: 'circling' },
  });

const lostState = (): LiveState =>
  live({
    verdict: { state: 'lost', basis: 'edits_to_unread_files', reason: null, file_id: null, evidence: { ...EVIDENCE, blind_edits: 4 } },
    needs_you: { score: 60, reason: 'lost' },
  });

const startingState = (sinceS = 50): LiveState =>
  live({
    activity: { kind: 'reading', role: 'docs', attempt: 0, since_s: sinceS, files: 3, calls: 5, file_id: null },
    verdict: { state: 'starting', basis: 'segment_tool_calls', reason: null, file_id: null, evidence: EVIDENCE },
    eta: REFUSED,
  });

function row(id: string, over: Partial<SessionDetail> = {}, stats: Record<string, unknown> = {}): SessionDetail {
  return {
    id,
    client_session_id: `${id}-c`,
    harness: 'claude_code',
    repo_name: 'builder',
    started_at: new Date(NOW - 12 * MIN).toISOString(),
    ended_at: new Date(NOW - 20_000).toISOString(),
    updated_at: new Date(NOW - 20_000).toISOString(),
    active_seconds: 12 * 60,
    idle_seconds: 0,
    local_date: '2026-09-13',
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'live',
    attended_seconds: 12 * 60,
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
      lines_removed_agent: 88,
      commit_count: 3,
      agent_line_bucket: 'some',
      attrib_confidence: 'high',
      ...stats,
    },
    ...over,
  };
}

const final = (id: string, endedAgoMin: number, stats: Record<string, unknown> = {}): SessionDetail =>
  row(id, { state: 'final', end_reason: 'idle_gap', ended_at: new Date(NOW - endedAgoMin * MIN).toISOString(), started_at: new Date(NOW - (endedAgoMin + 47) * MIN).toISOString() }, stats);

const at = (iso: string) => clockOf(Date.parse(iso));

// ------------------------------------------------------------------ geometry and formatting

describe('the tile is the design\'s box', () => {
  test('two per row inside 16pt gutters and a 12pt gap: 174.5pt on a 393pt phone', () => {
    expect(tileWidth(393)).toBe(174.5);
    expect(tileWidth(402)).toBe(179);
  });

  test('188pt tall, growing with Dynamic Type to 1.3x and never shrinking', () => {
    expect(tileHeight(1)).toBe(TILE_HEIGHT);
    expect(tileHeight(0.82)).toBe(188);
    expect(tileHeight(1.2)).toBe(226);
    expect(tileHeight(3.1)).toBe(244);
    expect(tileHeight(Number.NaN)).toBe(188);
  });

  test('elapsed reads like the widget: whole minutes, hours with two digit minutes', () => {
    expect(elapsedLabel(0)).toBe('0m');
    expect(elapsedLabel(59)).toBe('0m');
    expect(elapsedLabel(22 * 60 + 50)).toBe('22m');
    expect(elapsedLabel(65 * 60)).toBe('1h 05m');
    expect(elapsedLabel(130 * 60)).toBe('2h 10m');
    expect(elapsedLabel(-5)).toBe('0m');
  });

  test('time left is "about", never under a minute', () => {
    expect(leftLabel(514)).toBe('about 9m left');
    expect(leftLabel(20)).toBe('about 1m left');
    expect(leftLabel(65 * 60)).toBe('about 1h 05m left');
  });
});

// ------------------------------------------------------------------ order

describe('the order is the engine\'s, and the Lock Screen\'s', () => {
  test('needs you first, the longest wait first', () => {
    const rows = [row('fine', { live_state: live() }), row('short', { live_state: waitingState(120) }), row('long', { live_state: waitingState(600) })];
    expect(missionOrderIds(rows, NOW)).toEqual(['long', 'short', 'fine']);
  });

  test('then circling above lost (the engine\'s bases, 60 and 55), then converging and a fresh start by who has run longest', () => {
    const rows = [
      row('start', { live_state: startingState(50) }),
      row('conv', { live_state: live() }),
      row('lost', { live_state: lostState() }),
      row('circ', { live_state: circlingState() }),
    ];
    // converging and starting both run fine at 5; converging has been at it 95 s, the start 50 s.
    expect(missionOrderIds(rows, NOW)).toEqual(['circ', 'lost', 'conv', 'start']);
  });

  test('a row with no engine state ranks by the engine\'s own table: quiet 35 above running 5', () => {
    const quiet = row('quiet', { ended_at: new Date(NOW - 20 * MIN).toISOString() });
    // Both running rows score 5; the tie goes to who has been at it longest: the converging
    // edit 95 s, the bare row's last record 20 s ago.
    expect(missionOrderIds([row('bare'), quiet, row('conv', { live_state: live() })], NOW)).toEqual(['quiet', 'conv', 'bare']);
  });

  test('a stale row goes after every current one, in the engine\'s order among themselves', () => {
    const old = (id: string, st: LiveState) =>
      row(id, { updated_at: new Date(NOW - 40 * MIN).toISOString(), live_state: { ...st, computed_at: new Date(NOW - 40 * MIN).toISOString() } });
    const rows = [old('oldWait', waitingState(600)), row('fine', { live_state: live() }), old('oldCirc', circlingState()), row('now', { live_state: waitingState(60) })];
    expect(missionOrderIds(rows, NOW)).toEqual(['now', 'fine', 'oldWait', 'oldCirc']);
  });

  test('the first tile is the session the Lock Screen starts its first card for', () => {
    const s = missionSample('all', NOW);
    const running = s.live;
    const order = missionOrderIds(running, NOW);
    const plan = planSync({
      sessions: running,
      liveStates: Object.fromEntries(running.map((r) => [r.id, toWire(r.live_state)])),
      tracked: new Map(),
      activitiesEnabled: true,
      nowMs: NOW,
    });
    const starts = plan.actions.filter((a) => a.kind === 'start').map((a) => a.sessionId);
    expect(starts[0]).toBe(order[0]!);
    expect(starts).toEqual(order.slice(0, starts.length));
  });

  test('the sample grid lands in the order the design notes describe', () => {
    const grid = missionSample('grid', NOW);
    const rows = visibleRows(grid.live, grid.finals, grid.seen, NOW);
    expect(missionOrderIds(rows, NOW)).toEqual([
      'sample-needs-you',
      'sample-circling',
      'sample-lost',
      'sample-finished',
      'sample-converging',
      'sample-starting',
    ]);
    const all = missionSample('all', NOW);
    expect(missionOrderIds(visibleRows(all.live, all.finals, all.seen, NOW), NOW)).toEqual([
      'sample-needs-you',
      'sample-circling',
      'sample-lost',
      'sample-stalled',
      'sample-finished',
      'sample-background',
      'sample-converging',
      'sample-starting',
    ]);
  });
});

// ------------------------------------------------------------------ the 15 second hold

describe('the order moves at most every 15 s and never under a finger', () => {
  const T0 = NOW;

  test('nothing on screen: the target is placed at once, and placing counts as a sort', () => {
    const r = holdOrder(EMPTY_HOLD, ['a', 'b'], T0, false);
    expect(r.order).toEqual({ ids: ['a', 'b'], sortedAtMs: T0 });
    expect(r.resortInMs).toBeNull();
    // Even with a finger down: an empty grid has nothing under the finger to move.
    expect(holdOrder(EMPTY_HOLD, ['a'], T0, true).order.ids).toEqual(['a']);
  });

  test('a new order inside the 15 s waits, and says how long', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const r = holdOrder(held, ['b', 'a'], T0 + 4_000, false);
    expect(r.order.ids).toEqual(['a', 'b']);
    expect(r.resortInMs).toBe(RESORT_MIN_MS - 4_000);
  });

  test('at 15 s it moves, and the clock restarts', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const r = holdOrder(held, ['b', 'a'], T0 + RESORT_MIN_MS, false);
    expect(r.order).toEqual({ ids: ['b', 'a'], sortedAtMs: T0 + RESORT_MIN_MS });
    expect(r.resortInMs).toBeNull();
  });

  test('never while a finger is down, however long it has been', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const r = holdOrder(held, ['b', 'a'], T0 + 10 * RESORT_MIN_MS, true);
    expect(r.order).toBe(held);
    expect(r.resortInMs).toBeNull();
  });

  test('under a finger an arrival goes after the last tile, where it moves nobody', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const r = holdOrder(held, ['c', 'b', 'a'], T0 + 60_000, true);
    expect(r.order.ids).toEqual(['a', 'b', 'c']);
    expect(r.order.sortedAtMs).toBe(T0);
  });

  test('under a finger a tile that left keeps its place; after, it leaves and the rest close up', () => {
    const held: HeldOrder = { ids: ['a', 'b', 'c'], sortedAtMs: T0 };
    const down = holdOrder(held, ['a', 'c'], T0 + 2_000, true);
    expect(down.order.ids).toEqual(['a', 'b', 'c']);
    const up = holdOrder(down.order, ['a', 'c'], T0 + 3_000, false);
    // A removal, not a re-sort: the 15 s clock is where it was.
    expect(up.order).toEqual({ ids: ['a', 'c'], sortedAtMs: T0 });
    expect(up.resortInMs).toBeNull();
  });

  test('inside the 15 s an arrival is added at the end and sorted in when the time is up', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const early = holdOrder(held, ['c', 'a', 'b'], T0 + 5_000, false);
    expect(early.order.ids).toEqual(['a', 'b', 'c']);
    expect(early.resortInMs).toBe(10_000);
    const due = holdOrder(early.order, ['c', 'a', 'b'], T0 + RESORT_MIN_MS, false);
    expect(due.order.ids).toEqual(['c', 'a', 'b']);
  });

  test('the same order is never a sort: nothing moves, so no clock restarts', () => {
    const held: HeldOrder = { ids: ['a', 'b'], sortedAtMs: T0 };
    const r = holdOrder(held, ['a', 'b'], T0 + 40_000, false);
    expect(r.order).toBe(held);
    expect(r.resortInMs).toBeNull();
  });

  test('a finger counts as down until its end arrives, or for a minute when it never does', () => {
    expect(isHeld(null, T0)).toBe(false);
    expect(isHeld(T0 - 1_000, T0)).toBe(true);
    expect(isHeld(T0 - HOLD_MAX_MS, T0)).toBe(false);
  });

  test('the moving creature is the first needs you tile on screen, and never a stale one', () => {
    const models = new Map<string, Pick<TileModel, 'kind' | 'stale'>>([
      ['w', { kind: 'working', stale: false }],
      ['old', { kind: 'needsYou', stale: true }],
      ['n1', { kind: 'needsYou', stale: false }],
      ['n2', { kind: 'needsYou', stale: false }],
    ]);
    expect(topNeedsYou(['w', 'old', 'n1', 'n2'], models)).toBe('n1');
    expect(topNeedsYou(['w'], models)).toBeNull();
  });
});

// ------------------------------------------------------------------ one tile

describe('what a tile says', () => {
  test('needs you: amber "needs you" in the elapsed time\'s place, what it waits for, and since when', () => {
    const m = tileModel(row('n', { live_state: waitingState(240, 60) }), NOW);
    expect(m.kind).toBe('needsYou');
    expect(m.corner).toEqual({ text: 'needs you', tone: 'accent', weight: 600 });
    // 240 s at computed_at, a minute ago: five minutes now, aged for display.
    expect(m.sentence).toBe('Waiting on you for five minutes');
    // computed 09:40:00Z, waiting 240 s before that: since 09:36.
    expect(m.eta).toBe(`since ${at('2026-09-13T09:36:00Z')}`);
    expect(m.verdict).toBeNull();
    expect(m.dim).toBe(false);
  });

  test('working: the elapsed time, the drawn verdict, files touched and the ETA aged to now', () => {
    const m = tileModel(row('c', { live_state: live() }), NOW);
    expect(m.kind).toBe('working');
    expect(m.corner).toEqual({ text: '12m', tone: 'dim', weight: 400 });
    expect(m.sentence).toBe('Rewriting a source file, third attempt');
    expect(m.verdict).toBe('converging');
    expect(m.files).toBe(9);
    // 534 s left at computed_at, twenty seconds ago: 514 s, about nine minutes.
    expect(m.eta).toBe('about 9m left');
  });

  test('the ETA line: past the typical run, refused, and none while circling or lost', () => {
    expect(etaLine({ ...ANSWERED, remaining_s: 30 }, 60, 'converging')).toBe('longer than usual');
    expect(etaLine({ ...ANSWERED, remaining_s: 0 }, 0, null)).toBe('longer than usual');
    expect(etaLine(REFUSED, 0, null)).toBe('no ETA yet');
    expect(etaLine(null, 0, null)).toBe('no ETA yet');
    expect(etaLine(ANSWERED, 0, 'circling')).toBeNull();
    expect(etaLine(ANSWERED, 0, 'lost')).toBeNull();
  });

  test('circling: the stuck duration aged, the verdict, and no countdown', () => {
    const m = tileModel(row('c', { live_state: circlingState() }), NOW);
    expect(m.sentence).toBe('Stuck on the same failing command for six minutes');
    expect(m.verdict).toBe('circling');
    expect(m.eta).toBeNull();
  });

  test('lost: the engine\'s words and the dashed glyph; a private repository says so', () => {
    const m = tileModel(row('l', { repo_name: null, live_state: lostState() }), NOW);
    expect(m.sentence).toBe('Editing four files it has not read yet');
    expect(m.verdict).toBe('lost');
    expect(m.repo).toBe('private repo');
  });

  test('a fresh start says "starting" where a verdict would be drawn', () => {
    const m = tileModel(row('s', { live_state: startingState() }), NOW);
    expect(m.verdict).toBeNull();
    expect(m.stateWord).toBe('starting');
    expect(m.sentence).toBe('Reading the docs');
    expect(m.eta).toBe('no ETA yet');
  });

  test('no new output: dim, the idle sentence aged, and since when', () => {
    const idle = live({
      activity: { kind: 'idle', role: 'unknown', attempt: 0, since_s: 360, files: 0, calls: 0, file_id: null },
      verdict: { state: null, basis: null, reason: 'no_rule_fired', file_id: null, evidence: EVIDENCE },
      needs_you: { score: 41, reason: 'idle' },
    });
    const m = tileModel(row('i', { live_state: idle }), NOW);
    expect(m.kind).toBe('stalled');
    expect(m.dim).toBe(true);
    expect(m.sentence).toBe('No new output for six minutes');
    expect(m.verdict).toBeNull();
    expect(m.eta).toBe(`since ${at('2026-09-13T09:34:00Z')}`);
  });

  test('without the engine: the presence line, no file count, no ETA and never "needs you"', () => {
    const m = tileModel(row('bare', { live_state: null }), NOW);
    expect(m.kind).toBe('working');
    expect(m.sentence).toBe("You're at the keyboard");
    expect(m.files).toBeNull();
    expect(m.verdict).toBeNull();
    expect(m.eta).toBe('no ETA yet');
  });

  test('stale: nothing may read as current; the timeless sentence, "as of", no amber, dim', () => {
    const s = row('old', { updated_at: new Date(NOW - 40 * MIN).toISOString(), live_state: waitingState(240, 40 * 60) });
    expect(isStale(s, NOW)).toBe(true);
    const m = tileModel(s, NOW);
    expect(m.kind).toBe('needsYou');
    expect(m.stale).toBe(true);
    expect(m.corner.tone).toBe('dim');
    expect(m.sentence).toBe('Waiting on you');
    expect(m.eta).toBe(`as of ${at('2026-09-13T09:01:00Z')}`);
    expect(m.dim).toBe(true);
    expect(countsOf([m]).needsYou).toBe(0);
  });

  test('a final row is finished, with what it landed in place of files and the ETA', () => {
    const m = tileModel(final('f', 16), NOW);
    expect(m.kind).toBe('finished');
    expect(m.corner).toEqual({ text: 'finished', tone: 'dim', weight: 600 });
    expect(m.sentence).toBe('Finished');
    expect(m.files).toBeNull();
    expect(m.eta).toBeNull();
    expect(landedLines(m.landed!)).toBe('+420 -88');
    expect(landedCommits(m.landed!)).toBe('3 commits');
  });

  test('landed counts: more than none, a measured zero said once, an unknown said never', () => {
    const one = tileModel(final('a', 5, { lines_added_agent: 1204, lines_removed_agent: undefined, commit_count: 1 }), NOW).landed!;
    expect(landedLines(one)).toBe('+1,204');
    expect(landedCommits(one)).toBe('1 commit');
    const zero = tileModel(final('z', 5, { lines_added_agent: 0, lines_removed_agent: 0, commit_count: 0 }), NOW).landed!;
    expect(landedLines(zero)).toBe('no lines');
    expect(landedCommits(zero)).toBe('no commits');
    const none = tileModel({ ...final('n', 5), stats: null }, NOW).landed!;
    expect(landedLines(none)).toBeNull();
    expect(landedCommits(none)).toBeNull();
    // Lines measured at zero with a commit is not "nothing": the commit is said, the zero is not.
    const commitOnly = tileModel(final('c', 5, { lines_added_agent: 0, lines_removed_agent: 0, commit_count: 2 }), NOW).landed!;
    expect(landedLines(commitOnly)).toBeNull();
    expect(landedCommits(commitOnly)).toBe('2 commits');
  });

  test('aging moves only the durations a sentence speaks, never a count', () => {
    const s = row('c', { live_state: circlingState() });
    const aged = agedWire(s, NOW)!;
    expect(ageSecondsOf(s, NOW)).toBe(20);
    expect(aged.activity?.since_s).toBe(40);
    expect(aged.verdict?.evidence?.stuck_s).toBe(392);
    expect(aged.verdict?.evidence?.fail_run).toBe(5);
    expect(aged.needs_you).toEqual({ score: 66, reason: 'circling' });
  });

  test('the key moves when a word moves and holds while nothing drawn changes', () => {
    const s = row('c', { live_state: live() });
    expect(tileModel(s, NOW).key).toBe(tileModel(s, NOW + 1_000).key);
    expect(tileModel(s, NOW).key).not.toBe(tileModel(s, NOW + 2 * MIN).key);
  });

  test('VoiceOver hears the whole tile in one label', () => {
    const m = tileModel(row('c', { live_state: live() }), NOW);
    expect(m.label).toBe('builder, Claude Code, 12m in, Rewriting a source file, third attempt, converging, 9 files touched, about 9m left');
  });
});

describe('the ETA refusal, for the session screen', () => {
  test('in the engine\'s words, from the code and its numbers', () => {
    expect(etaDetail(REFUSED)).toBe('No ETA yet: 5 finished sessions on this repository, 10 needed.');
    expect(etaDetail({ ...REFUSED, reason: 'repo_unresolved', n: null })).toBe(
      'No ETA yet: the repository this session runs in could not be resolved.'
    );
    expect(etaDetail(ANSWERED)).toBeNull();
    expect(etaDetail(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ finished tiles

describe('a finished tile stays ten minutes from when the phone saw it finish', () => {
  test('noteFinishes stamps what left the live list, forgets what came back, drops what is old', () => {
    const seen = noteFinishes(new Map([['old', NOW - FINISHED_SHOW_MS - 1]]), ['a', 'b'], ['b'], NOW);
    expect([...seen]).toEqual([['a', NOW]]);
    const again = noteFinishes(seen, ['a'], ['a'], NOW + 1_000);
    expect(again.has('a')).toBe(false);
    // A second look does not restamp: the finish is when it was first seen.
    expect(noteFinishes(seen, ['a'], [], NOW + 5 * MIN).get('a')).toBe(NOW);
  });

  test('shown for ten minutes, then gone; never when it finished while nobody looked', () => {
    const f = final('f', 16);
    expect(visibleRows([], [f], new Map([['f', NOW - 2 * MIN]]), NOW).map((s) => s.id)).toEqual(['f']);
    expect(visibleRows([], [f], new Map([['f', NOW - FINISHED_SHOW_MS]]), NOW)).toEqual([]);
    expect(visibleRows([], [f], new Map(), NOW)).toEqual([]);
    const ancient = final('x', FINISHED_HORIZON_SECONDS / 60 + 1);
    expect(visibleRows([], [ancient], new Map([['x', NOW - MIN]]), NOW)).toEqual([]);
  });

  test('a live row is always shown, and a row is never shown twice', () => {
    const l = row('l', { live_state: live() });
    expect(visibleRows([l], [{ ...l, state: 'final' }], new Map([['l', NOW]]), NOW).map((s) => s.id)).toEqual(['l']);
  });

  test('a turn the engine called done with no wait behind it leaves ten minutes after it ended', () => {
    const done = live({ activity: null, verdict: { state: 'done', basis: 'turn_ended', reason: null, file_id: null, evidence: { ...EVIDENCE, files_changed: 3 } } }, 11 * 60);
    expect(visibleRows([row('d', { live_state: done })], [], new Map(), NOW)).toEqual([]);
    const fresh = live({ activity: null, verdict: { state: 'done', basis: 'turn_ended', reason: null, file_id: null, evidence: { ...EVIDENCE, files_changed: 3 } } }, 60);
    const shown = visibleRows([row('d', { live_state: fresh })], [], new Map(), NOW);
    expect(shown.map((s) => s.id)).toEqual(['d']);
    expect(tileModel(shown[0]!, NOW).sentence).toBe('Finished, with three files changed');
  });
});

// ------------------------------------------------------------------ the screen

describe('the screen', () => {
  test('the one row summary leaves out what has nothing in it', () => {
    const models = [
      { kind: 'needsYou', stale: false },
      { kind: 'working', stale: false },
      { kind: 'stalled', stale: false },
      { kind: 'finished', stale: false },
    ] as const;
    const c = countsOf([...models]);
    expect(c).toEqual({ running: 3, needsYou: 1, finished: 1 });
    expect(summaryLine(c)).toBe('3 running · 1 needs you · 1 finished');
    expect(summaryParts(c).filter((p) => p.accent).map((p) => p.text)).toEqual(['1 needs you']);
    expect(summaryLine({ running: 0, needsYou: 0, finished: 1 })).toBe('1 finished');
    expect(summaryLine({ running: 0, needsYou: 0, finished: 0 })).toBeNull();
  });

  test('the refusal is a sentence from the data, about the rows that came without a state', () => {
    const withState = row('a', { live_state: live() });
    const bare = (id: string) => row(id, { live_state: null });
    expect(refusalLine([withState])).toBeNull();
    expect(refusalLine([withState, withState, bare('b')])).toBe(
      'One of three sessions does not report what it is doing yet, so it cannot say when it needs you.'
    );
    expect(refusalLine([withState, bare('b'), bare('c')])).toBe(
      'Two of three sessions do not report what they are doing yet, so they cannot say when they need you.'
    );
    expect(refusalLine([bare('b'), bare('c')])).toBe(
      'These sessions do not report what they are doing yet, so they cannot say when they need you.'
    );
    expect(refusalLine([bare('b')])).toBe('This session does not report what it is doing yet, so it cannot say when it needs you.');
    // A finished row has no live state by definition and is not counted.
    expect(refusalLine([withState, final('f', 3)])).toBeNull();
  });

  test('five states, decided once: "Nothing needs you" only after a sync has looked', () => {
    const base = { signedIn: true, synced: true, error: null, savedAt: NOW };
    const one = [row('a')];
    expect(missionScreen({ ...base, signedIn: false, rows: one })).toEqual({ kind: 'signedOut' });
    expect(missionScreen({ ...base, rows: null })).toEqual({ kind: 'loading' });
    expect(missionScreen({ ...base, signedIn: null, rows: [] })).toEqual({ kind: 'loading' });
    expect(missionScreen({ ...base, rows: [] })).toEqual({ kind: 'empty', stale: null });
    expect(missionScreen({ ...base, synced: false, rows: [] })).toEqual({ kind: 'loading' });
    expect(missionScreen({ ...base, synced: false, error: 'down', rows: [] })).toEqual({ kind: 'error', message: 'down' });
    expect(missionScreen({ ...base, error: 'down', rows: [] })).toEqual({ kind: 'empty', stale: { savedAt: NOW, message: 'down' } });
    expect(missionScreen({ ...base, rows: one })).toEqual({ kind: 'ready', stale: null });
    expect(missionScreen({ ...base, error: 'down', savedAt: null, rows: one })).toEqual({ kind: 'ready', stale: { savedAt: null, message: 'down' } });
  });

  test('the empty state\'s one row is the session that finished last', () => {
    const a = final('a', 90);
    const b = final('b', 30);
    expect(lastFinished([a, b, row('live')])?.id).toBe('b');
    expect(lastFinished([])).toBeNull();
    expect(finishedMeta(b, () => 'today')).toBe(`today at ${at('2026-09-13T09:11:00Z')} · ran 47m`);
    expect(finishedMeta(b, () => 'Sep 2')).toBe('Sep 2 · ran 47m');
  });

  test('every sample state is the state it is named for', () => {
    const screenOf = (k: (typeof SAMPLE_KINDS)[number]) => {
      const s = missionSample(k, NOW);
      const rows = s.inputs.signedIn === false ? [] : visibleRows(s.live, s.finals, s.seen, NOW);
      return { screen: missionScreen({ ...s.inputs, rows }), rows };
    };
    expect(screenOf('grid').screen.kind).toBe('ready');
    expect(screenOf('all').rows.length).toBe(8);
    expect(screenOf('empty').screen.kind).toBe('empty');
    expect(screenOf('loading').screen.kind).toBe('loading');
    expect(screenOf('error').screen.kind).toBe('error');
    expect(screenOf('signedout').screen.kind).toBe('signedOut');
    const stale = screenOf('stale');
    expect(stale.screen).toEqual({ kind: 'ready', stale: { savedAt: NOW - 40 * MIN, message: 'Builder is not reachable right now.' } });
    expect(stale.rows.some((r) => isStale(r, NOW))).toBe(true);
    expect(refusalLine(screenOf('refused').rows)).not.toBeNull();
  });

  test('?sample= reads its kinds and nothing else', () => {
    expect(parseSample('1')).toBe('grid');
    expect(parseSample(['all'])).toBe('all');
    expect(parseSample('Stale')).toBe('stale');
    expect(parseSample('nope')).toBeNull();
    expect(parseSample(undefined)).toBeNull();
  });
});

// ------------------------------------------------------------------ the live bar

describe('the live bar mirrors the Lock Screen', () => {
  test('on track: the ring is elapsed over typical aged to now, the minutes left inside it', () => {
    const b = barModel(row('c', { live_state: live() }), NOW);
    expect(b.progress).toBeCloseTo(740 / 1254, 5);
    expect(b.inner).toBe('9m');
    expect(b.ringLabel).toBe('about 9m left');
    expect(b.corner.text).toBe('12m');
  });

  test('waiting on you: an empty track and amber in the corner', () => {
    const b = barModel(row('n', { live_state: waitingState(240) }), NOW);
    expect(b.progress).toBe(0);
    expect(b.inner).toBeNull();
    expect(b.corner).toEqual({ text: 'needs you', tone: 'accent', weight: 600 });
  });

  test('no ETA yet: the dotted track, never a number', () => {
    const b = barModel(row('s', { live_state: startingState() }), NOW);
    expect(b.progress).toBeNull();
    expect(b.inner).toBeNull();
    expect(b.ringLabel).toBe('no ETA yet');
  });

  test('past the typical run: a full ring and no second lap', () => {
    const b = barModel(row('o', { live_state: live({ eta: { ...ANSWERED, elapsed_s: 1300, remaining_s: 0 } }) }), NOW);
    expect(b.progress).toBe(1);
    expect(b.inner).toBeNull();
    expect(b.ringLabel).toBe('running longer than usual');
  });

  test('circling: the arc still says how long, but nothing counts down', () => {
    const b = barModel(row('c', { live_state: circlingState() }), NOW);
    expect(b.progress).toBeGreaterThan(0);
    expect(b.inner).toBeNull();
    expect(b.ringLabel).toBe('circling');
  });

  test('a stale row left live over a night says the day, never a clock that reads as today', () => {
    const s = row('night', { updated_at: new Date(NOW - 26 * 3600_000).toISOString(), live_state: live({}, 26 * 3600) });
    expect(tileModel(s, NOW).eta).toMatch(/^as of [A-Z][a-z]{2} \d{1,2}$/);
  });

  test('stale: the corner says when the numbers were taken', () => {
    const s = row('old', { updated_at: new Date(NOW - 40 * MIN).toISOString(), live_state: live({}, 40 * 60) });
    expect(barModel(s, NOW).corner.text).toBe(`as of ${at('2026-09-13T09:01:00Z')}`);
  });
});

// ------------------------------------------------------------------ copy

describe('no dashes in anything mission control says', () => {
  test('every tile, bar, summary, refusal and meta line, by the phone\'s one dash rule', () => {
    const said: string[] = [];
    for (const kind of SAMPLE_KINDS) {
      const s = missionSample(kind, NOW);
      const rows = [...s.live, ...s.finals];
      for (const r of rows) {
        for (const nowMs of [NOW, NOW + 5 * MIN, NOW + 40 * MIN]) {
          const t = tileModel(r, nowMs);
          said.push(t.corner.text, t.sentence, t.label, t.eta ?? '', t.stateWord ?? '', t.repo);
          if (t.landed) said.push(landedLines(t.landed) ?? '', landedCommits(t.landed) ?? '');
          if (r.state === 'live') {
            const b = barModel(r, nowMs);
            said.push(b.label, b.ringLabel, b.inner ?? '', b.corner.text);
          }
        }
        said.push(etaDetail(r.live_state?.eta) ?? '', finishedMeta(r, () => 'today'));
      }
      said.push(summaryLine(countsOf(rows.map((r) => tileModel(r, NOW)))) ?? '', refusalLine(rows) ?? '');
    }
    const dashed = said.filter((x) => hasDash(x));
    expect(dashed).toEqual([]);
    expect(said.length).toBeGreaterThan(200);
  });
});

// ------------------------------------------------------------------ the kit

describe('mission control builds from the kit', () => {
  // The same rules `screens.test.ts` holds the refit screens to, over the files this screen
  // added (that list is not this screen's to edit). Comments are stripped so prose about a
  // rule never trips it.
  const FILES = ['src/live/MissionTile.tsx', 'src/live/LiveBar.tsx', 'src/live/LiveSessions.tsx', 'app/live.tsx', 'app/(tabs)/now.tsx'];
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const files = FILES.map((name) => ({ name, src: code(readFileSync(join(import.meta.dir, '..', name), 'utf8')) }));

  test('text through <T>, sizes from the roles, radii from the rule, no amber outline, no gradient', () => {
    for (const f of files) {
      const imports = f.src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
      expect({ file: f.name, bareText: imports.some((i) => /[{,\s]Text[,\s}]/.test(i)) }).toEqual({ file: f.name, bareText: false });
      expect({ file: f.name, sizes: f.src.match(/fontSize:\s*\d+/g) ?? [] }).toEqual({ file: f.name, sizes: [] });
      expect({ file: f.name, radii: f.src.match(/borderRadius:\s*\d+/g) ?? [] }).toEqual({ file: f.name, radii: [] });
      expect({ file: f.name, amber: f.src.match(/border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/g) ?? [] }).toEqual({
        file: f.name,
        amber: [],
      });
      expect({ file: f.name, gradient: /Gradient\b/.test(f.src) }).toEqual({ file: f.name, gradient: false });
    }
  });

  test('one animating creature: only the top needs you tile, or a bar that needs you, draws PixelAnimal', () => {
    const tile = files.find((f) => f.name.endsWith('MissionTile.tsx'))!.src;
    expect(tile).toMatch(/\{animate \? \(\s*<PixelAnimal /);
    const grid = files.find((f) => f.name.endsWith('LiveSessions.tsx'))!.src;
    expect(grid).toMatch(/animate=\{m\.id === top\}/);
  });
});
