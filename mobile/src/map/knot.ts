/**
 * The knot where it got stuck, and the burst at the end (docs/approved-roadmap.md 2.7 and
 * 2.8: "Circling looks like a tight knot of three files pulsing"; "the knot where it got
 * stuck, the burst at the end").
 *
 * The LIVE knot is the engine's: only when the verdict says `circling`, the churned file it
 * names plus the files it kept changing since the circling began (`evidence.stuck_s`).
 *
 * The TIME LAPSE knot reads the frames by the engine's own circling rule, the one
 * `live._verdict` fires as `causes:file_churn_with_failures`: one file written at least
 * `burn.FILE_CHURN_MIN_WRITES` times, with at least two failing calls beside it. The engine
 * reads that over its last tool calls; the frames carry only calls that named a file, so here
 * it is read over a stretch that touched at most KNOT_MAX_FILES files. A failing command that
 * named no file (a test run) leaves no frame, so a knot of that kind cannot be seen here, and
 * none is claimed: finding no knot says nothing about whether the session circled.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import type { LiveFrame, LiveState } from '../generated/live';
import { spanOf } from './frames';

/**
 * At most this many files in a knot: the roadmap's "three files". Beyond it a stretch is the
 * agent working across the code, not going round in it. UNMEASURED JUDGEMENT CALL.
 */
export const KNOT_MAX_FILES = 3;

/** `burn.FILE_CHURN_MIN_WRITES`: the file_churn cause's bar. Pinned to Python by a test. */
export const KNOT_MIN_WRITES = 4;

/** `live._verdict` rule 3b: `ev["errors_now"] >= 2` beside the churn. Pinned to its source by a test. */
export const KNOT_MIN_FAILS = 2;

export interface Knot {
  /** Seconds from the first event: the stretch's first and last frame. */
  startT: number;
  endT: number;
  /** The files it went round, most changed first, then by id. */
  files: string[];
  /** Changes and failing calls on them inside the stretch. */
  edits: number;
  fails: number;
  /** The most changed file, and how often it changed. */
  top: string;
  topEdits: number;
}

/**
 * The longest stretch of frames that touched at most KNOT_MAX_FILES files and holds one file
 * changed KNOT_MIN_WRITES times with KNOT_MIN_FAILS failing calls; ties to the one with more
 * frames, then the earlier. Null when no stretch clears the bar.
 */
export function findKnot(frames: readonly LiveFrame[]): Knot | null {
  const n = frames.length;
  let best: { i: number; j: number } | null = null;
  // Two pointers: for each start, the furthest end that keeps the file count in bounds.
  const count = new Map<string, number>();
  let j = -1;
  for (let i = 0; i < n; i++) {
    while (j + 1 < n) {
      const next = frames[j + 1]!.file_id;
      if (!count.has(next) && count.size >= KNOT_MAX_FILES) break;
      count.set(next, (count.get(next) ?? 0) + 1);
      j += 1;
    }
    // The stretch [i, j] is maximal for this start. Score it only when it is maximal on
    // the left too (the frame before it could not have joined), so each stretch is read once.
    const leftMaximal = i === 0 || (!count.has(frames[i - 1]!.file_id) && count.size >= KNOT_MAX_FILES);
    if (leftMaximal && j >= i && qualifies(frames, i, j)) {
      // Compared as trimmed: reads at either end are not the knot and do not lengthen it.
      const cut = trim(frames, i, j);
      const dur = frames[cut.j]!.t - frames[cut.i]!.t;
      if (!best) best = cut;
      else {
        const bestDur = frames[best.j]!.t - frames[best.i]!.t;
        if (dur > bestDur || (dur === bestDur && cut.j - cut.i > best.j - best.i)) best = cut;
      }
    }
    // Drop frame i before the next start.
    const id = frames[i]!.file_id;
    const left = (count.get(id) ?? 0) - 1;
    if (left <= 0) count.delete(id);
    else count.set(id, left);
  }
  if (!best) return null;
  return describe(frames, best);
}

function tallies(frames: readonly LiveFrame[], i: number, j: number) {
  const edits = new Map<string, number>();
  let fails = 0;
  for (let k = i; k <= j; k++) {
    const f = frames[k]!;
    if (f.kind === 'edit') edits.set(f.file_id, (edits.get(f.file_id) ?? 0) + 1);
    else if (f.kind === 'fail') fails += 1;
  }
  return { edits, fails };
}

