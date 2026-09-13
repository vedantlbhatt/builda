/**
 * The live engine's one sentence, rendered on the phone.
 *
 * `analysis/live.py` computes a running session's state and `wire()` DROPS its sentence: "the
 * phone renders its own words from the ids and numbers, so a reworded sentence is a client
 * change and not a re-upload" (docs/overnight-engine.md, rule 5). This is that renderer: a
 * line-for-line port of `live.sentence(state, names=False)`. The `plain` helpers it uses
 * (`spoken`, `ordinal`, `ROLE_NOUN`, the dash rule) are the phone's ONE copy of `analysis/
 * plain.py`, `src/copy/plain.ts`, re-exported here: this file used to carry a second copy with
 * a two character dash rule, so a horizontal bar or a minus sign passed it while the engine's
 * `plain.has_dash` counted both (the review's finding, CLAUDE.md "one rule is one function").
 * The LOCAL variant (`names=True`, file and command names) never reaches the phone, so it is
 * not here.
 *
 * Pure, no React Native: `__tests__/liveSurface.test.ts` pins every branch to the engine's
 * exact words, by hand, against `spec/fixtures/live/content_state.json`, and against
 * `live.sentence` itself over every activity and verdict the wire can carry.
 */

import { DASH, hasDash, ordinal, ROLE_NOUN, spoken } from '../copy/plain';

export { DASH, hasDash, ordinal, ROLE_NOUN, spoken };

// ------------------------------------------------------------------ the wire shape

/** `live.ACTIVITY_KINDS`. A kind this build does not know renders as "Running a command". */
export type ActivityKind =
  | 'reading'
  | 'editing'
  | 'testing'
  | 'running'
  | 'searching'
  | 'delegating'
  | 'waiting_on_you'
  | 'thinking'
  | 'idle';

/** `live.VERDICT_STATES`, or null when no rule fired. */
export type VerdictState = 'starting' | 'converging' | 'circling' | 'lost' | 'waiting' | 'done';

export interface LiveActivityWire {
  kind: ActivityKind | string;
  /** `plain.ROLES`: test, source, config, docs, migration, style, build, dependency, unknown. */
  role?: string | null;
  attempt?: number | null;
  since_s?: number | null;
  files?: number | null;
  calls?: number | null;
  file_id?: string | null;
}

/** `live.EVIDENCE_KEYS`: always all present on the engine's output, integers. */
export interface LiveEvidence {
  window_calls?: number;
  errors_now?: number;
  errors_before?: number;
  new_files?: number;
  checkpoints?: number;
  repeats?: number;
  churn_writes?: number;
  fail_run?: number;
  blind_edits?: number;
  stuck_s?: number;
  files_changed?: number;
  commits?: number;
  /** Background tasks the session launched that were still out when its turn ended. */
  background?: number;
}

/**
 * `live.BACKGROUND_BASIS`: a turn handed back cleanly while work the session launched into the
 * background is still out. The agent is waiting on its own job, not on the person
 * (`needs_you.reason` `waiting_on_background`, score 10), so the sentence says so.
 */
export const BACKGROUND_BASIS = 'turn_ended_background_out';

export interface LiveVerdictWire {
  /** Absent or null when no rule fired (the spec leaves the key out; older fixtures send null). */
  state?: VerdictState | string | null;
  evidence?: LiveEvidence | null;
  basis?: string | null;
  reason?: string | null;
  file_id?: string | null;
}

export interface LiveEtaWire {
  elapsed_s?: number | null;
  typical_s?: number | null;
  p25_s?: number | null;
  p75_s?: number | null;
  remaining_s?: number | null;
  n?: number | null;
  needed?: number | null;
  unattended?: boolean | null;
  basis?: string | null;
  reason?: string | null;
}

export interface LiveMapRow {
  id: string;
  role: string;
  depth?: number | null;
  /** Null at the base (spec/live.v1.json). */
  dir_id?: string | null;
  reads?: number;
  edits?: number;
  last_read_ts?: number | null;
  last_edit_ts?: number | null;
}

/**
 * `live.wire(live_state(...))`, as the server hands it to the phone beside a live
 * `SessionDetail`: the structural partial of the generated `LiveState` (src/generated/live.ts)
 * that the surfaces read. A generated `LiveState` is assignable to it, which
 * `__tests__/liveSurface.test.ts` checks at compile time, so the two cannot drift apart. Every
 * block is optional: a server older than the engine sends none, and a newer one may add blocks
 * this build ignores.
 */
