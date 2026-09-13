/**
 * What the Lock Screen, the Dynamic Island and the Home Screen widget say about the sessions
 * that are running, and when they say it. Pure: no React Native, no native module, no clock
 * (every function takes `nowMs`), so `__tests__/liveSurface.test.ts` pins every rule in bun.
 * `activity.ts` and `widget.ts` carry the decisions to the native side.
 *
 * Inputs are what the phone already has: the live `SessionDetail` rows (`api.liveSessions()`)
 * and, when the server provides it, the engine's `live_state` block for each one
 * (`analysis/live.py` `wire()`, docs/overnight-engine.md section 3). Without a live_state the
 * surfaces fall back to `src/live/format.ts`, and anything neither source measured is refused
 * on the surface ("no ETA yet", no count in the ring), never invented.
 *
 * The rules, each tested:
 *  - One Live Activity per running session, at most MAX_ACTIVITIES, in mission control order
 *    (who needs you most first), with relevance 100 for needs you so that one wins the island.
 *  - Update only when something a surface shows has changed (the content key, which includes
 *    the displayed elapsed minute and excludes `updatedEpoch`).
 *  - Alert only on the move INTO needs you, never on a first sighting.
 *  - A session that finishes ends its activity with the finished state and a 20 minute
 *    dismissal (HIG: 15 to 30); no notification then, because the Lock Screen already says it.
 *  - Never both: a notification is the fallback only for a session with no activity.
 */

import type {
  ContentOptions,
  CreatureId,
  Phase,
  SessionAttrs,
  SessionState,
  Trajectory,
} from '../../modules/builder-live/src/BuilderLive.types';
import type { SessionDetail } from '../data/api';
import { ANIMALS } from '../pixel/animals';
import { graphLevel } from '../theme';
import { livePresenceLine, TEMPO_STALE_SECONDS } from './format';
import { renderLiveSentence, type LiveStateWire } from './sentence';

export type { LiveStateWire } from './sentence';

// ------------------------------------------------------------------ constants

/** ActivityKit shows the sentence on two lines; the brief caps it under 90 characters. */
export const SENTENCE_MAX = 89;
/** Activities one app may run is capped by the system; four is the most the debug route shows. */
export const MAX_ACTIVITIES = 4;
/** The widget lists at most four: one on the left of the medium widget, three on the right. */
export const WIDGET_MAX_SESSIONS = 4;
/**
 * Past this the data is old: `context.isStale` flips and the surfaces say "Not updating".
 * The same threshold as `format.ts` TEMPO_STALE_SECONDS ("past this the Mac has gone quiet"),
 * so the in-app live row and the Lock Screen give up at the same moment.
 */
export const STALE_SECONDS = TEMPO_STALE_SECONDS;
/** HIG: after a Live Activity ends, keep it on the Lock Screen 15 to 30 minutes. */
export const DISMISS_AFTER_SECONDS = 1200;
export const RELEVANCE_NEEDS_YOU = 100;
export const RELEVANCE_DEFAULT = 50;
/** ActivityKit's limit on attributes plus content state, as JSON. */
export const PAYLOAD_LIMIT_BYTES = 4096;
/** The repo name a private session shows, as the in-app live row says it. */
export const PRIVATE_REPO = 'private repo';
const REPO_MAX = 60;
const RETRY_START_MS = 60_000;

export type LiveStates = Readonly<Record<string, LiveStateWire | null | undefined>>;

// ------------------------------------------------------------------ one session

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const count = (x: unknown): number | null => (isNum(x) ? Math.max(0, Math.round(x)) : null);

function epochSeconds(iso: string | null | undefined): number | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms / 1000 : null;
}

export function toAttrs(s: SessionDetail): SessionAttrs {
  return {
    sessionId: s.id,
    repo: (s.repo_name ?? PRIVATE_REPO).slice(0, REPO_MAX),
    agent: s.harness,
    startedEpoch: Math.round(epochSeconds(s.started_at) ?? 0),
  };
}

/**
 * working, needsYou, done or stalled. The engine decides when it spoke: its `waiting` verdict
 * (the turn was handed back) is needs you, `done` is done, an `idle` activity (no output for
 * three minutes, which a long test run and a permission prompt both look like) is stalled.
 * Without it, a final row is done and a live row whose last record is older than
 * STALE_SECONDS is stalled; nothing without the engine can say "needs you".
 */
