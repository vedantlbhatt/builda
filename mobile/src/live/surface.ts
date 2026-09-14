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
 * on the surface ("no ETA yet", no file count), never invented.
 *
 * The rules, each tested:
 *  - One Live Activity per running session, at most MAX_ACTIVITIES, in mission control order
 *    (who needs you most first), with relevance 100 for needs you so that one wins the island.
 *  - "N more running" counts only the sessions that have no card of their own: a card that
 *    says "1 more running" above the very card it means says nothing.
 *  - Update only when something a surface shows has changed (the content key, which includes
 *    the displayed elapsed minute and excludes `updatedEpoch`).
 *  - Alert only on the move INTO needs you, never on a first sighting, and never for an agent
 *    that is waiting on a background job it started (that is its wait, not yours).
 *  - A session that finishes while nothing else runs ends with its finished card and a 20
 *    minute dismissal (HIG: 15 to 30). While another session runs, a finished card is taken
 *    down at once, so it never sits on top of a running one; a finish that is news is then a
 *    notification, because no card says it.
 *  - Never both: a notification is the fallback only for a session with no activity.
 *  - A turn the engine called done is FINISHED, not looked at yet, never needs you (`phaseOf`),
 *    on the Lock Screen, in the island and on the widget, as on mission control's tile.
 *  - Every session wears its own crew creature (`crew.ts`), so each card, island and widget row
 *    is drawn in its session's hue; no session is Bit, so none is amber.
 *  - No duration inside a sentence on a surface: a Lock Screen is not redrawn between updates,
 *    so "for four minutes" is wrong a minute later. The sentence drops it and the surface says
 *    when the condition began (`sinceEpoch`), which stays true.
 */

import type {
  ContentOptions,
  CreatureId,
  Phase,
  SessionAttrs,
  SessionState,
  Trajectory,
} from '../../modules/builder-live/src/BuilderLive.types';
import { lockScreenWithoutDetails } from '../copy/live';
import { PRIVATE_REPO, repoLabel, type RepoNames } from '../copy/repoLabel';
import type { SessionDetail } from '../data/api';
import { needsYouTitle } from '../push/localCopy';
import { ANIMALS } from '../pixel/animals';
import { DAY_BOUNDARY_HOUR, graphLevel } from '../theme';
import { crewCreatures, crewHashed } from './crew';
import { livePresenceLine, TEMPO_STALE_SECONDS } from './format';
import { BACKGROUND_BASIS, renderLiveSentence, type LiveStateWire } from './sentence';

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
/** A finished card sorts under every running one. */
export const RELEVANCE_DONE = 0;
/** ActivityKit's limit on attributes plus content state, as JSON. */
export const PAYLOAD_LIMIT_BYTES = 4096;
/**
 * What a card says for a repository it cannot name (`copy/repoLabel.ts`, the one rule): a private
 * project this phone has numbered is "Private project 2" there, as on the Projects tab.
 */
export { PRIVATE_REPO };
/**
 * What a card names instead of the repository with Settings > Show details on Lock Screen OFF
 * (`src/data/privacy.ts LOCK_SCREEN_OFF`: Builda, how many are running, the tool and its timer).
 */
export const DETAILS_OFF_TITLE = 'Builda';
/** `live.NEEDS_YOU_REASONS`: the agent waits on its own background job (score 10). */
export const BACKGROUND_REASON = 'waiting_on_background';
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

/** Unix seconds, down to the whole minute: "since 9:37" names the minute it began in. */
const minuteFloor = (seconds: number): number => Math.floor(seconds / 60) * 60;

/**
 * The card's attributes, fixed for the life of the activity. `details` false (Settings > Show
 * details on Lock Screen off) names Builda instead of the repository; since attributes cannot
 * change, `activity.ts` ends every card when the switch moves and the next sync starts them
 * again with the new name.
 *
 * The repository is `repoLabel` at the OUTSIDE reach: its public name, else the number this
 * phone gave the project ("Private project 2", the Projects tab's words), never the owner's own
 * name for it, which the naming field promises stays inside the app; "private repo" when there
 * is no key or no number yet.
 */
