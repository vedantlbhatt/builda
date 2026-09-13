/**
 * Mission control, decided (DESIGN-DIRECTION 7.1): which running sessions get a tile, in what
 * order, when the order may move, and every word and number a tile says. Pure: no React Native,
 * no clock (every function takes `nowMs`), so `__tests__/mission.test.ts` pins every rule in bun.
 * `MissionTile.tsx` and `LiveSessions.tsx` only lay these out.
 *
 * Nothing here is a second copy of a rule that already has a home:
 *  - the order is `surface.missionOrder`, the port of `live.mission_order` that the Lock Screen
 *    and the widget already use, so the first tile is the session the Lock Screen shows;
 *  - the phase (needs you, working, stalled, done) is `surface.phaseOf`, the sentence is
 *    `surface.sentenceOf` over the engine's own renderer (`sentence.ts`), and the time a wait
 *    began is `surface.sinceEpochOf`;
 *  - an ETA refusal is `copy/live.etaRefusal`, the engine's words from its code;
 *  - a clock time is `you/numbers.clockOf`.
 * What is new here is only what a tile adds: aging the engine's numbers by the seconds since
 * `computed_at` (for display, docs/overnight-integration.md 3.5), the 15 second hold on the
 * order, the ten minutes a finished tile stays, and the tile's copy. The tile's phase is the
 * surfaces' own (`tilePhase` is `surface.phaseOf`: a turn the engine called done is finished on
 * the tile, the Lock Screen, the island and the widget alike), and the crew rule is `crew.ts`'s,
 * re-exported here (DESIGN-V2 2.2).
 */

import type { SessionDetail } from '../data/api';
import type { LiveActivity, LiveEta, LiveState, Phase } from '../generated/live';
import { etaRefusal } from '../copy/live';
import { commas } from '../copy/numbers';
import { spoken } from '../copy/plain';
import { HARNESS_NAMES, isHarness } from '../pixel/harness';
import { layout } from '../theme';
import { clockOf, dayOf } from '../you/numbers';
import type { LiveStateWire } from './sentence';
import {
  missionOrder as surfaceMissionOrder,
  phaseOf,
  PRIVATE_REPO,
  sentenceOf,
  sinceEpochOf,
  STALE_SECONDS,
  surfaceSentenceOf,
  trajectoryOf,
  type LiveStates,
} from './surface';

// ------------------------------------------------------------------ constants

/** DESIGN-DIRECTION 7.1: a tile is 188pt tall at the default text size. */
export const TILE_HEIGHT = 188;
/** Two tiles per row. */
export const TILE_COLUMNS = 2;
/** The creature in a tile's bottom right corner, 48pt (a whole-pixel size: 3pt per cell). */
export const TILE_CREATURE = 48;
/** "4pt into the padding": the creature's box sits this far inside the tile's edge, not 14. */
export const TILE_CREATURE_INSET = layout.tilePad - 4;
/**
 * Text beside the creature stops this far from the text column's right edge: the creature's box
 * minus the 4pt it sits into the padding, plus a 4pt gap. The drawn animal is narrower than its
 * box (a 12 cell live area in a 16 cell frame, 6pt clear each side at 48pt), so the gap to the
 * pixels is 10pt.
 */
export const TILE_CREATURE_CLEAR = TILE_CREATURE - 4 + 4;
/**
 * The most a tile's text grows with Dynamic Type, and the tile grows with it. UNMEASURED
 * JUDGEMENT CALL: a fixed 188pt tile holds four 15pt lines and three footer lines exactly, so
 * its text cannot grow at all unless the tile does; past 1.3x a two column tile is a column of
 * single words, and the session screen is where large text reads the whole sentence.
 */
export const TILE_MAX_SCALE = 1.3;

/**
 * The order moves at most this often, and never while a finger is down (DESIGN-DIRECTION 7.1:
 * "a grid that jumps under your thumb is broken"). The design's number.
 */
export const RESORT_MIN_MS = 15_000;
/** A finished tile stays this long after the phone saw the session finish, then leaves. The design's number. */
export const FINISHED_SHOW_MS = 10 * 60_000;
/**
 * A session the phone saw leave the live list is shown as finished only if its last record is
 * at most this old. The server finalises a session once no record has come for tau, and the
 * widest tau the boundary fit returns is 3600 s (`scripts/measure_boundaries.py TAU_MAX`, the
 * same bound as `live.LIVE_MTIME_SEC`); a longer gap plus the ten minutes a tile stays means it
 * finished while nobody was looking, and a "finished" tile for it would be old news.
 */
export const FINISHED_HORIZON_SECONDS = 3600 + FINISHED_SHOW_MS / 1000;
/**
 * A touch that began and never reported its end still blocks the re-sort for at most this long.
 * UNMEASURED JUDGEMENT CALL: longer than any real press or drag, short enough that a lost
 * touch end cannot freeze the order for the rest of the visit.
 */
export const HOLD_MAX_MS = 60_000;

/**
 * "22m", "1h 05m": LiveDisplay.swift `LiveCopy.duration`, so a tile and the widget say the same
 * minute. A worklet as well: a tile's elapsed figure writes every frame of its count with it, so
 * the frames and the resting string can never differ in shape.
 */
export function elapsedLabel(seconds: number): string {
  'worklet';
  const total = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
}

// ------------------------------------------------------------------ geometry

/** `(screen - 2 gutters - one tile gap) / 2`: 174.5pt on a 393pt phone. */
export function tileWidth(screenWidth: number): number {
  return (screenWidth - 2 * layout.gutter - layout.tileGap * (TILE_COLUMNS - 1)) / TILE_COLUMNS;
}

/**
 * Which size tile `index` of `count` is. The first, who needs you most, leads across the width;
 * the rest go two to a row; an unpaired last one spans the width too, so a row never ends on a
 * hole. The house style's "everything the same size" is on the banned list: the order is also
 * the hierarchy.
 */
export function tileVariant(index: number, count: number): 'lead' | 'wide' | 'half' {
  if (index <= 0) return 'lead';
  const rest = count - 1;
  return rest % 2 === 1 && index === count - 1 ? 'wide' : 'half';
}

/** A tile's width: the lead and the wide span the gutters, a half is `tileWidth`. */
export function tileWidthFor(variant: 'lead' | 'wide' | 'half', screenWidth: number): number {
  return variant === 'half' ? tileWidth(screenWidth) : screenWidth - 2 * layout.gutter;
}

