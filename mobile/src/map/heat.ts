/**
 * How hot each cell is: the roadmap's "files glow as the agent reads them, go hot as it edits
 * them, fade as it moves on" (docs/approved-roadmap.md 2.7), as one rule both screens draw.
 *
 * A cell's LEVEL indexes the amber ramp `design/tokens.json graph.levels` (six steps, the
 * contribution graph's own, tuned on the dark canvas):
 *
 *   0  never touched yet            the island's outline only (the time lapse before it)
 *   1  only read, and moved on      dim warm
 *   2  only read, among the last WARM_FILES files it touched
 *   3  changed, and moved on        amber, cooled
 *   4  changed, among the last WARM_FILES files
 *   5  changed, and it is the file it is on now
 *
 * "Moves on" is counted in FILES, not minutes: a file cools as the agent touches other files
 * after it, and a pause with nothing touched cools nothing, because the agent has not moved
 * on. So "waiting on you" leaves the last files hot, where the work stopped. A step down the
 * ramp rather than a blend: amber diluted toward the canvas is the muddy brown CLAUDE.md
 * measured on the strip, and the ramp's steps are colours the palette already has.
 *
 * Pure: no React Native. The replay readers are worklets (the time lapse runs them on the UI
 * thread every frame) and plain functions to `bun test`.
 */

import type { FrameKind, LiveFile, LiveFrame } from '../generated/live';

/**
 * The working set: the files touched most recently stay warm. Three because the roadmap's
 * picture of an agent circling is "a tight knot of three files pulsing" (2.7), so a knot of
 * three stays lit while it circles and everything else cools. UNMEASURED JUDGEMENT CALL.
 */
export const WARM_FILES = 3;

export const LEVEL_SLOT = 0;
export const LEVEL_READ = 1;
export const LEVEL_READ_WARM = 2;
export const LEVEL_EDIT = 3;
export const LEVEL_EDIT_WARM = 4;
export const LEVEL_HOT = 5;

/** A cell's level from what has happened to it and how many files the agent touched since. */
export function levelOf(touched: boolean, edited: boolean, rank: number): number {
  'worklet';
  if (!touched) return LEVEL_SLOT;
  if (edited) return rank === 0 ? LEVEL_HOT : rank < WARM_FILES ? LEVEL_EDIT_WARM : LEVEL_EDIT;
  return rank < WARM_FILES ? LEVEL_READ_WARM : LEVEL_READ;
}

// ------------------------------------------------------------------ the live map

/** When a row was last read or changed; null when it was only named (a failing call). */
export function touchedAt(f: LiveFile): number | null {
  const ts = [f.last_read_ts, f.last_edit_ts].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return ts.length ? Math.max(...ts) : null;
}

/**
 * Each file's recency rank: 0 for the one touched last, then back in time, ties by id.
 * A file never read or changed (a failing call named it) is ranked after every other.
 */
