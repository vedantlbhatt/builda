/**
 * The time lapse's frames: `live_state.timelapse`, one `{t, file_id, kind}` per read, change
 * or failure that named a file, `t` in whole seconds from the session's first event
 * (spec/live.v1.json `LiveFrame`, docs/overnight-engine.md 3.8).
 *
 * Three things happen to them on the phone, each a rule the engine already has:
 *
 *   cleanFrames  the door: a frame that is not the spec's shape is dropped, never guessed at
 *   thinFrames   the engine's thinning, `live._timelapse`, line for line: equal time bins,
 *                per bin the frame that matters most (a change, then a failure, then a
 *                read), ties to the later one, empty bins emit nothing. The server never sends
 *                more than MAX_FRAMES; this is what the phone uses when it has to draw fewer
 *                (the scrubber's bars), so the phone and the engine agree on what "the moment
 *                that matters most" means. Pinned to Python by `__tests__/mapFrames.test.ts`.
 *   spikeBins    a stretch with SPIKE_MULTIPLE times the median activity, burn's own bar for
 *                a costly segment, applied to frames per bar of the scrubber
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import type { FrameKind, LiveFrame } from '../generated/live';

/** `live.MAX_FRAMES`: the most frames a live state carries. Pinned to Python by a test. */
export const MAX_FRAMES = 600;

/** `live._FRAME_PRIORITY`: which frame a thinned bin keeps. Pinned to Python by a test. */
export const FRAME_PRIORITY: Readonly<Record<FrameKind, number>> = { edit: 3, fail: 2, read: 1 };

const KINDS: readonly FrameKind[] = ['read', 'edit', 'fail'];
const HEX16 = /^[0-9a-f]{16}$/;

/**
 * The frames a person can be shown: each one the spec's shape (a whole second at or after
 * the first event, a 16 hex file id, a known kind), in time order, ties kept in the order
 * they came. A frame that is not that shape is dropped rather than repaired. The engine's
 * own local form, `[t, file_id, kind]`, is read too. Null when there is no list at all,
 * which is not the same as an empty one (the slim live body sends null).
 */
export function cleanFrames(raw: unknown): LiveFrame[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { f: LiveFrame; i: number }[] = [];
  raw.forEach((r, i) => {
    let t: unknown;
    let id: unknown;
    let kind: unknown;
    if (Array.isArray(r)) [t, id, kind] = r;
    else if (r && typeof r === 'object') ({ t, file_id: id, kind } = r as Record<string, unknown>);
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return;
    if (typeof id !== 'string' || !HEX16.test(id)) return;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return;
    out.push({ f: { t: Math.floor(t), file_id: id, kind: kind as FrameKind }, i });
  });
  out.sort((a, b) => a.f.t - b.f.t || a.i - b.i);
  return out.map((x) => x.f);
}

/** The seconds the frames cover, from the first event to the last frame. 0 with none. */
export function spanOf(frames: readonly LiveFrame[]): number {
  let hi = 0;
  for (const f of frames) if (f.t > hi) hi = f.t;
  return hi;
}

/**
 * `live._timelapse`'s thinning, over frames already on the wire: above `max` frames, cut
 * [first t, last t] into `max` equal bins and keep, per bin, the frame with the highest
 * (priority, t, position), which is Python's `>=` tuple rule (a later frame wins a tie);
 * empty bins emit nothing; bins come out in order. At or under `max`, the frames as given.
 */
export function thinFrames(frames: readonly LiveFrame[], max: number = MAX_FRAMES): LiveFrame[] {
  if (frames.length <= max) return frames.slice();
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const f of frames) {
    lo = Math.min(lo, f.t);
    hi = Math.max(hi, f.t);
  }
  const span = hi - lo;
  const bins = new Map<number, { f: LiveFrame; i: number }>();
  frames.forEach((f, i) => {
    const b = span > 0 ? Math.min(max - 1, Math.floor(((f.t - lo) / span) * max)) : 0;
    const cur = bins.get(b);
    if (!cur) {
      bins.set(b, { f, i });
      return;
    }
    const p = FRAME_PRIORITY[f.kind];
    const cp = FRAME_PRIORITY[cur.f.kind];
    const wins = p !== cp ? p > cp : f.t !== cur.f.t ? f.t > cur.f.t : i >= cur.i;
    if (wins) bins.set(b, { f, i });
  });
  return [...bins.keys()].sort((a, b) => a - b).map((b) => bins.get(b)!.f);
}

// ------------------------------------------------------------------ the scrubber's bars

/**
 * Bars across the scrubber: a fixed count, so a spike is the same spike on every phone
 * whatever its width. 60 is four bars to each second of the fifteen second replay.
 * UNMEASURED JUDGEMENT CALL.
 */
export const TRACK_BINS = 60;

export interface TrackBin {
  /** How many frames fell in this bar. */
  count: number;
  /** The kind that matters most among them (`FRAME_PRIORITY`), null for an empty bar. */
  kind: FrameKind | null;
  /** The bar's frames by kind, which the scrubber stacks: changes, then failures, then reads. */
  edits: number;
  fails: number;
  reads: number;
}

/** Which bar a moment `t` seconds in falls in, over a span of `span` seconds. */
export function binOf(t: number, span: number, bins: number = TRACK_BINS): number {
  'worklet';
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(bins - 1, Math.floor((t / span) * bins)));
}

/** The frames counted into `bins` equal bars over [0, span]. */
export function trackBins(frames: readonly LiveFrame[], span: number, bins: number = TRACK_BINS): TrackBin[] {
  const out: TrackBin[] = Array.from({ length: bins }, () => ({ count: 0, kind: null, edits: 0, fails: 0, reads: 0 }));
  for (const f of frames) {
    const bar = out[binOf(f.t, span, bins)]!;
    bar.count += 1;
    if (f.kind === 'edit') bar.edits += 1;
    else if (f.kind === 'fail') bar.fails += 1;
    else bar.reads += 1;
    if (bar.kind === null || FRAME_PRIORITY[f.kind] > FRAME_PRIORITY[bar.kind]) bar.kind = f.kind;
  }
  return out;
}

/**
 * `burn.SPIKE_MULTIPLE`: a segment is a spike at three times the median segment. The same bar
 * here, over the scrubber's bars instead of segments. Pinned to Python by a test.
 */
export const SPIKE_MULTIPLE = 3;

/**
 * `burn.MIN_SEGMENTS_FOR_SPIKES`: under five, "the median" is one of the things measured, and
 * a spike would be an accident of parity. Here: bars that had anything in them.
 */
export const SPIKE_MIN_BINS = 5;

/**
 * The bars that are spikes: at least SPIKE_MULTIPLE times the median count of the bars that
 * had anything in them. None when fewer than SPIKE_MIN_BINS bars had anything: a median
 * over fewer is not one. The median of an even count is the mean of the middle two, as
 * Python's `statistics.median`.
 */
export function spikeBins(bins: readonly TrackBin[]): number[] {
  const counts = bins.map((b) => b.count).filter((c) => c > 0).sort((a, b) => a - b);
  if (counts.length < SPIKE_MIN_BINS) return [];
  const mid = counts.length >> 1;
  const median = counts.length % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2;
  const out: number[] = [];
  bins.forEach((b, i) => {
    if (b.count > 0 && b.count >= SPIKE_MULTIPLE * median) out.push(i);
  });
  return out;
}