/** 188pt, grown with the reader's text size up to `TILE_MAX_SCALE`, so the grid stays even. */
export function tileHeight(fontScale: number): number {
  const scale = Number.isFinite(fontScale) ? Math.min(TILE_MAX_SCALE, Math.max(1, fontScale)) : 1;
  return Math.round(TILE_HEIGHT * scale);
}

// ------------------------------------------------------------------ the wire, aged

/**
 * The generated `LiveState` as `sentence.ts`'s structural `LiveStateWire`, which `surface.ts`
 * reads. The same JSON; the hand typed partial spells an absent verdict state as null where the
 * spec leaves the key out, so the fields are carried across rather than cast.
 */
export function toWire(live: LiveState | null | undefined): LiveStateWire | null {
  if (!live) return null;
  const v = live.verdict;
  const e = live.eta;
  return {
    // The anchor every clock counts from (`surface.anchorOf`) and the map's own count, which
    // tells a cut map (the slim list body) from a whole one (`surface.filesChangedOf`).
    computed_at: live.computed_at,
    activity: live.activity ?? null,
    verdict: {
      state: v.state ?? null,
      basis: v.basis ?? null,
      reason: v.reason ?? null,
      file_id: v.file_id ?? null,
      evidence: v.evidence,
    },
    eta: {
      elapsed_s: e.elapsed_s ?? null,
      typical_s: e.typical_s ?? null,
      p25_s: e.p25_s ?? null,
      p75_s: e.p75_s ?? null,
      remaining_s: e.remaining_s ?? null,
      n: e.n ?? null,
      basis: e.basis,
      reason: e.reason ?? null,
    },
    decisions: live.decisions.map((d) => ({ kind: d.kind, ts: d.ts, evidence: { event_n: d.event_n, count: d.count } })),
    needs_you: live.needs_you,
    map: live.map
      ? {
          files: live.map.files.map((f) => ({
            id: f.id,
            role: f.role,
            depth: f.depth ?? null,
            dir_id: f.dir_id ?? null,
            reads: f.reads,
            edits: f.edits,
            last_read_ts: f.last_read_ts ?? null,
            last_edit_ts: f.last_edit_ts ?? null,
          })),
          files_total: live.map.files_total,
        }
      : null,
  };
}

/** Every row's live state, keyed by id, as `surface.ts` takes them. */
export function liveStatesOf(rows: readonly SessionDetail[]): LiveStates {
  const out: Record<string, LiveStateWire | null> = {};
  for (const s of rows) out[s.id] = toWire(s.live_state);
  return out;
}

function parseMs(iso: string | null | undefined): number | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When the numbers on this row were true: the engine's `computed_at`, else the row's
 * `updated_at` (the last upload), else never known. `since_s`, `stuck_s`, the ETA and the stale
 * rule all count from here, never from the moment the phone happened to fetch it.
 */
export function anchorMsOf(s: SessionDetail): number | null {
  return parseMs(s.live_state?.computed_at) ?? parseMs(s.updated_at);
}

/** Seconds from the anchor to now, never negative (a server clock a little ahead of the phone's). */
export function ageSecondsOf(s: SessionDetail, nowMs: number): number {
  const anchor = anchorMsOf(s);
  return anchor === null ? 0 : Math.max(0, (nowMs - anchor) / 1000);
}

/**
 * The data behind this live row is older than STALE_SECONDS (the Lock Screen's "Not updating"
 * threshold): the Mac stopped sending, and nothing on the tile may be read as current.
 */
export function isStale(s: SessionDetail, nowMs: number): boolean {
  if (s.state === 'final') return false;
  const anchor = anchorMsOf(s);
  return anchor !== null && (nowMs - anchor) / 1000 > STALE_SECONDS;
}

/**
 * The wire state as it stands NOW for display: the activity's `since_s` and a failing
 * command's `stuck_s` advanced by the seconds since `computed_at`. Only the durations a sentence
 * speaks move ("Waiting on you for five minutes" a minute after four); every count stays the
 * engine's. The ordering never reads this: it ranks the engine's own numbers.
 */
export function agedWire(s: SessionDetail, nowMs: number): LiveStateWire | null {
  const wire = toWire(s.live_state);
  if (!wire) return null;
  const age = Math.floor(ageSecondsOf(s, nowMs));
  if (age <= 0) return wire;
  const a = wire.activity;
  const v = wire.verdict;
  const stuck = v?.evidence?.stuck_s ?? 0;
  return {
    ...wire,
    activity: a ? { ...a, since_s: (a.since_s ?? 0) + age } : a,
    verdict: v && v.evidence && stuck > 0 ? { ...v, evidence: { ...v.evidence, stuck_s: stuck + age } } : v,
  };
}

/** The same row with its anchor moved onto `computed_at`, for `surface.ts`'s epoch helpers (3.5). */
function anchored(s: SessionDetail): SessionDetail {
  const at = s.live_state?.computed_at;
  return at ? { ...s, updated_at: at } : s;
}

// ------------------------------------------------------------------ one tile

export type TileKind = 'needsYou' | 'working' | 'stalled' | 'finished';
export type TileVerdict = 'converging' | 'circling' | 'lost';

export interface TileLanded {
  /** Lines the agent added, when more than none. */
  added: number | null;
  /** Lines it removed, when the server sent the count and it was more than none. */
  removed: number | null;
  commits: number | null;
  /** Lines and commits both measured, and all zero: the one case a tile may say so. */
  nothing: boolean;
}

export interface TileModel {
  id: string;
  kind: TileKind;
  /** The wire value; `HarnessGlyph` draws nothing for one this build does not know. */
  harness: string;
  repo: string;
  /** Top right: the elapsed time, or the word that replaces it. */
  corner: { text: string; tone: 'dim' | 'accent'; weight: 400 | 600 };
  sentence: string;
  /** No new output, or not updating: the sentence and the creature dim. */
  dim: boolean;
  /** The drawn verdict, only while working. */
  verdict: TileVerdict | null;
  /** A state word when there is no verdict to draw ("starting"), else null. */
  stateWord: string | null;
  /** Files the session touched (`map.files_total`); null when nothing measured it. */
  files: number | null;
  /** A finished tile's lines and commits, in place of files and the ETA. */
  landed: TileLanded | null;
  /** The line under the files: the ETA, or when the wait began; null when there is nothing honest to say. */
  eta: string | null;
  stale: boolean;
  /**
   * Whole minutes since the session started, for the tile's counted figure (`elapsedLabel` of
   * it is the corner's text); null on a finished tile, which shows what it landed instead, and
   * when the row carries no start.
   */
  elapsedMin: number | null;
  /**
   * Elapsed over the repository's typical run, 0 to 1 in 2% steps, for the pixel track along
   * the tile's foot. Only while the ETA line is an answer: working on current data, the engine
   * answered, and not circling or lost (a run going nowhere has nothing to count down). Null
   * otherwise, so a refused ETA draws no track at all rather than an empty one.
   */
  track: number | null;
  /**
   * The row is still live but the engine called the turn done: finished, not looked at yet
   * (`needs_you.reason` `finished_unreviewed`, analysis/__main__.py's words). A finished tile.
   */
  unreviewed: boolean;
  /** What VoiceOver reads for the whole tile. */
  label: string;
  /** Changes exactly when something the tile draws changes (for `React.memo`). */
  key: string;
}

