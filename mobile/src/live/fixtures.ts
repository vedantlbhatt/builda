/**
 * Realistic running sessions for the dev-only `builder://debug/live` route and the tests.
 *
 * Not invented prose: each row carries the engine's live_state (docs/overnight-engine.md
 * section 3) with numbers of the size this repository and RideGT really produce, and its
 * sentence comes out of the phone's port of the engine's renderer (`sentence.ts`). builder has
 * five finished sessions, so the engine refuses it an ETA ("5 finished sessions on this
 * repository, 10 needed"); RideGT has 148 with a median of 20.9 active minutes. The ids are
 * fixed, so opening the link with state=working and then state=needsYou moves the SAME session
 * into needs you, which is what makes the alert fire. The repositories carry the sample's
 * invented names (`mission.SAMPLE_REPOS`), never those two real ones.
 *
 * Pure, so the debug route and `__tests__/liveSurface.test.ts` share one set.
 */

import type { SessionDetail } from '../data/api';
import { SAMPLE_REPOS } from './mission';
import type { LiveStateWire } from './sentence';

export const DEBUG_STATES = ['working', 'needsYou', 'done', 'stalled'] as const;
export type DebugState = (typeof DEBUG_STATES)[number];

export interface DebugLiveRequest {
  state: DebugState | 'end' | null;
  /** How many sessions run, 1 to 4. The first one is in `state`; the rest keep working. */
  n: number;
  /** Also write a widget snapshot. */
  widget: boolean;
  /** Render every surface to PNGs in Documents/live-previews (BuilderLive.renderPreviews). */
  render: boolean;
  /** Draw this creature instead of the builder's own (any ANIMALS id, or bit). */
  creature: string | null;
  /** Seconds until "Not updating", to photograph the stale state without waiting 15 minutes. */
  staleInSeconds: number | null;
  problem: string | null;
}

/**
 * `builder://debug/live?state=working|needsYou|done|stalled|end&n=1..4&widget=1&render=1`
 * `[&creature=owl][&stale=10]`
 */
export function parseDebugLive(params: Record<string, string | string[] | undefined>): DebugLiveRequest {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim();
  };
  const raw = one('state');
  const state = raw === undefined || raw === '' ? null : raw === 'end' || (DEBUG_STATES as readonly string[]).includes(raw) ? (raw as DebugState | 'end') : null;
  const nRaw = Number(one('n') ?? '1');
  const n = Number.isInteger(nRaw) ? Math.max(1, Math.min(4, nRaw)) : 1;
  const flag = (k: string) => ['1', 'true', 'yes'].includes((one(k) ?? '').toLowerCase());
  const widget = flag('widget');
  const render = flag('render');
  const creature = /^[a-z-]{2,20}$/.test(one('creature') ?? '') ? one('creature')! : null;
  const staleRaw = Number(one('stale') ?? 'NaN');
  const staleInSeconds = Number.isInteger(staleRaw) && staleRaw >= 1 && staleRaw <= 3600 ? staleRaw : null;
  let problem: string | null = null;
  if (raw && state === null) problem = `state must be working, needsYou, done, stalled or end, not "${raw}"`;
  else if (state === null && !widget && !render) problem = 'nothing to do: add state=, widget=1 or render=1';
  return { state, n, widget, render, creature, staleInSeconds, problem };
}

const MIN = 60;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function detail(
  id: string,
  repo: string,
  harness: string,
  startedMinAgo: number,
  nowMs: number,
  stats: Partial<NonNullable<SessionDetail['stats']>>,
  extra: Partial<SessionDetail> = {}
): SessionDetail {
  const started = nowMs - startedMinAgo * MIN * 1000;
  return {
    id,
    client_session_id: `${id}-client`,
    harness,
    repo_name: repo,
    started_at: iso(started),
    ended_at: iso(nowMs - 20 * 1000),
    updated_at: iso(nowMs - 20 * 1000),
    active_seconds: startedMinAgo * MIN,
    idle_seconds: 0,
    local_date: iso(nowMs).slice(0, 10),
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'live',
    attended_seconds: startedMinAgo * MIN,
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
      human_prompt_count: 14,
      prompt_count_basis: 'typed',
      files_touched: 0,
      lines_added_agent: 0,
      commit_count: 0,
      agent_line_bucket: 'some',
      attrib_confidence: 'high',
      ...stats,
    },
    ...extra,
  };
}

const evidence = (e: Record<string, number>) => ({
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
  ...e,
});

/** builder has five finished sessions: the engine's ETA refusal, word for word. */
const BUILDER_ETA_REFUSED = {
  elapsed_s: null,
  typical_s: null,
  p25_s: null,
  p75_s: null,
  remaining_s: null,
  n: 5,
  basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
  reason: '5 finished sessions on this repository, 10 needed',
};

function rideGtEta(elapsedMin: number) {
  const typical = Math.round(20.9 * MIN);
  const elapsed = elapsedMin * MIN;
  return {
    elapsed_s: elapsed,
    typical_s: typical,
    p25_s: 9 * MIN,
    p75_s: Math.round(44.1 * MIN),
    remaining_s: Math.max(0, typical - elapsed),
    n: 61,
    basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
    reason: null,
  };
}

export interface DebugSessions {
  sessions: SessionDetail[];
  liveStates: Record<string, LiveStateWire>;
  /** Rows that just ended, for their final counts (the done state). */
  finished: SessionDetail[];
}