export function phaseOf(s: SessionDetail, live: LiveStateWire | null | undefined, nowMs: number): Phase {
  if (s.state === 'final') return 'done';
  const verdict = live?.verdict?.state ?? null;
  const kind = live?.activity?.kind ?? null;
  if (verdict === 'waiting' || kind === 'waiting_on_you') return 'needsYou';
  if (verdict === 'done') return 'done';
  if (kind === 'idle') return 'stalled';
  if (live) return 'working';
  const quiet = quietSeconds(s, nowMs);
  return quiet !== null && quiet > STALE_SECONDS ? 'stalled' : 'working';
}

/** Seconds since the Mac's last record for this row (`ended_at` on a live row). */
function quietSeconds(s: SessionDetail, nowMs: number): number | null {
  const last = epochSeconds(s.ended_at);
  return last === null ? null : Math.max(0, Math.round(nowMs / 1000 - last));
}

export function trajectoryOf(live: LiveStateWire | null | undefined): Trajectory {
  const v = live?.verdict?.state;
  return v === 'converging' || v === 'circling' || v === 'lost' ? v : 'none';
}

/**
 * The sentence, from the engine's renderer whenever there is anything for it to render: its
 * live_state, a finished row's own counts (the engine's done rule), or a quiet row's age (its
 * idle rule). Otherwise `format.ts`'s presence line. Never free text from the wire.
 */
export function sentenceOf(s: SessionDetail, live: LiveStateWire | null | undefined, phase: Phase, nowMs: number): string {
  if (live && !(phase === 'done' && live.verdict?.state !== 'done')) return renderLiveSentence(live);
  if (phase === 'done') {
    return renderLiveSentence({
      verdict: {
        state: 'done',
        evidence: { files_changed: count(s.stats?.files_touched) ?? 0, commits: count(s.stats?.commit_count) ?? 0 },
      },
    });
  }
  if (phase === 'stalled') {
    return renderLiveSentence({ activity: { kind: 'idle', since_s: quietSeconds(s, nowMs) ?? 0 } });
  }
  return livePresenceLine(s);
}