/**
 * The phase a TILE shows: `surface.phaseOf`, the one rule. A turn the engine called `done` while
 * the row is still live is finished, not looked at yet (`needs_you.reason` `finished_unreviewed`,
 * analysis/__main__.py's words), never needs you.
 *
 * This was the one place a tile read a phase differently from the Lock Screen: `phaseOf` checked
 * the waiting activity first, so every such row was needs you on the Lock Screen, in the island
 * and on the widget while the tile said finished (the owner, 2026-09-13: a finished session
 * waiting to be looked at is FINISHED). The rule moved into `phaseOf` and its server half
 * (`live_push.phase_of`) together, and `spec/fixtures/live/content_state.json` pins it
 * (`done_after_commit`). A finished tile is counted as finished and goes ten minutes after the
 * turn ended like any other (`visibleRows`). The ORDER is untouched: it is still the engine's
 * score (`finished_unreviewed`, 30).
 */
export function tilePhase(s: SessionDetail, wire: LiveStateWire | null | undefined, nowMs: number): Phase {
  return phaseOf(s, wire, nowMs);
}

/** Elapsed over typical in 2% steps, so a tile redraws its track at most fifty times a run. */
const TRACK_STEPS = 50;

/**
 * The track under a working tile: elapsed over the repository's typical run, aged to now, from
 * the engine's ETA block. Null whenever the ETA line is not an answer (`etaLine`): refused,
 * circling or lost. Past the typical run it is full, never a second lap.
 */
export function trackOf(eta: LiveEta | null | undefined, ageSeconds: number, verdict: TileVerdict | null): number | null {
  if (verdict === 'circling' || verdict === 'lost') return null;
  const typical = eta?.typical_s;
  const elapsed = eta?.elapsed_s;
  if (typeof typical !== 'number' || !(typical > 0) || typeof elapsed !== 'number' || !Number.isFinite(elapsed)) return null;
  if (typeof eta?.remaining_s !== 'number') return null;
  const ratio = (elapsed + Math.max(0, ageSeconds)) / typical;
  return Math.round(Math.min(1, Math.max(0, ratio)) * TRACK_STEPS) / TRACK_STEPS;
}

/**
 * "9:37" on the Builda day it is now, else the day ("Sep 12"): a stale row left live over
 * a night must not read as this morning. The same rule as the stale note (`you/load.staleLine`).
 */
export function clockOrDay(ms: number, nowMs: number): string {
  const day = dayOf(new Date(ms).toISOString(), nowMs);
  return day !== null && day === dayOf(new Date(nowMs).toISOString(), nowMs) ? clockOf(ms) : (day ?? clockOf(ms));
}

/** "since 9:37": a clock time stays true while nobody refreshes, a duration would not. */
function sinceLabel(epochS: number | null, nowMs: number): string | null {
  return epochS === null ? null : `since ${clockOrDay(epochS * 1000, nowMs)}`;
}

/** "about 18m left", "about 1h 05m left": never under a minute, never a second lap. */
export function leftLabel(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `about ${elapsedLabel(m * 60)} left`;
}

/**
 * The ETA line while a session works (DESIGN-DIRECTION 7.1), from the engine's block aged to
 * now. On track: "about 18m left". Past the typical run: "longer than usual" (the Lock Screen's
 * "running longer than usual", cut to fit beside the creature). Refused, or no engine: "no ETA
 * yet". Circling or lost: nothing, because a run going nowhere has no time left to count down
 * (LiveDisplay.swift offers none either).
 */
export function etaLine(eta: LiveEta | null | undefined, ageSeconds: number, verdict: TileVerdict | null): string | null {
  if (verdict === 'circling' || verdict === 'lost') return null;
  const remaining = eta?.remaining_s;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return 'no ETA yet';
  const left = remaining - Math.max(0, ageSeconds);
  return left > 0 ? leftLabel(left) : 'longer than usual';
}

/**
 * Why there is no ETA, in the engine's words ("5 finished sessions on this repository, 10
 * needed"), for the session screen and the live bar's label. Null when there is an ETA. The
 * design's "3 more finished runs and it will have one" is not used: ten sessions can still
 * refuse (too few of them ran as long as this one), so it would promise what the rule does not.
 */
export function etaDetail(eta: LiveEta | null | undefined): string | null {
  if (!eta) return null;
  const why = etaRefusal(eta);
  return why === null ? null : `No ETA yet: ${why}.`;
}

function landedOf(s: SessionDetail): TileLanded {
  const st = s.stats ?? null;
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : null);
  const added = num(st?.lines_added_agent);
  const removed = num(st?.lines_removed_agent);
  const commits = num(st?.commit_count);
  return {
    added: added !== null && added > 0 ? added : null,
    removed: removed !== null && removed > 0 ? removed : null,
    commits: commits !== null && commits > 0 ? commits : null,
    nothing: added === 0 && removed === 0 && commits === 0,
  };
}

/**
 * `+420` and `-88`, each only when more than none: a hyphen before a number is a sign, not a
 * dash, and `copy/plain.hasDash` agrees (the phone's rule; the Lock Screen's U+2212 is Swift's).
 * `none` is "no lines" when lines were measured at zero and nothing else landed either.
 */
export function landedParts(l: TileLanded): { add: string | null; del: string | null; none: string | null } {
  return {
    add: l.added !== null ? `+${commas(l.added)}` : null,
    del: l.removed !== null ? `-${commas(l.removed)}` : null,
    none: l.added === null && l.removed === null && l.nothing ? 'no lines' : null,
  };
}

/** The lines as one string, "+420 -88", for a label; null when there is nothing to say. */
export function landedLines(l: TileLanded): string | null {
  const p = landedParts(l);
  const text = [p.add, p.del].filter((x): x is string => x !== null).join(' ');
  return text === '' ? p.none : text;
}