export function recencyRanks(files: readonly LiveFile[]): Map<string, number> {
  const order = files
    .map((f) => ({ id: f.id, at: touchedAt(f) }))
    .sort((a, b) => {
      if (a.at !== b.at) {
        if (a.at === null) return 1;
        if (b.at === null) return -1;
        return b.at - a.at;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const out = new Map<string, number>();
  order.forEach((o, i) => out.set(o.id, o.at === null ? Number.POSITIVE_INFINITY : i));
  return out;
}

/**
 * The live map's levels, in `order` (the layout's cell ids). Every row on the map was touched
 * (it is there because a call named it); "changed" is `edits > 0`, counted by the engine over
 * every event rather than over the thinned frames.
 */
export function mapLevels(files: readonly LiveFile[], order: readonly string[]): number[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const ranks = recencyRanks(files);
  return order.map((id) => {
    const f = byId.get(id);
    if (!f) return LEVEL_SLOT;
    return levelOf(true, f.edits > 0, ranks.get(id) ?? Number.POSITIVE_INFINITY);
  });
}

/**
 * Where the agent is on the live map: the file its last call named (`activity.file_id`), else
 * the file touched last. Null when neither is on the map.
 */
export function cursorOf(files: readonly LiveFile[], activityFile: string | null | undefined): string | null {
  if (activityFile && files.some((f) => f.id === activityFile)) return activityFile;
  const ranks = recencyRanks(files);
  let best: string | null = null;
  for (const [id, r] of ranks) if (r === 0) best = id;
  return best;
}

// ------------------------------------------------------------------ the replay

export const KIND_READ = 0;
export const KIND_EDIT = 1;
export const KIND_FAIL = 2;
const KIND_CODE: Readonly<Record<FrameKind, number>> = { read: KIND_READ, edit: KIND_EDIT, fail: KIND_FAIL };

/**
 * Everything the time lapse needs per frame, precomputed once so the UI thread only looks
 * things up. Plain number arrays (a worklet copies them once when it is made).
 */
export interface Replay {
  /** Cells on the map. */
  cells: number;
  /** Frame times, seconds from the first event, ascending. */
  t: number[];
  /** The cell each frame lights, or -1 when its file is not on the map (the map keeps 400). */
  cell: number[];
  kind: number[];
  /** Per cell: the first frame that touched it, and the first that changed it; `t.length` for never. */
  firstTouch: number[];
  firstEdit: number[];
  /**
   * After each frame, the last WARM_FILES distinct files touched, newest first, as slots
   * (`cell` for a file on the map, `cells + j` for one that is not), -1 padded; and the kind
   * of each one's last touch.
   */
  mru: number[];
  mruKind: number[];
}

export function buildReplay(frames: readonly LiveFrame[], index: Readonly<Record<string, number>>, cells: number): Replay {
  const n = frames.length;
  const t: number[] = [];
  const cell: number[] = [];
  const kind: number[] = [];
  const firstTouch = new Array<number>(cells).fill(n);
  const firstEdit = new Array<number>(cells).fill(n);
  const mru: number[] = [];
  const mruKind: number[] = [];
  const offMap = new Map<string, number>();
  let recent: { slot: number; kind: number }[] = [];

  frames.forEach((f, k) => {
    const c = index[f.file_id];
    const onMap = typeof c === 'number' && c >= 0 && c < cells;
    let slot: number;
    if (onMap) {
      slot = c;
    } else {
      if (!offMap.has(f.file_id)) offMap.set(f.file_id, cells + offMap.size);
      slot = offMap.get(f.file_id)!;
    }
    const code = KIND_CODE[f.kind];
    t.push(f.t);
    cell.push(onMap ? c : -1);
    kind.push(code);
    if (onMap) {
      if (firstTouch[c]! === n) firstTouch[c] = k;
      if (code === KIND_EDIT && firstEdit[c]! === n) firstEdit[c] = k;
    }
    recent = [{ slot, kind: code }, ...recent.filter((r) => r.slot !== slot)].slice(0, WARM_FILES);
    for (let j = 0; j < WARM_FILES; j++) {
      mru.push(recent[j]?.slot ?? -1);
      mruKind.push(recent[j]?.kind ?? -1);
    }
  });

  return { cells, t, cell, kind, firstTouch, firstEdit, mru, mruKind };
}

/** The last frame at or before `sec`; -1 before the first. Binary search. */
export function frameAt(t: readonly number[], sec: number): number {
  'worklet';
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= sec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** How many files the agent touched after cell `i` as of frame `k`: 0 to WARM_FILES - 1, or WARM_FILES. */
export function rankAt(mru: readonly number[], k: number, i: number): number {
  'worklet';
  if (k < 0) return WARM_FILES;
  const base = k * WARM_FILES;
  for (let j = 0; j < WARM_FILES; j++) if (mru[base + j] === i) return j;
  return WARM_FILES;
}

/** Cell `i`'s level as of frame `k` (-1: before the first frame). */
export function replayLevel(r: Replay, k: number, i: number): number {
  'worklet';
  if (k < 0) return LEVEL_SLOT;
  const touched = r.firstTouch[i]! <= k;
  const edited = r.firstEdit[i]! <= k;
  return levelOf(touched, edited, rankAt(r.mru, k, i));
}

/** Whether cell `i` is warm as of frame `k` and the last call on it failed. */
export function replayFailing(r: Replay, k: number, i: number): boolean {
  'worklet';
  if (k < 0) return false;
  const base = k * WARM_FILES;
  for (let j = 0; j < WARM_FILES; j++) if (r.mru[base + j] === i) return r.mruKind[base + j] === KIND_FAIL;
  return false;
}

/** The cell the agent is on as of frame `k`, or -1 (before the first frame, or off the map). */
export function replayCursor(r: Replay, k: number): number {
  'worklet';
  if (k < 0) return -1;
  const slot = r.mru[k * WARM_FILES]!;
  return slot >= 0 && slot < r.cells ? slot : -1;
}

/** Every level at frame `k`, for tests and for the still frame a paused replay shows. */
export function replayLevels(r: Replay, k: number): number[] {
  return Array.from({ length: r.cells }, (_, i) => replayLevel(r, k, i));
}