export function toAttrs(s: SessionDetail, details = true, names?: RepoNames | null): SessionAttrs {
  return {
    sessionId: s.id,
    repo: details ? repoLabel(s, names, 'outside').slice(0, REPO_MAX) : DETAILS_OFF_TITLE,
    agent: s.harness,
    startedEpoch: Math.round(epochSeconds(s.started_at) ?? 0),
  };
}

/**
 * The engine handed the turn back while a job the session launched into the background is
 * still out: the agent is waiting on its own work and Claude Code wakes it when the job
 * reports back (`live.BACKGROUND_BASIS`). FOUND IN CAPTURE (2026-09-13, live-self-1): the
 * engine said "Waiting on one background task it started", needs you 10, and the phone put
 * the amber hand, "needs you" and "Waiting on you for one minute" on the Lock Screen, the
 * bug the engine itself had fixed in review.
 */
export function waitsOnBackground(live: LiveStateWire | null | undefined): boolean {
  return live?.verdict?.basis === BACKGROUND_BASIS || live?.needs_you?.reason === BACKGROUND_REASON;
}

/**
 * working, needsYou, done or stalled. The engine decides when it spoke: its `done` verdict (a turn
 * that ended with work landed cleanly) is done, its `waiting` verdict (the turn was handed back to
 * the person) is needs you, an `idle` activity (no output for three minutes, which a long test
 * run and a permission prompt both look like) is stalled. A `waiting` on its own background job
 * is working: the agent is the one waiting. Without the engine, a final row is done and a live
 * row whose last record is older than STALE_SECONDS is stalled; nothing without the engine can
 * say "needs you".
 *
 * Done comes BEFORE the wait. The engine only calls a turn done while the activity is the wait
 * that followed it (`waiting_on_you`), so checking the wait first read every finished turn as
 * needs you: the amber hand and "needs you" on the Lock Screen for a session that had finished
 * and was only waiting to be looked at, while mission control's tile said finished (the owner,
 * 2026-09-13: FINISHED, not needs you). One rule now, here and in `live_push.phase_of`, pinned by
 * `spec/fixtures/live/content_state.json` (`done_after_commit`); `mission.tilePhase` is this.
 */