export function landedCommits(l: TileLanded): string | null {
  if (l.commits !== null) return l.commits === 1 ? '1 commit' : `${commas(l.commits)} commits`;
  return l.nothing ? 'no commits' : null;
}

export function harnessName(harness: string): string {
  return isHarness(harness) ? HARNESS_NAMES[harness] : harness;
}

/**
 * Everything one tile shows, at `nowMs`. The phase and the sentence are the surfaces' rules; a
 * stale row speaks the timeless sentence (no "for four minutes" it cannot vouch for) and says
 * when its numbers were taken instead.
 */
export function tileModel(s: SessionDetail, nowMs: number): TileModel {
  const wire = toWire(s.live_state);
  const stale = isStale(s, nowMs);
  const phase = tilePhase(s, wire, nowMs);
  const kind: TileKind = phase === 'done' ? 'finished' : phase;
  const age = ageSecondsOf(s, nowMs);
  const sentence = stale ? surfaceSentenceOf(s, wire, phase, nowMs) : sentenceOf(s, agedWire(s, nowMs), phase, nowMs);

  const started = parseMs(s.started_at);
  const elapsedSeconds = started === null ? 0 : Math.max(0, (nowMs - started) / 1000);
  const elapsed = elapsedLabel(elapsedSeconds);
  // Amber says "needs you" and nothing else, and only about data that is current: a wait the
  // Mac stopped reporting forty minutes ago is said in the dim ink, with when it was taken.
  const corner: TileModel['corner'] =
    kind === 'needsYou'
      ? { text: 'needs you', tone: stale ? 'dim' : 'accent', weight: 600 }
      : kind === 'finished'
        ? { text: 'finished', tone: 'dim', weight: 600 }
        : { text: elapsed, tone: 'dim', weight: 400 };

  const trajectory = trajectoryOf(wire);
  const verdict: TileVerdict | null = kind === 'working' && trajectory !== 'none' ? trajectory : null;
  const stateWord = kind === 'working' && verdict === null && s.live_state?.verdict.state === 'starting' ? 'starting' : null;

  const total = s.live_state?.map?.files_total;
  const files = kind === 'finished' || typeof total !== 'number' ? null : Math.max(0, Math.round(total));
  const landed = kind === 'finished' ? landedOf(s) : null;

  let eta: string | null;
  if (kind === 'finished') eta = null;
  else if (stale) {
    const anchor = anchorMsOf(s);
    eta = anchor === null ? null : `as of ${clockOrDay(anchor, nowMs)}`;
  } else if (kind === 'needsYou' || kind === 'stalled') {
    eta = sinceLabel(sinceEpochOf(anchored(s), wire, phase, nowMs), nowMs);
  } else {
    eta = etaLine(s.live_state?.eta, age, verdict);
  }

  const repo = s.repo_name ?? PRIVATE_REPO;
  const dim = kind === 'stalled' || stale;
  const label = [
    repo,
    harnessName(s.harness),
    kind === 'needsYou' || kind === 'finished' ? corner.text : `${elapsed} in`,
    sentence,
    verdict ?? stateWord,
    files === null ? null : `${files} ${files === 1 ? 'file' : 'files'} touched`,
    landed ? landedLines(landed) : null,
    landed ? landedCommits(landed) : null,
    eta,
  ]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join(', ');

  const model: Omit<TileModel, 'key'> = {
    id: s.id,
    kind,
    harness: s.harness,
    repo,
    corner,
    sentence,
    dim,
    verdict,
    stateWord,
    files,
    landed,
    eta,
    stale,
    elapsedMin: kind === 'finished' || started === null ? null : Math.floor(elapsedSeconds / 60),
    track: kind === 'working' && !stale ? trackOf(s.live_state?.eta, age, verdict) : null,
    unreviewed: kind === 'finished' && s.state !== 'final',
    label,
  };
  return { ...model, key: JSON.stringify(model) };
}

// ------------------------------------------------------------------ order

/**
 * Mission control's order: `live.mission_order` (the engine's needs you score, then who has
 * waited longest, then id) through its phone port, `surface.missionOrder`, which also ranks a
 * row with no engine state by the engine's own table (finished 30, quiet 35, running 5).
 *
 * The design's list (needs you, lost, circling, converging, just started) predates the engine's
 * review, which set the bases to waiting 80, circling 60, lost 55, error loop 50, idle 38,
 * finished 30, background 10, running 5, "the order the contract claims"; converging and a
 * fresh start both run fine at 5 and meet on who has been at it longest. One order for the grid
 * and the Lock Screen: a first tile that is not the Lock Screen's card is two answers.
 *
 * One addition the grid makes: a STALE row (nothing new for STALE_SECONDS) goes after every
 * current one, still in the engine's order among themselves. Its score is the engine's claim
 * about a moment the Mac stopped reporting on, and a wait from yesterday at the top of the grid
 * would outrank a session that needs you now on evidence nobody can vouch for.
 */
export function missionOrderIds(rows: readonly SessionDetail[], nowMs: number): string[] {
  const ordered = surfaceMissionOrder(rows, liveStatesOf(rows), nowMs);
  return [...ordered.filter((s) => !isStale(s, nowMs)), ...ordered.filter((s) => isStale(s, nowMs))].map((s) => s.id);
}

/** The order on screen, and when it last moved. */
export interface HeldOrder {
  ids: readonly string[];
  /** When the order was last placed or re-sorted; null before anything was placed. */
  sortedAtMs: number | null;
}

export const EMPTY_HOLD: HeldOrder = { ids: [], sortedAtMs: null };