/** Cut at a word boundary, under 90 characters. The engine's sentences are all far shorter. */
export function clampSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= SENTENCE_MAX) return t;
  const cut = t.slice(0, SENTENCE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}\u2026`;
}

/** Elapsed over typical, from the engine's ETA block; -1 when it refused one. */
export function progressOf(live: LiveStateWire | null | undefined): number {
  const e = live?.eta;
  if (!e || !isNum(e.typical_s) || e.typical_s <= 0 || !isNum(e.elapsed_s)) return -1;
  return Math.round(Math.min(e.elapsed_s / e.typical_s, 9.99) * 1000) / 1000;
}

/**
 * When a typical run like this one ends, as Unix seconds rounded to the minute, or null when
 * the engine refused an ETA. Anchored on the row's `updated_at` (when the engine's numbers were
 * taken), so every tick between two uploads computes the same instant and nothing re-renders.
 */
export function etaEpochOf(s: SessionDetail, live: LiveStateWire | null | undefined, nowMs: number): number | null {
  const remaining = live?.eta?.remaining_s;
  if (!isNum(remaining)) return null;
  const base = epochSeconds(s.updated_at) ?? nowMs / 1000;
  return Math.round((base + Math.max(0, remaining)) / 60) * 60;
}

export function normalizeCreature(id: string | null | undefined): CreatureId {
  return typeof id === 'string' && ((ANIMALS as readonly string[]).includes(id) || id === 'bit') ? (id as CreatureId) : 'bit';
}

export interface StateContext {
  nowMs: number;
  creature?: string | null;
  /** Sessions running beside this one. */
  runningCount: number;
}

export function toState(s: SessionDetail, live: LiveStateWire | null | undefined, ctx: StateContext): SessionState {
  const phase = phaseOf(s, live, ctx.nowMs);
  const stats = s.stats ?? null;
  return {
    phase,
    sentence: clampSentence(sentenceOf(s, live, phase, ctx.nowMs)),
    progress: progressOf(live),
    filesTouched: count(stats?.files_touched) ?? -1,
    etaEpoch: phase === 'done' ? null : etaEpochOf(s, live, ctx.nowMs),
    trajectory: trajectoryOf(live),
    creature: normalizeCreature(ctx.creature),
    linesAdded: count(stats?.lines_added_agent),
    linesRemoved: count(stats?.lines_removed_agent),
    commits: count(stats?.commit_count),
    runningCount: Math.max(0, ctx.runningCount),
    updatedEpoch: Math.round(ctx.nowMs / 1000),
  };
}

/** Attributes plus state as JSON, in UTF-8 bytes: must stay under PAYLOAD_LIMIT_BYTES. */
export function payloadBytes(attrs: SessionAttrs, state: SessionState): number {
  return new TextEncoder().encode(JSON.stringify(attrs) + JSON.stringify(state)).length;
}

/**
 * Two states with the same key look the same on every surface, so the second is not sent.
 * `updatedEpoch` is left out (it moves every tick and nothing draws it); the elapsed minute is
 * put in, because "22m" is drawn and would otherwise freeze until something else changed.
 */
export function contentKey(attrs: SessionAttrs, state: SessionState, nowMs: number): string {
  const { updatedEpoch: _ignored, ...shown } = state;
  const minute = Math.floor(Math.max(0, nowMs / 1000 - attrs.startedEpoch) / 60);
  return JSON.stringify([attrs.repo, attrs.agent, minute, shown]);
}

export function relevanceOf(state: SessionState, live: LiveStateWire | null | undefined): number {
  if (state.phase === 'needsYou') return RELEVANCE_NEEDS_YOU;
  const score = live?.needs_you?.score;
  return isNum(score) ? Math.max(0, Math.min(RELEVANCE_NEEDS_YOU - 1, Math.round(score))) : RELEVANCE_DEFAULT;
}

/**
 * Mission control's order (`live.mission_order`): needs_you score, then who has waited longest,
 * then id. A row with no live_state scores by the engine's own table for what the phone can
 * tell: finished 30, quiet 35, running 5.
 */
export function missionOrder(sessions: readonly SessionDetail[], liveStates: LiveStates | undefined, nowMs: number): SessionDetail[] {
  const key = (s: SessionDetail): [number, number, string] => {
    const live = liveStates?.[s.id] ?? null;
    const score = live?.needs_you?.score;
    if (isNum(score)) return [-score, -(live?.activity?.since_s ?? 0), s.id];
    const phase = phaseOf(s, null, nowMs);
    const fallback = phase === 'done' ? 30 : phase === 'stalled' ? 35 : 5;
    return [-fallback, -(quietSeconds(s, nowMs) ?? 0), s.id];
  };
  return [...sessions].sort((a, b) => {
    const [a0, a1, a2] = key(a);
    const [b0, b1, b2] = key(b);
    return a0 - b0 || a1 - b1 || (a2 < b2 ? -1 : a2 > b2 ? 1 : 0);
  });
}

/**
 * A finished session is news by the server's own rule (`server/builder/notify.py plan`): an
 * unattended run, or a notable session. Anything else finishes quietly on every channel.
 */
export function finishIsNews(s: Pick<SessionDetail, 'notable' | 'unattended'>): boolean {
  return Boolean(s.unattended || s.notable);
}

// ------------------------------------------------------------------ the plan

export interface Tracked {
  sessionId: string;
  /** The running activity's id; null while none runs for it (disabled, capped, or failed). */
  activityId: string | null;
  phase: Phase;
  key: string;
  /** The last state sent. Null for an activity found running at launch, before any sync. */
  state: SessionState | null;
  attrs: SessionAttrs | null;
  /** A start that failed is not retried before this. */
  retryAfterMs?: number;
}

export type SyncAction =
  | { kind: 'start'; sessionId: string; attrs: SessionAttrs; state: SessionState; opts: ContentOptions }
  | { kind: 'update'; sessionId: string; activityId: string; state: SessionState; opts: ContentOptions }
  | { kind: 'end'; sessionId: string; activityId: string; state: SessionState | null; opts: ContentOptions }
  | { kind: 'notify'; sessionId: string; which: 'needsYou' | 'finished'; session: SessionDetail; state: SessionState };

export interface PlanInput {
  /** The live rows, from a SUCCESSFUL fetch: a row missing from it is taken to have finished. */
  sessions: readonly SessionDetail[];
  liveStates?: LiveStates;
  /** Rows known to have ended since the last sync (the cache's live to final flip), for their final counts. */
  finished?: readonly SessionDetail[];
  tracked: ReadonlyMap<string, Tracked>;
  activitiesEnabled: boolean;
  creature?: string | null;
  /** Seconds until the surfaces say "Not updating". Default STALE_SECONDS; the debug route shortens it. */
  staleInSeconds?: number;
  nowMs: number;
}

export interface Plan {
  actions: SyncAction[];
  /** The memory after the actions, assuming they succeed (`activity.ts` patches start ids). */
  tracked: Map<string, Tracked>;
}

function contentOptions(state: SessionState, live: LiveStateWire | null | undefined, staleIn: number): ContentOptions {
  return { staleInSeconds: staleIn, relevance: relevanceOf(state, live) };
}

export function alertFor(attrs: SessionAttrs, state: SessionState): Pick<ContentOptions, 'alertTitle' | 'alertBody'> {
  return { alertTitle: `${attrs.repo} needs you`, alertBody: state.sentence };
}

/** The last state an activity showed, turned into its finished card (null when none is known). */
function finishedFrom(prev: Tracked, ctx: StateContext): SessionState | null {
  if (!prev.state) return null;
  const files = prev.state.filesTouched >= 0 ? prev.state.filesTouched : 0;
  return {
    ...prev.state,
    phase: 'done',
    sentence: renderLiveSentence({ verdict: { state: 'done', evidence: { files_changed: files, commits: prev.state.commits ?? 0 } } }),
    etaEpoch: null,
    runningCount: ctx.runningCount,
    updatedEpoch: Math.round(ctx.nowMs / 1000),
  };
}

export function planSync(input: PlanInput): Plan {
  const { nowMs } = input;
  const staleIn = input.staleInSeconds ?? STALE_SECONDS;
  const finishedById = new Map((input.finished ?? []).map((s) => [s.id, s]));
  const rows = missionOrder(
    [...input.sessions.filter((s) => !finishedById.has(s.id)), ...finishedById.values()],
    input.liveStates,
    nowMs
  );
  const phases = new Map(rows.map((s) => [s.id, phaseOf(s, input.liveStates?.[s.id], nowMs)]));
  const running = rows.filter((s) => phases.get(s.id) !== 'done').length;

  const actions: SyncAction[] = [];
  const next = new Map<string, Tracked>();
  const seen = new Set<string>();
  // Toward the cap count only activities that stay: those of rows still running.
  let active = 0;
  for (const t of input.tracked.values()) {
    const phase = phases.get(t.sessionId);
    if (t.activityId && phase !== undefined && phase !== 'done') active += 1;
  }

  for (const s of rows) {
    seen.add(s.id);
    const live = input.liveStates?.[s.id] ?? null;
    const phase = phases.get(s.id)!;
    const ctx: StateContext = { nowMs, creature: input.creature, runningCount: running - (phase === 'done' ? 0 : 1) };
    const attrs = toAttrs(s);
    const state = toState(s, live, ctx);
    const prev = input.tracked.get(s.id);

    if (phase === 'done') {
      if (prev?.activityId) {
        actions.push({ kind: 'end', sessionId: s.id, activityId: prev.activityId, state, opts: { dismissAfterSeconds: DISMISS_AFTER_SECONDS } });
      } else if (prev && finishIsNews(s)) {
        actions.push({ kind: 'notify', sessionId: s.id, which: 'finished', session: s, state });
      }
      continue; // a finished session leaves the memory
    }

    const key = contentKey(attrs, state, nowMs);
    // A move INTO needs you that this process watched happen. An activity found running at
    // launch (state null) is a first sighting: it was not watched, so it does not alert.
    const intoNeedsYou = phase === 'needsYou' && prev?.state != null && prev.phase !== 'needsYou';
    if (prev?.activityId) {
      if (prev.key !== key) {
        const opts = { ...contentOptions(state, live, staleIn), ...(intoNeedsYou ? alertFor(attrs, state) : {}) };
        actions.push({ kind: 'update', sessionId: s.id, activityId: prev.activityId, state, opts });
      }
      next.set(s.id, { ...prev, phase, key, state, attrs });
      continue;
    }

    const retryBlocked = prev?.retryAfterMs !== undefined && nowMs < prev.retryAfterMs;
    if (input.activitiesEnabled && active < MAX_ACTIVITIES && !retryBlocked) {
      actions.push({ kind: 'start', sessionId: s.id, attrs, state, opts: contentOptions(state, live, staleIn) });
      active += 1;
    } else if (intoNeedsYou) {
      actions.push({ kind: 'notify', sessionId: s.id, which: 'needsYou', session: s, state });
    }
    next.set(s.id, { sessionId: s.id, activityId: null, phase, key, state, attrs, retryAfterMs: retryBlocked ? prev?.retryAfterMs : undefined });
  }

  // Tracked, and gone from the live list: the server flipped it to final. End its card with the
  // last thing it showed, as finished; an activity found at launch with nothing known about it
  // is removed rather than left claiming to run.
  for (const prev of input.tracked.values()) {
    if (seen.has(prev.sessionId) || !prev.activityId) continue;
    const state = finishedFrom(prev, { nowMs, creature: input.creature, runningCount: running });
    actions.push({
      kind: 'end',
      sessionId: prev.sessionId,
      activityId: prev.activityId,
      state,
      opts: { dismissAfterSeconds: state ? DISMISS_AFTER_SECONDS : 0 },
    });
  }

  return { actions, tracked: next };
}

/** How long a failed start waits before the next try. */
export function retryAfter(nowMs: number): number {
  return nowMs + RETRY_START_MS;
}

// ------------------------------------------------------------------ the widget

/** One row of `WidgetSnapshot.Session` in targets/widget/_shared/HomeWidgetViews.swift. */
export interface WidgetSession {
  id: string;
  repo: string;
  agent: string;
  phase: Phase;
  sentence: string;
  trajectory: Trajectory;
  startedEpoch: number;
  progress: number;
  filesTouched: number;
  etaEpoch: number | null;
}

export interface WidgetToday {
  /** Attended seconds today (the 04:00 day); null when the app could not say. */
  attendedSeconds: number | null;
  /** Seven `graph.levels` indexes, 0 to 5, oldest first, today last. */
  week: number[];
}

/** `WidgetSnapshot` in HomeWidgetViews.swift. A bun test holds the two key sets equal. */
export interface WidgetSnapshot {
  v: 1;
  updatedEpoch: number;
  staleEpoch: number;
  creature: CreatureId;
  runningCount: number;
  sessions: WidgetSession[];
  today: WidgetToday | null;
}

export interface WidgetInput {
  sessions: readonly SessionDetail[];
  liveStates?: LiveStates;
  creature?: string | null;
  today?: WidgetToday | null;
  nowMs: number;
}

export function buildWidgetSnapshot(input: WidgetInput): WidgetSnapshot {
  const { nowMs } = input;
  const running = missionOrder(input.sessions, input.liveStates, nowMs).filter(
    (s) => phaseOf(s, input.liveStates?.[s.id], nowMs) !== 'done'
  );
  const updatedEpoch = Math.round(nowMs / 1000);
  const today = input.today ?? null;
  return {
    v: 1,
    updatedEpoch,
    staleEpoch: updatedEpoch + STALE_SECONDS,
    creature: normalizeCreature(input.creature),
    runningCount: running.length,
    sessions: running.slice(0, WIDGET_MAX_SESSIONS).map((s) => {
      const live = input.liveStates?.[s.id] ?? null;
      const state = toState(s, live, { nowMs, creature: input.creature, runningCount: running.length - 1 });
      const attrs = toAttrs(s);
      return {
        id: s.id,
        repo: attrs.repo,
        agent: attrs.agent,
        phase: state.phase,
        sentence: state.sentence,
        trajectory: state.trajectory,
        startedEpoch: attrs.startedEpoch,
        progress: state.progress,
        filesTouched: state.filesTouched,
        etaEpoch: state.etaEpoch,
      };
    }),
    today: today && {
      attendedSeconds: isNum(today.attendedSeconds) ? Math.max(0, Math.round(today.attendedSeconds)) : null,
      week: today.week.length === 7 ? today.week.map((l) => Math.max(0, Math.min(5, Math.round(l)))) : [],
    },
  };
}

/**
 * The widget's week row from the profile graph (`Profile.graph`, one row per local date):
 * seven levels ending on `today` (YYYY-MM-DD), a missing day being a day with no time, by the
 * same absolute buckets as the contribution graph (`theme.graphLevel`).
 */
export function weekFromGraph(graph: readonly { date: string; active_seconds: number }[], today: string): number[] {
  const byDate = new Map(graph.map((g) => [g.date, g.active_seconds]));
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];
  const out: number[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    out.push(graphLevel(byDate.get(d) ?? 0));
  }
  return out;
}
