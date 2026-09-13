/**
 * The time lapse's frames, heat, knot and burst (`src/map/frames.ts`, `heat.ts`, `knot.ts`).
 *
 * The frame thinning is the engine's own rule, so it is pinned to `live._timelapse` itself:
 * the same events through Python, thinned by Python and by the port, must come out frame for
 * frame the same. Every constant that copies an engine bar is pinned to the engine too.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FrameKind, LiveFile, LiveFrame, LiveState } from '../src/generated/live';
import {
  binOf,
  cleanFrames,
  FRAME_PRIORITY,
  MAX_FRAMES,
  SPIKE_MIN_BINS,
  SPIKE_MULTIPLE,
  spanOf,
  spikeBins,
  thinFrames,
  trackBins,
  TRACK_BINS,
} from '../src/map/frames';
import {
  buildReplay,
  cursorOf,
  frameAt,
  LEVEL_EDIT,
  LEVEL_EDIT_WARM,
  LEVEL_HOT,
  LEVEL_READ,
  LEVEL_READ_WARM,
  LEVEL_SLOT,
  levelOf,
  mapLevels,
  rankAt,
  recencyRanks,
  replayCursor,
  replayFailing,
  replayLevels,
  WARM_FILES,
} from '../src/map/heat';
import { BURST_MIN_FILES, findBurst, findKnot, KNOT_MAX_FILES, KNOT_MIN_FAILS, KNOT_MIN_WRITES, liveKnot } from '../src/map/knot';
import { mapSample } from '../src/map/sample';
import { layoutMap } from '../src/map/layout';
import { thinnedNote } from '../src/map/view';
import type { SessionDetail } from '../src/data/api';
import { python, REPO } from './pythonRef';

const id = (n: number) => n.toString(16).padStart(16, '0');
const fr = (t: number, file: number, kind: FrameKind): LiveFrame => ({ t, file_id: id(file), kind });

describe('the constants are the engine\'s', () => {
  test('MAX_FRAMES, the frame priority, the spike bar and the churn bar come from Python', () => {
    const py = python<{ max: number; prio: Record<string, number>; mult: number; min: number; churn: number }>(
      [
        'import json',
        'from analysis import live, burn',
        'print(json.dumps({"max": live.MAX_FRAMES, "prio": live._FRAME_PRIORITY, "mult": burn.SPIKE_MULTIPLE,',
        '  "min": burn.MIN_SEGMENTS_FOR_SPIKES, "churn": burn.FILE_CHURN_MIN_WRITES}))',
      ].join('\n'),
    );
    if (py === null) return; // no python3 here: the hand checked values below still hold
    expect(MAX_FRAMES).toBe(py.max);
    expect(FRAME_PRIORITY).toEqual(py.prio as typeof FRAME_PRIORITY);
    expect(SPIKE_MULTIPLE).toBe(py.mult);
    expect(SPIKE_MIN_BINS).toBe(py.min);
    expect(KNOT_MIN_WRITES).toBe(py.churn);
  });

  test('the knot\'s failure bar is the one live._verdict fires file churn on', () => {
    const src = readFileSync(join(REPO, 'analysis', 'live.py'), 'utf8');
    expect(src).toContain(`"file_churn" in cause_ids and ev["errors_now"] >= ${KNOT_MIN_FAILS}`);
  });

  test('hand checked: 600 frames, edit over fail over read, three times a median of five', () => {
    expect(MAX_FRAMES).toBe(600);
    expect(FRAME_PRIORITY).toEqual({ edit: 3, fail: 2, read: 1 });
    expect([SPIKE_MULTIPLE, SPIKE_MIN_BINS, KNOT_MIN_WRITES, KNOT_MIN_FAILS, KNOT_MAX_FILES]).toEqual([3, 5, 4, 2, 3]);
  });
});

describe('frame thinning is live._timelapse, frame for frame', () => {
  test('the same 1,500 events thinned to 200, 400 and 600 bins by Python and by the port', () => {
    const py = python<{
      full: [number, string, FrameKind][];
      thin: Record<string, [number, string, FrameKind][]>;
      rows: LiveFile[];
    }>(
      [
        'import json, random',
        'from analysis import digest, live',
        'rng = random.Random(7)',
        'paths = [f"/repo/src/m{i // 8}/f{i}.py" for i in range(40)]',
        'events = []',
        't = 1_000_000',
        'for n in range(1500):',
        '    t += rng.choice([0, 0, 1, 2, 3, 7, 30, 90])',
        '    p = rng.choice(paths)',
        '    r = rng.random()',
        '    if r < 0.6:',
        '        events.append(digest.Ev(n=n, ts=float(t), kind="tool", tool="Read", path=p, tool_id=f"t{n}"))',
        '    elif r < 0.8:',
        '        events.append(digest.Ev(n=n, ts=float(t), kind="tool", tool="Edit", path=p, added=1, removed=0, tool_id=f"t{n}"))',
        '    else:',
        '        events.append(digest.Ev(n=n, ts=float(t), kind="result_error", path=p, tool_id=f"x{n}"))',
        'paths_obj = live._Paths(events, "/repo", "s" * 32)',
        'failed = live._failed_calls(events)',
        'keep = live.MAX_FRAMES',
        'live.MAX_FRAMES = 10**9',
        'full = live._timelapse(events, paths_obj, failed)',
        'thin = {}',
        'for m in (200, 400, 600):',
        '    live.MAX_FRAMES = m',
        '    thin[str(m)] = live._timelapse(events, paths_obj, failed)',
        'live.MAX_FRAMES = keep',
        'rows = live._map(events, paths_obj, failed)["files"]',
        'print(json.dumps({"full": full, "thin": thin, "rows": rows}))',
      ].join('\n'),
    );
    if (py === null) return;
    const full = py.full.map(([t, f, k]) => ({ t, file_id: f, kind: k }));
    expect(full.length).toBe(1500);
    for (const m of [200, 400, 600]) {
      const want = py.thin[String(m)]!.map(([t, f, k]) => ({ t, file_id: f, kind: k }));
      expect({ m, frames: thinFrames(full, m) }).toEqual({ m, frames: want });
    }
    // The thinned lists really exercise the rule: empty bins, and every kind kept somewhere.
    expect(py.thin['400']!.length).toBeLessThan(400);
    expect(new Set(py.thin['600']!.map((f) => f[2]))).toEqual(new Set(['read', 'edit', 'fail']));
    // The premise the thinned note rests on: unthinned, the frames hold exactly the reads and
    // changes the map counts, so fewer frames than that is the engine's thinning and nothing else.
    const counted = py.rows.reduce((n, r) => n + r.reads + r.edits, 0);
    expect(full.filter((f) => f.kind !== 'fail').length).toBe(counted);
    expect(thinnedNote(full, py.rows)).toBeNull();
    const thin = py.thin['400']!.map(([t, f, k]) => ({ t, file_id: f, kind: k }));
    expect(thinnedNote(thin, py.rows)).not.toBeNull();
  });

  test('a bin keeps the change over the failure over the read, and the later of two equals', () => {
    const frames = [fr(0, 1, 'read'), fr(1, 2, 'fail'), fr(2, 3, 'read'), fr(10, 4, 'read'), fr(10, 5, 'read'), fr(20, 6, 'edit'), fr(21, 7, 'fail')];
    // Two bins over [0, 21]: the failure outranks four reads, the change outranks a failure.
    expect(thinFrames(frames, 2)).toEqual([fr(1, 2, 'fail'), fr(20, 6, 'edit')]);
    // Four bins: the two reads at t 10 share a bin, and the later of the two stays.
    expect(thinFrames(frames, 4)).toEqual([fr(1, 2, 'fail'), fr(10, 5, 'read'), fr(20, 6, 'edit')]);
  });

  test('at or under the cap, the frames are kept as they are', () => {
    const frames = [fr(0, 1, 'read'), fr(5, 2, 'edit')];
    expect(thinFrames(frames, 2)).toEqual(frames);
    expect(thinFrames([], 600)).toEqual([]);
  });

  test('frames all at one instant fall in one bin and keep the one that matters most', () => {
    expect(thinFrames([fr(3, 1, 'edit'), fr(3, 2, 'read'), fr(3, 3, 'edit')], 2)).toEqual([fr(3, 3, 'edit')]);
  });
});

describe('the door: frames that are not the spec\'s shape are dropped, never guessed at', () => {
  test('objects and the engine\'s tuples are read; anything else is left out; order is by time', () => {
    const got = cleanFrames([
      { t: 9, file_id: id(1), kind: 'edit' },
      [3, id(2), 'read'],
      { t: -1, file_id: id(3), kind: 'read' },
      { t: 4, file_id: 'src/secret.py', kind: 'read' },
      { t: 5, file_id: id(4), kind: 'write' },
      { t: 2.7, file_id: id(5), kind: 'fail' },
      null,
    ]);
    expect(got).toEqual([fr(2, 5, 'fail'), fr(3, 2, 'read'), fr(9, 1, 'edit')]);
  });

  test('no list at all is null, which is not the same as an empty one', () => {
    expect(cleanFrames(null)).toBeNull();
    expect(cleanFrames(undefined)).toBeNull();
    expect(cleanFrames([])).toEqual([]);
  });

  test('the span is the last frame\'s second', () => {
    expect(spanOf([fr(0, 1, 'read'), fr(95, 1, 'read'), fr(40, 2, 'edit')])).toBe(95);
    expect(spanOf([])).toBe(0);
  });
});

describe('the scrubber\'s bars and spikes', () => {
  test('a fixed number of bars, so a spike is the same spike on every phone', () => {
    expect(TRACK_BINS).toBe(60);
    const bins = trackBins([fr(0, 1, 'read'), fr(59, 1, 'edit'), fr(60, 2, 'fail')], 60);
    expect(bins.length).toBe(60);
    expect(bins[0]).toEqual({ count: 1, kind: 'read', edits: 0, fails: 0, reads: 1 });
    expect(bins[59]).toEqual({ count: 2, kind: 'edit', edits: 1, fails: 1, reads: 0 });
    expect(binOf(60, 60)).toBe(59);
    expect(binOf(10, 0)).toBe(0);
  });

  test('a spike is three times the median bar, and needs five bars with anything in them', () => {
    const quiet = (b: number, n: number) => Array.from({ length: n }, (_, i) => fr(b, i, 'read'));
    // Five bars of 1, 1, 1, 2, 6 frames: median 1, so only the 6 clears three times it.
    const frames = [...quiet(0, 1), ...quiet(10, 1), ...quiet(20, 1), ...quiet(30, 2), ...quiet(40, 6), fr(59, 0, 'read')];
    const bins = trackBins(frames, 59, 6);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 2, 6, 1]);
    expect(spikeBins(bins)).toEqual([4]);
    // Four bars with anything in them: no median, no spike.
    expect(spikeBins(trackBins([...quiet(0, 1), ...quiet(20, 1), ...quiet(40, 9), fr(59, 0, 'read')], 59, 6))).toEqual([]);
  });
});

describe('heat: hot where it works, cooling as it moves on', () => {
  test('the level table', () => {
    expect(levelOf(false, false, 0)).toBe(LEVEL_SLOT);
    expect(levelOf(true, true, 0)).toBe(LEVEL_HOT);
    expect(levelOf(true, true, WARM_FILES - 1)).toBe(LEVEL_EDIT_WARM);
    expect(levelOf(true, true, WARM_FILES)).toBe(LEVEL_EDIT);
    expect(levelOf(true, false, 0)).toBe(LEVEL_READ_WARM);
    expect(levelOf(true, false, WARM_FILES)).toBe(LEVEL_READ);
    expect(levelOf(true, false, Number.POSITIVE_INFINITY)).toBe(LEVEL_READ);
  });

  const row = (n: number, edits: number, readAt: number | null, editAt: number | null): LiveFile => ({
    id: id(n),
    dir_id: null,
    role: 'source',
    depth: 0,
    reads: readAt === null ? 0 : 1,
    edits,
    last_read_ts: readAt,
    last_edit_ts: editAt,
  });

  test('the live map ranks by the last read or change, and a file only named ranks last', () => {
    const files = [row(1, 2, 100, 400), row(2, 0, 300, null), row(3, 1, null, 200), row(4, 0, null, null), row(5, 0, 50, null)];
    const ranks = recencyRanks(files);
    expect([1, 2, 3, 5].map((n) => ranks.get(id(n)))).toEqual([0, 1, 2, 3]);
    expect(ranks.get(id(4))).toBe(Number.POSITIVE_INFINITY);
    expect(mapLevels(files, files.map((f) => f.id))).toEqual([LEVEL_HOT, LEVEL_READ_WARM, LEVEL_EDIT_WARM, LEVEL_READ, LEVEL_READ]);
    expect(cursorOf(files, null)).toBe(id(1));
    expect(cursorOf(files, id(3))).toBe(id(3));
    expect(cursorOf(files, id(99))).toBe(id(1));
  });

  test('the replay cools a file by the files touched after it, never by the clock', () => {
    const index = { [id(1)]: 0, [id(2)]: 1, [id(3)]: 2, [id(4)]: 3 };
    const frames = [fr(0, 1, 'read'), fr(5, 1, 'edit'), fr(9, 2, 'read'), fr(500, 3, 'read'), fr(501, 4, 'fail'), fr(502, 9, 'read')];
    const r = buildReplay(frames, index, 4);
    expect(frameAt(r.t, -1)).toBe(-1);
    expect(frameAt(r.t, 0)).toBe(0);
    expect(frameAt(r.t, 499)).toBe(2);
    expect(frameAt(r.t, 10_000)).toBe(5);
    expect(replayLevels(r, -1)).toEqual([0, 0, 0, 0]);
    expect(replayLevels(r, 1)).toEqual([LEVEL_HOT, 0, 0, 0]);
    // A long pause between frames 2 and 3 cools nothing: file 1 is one file back.
    expect(replayLevels(r, 2)).toEqual([LEVEL_EDIT_WARM, LEVEL_READ_WARM, 0, 0]);
    expect(replayLevels(r, 4)).toEqual([LEVEL_EDIT, LEVEL_READ_WARM, LEVEL_READ_WARM, LEVEL_READ_WARM]);
    expect(replayFailing(r, 4, 3)).toBe(true);
    expect(replayCursor(r, 4)).toBe(3);
    // A file off the map (9) still moves the agent on, and cannot be the cursor on the map.
    expect(replayLevels(r, 5)).toEqual([LEVEL_EDIT, LEVEL_READ, LEVEL_READ_WARM, LEVEL_READ_WARM]);
    expect(replayCursor(r, 5)).toBe(-1);
    expect(r.cell[5]).toBe(-1);
    expect(rankAt(r.mru, 5, 2)).toBe(2);
  });
});

describe('the knot where it got stuck', () => {
  test('one file changed four times with two failures, inside three files, is the knot', () => {
    const frames = [
      fr(0, 9, 'read'), fr(10, 8, 'edit'),
      fr(100, 1, 'edit'), fr(110, 2, 'fail'), fr(120, 1, 'edit'), fr(130, 3, 'read'), fr(140, 1, 'edit'),
      fr(150, 1, 'fail'), fr(160, 1, 'edit'), fr(170, 3, 'edit'), fr(180, 2, 'read'),
      fr(400, 7, 'edit'), fr(410, 6, 'edit'),
    ];
    const k = findKnot(frames)!;
    expect(k).not.toBeNull();
    expect(k.startT).toBe(100);
    expect(k.endT).toBe(170);
    expect(k.files).toEqual([id(1), id(3), id(2)]);
    expect([k.edits, k.fails, k.top, k.topEdits]).toEqual([5, 2, id(1), 4]);
  });

  test('the same rewrites with one failure are focus, not a knot', () => {
    const frames = [fr(0, 1, 'edit'), fr(1, 1, 'edit'), fr(2, 2, 'fail'), fr(3, 1, 'edit'), fr(4, 1, 'edit')];
    expect(findKnot(frames)).toBeNull();
    expect(findKnot([...frames, fr(5, 2, 'fail')])).not.toBeNull();
  });

  test('a fourth file breaks the stretch: working across the code is not going round in it', () => {
    const frames = [fr(0, 1, 'edit'), fr(1, 2, 'fail'), fr(2, 1, 'edit'), fr(3, 3, 'read'), fr(4, 4, 'read'), fr(5, 1, 'edit'), fr(6, 2, 'fail'), fr(7, 1, 'edit')];
    expect(findKnot(frames)).toBeNull();
  });

  test('the live knot is the engine\'s verdict: circling only, its churned file first, three at most', () => {
    const now = Date.parse('2026-09-13T12:00:00Z') / 1000;
    const rows: LiveFile[] = [1, 2, 3, 4, 5].map((n) => ({
      id: id(n),
      dir_id: null,
      role: 'source',
      depth: 0,
      reads: 1,
      edits: 6 - n,
      last_read_ts: now - 900,
      last_edit_ts: now - 60 * n,
    }));
    const state = (s: 'circling' | 'converging', stuck: number, file: string | null) =>
      ({
        computed_at: '2026-09-13T12:00:00Z',
        verdict: { state: s, basis: null, reason: null, file_id: file, evidence: { stuck_s: stuck } },
        map: { files: rows, files_total: 5 },
      }) as unknown as LiveState;
    expect(liveKnot(state('converging', 600, id(2)))).toEqual([]);
    expect(liveKnot(state('circling', 600, id(4)))).toEqual([id(4), id(1), id(2)]);
    // Only files changed since the circling began, and twice at least.
    expect(liveKnot(state('circling', 150, null))).toEqual([id(1), id(2)]);
    expect(liveKnot(null)).toEqual([]);
  });
});

describe('the burst at the end', () => {
  test('the changes in the last tenth, after the knot, across two files at least', () => {
    const frames = [fr(0, 1, 'read'), fr(500, 1, 'edit'), fr(905, 2, 'edit'), fr(930, 3, 'edit'), fr(950, 2, 'edit'), fr(1000, 4, 'read')];
    expect(findBurst(frames, null)).toEqual({ startT: 905, endT: 950, files: [id(2), id(3)], edits: 3 });
    expect(findBurst(frames.filter((f) => f.file_id !== id(3)), null)).toBeNull();
    expect(BURST_MIN_FILES).toBe(2);
  });

  test('a session still in its knot at the end had no burst', () => {
    const knot = { startT: 100, endT: 1000, files: [id(2)], edits: 9, fails: 2, top: id(2), topEdits: 9 };
    expect(findBurst([fr(0, 1, 'read'), fr(950, 2, 'edit'), fr(990, 3, 'edit'), fr(1000, 2, 'edit')], knot)).toBeNull();
  });
});

describe('the sample tells the story the roadmap asks the replay to show', () => {
  const base = { id: 'sample', repo_name: 'gt-transit', state: 'final' } as unknown as SessionDetail;
  const now = Date.parse('2026-09-13T15:00:00Z');

  test('the knot is the three guidance files, then a burst across many at the end', () => {
    const s = mapSample(base, 'map', now);
    const frames = cleanFrames(s.live_state!.timelapse)!;
    const knot = findKnot(frames)!;
    expect(knot).not.toBeNull();
    expect(knot.files.length).toBe(3);
    expect(knot.startT).toBeGreaterThanOrEqual(1860);
    expect(knot.endT).toBeLessThanOrEqual(2645);
    const burst = findBurst(frames, knot)!;
    expect(burst.files.length).toBeGreaterThanOrEqual(6);
  });

  test('while it is stuck, the live map pulses the file the verdict names', () => {
    const s = mapSample(base, 'circling', now);
    const knot = liveKnot(s.live_state!);
    expect(knot[0]).toBe(s.live_state!.verdict.file_id!);
    expect(knot.length).toBeLessThanOrEqual(KNOT_MAX_FILES);
    const layout = layoutMap(s.live_state!.map!.files);
    for (const k of knot) expect(layout.index[k]).toBeDefined();
  });
});