export interface HoldResult {
  order: HeldOrder;
  /** Ask again in this many ms, when a re-sort was due to wait; null when nothing waits on a clock. */
  resortInMs: number | null;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * What the grid shows, given what it shows now and the order the engine wants.
 *
 *  - Nothing on screen: the target, placed at once. Placing counts as a sort.
 *  - A finger down (`blocked`): nothing moves and nothing leaves; a session that arrived is
 *    added after the last tile, where it moves nobody. The finger lifting asks again.
 *  - Otherwise, when the target is a different order and the last sort is at least
 *    RESORT_MIN_MS old: the target. When it is younger: tiles keep their places, gone ones
 *    leave (the rest close up; that is a removal, not a re-sort, and does not restart the
 *    clock), new ones are added at the end, and the caller asks again when the 15 s are up.
 *  - The same order as the target is never a sort: it moves nothing, so it restarts no clock.
 */
export function holdOrder(held: HeldOrder, target: readonly string[], nowMs: number, blocked: boolean): HoldResult {
  if (held.ids.length === 0) {
    return { order: { ids: [...target], sortedAtMs: target.length > 0 ? nowMs : held.sortedAtMs }, resortInMs: null };
  }
  const had = new Set(held.ids);
  const arrivals = target.filter((id) => !had.has(id));
  if (blocked) {
    return {
      order: arrivals.length ? { ids: [...held.ids, ...arrivals], sortedAtMs: held.sortedAtMs } : held,
      resortInMs: null,
    };
  }
  const wanted = new Set(target);
  const kept = [...held.ids.filter((id) => wanted.has(id)), ...arrivals];
  if (sameIds(kept, target)) {
    return { order: sameIds(kept, held.ids) ? held : { ids: kept, sortedAtMs: held.sortedAtMs }, resortInMs: null };
  }
  const wait = held.sortedAtMs === null ? 0 : held.sortedAtMs + RESORT_MIN_MS - nowMs;
  if (wait <= 0) return { order: { ids: [...target], sortedAtMs: nowMs }, resortInMs: null };
  return { order: sameIds(kept, held.ids) ? held : { ids: kept, sortedAtMs: held.sortedAtMs }, resortInMs: wait };
}

// ------------------------------------------------------------------ the crew

/**
 * Each session's creature, and the hash under it: the rule lives once, in `crew.ts` (the Lock
 * Screen, the island and the widget read it too, and `crew.ts` cannot be reached through this
 * module without an import cycle through `surface.ts`). Re-exported for the screens and tests
 * that have always asked mission control.
 */
export { crewCreatures, crewHashed, fnv1a32 } from './crew';

/** A finger counts as down only for HOLD_MAX_MS after it went down with no end reported. */
export function isHeld(downSinceMs: number | null, nowMs: number): boolean {
  return downSinceMs !== null && nowMs - downSinceMs < HOLD_MAX_MS;
}

/**
 * The first tile in the order on screen that needs you, on current data: the only creature on
 * the screen that moves. A stale wait does not get it; nobody can say it is still waiting.
 */
export function topNeedsYou(ids: readonly string[], models: ReadonlyMap<string, Pick<TileModel, 'kind' | 'stale'>>): string | null {
  for (const id of ids) {
    const m = models.get(id);
    if (m?.kind === 'needsYou' && !m.stale) return id;
  }
  return null;
}

// ------------------------------------------------------------------ finished tiles

/**
 * Remember the moment the phone saw a session leave the live list, which is when it finished
 * as far as anyone looking could tell: the server finalises a session only after its idle gap,
 * so `ended_at` is usually older than the finish the person saw happen. A session that comes
 * back live is forgotten; an entry older than the ten minutes is dropped.
 */
export function noteFinishes(
  seen: ReadonlyMap<string, number>,
  wasLive: Iterable<string>,
  liveNow: Iterable<string>,
  nowMs: number
): Map<string, number> {
  const now = new Set(liveNow);
  const next = new Map(seen);
  for (const id of wasLive) if (!now.has(id) && !next.has(id)) next.set(id, nowMs);
  for (const id of now) next.delete(id);
  for (const [id, at] of next) if (nowMs - at >= FINISHED_SHOW_MS) next.delete(id);
  return next;
}

/**
 * Which rows get a tile: every live row, except one whose turn the engine called done more than
 * ten minutes ago (its activity's `since_s`, aged: the engine only calls a turn done while its
 * activity is the wait that followed it, so that is when it finished); plus every FINAL row the phone saw finish in
 * the last ten minutes whose last record is inside FINISHED_HORIZON_SECONDS. A row is never
 * shown twice.
 */
export function visibleRows(
  live: readonly SessionDetail[],
  finals: readonly SessionDetail[],
  seen: ReadonlyMap<string, number>,
  nowMs: number
): SessionDetail[] {
  const out: SessionDetail[] = [];
  const ids = new Set<string>();
  for (const s of live) {
    const wire = toWire(s.live_state);
    if (tilePhase(s, wire, nowMs) === 'done' && s.state !== 'final') {
      const since = (s.live_state?.activity?.since_s ?? 0) + ageSecondsOf(s, nowMs);
      if (since * 1000 >= FINISHED_SHOW_MS) continue;
    }
    out.push(s);
    ids.add(s.id);
  }
  for (const s of finals) {
    if (ids.has(s.id) || s.state !== 'final') continue;
    const at = seen.get(s.id);
    if (at === undefined || nowMs - at >= FINISHED_SHOW_MS) continue;
    const ended = parseMs(s.ended_at);
    if (ended === null || (nowMs - ended) / 1000 > FINISHED_HORIZON_SECONDS) continue;
    out.push(s);
    ids.add(s.id);
  }
  return out;
}

// ------------------------------------------------------------------ the screen

export interface MissionCounts {
  running: number;
  needsYou: number;
  finished: number;
}

/** Needs you counts only a wait on current data, the same rule as the amber word and the moving creature. */
export function countsOf(models: readonly Pick<TileModel, 'kind' | 'stale'>[]): MissionCounts {
  let running = 0;
  let needsYou = 0;
  let finished = 0;
  for (const m of models) {
    if (m.kind === 'finished') finished += 1;
    else running += 1;
    if (m.kind === 'needsYou' && !m.stale) needsYou += 1;
  }
  return { running, needsYou, finished };
}

/**
 * The one row summary: "3 running · 1 needs you", "1 finished". Pieces with nothing in them are
 * left out rather than printed as a zero; null when there is nothing at all.
 */
export function summaryParts(c: MissionCounts): { text: string; accent: boolean }[] {
  const parts: { text: string; accent: boolean }[] = [];
  if (c.running > 0) parts.push({ text: `${c.running} running`, accent: false });
  if (c.needsYou > 0) parts.push({ text: `${c.needsYou} needs you`, accent: true });
  if (c.finished > 0) parts.push({ text: `${c.finished} finished`, accent: false });
  return parts;
}

export function summaryLine(c: MissionCounts): string | null {
  const parts = summaryParts(c);
  return parts.length ? parts.map((p) => p.text).join(' · ') : null;
}

/** The summary band's words: one big number, what it counts, and the lines under it. */
export interface SummaryHead {
  figure: number;
  /** What the figure counts: "needs you", "running", "finished". */
  word: string;
  /** Under it, one idea a line: "3 running", "Nothing needs you.", "1 finished", "1 not updating". */
  lines: string[];
  /** The band read aloud, figure first. */
  label: string;
}

/**
 * The summary band (DESIGN-DIRECTION 7.1's "3 running · 1 needs you", set as a chapter): the
 * loudest number is the one that asks for you, so a wait leads when there is one; otherwise how
 * many run, with "Nothing needs you." under it; otherwise how many finished. Rows the Mac stopped
 * reporting on are their own line, and while there are any the band does not claim that nothing
 * needs you: a wait nobody can see is not the absence of one. Null when there is nothing at all.
 */
export function summaryHead(models: readonly Pick<TileModel, 'kind' | 'stale'>[]): SummaryHead | null {
  const c = countsOf(models);
  const quiet = models.filter((m) => m.stale && m.kind !== 'finished').length;
  const finished = c.finished > 0 ? `${c.finished} finished` : null;
  const notUpdating = quiet > 0 ? `${quiet} not updating` : null;
  let head: Omit<SummaryHead, 'label'>;
  if (c.needsYou > 0) {
    head = { figure: c.needsYou, word: 'needs you', lines: [`${c.running} running`, finished, notUpdating].filter((x): x is string => x !== null) };
  } else if (c.running > 0) {
    const nothing = quiet > 0 ? null : 'Nothing needs you.';
    head = { figure: c.running, word: 'running', lines: [nothing, finished, notUpdating].filter((x): x is string => x !== null) };
  } else if (c.finished > 0) {
    head = { figure: c.finished, word: 'finished', lines: ['Nothing needs you.'] };
  } else {
    return null;
  }
  const label = [`${head.figure} ${head.word}`, ...head.lines.map((l) => l.replace(/\.$/, ''))].join(', ');
  return { ...head, label };
}

function capitalFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The screen's refusal, from the data: running rows that came with no engine state cannot say
 * when they need you (their tiles fall back to the presence line and never claim "needs you").
 * Null when every running row has a state.
 */
export function refusalLine(rows: readonly SessionDetail[]): string | null {
  const running = rows.filter((s) => s.state !== 'final');
  const without = running.filter((s) => !s.live_state).length;
  if (without === 0) return null;
  if (without === running.length) {
    return without === 1
      ? 'This session does not report what it is doing yet, so it cannot say when it needs you.'
      : 'These sessions do not report what they are doing yet, so they cannot say when they need you.';
  }
  const lead = capitalFirst(`${spoken(without)} of ${spoken(running.length)} sessions`);
  return without === 1
    ? `${lead} does not report what it is doing yet, so it cannot say when it needs you.`
    : `${lead} do not report what they are doing yet, so they cannot say when they need you.`;
}

export interface Stale {
  /** When the rows on screen were last fetched successfully; null when not in this visit. */
  savedAt: number | null;
  message: string;
}

export type MissionScreen =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; stale: Stale | null }
  | { kind: 'ready'; stale: Stale | null };