export interface LiveStateWire {
  live_version?: number | null;
  /**
   * When the engine computed this state (ISO 8601). The surfaces anchor every clock on it
   * (docs/overnight-integration.md 3.5): `since_s`, `stuck_s` and `remaining_s` were true at
   * THIS moment, and the session row's `updated_at` does not move when a heartbeat re-cuts an
   * unchanged transcript.
   */
  computed_at?: string | null;
  session_id?: string | null;
  activity?: LiveActivityWire | null;
  verdict?: LiveVerdictWire | null;
  eta?: LiveEtaWire | null;
  decisions?: { kind: string; ts: number; evidence?: { event_n?: number; count?: number } }[] | null;
  needs_you?: { score: number; reason: string } | null;
  /**
   * `files_total` counts every file the session touched; `files` keeps the rows touched most
   * recently (400 in the detail, only the rows the sentence names in the slim list body).
   */
  map?: { files?: LiveMapRow[] | null; files_total?: number | null } | null;
  timelapse?: unknown;
  sample?: unknown;
}

// ------------------------------------------------------------------ live.sentence

function int(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : 0;
}

function minutes(m: number): string {
  return m === 1 ? 'one minute' : `${spoken(m)} minutes`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function noun(role: string, n: number, collective = false): string {
  const table = ROLE_NOUN as Readonly<Record<string, readonly [string, string, string]>>;
  const [one, many, whole] = table[role] ?? ROLE_NOUN.unknown;
  if (collective) return whole;
  return n <= 1 ? one : many.replace('{n}', spoken(n));
}

function mapRole(state: LiveStateWire, fileId: string | null | undefined): string {
  for (const row of state.map?.files ?? []) {
    if (row.id === fileId) return row.role;
  }
  return 'unknown';
}

/**
 * What the session is doing, in one sentence: `live.sentence(state)`. The verdict speaks first
 * when it has something to say (circling, lost, done), then the activity.
 */
export function renderLiveSentence(state: LiveStateWire): string {
  const v = state.verdict ?? null;
  const ev: LiveEvidence = v?.evidence ?? {};
  const st = v?.state ?? null;

  if (st === 'circling') {
    if (v?.basis === 'consecutive_failures') {
      const m = Math.floor(int(ev.stuck_s) / 60);
      return 'Stuck on the same failing command' + (m >= 1 ? ` for ${minutes(m)}` : '');
    }
    if (v?.basis === 'causes:file_churn_with_failures') {
      return `Going back and forth on ${noun(mapRole(state, v.file_id), 1)}, ${ordinal(int(ev.churn_writes))} pass`;
    }
    return `Running the same step over and over, ${spoken(int(ev.repeats))} times`;
  }
  if (st === 'lost') {
    return `Editing ${spoken(int(ev.blind_edits))} files it has not read yet`;
  }
  if (st === 'done') {
    const files = int(ev.files_changed);
    if (files) return `Finished, with ${spoken(files)} ${plural(files, 'file', 'files')} changed`;
    if (int(ev.commits)) return 'Finished, with a commit';
    return 'Finished';
  }

  const a = state.activity;
  if (!a) return 'Nothing has happened yet';
  const role = a.role || 'unknown';
  const sinceM = Math.floor(int(a.since_s) / 60);
  const files = int(a.files);
  switch (a.kind) {
    case 'waiting_on_you':
      if (st === 'waiting' && v?.basis === BACKGROUND_BASIS) {
        const n = int(ev.background);
        return `Waiting on ${spoken(n)} background ${plural(n, 'task', 'tasks')} it started`;
      }
      return 'Waiting on you' + (sinceM >= 1 ? ` for ${minutes(sinceM)}` : '');
    case 'idle':
      return 'No new output' + (sinceM >= 1 ? ` for ${minutes(sinceM)}` : '');
    case 'thinking':
      return 'Thinking about the next step';
    case 'reading':
      return `Reading ${noun(role, files, files >= 3)}`;
    case 'editing': {
      const attempt = int(a.attempt);
      if (attempt >= 2) return `Rewriting ${noun(role, 1)}, ${ordinal(attempt)} attempt`;
      return `Editing ${noun(role, files)}`;
    }
    case 'testing':
      return `Running ${noun(role, files, true)}`;
    case 'running':
      return 'Running a command';
    case 'searching':
      return 'Searching the codebase';
    case 'delegating': {
      const n = int(a.calls);
      return `Handing work to ${spoken(n)} helper ${plural(n, 'agent', 'agents')}`;
    }
    default:
      return 'Running a command';
  }
}