export function phaseOf(s: SessionDetail, live: LiveStateWire | null | undefined, nowMs: number): Phase {
  if (s.state === 'final') return 'done';
  const verdict = live?.verdict?.state ?? null;
  const kind = live?.activity?.kind ?? null;
  if (verdict === 'done' && !waitsOnBackground(live)) return 'done';
  if ((verdict === 'waiting' || kind === 'waiting_on_you') && !waitsOnBackground(live)) return 'needsYou';
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
 * A finished card's sentence when the engine's own done verdict is not there to speak: its
 * renderer with nothing counted, "Finished". The line under it says what landed ("+420 -88 ·
 * 3 commits"); the engine's "Finished, with a commit" above "3 commits" read as a contradiction
 * (capture, 2026-09-13), and no row carries a files CHANGED count to put in it.
 */
function doneSentence(): string {
  return renderLiveSentence({ verdict: { state: 'done', evidence: {} } });
}

/**
 * The engine's sentence as it stands at this moment, durations and all ("Waiting on you for
 * four minutes"): for an alert or a notification, which carry the time they arrived. From the
 * engine's renderer whenever there is anything for it to render: its live_state, a finished
 * row's commits (the engine's done rule), or a quiet row's age (its idle rule). Otherwise
 * `format.ts`'s presence line. Never free text from the wire.
 *
 * A finished row with no engine verdict says "Finished" and leaves the counts to the line
 * under it: `stats.files_touched` counts every file any event named, reads included, and
 * "Finished, with two files changed" about two files it only read (live-self-2, 2026-09-13) is
 * the bug that rule replaced.
 */
export function sentenceOf(s: SessionDetail, live: LiveStateWire | null | undefined, phase: Phase, nowMs: number): string {
  if (live && !(phase === 'done' && live.verdict?.state !== 'done')) return renderLiveSentence(live);
  if (phase === 'done') return doneSentence();
  if (phase === 'stalled') {
    return renderLiveSentence({ activity: { kind: 'idle', since_s: quietSeconds(s, nowMs) ?? 0 } });
  }
  return livePresenceLine(s);
}

/**
 * The same live_state with every duration the sentence would speak set to zero: the
 * activity's `since_s` ("Waiting on you for four minutes", "No new output for six minutes")
 * and a failing command's `stuck_s` ("Stuck on the same failing command for six minutes").
 */
function timeless(live: LiveStateWire): LiveStateWire {
  const v = live.verdict;
  return {
    ...live,
    activity: live.activity ? { ...live.activity, since_s: 0 } : live.activity,
    verdict: v ? { ...v, evidence: v.evidence ? { ...v.evidence, stuck_s: 0 } : v.evidence } : v,
  };
}

/**
 * What a surface shows: the engine's words with no duration in them. A Lock Screen is only
 * redrawn when an update arrives, and none arrives while the app is in the background (no
 * ActivityKit pushes yet), so "Waiting on you for four minutes" is wrong a minute later and
 * stays wrong until the card goes stale. The surface says when it began instead
 * (`sinceEpochOf`: "waiting since 9:37"), which is true for as long as it shows.
 */
export function surfaceSentenceOf(s: SessionDetail, live: LiveStateWire | null | undefined, phase: Phase, nowMs: number): string {
  if (live && !(phase === 'done' && live.verdict?.state !== 'done')) return renderLiveSentence(timeless(live));
  if (phase === 'stalled') return renderLiveSentence({ activity: { kind: 'idle', since_s: 0 } });
  return sentenceOf(s, live, phase, nowMs);
}

/** Cut at a word boundary, under 90 characters. The engine's sentences are all far shorter. */
export function clampSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= SENTENCE_MAX) return t;
  const cut = t.slice(0, SENTENCE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** Elapsed over typical, from the engine's ETA block; -1 when it refused one. */
export function progressOf(live: LiveStateWire | null | undefined): number {
  const e = live?.eta;
  if (!e || !isNum(e.typical_s) || e.typical_s <= 0 || !isNum(e.elapsed_s)) return -1;
  return Math.round(Math.min(e.elapsed_s / e.typical_s, 9.99) * 1000) / 1000;
}

/**
 * The moment the engine's numbers were true, as Unix seconds: the state's own `computed_at`
 * (docs/overnight-integration.md 3.5 and 2.5), then the row's `updated_at`, then now. FOUND IN
 * INTEGRATION (2026-09-13): this anchored on `updated_at` alone, and the server does not touch
 * the session row when a heartbeat re-cuts an unchanged transcript (routes/sync.py skips it on
 * an unchanged content hash) while it does refresh the live state. So every `remaining_s` and
 * `since_s` was aged by however long the transcript had been quiet: the fixture's rows are 90 s
 * older than their states, and the phone's ETA and "waiting since" disagreed with the push the
 * server sent for the same state. `live_push.anchor_of` is the Python half.
 */
export function anchorOf(s: SessionDetail, live: LiveStateWire | null | undefined, nowMs: number): number {
  return epochSeconds(live?.computed_at) ?? epochSeconds(s.updated_at) ?? nowMs / 1000;
}

/**
 * When a typical run like this one ends, as Unix seconds rounded to the minute, or null when
 * the engine refused an ETA. Anchored on when the engine's numbers were taken (`anchorOf`), so
 * every tick between two uploads computes the same instant and nothing re-renders.
 */
export function etaEpochOf(s: SessionDetail, live: LiveStateWire | null | undefined, nowMs: number): number | null {
  const remaining = live?.eta?.remaining_s;
  if (!isNum(remaining)) return null;
  const base = anchorOf(s, live, nowMs);
  return Math.round((base + Math.max(0, remaining)) / 60) * 60;
}

/**
 * When the condition the surface names began, as Unix seconds down to the minute, or null:
 * needs you since the turn was handed back, stalled since the last output, circling on one
 * failing command since it started failing (a minute or more), and a turn the engine called done
 * since it finished (the wait that followed it: the widget's "ran 47m" and the finished card's
 * "ran" count to here). The durations the engine puts in its sentence, turned into the moment
 * they count from, anchored like the ETA (`anchorOf`). Without the engine a stalled row's quiet
 * began at its last record. A final row has no live state, so nothing.
 */
export function sinceEpochOf(s: SessionDetail, live: LiveStateWire | null | undefined, phase: Phase, nowMs: number): number | null {
  const base = anchorOf(s, live, nowMs);
  if (phase === 'needsYou' || phase === 'stalled' || phase === 'done') {
    const since = live?.activity?.since_s;
    if (isNum(since)) return minuteFloor(base - Math.max(0, since));
    if (phase === 'stalled' && !live) {
      const last = epochSeconds(s.ended_at);
      return last === null ? null : minuteFloor(last);
    }
    return null;
  }
  const v = live?.verdict;
  if (phase === 'working' && v?.state === 'circling' && v.basis === 'consecutive_failures') {
    const stuck = v.evidence?.stuck_s;
    if (isNum(stuck) && stuck >= 60) return minuteFloor(base - stuck);
  }
  return null;
}

/**
 * Files the agent changed in this session: the engine's map rows with an edit that no error
 * answered (`live._edited`, the rule behind "files changed"), or -1 when no map came. NOT the
 * row's `stats.files_touched`, which counts every file any event named, reads included.
 *
 * Also -1 when the map was CUT (`files_total` above the rows sent). The live LIST serves the
 * slim body, which keeps only the one or two rows the sentence names, and a count over those
 * is a plausible wrong number: "1 file changed" of fourteen (Screens S4 found it; the fixture's
 * `map_cut` case pins it). Absent, not a lower bound. `live_push.files_changed_of` is the
 * Python half.
 */
export function filesChangedOf(live: LiveStateWire | null | undefined): number {
  const rows = live?.map?.files;
  if (!Array.isArray(rows) || rows.some((r) => !isNum(r.edits))) return -1;
  const total = live?.map?.files_total;
  if (isNum(total) && total > rows.length) return -1;
  return rows.filter((r) => (r.edits ?? 0) > 0).length;
}

export function normalizeCreature(id: string | null | undefined): CreatureId {
  return typeof id === 'string' && ((ANIMALS as readonly string[]).includes(id) || id === 'bit') ? (id as CreatureId) : 'bit';
}

export interface StateContext {
  nowMs: number;
  /** THIS session's creature (its crew creature, `crew.ts`), not the builder's own. */
  creature?: string | null;
  /** Sessions running beside this one that have no card of their own. */
  runningCount: number;
  /** Settings > Show details on Lock Screen. Default on (`cache.LOCK_SCREEN_DETAILS_DEFAULT`). */
  details?: boolean;
  /** Every session running, this one included: the "2 running" a card says with details off. */
  runningTotal?: number;
}

/**
 * The card with Show details on Lock Screen OFF: "Builda · 2 running" and nothing about which
 * repository or what it is doing (`src/data/privacy.ts LOCK_SCREEN_OFF`). The phase stays only
 * as far as working or finished: needs you, stalled and the verdict are what a session is
 * doing, and so are its counts and its clocks. A finished card says "Finished".
 */
function withoutDetails(state: SessionState, runningTotal: number): SessionState {
  const done = state.phase === 'done';
  return {
    ...state,
    phase: done ? 'done' : 'working',
    sentence: done ? doneSentence() : lockScreenWithoutDetails(Math.max(1, runningTotal)),
    progress: -1,
    filesChanged: -1,
    etaEpoch: null,
    sinceEpoch: null,
    trajectory: 'none',
    linesAdded: null,
    linesRemoved: null,
    commits: null,
  };
}

export function toState(s: SessionDetail, live: LiveStateWire | null | undefined, ctx: StateContext): SessionState {
  const state = detailedState(s, live, ctx);
  return ctx.details === false ? withoutDetails(state, ctx.runningTotal ?? ctx.runningCount + 1) : state;
}

function detailedState(s: SessionDetail, live: LiveStateWire | null | undefined, ctx: StateContext): SessionState {
  const phase = phaseOf(s, live, ctx.nowMs);
  const stats = s.stats ?? null;
  const ended = phase === 'done' && s.state === 'final' ? epochSeconds(s.ended_at) : null;
  return {
    phase,
    sentence: clampSentence(surfaceSentenceOf(s, live, phase, ctx.nowMs)),
    progress: progressOf(live),
    filesChanged: filesChangedOf(live),
    etaEpoch: phase === 'done' ? null : etaEpochOf(s, live, ctx.nowMs),
    sinceEpoch: sinceEpochOf(s, live, phase, ctx.nowMs),
    endedEpoch: ended === null ? null : Math.round(ended),
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
 * put in, because the widget's "22m" is drawn from it and would otherwise freeze until
 * something else changed.
 */
export function contentKey(attrs: SessionAttrs, state: SessionState, nowMs: number): string {
  const { updatedEpoch: _ignored, ...shown } = state;
  const minute = Math.floor(Math.max(0, nowMs / 1000 - attrs.startedEpoch) / 60);
  return JSON.stringify([attrs.repo, attrs.agent, minute, shown]);
}

export function relevanceOf(state: SessionState, live: LiveStateWire | null | undefined): number {
  if (state.phase === 'needsYou') return RELEVANCE_NEEDS_YOU;
  if (state.phase === 'done') return RELEVANCE_DONE;
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
  /** The activity's id; null while none runs for it (disabled, capped, or failed). */
  activityId: string | null;
  phase: Phase;
  key: string;
  /** The last state sent. Null for an activity found at launch, before any sync. */
  state: SessionState | null;
  attrs: SessionAttrs | null;
  /** A start that failed is not retried before this. */
  retryAfterMs?: number;
  /**
   * Set on a FINISHED card still on the Lock Screen (ended, not yet dismissed): when it ended.
   * These are keyed `ended:<activityId>`, apart from the running sessions, so a session id that
   * comes back gets a card of its own and `activityFor` never answers with a finished one.
   */
  endedAtMs?: number;
}

/** The memory key of a finished card still on the Lock Screen. */
export const endedKey = (activityId: string): string => `ended:${activityId}`;

export type SyncAction =
  | { kind: 'start'; sessionId: string; attrs: SessionAttrs; state: SessionState; opts: ContentOptions }
  | { kind: 'update'; sessionId: string; activityId: string; state: SessionState; opts: ContentOptions }
  | { kind: 'end'; sessionId: string; activityId: string; state: SessionState | null; opts: ContentOptions }
  | { kind: 'notify'; sessionId: string; which: 'needsYou' | 'finished'; session: SessionDetail; state: SessionState; body: string };

export interface PlanInput {
  /** The live rows, from a SUCCESSFUL fetch: a row missing from it is taken to have finished. */
  sessions: readonly SessionDetail[];
  liveStates?: LiveStates;
  /** Rows known to have ended since the last sync (the cache's live to final flip), for their final counts. */
  finished?: readonly SessionDetail[];
  tracked: ReadonlyMap<string, Tracked>;
  activitiesEnabled: boolean;
  /**
   * Each session's creature by id (`crew.crewFor`, which remembers them for the process, so a card
   * wears the colour its tile wears). Default: the crew rule over these rows alone. A session
   * missing from the map wears the creature its id hashes onto.
   */
  crew?: ReadonlyMap<string, string>;
  /** Seconds until the surfaces say "Not updating". Default STALE_SECONDS; the debug route shortens it. */
  staleInSeconds?: number;
  /**
   * Settings > Show details on Lock Screen. Off: every card says "Builda · N running" and no
   * update carries an alert, whose title and body would name the repository and what it is
   * doing. Default on.
   */
  details?: boolean;
  /** The phone's project names and numbers (`data/repoNames.loadRepoNames`); none says "private repo". */
  names?: RepoNames | null;
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

/**
 * The alert on the move into needs you: the one needs you title (`push/localCopy.needsYouTitle`,
 * the server's `live_push.alert_for`), over the engine's sentence as it stands, duration and all.
 * From the ROW, not the card's attributes: the card may say "Private project 2", which the
 * server's alert for the same moment cannot.
 */
export function alertFor(s: Pick<SessionDetail, 'repo_name'>, body: string): Pick<ContentOptions, 'alertTitle' | 'alertBody'> {
  return { alertTitle: needsYouTitle(s.repo_name), alertBody: body };
}

/**
 * The last state a card showed, turned into its finished card (null when none is known). It
 * went from the live list without a final row, so when it ended is not known (`endedEpoch`
 * null: the card says "finished", not a duration nobody measured), and the sentence is the
 * engine's plain "Finished", its counts on the line under it.
 */
function finishedFrom(prev: Tracked, nowMs: number): SessionState | null {
  if (!prev.state) return null;
  return {
    ...prev.state,
    phase: 'done',
    sentence: doneSentence(),
    etaEpoch: null,
    sinceEpoch: null,
    endedEpoch: null,
    runningCount: 0,
    updatedEpoch: Math.round(nowMs / 1000),
  };
}

/** A finish's end options: taken down now while another session runs, else the HIG's 20 minutes. */
function endOptions(othersRunning: boolean, known: boolean): ContentOptions {
  return { dismissAfterSeconds: othersRunning || !known ? 0 : DISMISS_AFTER_SECONDS, relevance: RELEVANCE_DONE };
}

export function planSync(input: PlanInput): Plan {
  const { nowMs } = input;
  const details = input.details !== false;
  const staleIn = input.staleInSeconds ?? STALE_SECONDS;
  const finishedById = new Map((input.finished ?? []).map((s) => [s.id, s]));
  const rows = missionOrder(
    [...input.sessions.filter((s) => !finishedById.has(s.id)), ...finishedById.values()],
    input.liveStates,
    nowMs
  );
  const phases = new Map(rows.map((s) => [s.id, phaseOf(s, input.liveStates?.[s.id], nowMs)]));
  const running = rows.filter((s) => phases.get(s.id) !== 'done');
  const anyRunning = running.length > 0;
  const crew = input.crew ?? crewCreatures(rows);

  // Which running sessions show a card: those that have one, then new starts in mission
  // control order up to the cap. The rest are "N more running" on every card.
  const carded = new Set<string>();
  const starts = new Set<string>();
  const retryBlocked = (id: string) => {
    const r = input.tracked.get(id)?.retryAfterMs;
    return r !== undefined && nowMs < r;
  };
  for (const s of running) if (input.tracked.get(s.id)?.activityId) carded.add(s.id);
  let active = carded.size;
  for (const s of running) {
    if (carded.has(s.id) || !input.activitiesEnabled || active >= MAX_ACTIVITIES || retryBlocked(s.id)) continue;
    starts.add(s.id);
    carded.add(s.id);
    active += 1;
  }
  const uncarded = running.length - carded.size;

  const actions: SyncAction[] = [];
  const next = new Map<string, Tracked>();
  const seen = new Set<string>();

  for (const s of rows) {
    seen.add(s.id);
    const live = input.liveStates?.[s.id] ?? null;
    const phase = phases.get(s.id)!;
    const ctx: StateContext = {
      nowMs,
      creature: creatureOf(s, crew),
      runningCount: phase === 'done' ? 0 : uncarded,
      details,
      runningTotal: running.length,
    };
    const attrs = toAttrs(s, details, input.names);
    const state = toState(s, live, ctx);
    const prev = input.tracked.get(s.id);

    if (phase === 'done') {
      if (prev?.activityId) {
        const opts = endOptions(anyRunning, true);
        actions.push({ kind: 'end', sessionId: s.id, activityId: prev.activityId, state, opts });
        if (opts.dismissAfterSeconds === 0 && s.state === 'final' && finishIsNews(s)) {
          // Taken down because another session runs: no card says it finished, so a finish
          // that is news is the notification it would otherwise never be.
          actions.push({ kind: 'notify', sessionId: s.id, which: 'finished', session: s, state, body: state.sentence });
        } else if (opts.dismissAfterSeconds) {
          next.set(endedKey(prev.activityId), { ...prev, phase: 'done', key: '', state, attrs, endedAtMs: nowMs });
        }
      } else if (prev && finishIsNews(s)) {
        actions.push({ kind: 'notify', sessionId: s.id, which: 'finished', session: s, state, body: state.sentence });
      }
      continue; // a finished session leaves the running memory
    }

    const key = contentKey(attrs, state, nowMs);
    // A move INTO needs you that this process watched happen. An activity found running at
    // launch (state null) is a first sighting: it was not watched, so it does not alert.
    const intoNeedsYou = phase === 'needsYou' && prev?.state != null && prev.phase !== 'needsYou';
    const spoken = clampSentence(sentenceOf(s, live, phase, nowMs));
    if (prev?.activityId && prev.attrs && prev.attrs.repo !== attrs.repo && input.activitiesEnabled) {
      // A card's repository is an attribute, fixed for its life (ActivityKit), so a card that
      // started before this phone had numbered its project ("private repo") would say so until
      // it ended. FOUND IN REVIEW (2026-09-14). When the name it would start with now differs,
      // the card comes down and starts again under it, in the same sync; no alert on either.
      actions.push({ kind: 'end', sessionId: s.id, activityId: prev.activityId, state: null, opts: { dismissAfterSeconds: 0 } });
      actions.push({ kind: 'start', sessionId: s.id, attrs, state, opts: contentOptions(state, live, staleIn) });
      next.set(s.id, { sessionId: s.id, activityId: null, phase, key, state, attrs });
      continue;
    }
    if (prev?.activityId) {
      if (prev.key !== key) {
        const alert = intoNeedsYou && details ? alertFor(s, spoken) : {};
        const opts = { ...contentOptions(state, live, staleIn), ...alert };
        actions.push({ kind: 'update', sessionId: s.id, activityId: prev.activityId, state, opts });
      }
      next.set(s.id, { ...prev, phase, key, state, attrs });
      continue;
    }

    if (starts.has(s.id)) {
      actions.push({ kind: 'start', sessionId: s.id, attrs, state, opts: contentOptions(state, live, staleIn) });
    } else if (intoNeedsYou) {
      actions.push({ kind: 'notify', sessionId: s.id, which: 'needsYou', session: s, state, body: spoken });
    }
    const blocked = retryBlocked(s.id);
    next.set(s.id, { sessionId: s.id, activityId: null, phase, key, state, attrs, retryAfterMs: blocked ? prev?.retryAfterMs : undefined });
  }

  for (const [k, prev] of input.tracked) {
    // A finished card still on the Lock Screen: taken down the moment anything runs, so it
    // never sits on top of a running card; otherwise kept until the system dismisses it.
    if (prev.endedAtMs !== undefined) {
      if (!prev.activityId) continue;
      if (anyRunning) {
        actions.push({ kind: 'end', sessionId: prev.sessionId, activityId: prev.activityId, state: null, opts: { dismissAfterSeconds: 0 } });
      } else if (nowMs - prev.endedAtMs < DISMISS_AFTER_SECONDS * 1000) {
        next.set(k, prev);
      }
      continue;
    }
    // Tracked, and gone from the live list: the server flipped it to final. End its card with
    // the last thing it showed, as finished; an activity found at launch with nothing known
    // about it is removed rather than left claiming to run.
    if (seen.has(prev.sessionId) || !prev.activityId) continue;
    const state = finishedFrom(prev, nowMs);
    const opts = endOptions(anyRunning, state !== null);
    actions.push({ kind: 'end', sessionId: prev.sessionId, activityId: prev.activityId, state, opts });
    if (state && opts.dismissAfterSeconds) {
      next.set(endedKey(prev.activityId), { ...prev, phase: 'done', key: '', state, endedAtMs: nowMs });
    }
  }

  return { actions, tracked: next };
}

/** A session's crew creature from the map, else the one its id hashes onto: never Bit. */
function creatureOf(s: SessionDetail, crew: ReadonlyMap<string, string>): string {
  return crew.get(s.id) ?? crewHashed(s.client_session_id || s.id);
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
  /** working, needsYou or stalled; done for a turn the engine called done (finished, not looked at yet). */
  phase: Phase;
  sentence: string;
  trajectory: Trajectory;
  /** This session's crew creature: the row, its word and its dot are drawn in that creature's hue. */
  creature: CreatureId;
  startedEpoch: number;
  progress: number;
  filesChanged: number;
  etaEpoch: number | null;
  /**
   * When the condition began (needs you, no output, a failing command), for "4m" live; on a
   * finished row, when the turn finished, for "ran 47m".
   */
  sinceEpoch: number | null;
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
  /** The builder's own creature (Bit, or their pick): the idle widget. No session row wears it. */
  creature: CreatureId;
  /** Every session running, which can be more than the rows listed. A finished row is not running. */
  runningCount: number;
  sessions: WidgetSession[];
  today: WidgetToday | null;
}

export interface WidgetInput {
  /**
   * The live rows the widget may list. `activity.ts` hands it the ones mission control shows
   * (`mission.visibleRows`), so a finished turn leaves the widget when it leaves the grid.
   */
  sessions: readonly SessionDetail[];
  liveStates?: LiveStates;
  /** The builder's own creature. */
  creature?: string | null;
  /** Each session's creature by id, as `PlanInput.crew`. Default: the crew rule over these rows. */
  crew?: ReadonlyMap<string, string>;
  today?: WidgetToday | null;
  /** The phone's project names and numbers, as `PlanInput.names`. */
  names?: RepoNames | null;
  nowMs: number;
}

/**
 * The widget's rows, in mission control's order: every running session, and every live row whose
 * turn the engine called done (finished, not looked at yet: mission control's finished tile,
 * which the widget lists the same way and never counts as running). A final row is never listed.
 */
export function buildWidgetSnapshot(input: WidgetInput): WidgetSnapshot {
  const { nowMs } = input;
  const ordered = missionOrder(input.sessions, input.liveStates, nowMs);
  const phases = new Map(ordered.map((s) => [s.id, phaseOf(s, input.liveStates?.[s.id], nowMs)]));
  const running = ordered.filter((s) => phases.get(s.id) !== 'done');
  const listed = ordered.filter((s) => s.state !== 'final');
  const crew = input.crew ?? crewCreatures(input.sessions);
  const updatedEpoch = Math.round(nowMs / 1000);
  const today = input.today ?? null;
  return {
    v: 1,
    updatedEpoch,
    staleEpoch: updatedEpoch + STALE_SECONDS,
    creature: normalizeCreature(input.creature),
    runningCount: running.length,
    sessions: listed.slice(0, WIDGET_MAX_SESSIONS).map((s) => {
      const live = input.liveStates?.[s.id] ?? null;
      const state = toState(s, live, { nowMs, creature: creatureOf(s, crew), runningCount: running.length - 1 });
      const attrs = toAttrs(s, true, input.names);
      return {
        id: s.id,
        repo: attrs.repo,
        agent: attrs.agent,
        phase: state.phase,
        sentence: state.sentence,
        trajectory: state.trajectory,
        creature: state.creature,
        startedEpoch: attrs.startedEpoch,
        progress: state.progress,
        filesChanged: state.filesChanged,
        etaEpoch: state.etaEpoch,
        sinceEpoch: state.sinceEpoch,
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

// ------------------------------------------------------------------ the foreground poll
// Pure halves of `useLiveSurfaces.ts`, here so bun can test them without React Native.

/** Rows that were live at the last pass and are final now, for their final counts on the card. */
export function finishedSince(before: readonly string[], liveNow: readonly SessionDetail[]): string[] {
  const still = new Set(liveNow.map((s) => s.id));
  return before.filter((id) => !still.has(id));
}

/** The widget's idle row: the week's levels from the profile graph; attended time is not in it. */
export function todayFromProfile(graph: readonly { date: string; active_seconds: number }[] | null | undefined, nowMs: number): WidgetToday | null {
  if (!graph) return null;
  const d = new Date(nowMs - DAY_BOUNDARY_HOUR * 3_600_000);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // `Profile.graph` is ACTIVE seconds per day; the widget's number is ATTENDED time, which the
  // phone does not have per day. Absent, not the active figure under an attended label.
  return { attendedSeconds: null, week: weekFromGraph(graph, today) };
}