export interface MissionInputs {
  /** Null until asked. */
  signedIn: boolean | null;
  /** The rows that get tiles; null until the cache has been read. */
  rows: readonly SessionDetail[] | null;
  /** A sync has succeeded since this screen first loaded. */
  synced: boolean;
  /** The last sync's failure, null when it worked or has not finished. */
  error: string | null;
  savedAt: number | null;
}

/**
 * The five states, decided once. "Nothing needs you" is a claim about the sessions, so it is
 * made only after a sync has looked; before that the screen is a skeleton, and after a failed
 * one with nothing saved it says it could not check.
 */
export function missionScreen(i: MissionInputs): MissionScreen {
  if (i.signedIn === false) return { kind: 'signedOut' };
  const stale = i.error ? { savedAt: i.savedAt, message: i.error } : null;
  if (i.rows && i.rows.length > 0) return { kind: 'ready', stale };
  if (i.signedIn === null || i.rows === null) return { kind: 'loading' };
  if (i.synced) return { kind: 'empty', stale };
  if (i.error) return { kind: 'error', message: i.error };
  return { kind: 'loading' };
}

/** The finished session the empty state offers, as one row: the one whose last record is latest. */
export function lastFinished(finals: readonly SessionDetail[]): SessionDetail | null {
  let best: SessionDetail | null = null;
  let bestMs = -Infinity;
  for (const s of finals) {
    if (s.state === 'live') continue;
    const ended = parseMs(s.ended_at);
    if (ended !== null && ended > bestMs) {
      best = s;
      bestMs = ended;
    }
  }
  return best;
}

/** The meta line under the last finished session: "today at 21:37 · ran 47m". */
export function finishedMeta(s: SessionDetail, dayLabel: (iso: string) => string): string {
  const ended = parseMs(s.ended_at);
  const started = parseMs(s.started_at);
  const parts: string[] = [];
  if (ended !== null) {
    const day = dayLabel(s.ended_at);
    parts.push(day === 'today' || day === 'yesterday' ? `${day} at ${clockOf(ended)}` : day);
  }
  if (ended !== null && started !== null) parts.push(`ran ${elapsedLabel((ended - started) / 1000)}`);
  return parts.join(' · ');
}

/**
 * The empty state's one line about the session that finished last: "builder finished today at
 * 21:37 · ran 47m". A private repository says so in full.
 */
export function lastFinishedLine(s: SessionDetail, dayLabel: (iso: string) => string): string {
  const meta = finishedMeta(s, dayLabel);
  const repo = s.repo_name ?? PRIVATE_REPO;
  return meta ? `${repo} finished ${meta}` : `${repo} finished`;
}

// ------------------------------------------------------------------ the live bar

export interface BarModel {
  kind: TileKind;
  repo: string;
  harness: string;
  corner: TileModel['corner'];
  sentence: string;
  dim: boolean;
  stale: boolean;
  /** For `Ring`: elapsed over typical, 0 for an empty track, null for the dotted "no ETA yet". */
  progress: number | null;
  /** Inside the ring: minutes left while on track ("18m"), else null. */
  inner: string | null;
  /** What the ring means, in words, for VoiceOver. */
  ringLabel: string;
  label: string;
  /** The tile's counted figure and track (`TileModel`), so the bar and the tile agree to the minute. */
  elapsedMin: number | null;
  track: number | null;
  /** The tile's line under its numbers: the ETA or "since 9:37", when there is an honest one. */
  eta: string | null;
  verdict: TileVerdict | null;
  unreviewed: boolean;
}

