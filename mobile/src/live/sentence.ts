/**
 * The live engine's one sentence, rendered on the phone.
 *
 * `analysis/live.py` computes a running session's state and `wire()` DROPS its sentence: "the
 * phone renders its own words from the ids and numbers, so a reworded sentence is a client
 * change and not a re-upload" (docs/overnight-engine.md, rule 5). This is that renderer: a
 * line-for-line port of `live.sentence(state, names=False)` and of the `plain` helpers it uses
 * (`spoken`, `ordinal`, `ROLE_NOUN`, `has_dash`, as section 1.1 specifies them). The LOCAL
 * variant (`names=True`, file and command names) never reaches the phone, so it is not here.
 *
 * Pure, no React Native: `__tests__/liveSurface.test.ts` pins every branch to the engine's
 * exact words, and a change on either side has to change both.
 */

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
}

export interface LiveVerdictWire {
  state: VerdictState | string | null;
  evidence?: LiveEvidence | null;
  basis?: string | null;
  reason?: string | null;
  file_id?: string | null;
}

export interface LiveEtaWire {
  elapsed_s: number | null;
  typical_s: number | null;
  p25_s?: number | null;
  p75_s?: number | null;
  remaining_s: number | null;
  n?: number | null;
  basis?: string | null;
  reason?: string | null;
}

export interface LiveMapRow {
  id: string;
  role: string;
  depth?: number | null;
  dir_id?: string;
  reads?: number;
  edits?: number;
  last_read_ts?: number | null;
  last_edit_ts?: number | null;
}

/**
 * `live.wire(live_state(...))`, as the server would hand it to the phone beside a live
 * `SessionDetail`. Every block is optional: a server older than the engine sends none, and a
 * newer one may add blocks this build ignores.
 */
export interface LiveStateWire {
  session_id?: string | null;
  activity?: LiveActivityWire | null;
  verdict?: LiveVerdictWire | null;
  eta?: LiveEtaWire | null;
  decisions?: { kind: string; ts: number; evidence?: { event_n?: number; count?: number } }[] | null;
  needs_you?: { score: number; reason: string } | null;
  map?: { files?: LiveMapRow[] | null } | null;
  timelapse?: unknown;
  sample?: unknown;
}

// ------------------------------------------------------------------ plain.py, section 1.1

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
] as const;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;

/** `plain.spoken`: 0 to 20 as words ("six"), digits above ("34"). */
export function spoken(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 20 ? WORDS[n]! : String(n);
}

/** `plain.ordinal`: 1 to 10 as words ("third"), then "11th", "12th", "21st". */
export function ordinal(n: number): string {
  if (Number.isInteger(n) && n >= 1 && n <= 10) return ORDINALS[n - 1]!;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** `plain.ROLE_NOUN`: role to (one, "{n} many", collective). */
export const ROLE_NOUN: Readonly<Record<string, readonly [string, string, string]>> = {
  test: ['a test file', '{n} test files', 'your test suite'],
  source: ['a source file', '{n} source files', 'the source code'],
  config: ['a config file', '{n} config files', 'the configuration'],
  docs: ['a doc', '{n} docs', 'the docs'],
  migration: ['a database migration', '{n} database migrations', 'the migrations'],
  style: ['a stylesheet', '{n} stylesheets', 'the styles'],
  build: ['the build setup', '{n} build files', 'the build setup'],
  dependency: ['the dependency list', '{n} dependency files', 'the dependencies'],
  unknown: ['a file', '{n} files', 'the project'],
};

/** `plain.DASH`: an em dash, an en dash, or a hyphen standing alone between spaces. */
export const DASH = /[\u2014\u2013]|\s-{1,2}\s/;

export function hasDash(text: string): boolean {
  return DASH.test(text);
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
  const [one, many, whole] = ROLE_NOUN[role] ?? ROLE_NOUN.unknown!;
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