function qualifies(frames: readonly LiveFrame[], i: number, j: number): boolean {
  const { edits, fails } = tallies(frames, i, j);
  let most = 0;
  for (const v of edits.values()) most = Math.max(most, v);
  return most >= KNOT_MIN_WRITES && fails >= KNOT_MIN_FAILS;
}

/** The stretch from its first change or failure to its last: reads at either end are not the knot. */
function trim(frames: readonly LiveFrame[], i: number, j: number): { i: number; j: number } {
  let a = i;
  let b = j;
  while (a < b && frames[a]!.kind === 'read') a++;
  while (b > a && frames[b]!.kind === 'read') b--;
  return { i: a, j: b };
}

function describe(frames: readonly LiveFrame[], { i, j }: { i: number; j: number }): Knot {
  const { edits, fails } = tallies(frames, i, j);
  const files = new Set<string>();
  for (let k = i; k <= j; k++) files.add(frames[k]!.file_id);
  const ordered = [...files].sort((a, b) => (edits.get(b) ?? 0) - (edits.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  let total = 0;
  for (const v of edits.values()) total += v;
  const top = ordered[0]!;
  return { startT: frames[i]!.t, endT: frames[j]!.t, files: ordered, edits: total, fails, top, topEdits: edits.get(top) ?? 0 };
}

// ------------------------------------------------------------------ the live knot

/**
 * The files the live map pulses: empty unless the engine's verdict is `circling`. Its churned
 * file (`verdict.file_id`) when it names one on the map, then the files changed at least
 * twice since the circling began, most changed first, to KNOT_MAX_FILES. A circle round a
 * command (a repeated call, a failing test run) names no file, and then nothing pulses: the
 * sentence above the map says what it is doing.
 */
export function liveKnot(state: LiveState | null | undefined): string[] {
  const v = state?.verdict;
  if (!state || v?.state !== 'circling') return [];
  const files = state.map?.files ?? [];
  const out: string[] = [];
  if (v.file_id && files.some((f) => f.id === v.file_id)) out.push(v.file_id);
  const computed = Date.parse(state.computed_at) / 1000;
  const stuck = v.evidence?.stuck_s ?? 0;
  if (!Number.isFinite(computed) || !(stuck > 0)) return out;
  const since = computed - stuck;
  const churned = files
    .filter((f) => !out.includes(f.id) && f.edits >= 2 && typeof f.last_edit_ts === 'number' && f.last_edit_ts >= since)
    .sort((a, b) => b.edits - a.edits || (b.last_edit_ts ?? 0) - (a.last_edit_ts ?? 0) || (a.id < b.id ? -1 : 1));
  for (const f of churned) {
    if (out.length >= KNOT_MAX_FILES) break;
    out.push(f.id);
  }
  return out;
}

// ------------------------------------------------------------------ the burst

/**
 * The end of the session, as a share of its span: the replay's last second and a half of
 * fifteen. UNMEASURED JUDGEMENT CALL.
 */
export const BURST_TAIL = 0.1;

/** A burst changes files, plural: one file changed over and over is focus. UNMEASURED JUDGEMENT CALL. */
export const BURST_MIN_FILES = 2;

export interface Burst {
  startT: number;
  endT: number;
  /** The files changed in it, in the order they were first changed. */
  files: string[];
  edits: number;
}

/**
 * The changes in the last BURST_TAIL of the session, after the knot when the knot reaches into
 * it, when they touched at least BURST_MIN_FILES files. Null otherwise: a session that ended
 * reading, or still in its knot, had no burst at the end.
 */
export function findBurst(frames: readonly LiveFrame[], knot: Knot | null): Burst | null {
  const span = spanOf(frames);
  if (!(span > 0)) return null;
  const from = Math.max(span * (1 - BURST_TAIL), knot ? knot.endT + 1 : 0);
  const files: string[] = [];
  let edits = 0;
  let startT = -1;
  let endT = -1;
  for (const f of frames) {
    if (f.t < from || f.kind !== 'edit') continue;
    if (startT < 0) startT = f.t;
    endT = f.t;
    edits += 1;
    if (!files.includes(f.file_id)) files.push(f.file_id);
  }
  if (files.length < BURST_MIN_FILES) return null;
  return { startT, endT, files, edits };
}