/**
 * The session screen's 64pt bar, which mirrors the Lock Screen (DESIGN-DIRECTION 7.1, Flighty's
 * cross-surface rule): the same phase, sentence and ring as LiveDisplay.swift, drawn from the
 * same tile rules. The ring is elapsed over typical, aged while the session works; dotted with no
 * ETA; an empty track while it waits on you; full once past the typical run; after a finish, full
 * when something landed and empty when nothing did.
 */
export function barModel(s: SessionDetail, nowMs: number): BarModel {
  const t = tileModel(s, nowMs);
  const eta = s.live_state?.eta ?? null;
  const typical = eta?.typical_s;
  const elapsedS = eta?.elapsed_s;
  const working = t.kind === 'working' && !t.stale;
  let progress: number | null = null;
  let inner: string | null = null;
  let ringLabel = 'no ETA yet';
  if (t.kind === 'needsYou') {
    progress = 0;
    ringLabel = 'waiting on you';
  } else if (t.kind === 'finished') {
    const l = t.landed;
    progress = l && (l.added !== null || l.removed !== null || l.commits !== null) ? 1 : 0;
    ringLabel = 'finished';
  } else if (typeof typical === 'number' && typical > 0 && typeof elapsedS === 'number') {
    const age = working ? ageSecondsOf(s, nowMs) : 0;
    const ratio = (elapsedS + age) / typical;
    progress = Math.min(1, Math.max(0, ratio));
    const line = etaLine(eta, age, t.verdict);
    if (ratio >= 1) ringLabel = 'running longer than usual';
    else if (line && line.startsWith('about ')) {
      ringLabel = line;
      const left = (eta?.remaining_s ?? 0) - age;
      const m = Math.max(1, Math.round(left / 60));
      inner = working && m < 100 && t.verdict !== 'circling' && t.verdict !== 'lost' ? `${m}m` : null;
    } else ringLabel = t.verdict ?? 'no ETA yet';
  }
  const label = [t.repo, t.kind === 'needsYou' || t.kind === 'finished' ? t.corner.text : `${t.corner.text} in`, t.sentence, ringLabel]
    .filter(Boolean)
    .join(', ');
  return {
    kind: t.kind,
    repo: t.repo,
    harness: t.harness,
    corner: t.stale && t.kind !== 'finished' ? { text: t.eta ?? t.corner.text, tone: 'dim', weight: 400 } : t.corner,
    sentence: t.sentence,
    dim: t.dim,
    stale: t.stale,
    progress,
    inner,
    ringLabel,
    label,
    elapsedMin: t.elapsedMin,
    track: t.track,
    eta: t.eta,
    verdict: t.verdict,
    unreviewed: t.unreviewed,
  };
}

// ------------------------------------------------------------------ the sample

/**
 * DEV ONLY sample sessions for `builder://live?sample=...`, so every tile state can be shot on
 * the simulator without eight agents running. Shaped as the server sends them (a generated
 * `LiveState` per row, the slim body) with numbers of the size this repository and RideGT
 * produce (engine doc 3.5: RideGT's median run is 20.9 active minutes; builder has five
 * finished sessions, so it is refused an ETA). Every sentence comes out of the engine's
 * renderer; nothing here is prose. The screen labels it a sample.
 */
export const SAMPLE_KINDS = ['grid', 'all', 'empty', 'loading', 'error', 'stale', 'refused', 'signedout', 'review'] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

export function parseSample(raw: string | string[] | undefined): SampleKind | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (!v) return null;
  if (v === '1' || v === 'true' || v === 'yes') return 'grid';
  return (SAMPLE_KINDS as readonly string[]).includes(v) ? (v as SampleKind) : null;
}