/** The first session in `state`, then up to three more working beside it. */
export function debugSessions(state: DebugState, n: number, nowMs: number): DebugSessions {
  const sessions: SessionDetail[] = [];
  const finished: SessionDetail[] = [];
  const liveStates: Record<string, LiveStateWire> = {};

  // 1. This repository, 47 minutes in: the session that builds the live surfaces.
  const builder = detail('debug-builder', SAMPLE_REPOS.tool, 'claude_code', 47, nowMs, { files_touched: 23, lines_added_agent: 1180, commit_count: 2 });
  if (state === 'done') {
    finished.push({
      ...builder,
      state: 'final',
      end_reason: 'idle_gap',
      stats: { ...builder.stats!, files_touched: 12, lines_added_agent: 420, lines_removed_agent: 88, commit_count: 3 },
    });
  } else {
    sessions.push(builder);
    liveStates[builder.id] =
      state === 'needsYou'
        ? {
            session_id: builder.id,
            activity: { kind: 'waiting_on_you', role: 'unknown', attempt: 0, since_s: 4 * MIN, files: 0, calls: 0, file_id: null },
            verdict: { state: 'waiting', evidence: evidence({ checkpoints: 2 }), basis: 'turn_ended', reason: null, file_id: null },
            eta: BUILDER_ETA_REFUSED,
            needs_you: { score: 84, reason: 'waiting_for_input' },
          }
        : state === 'stalled'
          ? {
              session_id: builder.id,
              activity: { kind: 'idle', role: 'unknown', attempt: 0, since_s: 6 * MIN, files: 0, calls: 0, file_id: null },
              verdict: { state: null, evidence: evidence({ checkpoints: 1 }), basis: null, reason: 'no rule fired: 25 calls, 0 errors, 1 checkpoints', file_id: null },
              eta: BUILDER_ETA_REFUSED,
              needs_you: { score: 41, reason: 'idle' },
            }
          : {
              session_id: builder.id,
              activity: { kind: 'testing', role: 'test', attempt: 0, since_s: 40, files: 0, calls: 2, file_id: null },
              verdict: {
                state: 'converging',
                evidence: evidence({ errors_now: 1, errors_before: 4, new_files: 3, checkpoints: 2 }),
                basis: 'error_rate_down_and_new_files',
                reason: null,
                file_id: null,
              },
              eta: BUILDER_ETA_REFUSED,
              needs_you: { score: 5, reason: 'running_fine' },
            };
  }

  // 2. RideGT, twelve minutes into a run that typically takes 21: an ETA the engine stands behind.
  if (n >= 2) {
    const s = detail('debug-tramline', SAMPLE_REPOS.transit, 'claude_code', 12, nowMs, { files_touched: 9, lines_added_agent: 214 });
    sessions.push(s);
    liveStates[s.id] = {
      session_id: s.id,
      activity: { kind: 'editing', role: 'source', attempt: 3, since_s: 95, files: 1, calls: 3, file_id: 'a1f09c3e5b7d2e10' },
      verdict: {
        state: 'converging',
        evidence: evidence({ errors_now: 1, errors_before: 3, new_files: 2, checkpoints: 1 }),
        basis: 'error_rate_down_and_new_files',
        reason: null,
        file_id: null,
      },
      eta: rideGtEta(12),
      needs_you: { score: 5, reason: 'running_fine' },
    };
  }

  // 3. RideGT under Codex, stuck on one failing command for six minutes.
  if (n >= 3) {
    const s = detail('debug-tramline-codex', SAMPLE_REPOS.transit, 'codex', 28, nowMs, { files_touched: 11, lines_added_agent: 96 });
    sessions.push(s);
    liveStates[s.id] = {
      session_id: s.id,
      activity: { kind: 'testing', role: 'test', attempt: 0, since_s: 20, files: 0, calls: 1, file_id: null },
      verdict: {
        state: 'circling',
        evidence: evidence({ errors_now: 6, errors_before: 2, checkpoints: 0, fail_run: 5, stuck_s: 6 * MIN + 12 }),
        basis: 'consecutive_failures',
        reason: null,
        file_id: null,
      },
      eta: rideGtEta(28),
      needs_you: { score: 66, reason: 'circling' },
    };
  }

  // 4. This repository again, three minutes into a Gemini session that is reading the docs.
  if (n >= 4) {
    const s = detail('debug-builder-gemini', SAMPLE_REPOS.tool, 'gemini_cli', 3, nowMs, { files_touched: 4 });
    sessions.push(s);
    liveStates[s.id] = {
      session_id: s.id,
      activity: { kind: 'reading', role: 'docs', attempt: 0, since_s: 50, files: 3, calls: 5, file_id: null },
      verdict: { state: 'starting', evidence: evidence({ window_calls: 3 }), basis: 'segment_tool_calls', reason: null, file_id: null },
      eta: BUILDER_ETA_REFUSED,
      needs_you: { score: 5, reason: 'running_fine' },
    };
  }

  return { sessions, liveStates, finished };
}

/** A realistic "today" for the widget: 2h 14m attended, and a week in the amber ramp. */
export const DEBUG_TODAY = { attendedSeconds: 2 * 3600 + 14 * 60, week: [2, 0, 3, 4, 1, 5, 3] };