const EVIDENCE_ZERO = {
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

function sampleState(nowMs: number, over: Partial<LiveState> & { activity?: LiveActivity | null }, files: number, eta: LiveEta): LiveState {
  return {
    live_version: 1,
    computed_at: new Date(nowMs - 20_000).toISOString(),
    activity: null,
    verdict: { state: null, basis: null, reason: 'no_rule_fired', file_id: null, evidence: EVIDENCE_ZERO },
    eta,
    decisions: [],
    needs_you: { score: 5, reason: 'running_fine' },
    map: { files: [], files_total: files },
    timelapse: null,
    sample: { events: 400, tool_calls: 120, segments: 6, tokens: null },
    ...over,
  };
}

const BUILDER_REFUSED: LiveEta = {
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

function rideGtEta(elapsedMin: number): LiveEta {
  const typical = Math.round(20.9 * 60);
  const elapsed = elapsedMin * 60;
  return {
    elapsed_s: elapsed,
    typical_s: typical,
    p25_s: 9 * 60,
    p75_s: Math.round(44.1 * 60),
    remaining_s: Math.max(0, typical - elapsed),
    n: 61,
    needed: 10,
    unattended: false,
    basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
    reason: null,
  };
}

function sampleRow(id: string, repo: string | null, harness: string, startedMinAgo: number, nowMs: number, extra: Partial<SessionDetail>): SessionDetail {
  const started = nowMs - startedMinAgo * 60_000;
  return {
    id,
    client_session_id: `${id}-client`,
    harness,
    repo_name: repo,
    started_at: new Date(started).toISOString(),
    ended_at: new Date(nowMs - 20_000).toISOString(),
    updated_at: new Date(nowMs - 20_000).toISOString(),
    active_seconds: startedMinAgo * 60,
    idle_seconds: 0,
    local_date: new Date(nowMs).toISOString().slice(0, 10),
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'live',
    attended_seconds: startedMinAgo * 60,
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
      files_touched: 0,
      lines_added_agent: 0,
      lines_removed_agent: 0,
      commit_count: 0,
      agent_line_bucket: 'some',
      attrib_confidence: 'high',
    },
    ...extra,
  };
}

export interface MissionSample {
  live: SessionDetail[];
  finals: SessionDetail[];
  seen: Map<string, number>;
  inputs: Omit<MissionInputs, 'rows'>;
}

/** The sample for one `?sample=` kind. `grid` is six tiles, one of each kind a person meets most. */
export function missionSample(kind: SampleKind, nowMs: number): MissionSample {
  const ok = { signedIn: true, synced: true, error: null, savedAt: nowMs - 20_000 };
  const offline = 'Builda is not reachable right now.';
  if (kind === 'signedout') return { live: [], finals: [], seen: new Map(), inputs: { ...ok, signedIn: false } };
  if (kind === 'loading') return { live: [], finals: [], seen: new Map(), inputs: { ...ok, synced: false } };
  if (kind === 'error') return { live: [], finals: [], seen: new Map(), inputs: { ...ok, synced: false, error: offline } };

  const finished = sampleRow('sample-finished', 'builder', 'claude_code', 52, nowMs, {
    state: 'final',
    end_reason: 'idle_gap',
    ended_at: new Date(nowMs - 16 * 60_000).toISOString(),
    stats: {
      ...sampleRow('x', null, 'x', 0, nowMs, {}).stats!,
      files_touched: 12,
      lines_added_agent: 420,
      lines_removed_agent: 88,
      commit_count: 3,
    },
  });
  const seen = new Map([[finished.id, nowMs - 2 * 60_000]]);
  if (kind === 'empty') {
    // Finished three hours ago after a 47 minute run: its start moves back with its end.
    const endedMs = nowMs - 3 * 3600_000;
    const earlier = { ...finished, id: 'sample-yesterday', ended_at: new Date(endedMs).toISOString(), started_at: new Date(endedMs - 47 * 60_000).toISOString() };
    return { live: [], finals: [earlier], seen: new Map(), inputs: ok };
  }

  const needs = sampleRow('sample-needs-you', 'builder', 'claude_code', 47, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'waiting_on_you', role: 'unknown', attempt: 0, since_s: 4 * 60, files: 0, calls: 0, file_id: null },
        verdict: { state: 'waiting', basis: 'turn_ended', reason: null, file_id: null, evidence: { ...EVIDENCE_ZERO, checkpoints: 2, files_changed: 5 } },
        needs_you: { score: 84, reason: 'waiting_for_input' },
      },
      23,
      BUILDER_REFUSED
    ),
  });
  const circling = sampleRow('sample-circling', 'RideGT', 'codex', 28, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'testing', role: 'test', attempt: 0, since_s: 20, files: 0, calls: 1, file_id: null },
        verdict: {
          state: 'circling',
          basis: 'consecutive_failures',
          reason: null,
          file_id: null,
          evidence: { ...EVIDENCE_ZERO, errors_now: 6, errors_before: 2, fail_run: 5, stuck_s: 6 * 60 + 12 },
        },
        needs_you: { score: 66, reason: 'circling' },
      },
      11,
      rideGtEta(28)
    ),
  });
  const lost = sampleRow('sample-lost', null, 'cursor_agent', 19, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'editing', role: 'source', attempt: 0, since_s: 70, files: 4, calls: 6, file_id: null },
        verdict: { state: 'lost', basis: 'edits_to_unread_files', reason: null, file_id: null, evidence: { ...EVIDENCE_ZERO, blind_edits: 4 } },
        needs_you: { score: 60, reason: 'lost' },
      },
      17,
      BUILDER_REFUSED
    ),
  });
  const converging = sampleRow('sample-converging', 'RideGT', 'claude_code', 12, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'editing', role: 'source', attempt: 3, since_s: 95, files: 1, calls: 3, file_id: 'a1f09c3e5b7d2e10' },
        verdict: {
          state: 'converging',
          basis: 'error_rate_down_and_new_files',
          reason: null,
          file_id: null,
          evidence: { ...EVIDENCE_ZERO, errors_now: 1, errors_before: 3, new_files: 2, checkpoints: 1 },
        },
      },
      9,
      rideGtEta(12)
    ),
  });
  const starting = sampleRow('sample-starting', 'builder', 'gemini_cli', 3, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'reading', role: 'docs', attempt: 0, since_s: 50, files: 3, calls: 5, file_id: null },
        verdict: { state: 'starting', basis: 'segment_tool_calls', reason: null, file_id: null, evidence: { ...EVIDENCE_ZERO, window_calls: 3 } },
      },
      4,
      BUILDER_REFUSED
    ),
  });
  const stalled = sampleRow('sample-stalled', 'builder', 'opencode', 64, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'idle', role: 'unknown', attempt: 0, since_s: 6 * 60, files: 0, calls: 0, file_id: null },
        needs_you: { score: 41, reason: 'idle' },
      },
      6,
      BUILDER_REFUSED
    ),
  });
  const background = sampleRow('sample-background', 'RideGT', 'claude_code', 33, nowMs, {
    live_state: sampleState(
      nowMs,
      {
        activity: { kind: 'waiting_on_you', role: 'unknown', attempt: 0, since_s: 90, files: 0, calls: 0, file_id: null },
        verdict: {
          state: 'waiting',
          basis: 'turn_ended_background_out',
          reason: null,
          file_id: null,
          evidence: { ...EVIDENCE_ZERO, background: 2, checkpoints: 1 },
        },
        needs_you: { score: 10, reason: 'waiting_on_background' },
      },
      14,
      rideGtEta(33)
    ),
  });

  if (kind === 'review') {
    // A turn the engine called done while the row is still live: the tile says finished, not
    // looked at yet, and the summary counts it as finished, never running (`tilePhase`).
    const done = sampleRow('sample-review', 'RideGT', 'claude_code', 26, nowMs, {
      live_state: sampleState(
        nowMs,
        {
          activity: { kind: 'waiting_on_you', role: 'unknown', attempt: 0, since_s: 3 * 60, files: 0, calls: 0, file_id: null },
          verdict: { state: 'done', basis: 'turn_ended', reason: null, file_id: null, evidence: { ...EVIDENCE_ZERO, checkpoints: 2, files_changed: 2, commits: 1 } },
          needs_you: { score: 31, reason: 'finished_unreviewed' },
        },
        2,
        rideGtEta(26)
      ),
      stats: { ...sampleRow('x', null, 'x', 0, nowMs, {}).stats!, lines_added_agent: 64, lines_removed_agent: 12, commit_count: 1 },
    });
    return { live: [done, converging, starting], finals: [], seen: new Map(), inputs: ok };
  }
  if (kind === 'refused') {
    const bare = (s: SessionDetail): SessionDetail => ({ ...s, live_state: null });
    return { live: [needs, bare(converging), bare(starting)], finals: [], seen: new Map(), inputs: ok };
  }
  if (kind === 'stale') {
    const old = (s: SessionDetail): SessionDetail => {
      const at = new Date(nowMs - 40 * 60_000).toISOString();
      return { ...s, updated_at: at, live_state: s.live_state ? { ...s.live_state, computed_at: at } : s.live_state };
    };
    return { live: [needs, old(converging), starting], finals: [], seen: new Map(), inputs: { ...ok, error: offline, savedAt: nowMs - 40 * 60_000 } };
  }
  const live = kind === 'all' ? [needs, circling, lost, converging, starting, stalled, background] : [needs, circling, lost, converging, starting];
  return { live, finals: [finished], seen, inputs: ok };
}
