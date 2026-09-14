/**
 * How the codebase map is painted (`src/map/paint.ts`, `src/map/figure.ts`): the role hues, the
 * bloom's order from the top of the repository, the flip, the knot's rings, the trail, the
 * ripple, and the band's figure. And the rule that crashed a screen once already: every function
 * a worklet calls per frame is itself a worklet.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionDetail } from '../src/data/api';
import type { LiveFile, PlainRole } from '../src/generated/live';
import { DATA, SPECTRUM } from '../src/insights/palette';
import { emsOf, fitFigure, headlineParts, widestLabel } from '../src/map/figure';
import { cleanFrames } from '../src/map/frames';
import { buildReplay, LEVEL_EDIT, LEVEL_EDIT_WARM, LEVEL_HOT, LEVEL_READ, LEVEL_READ_WARM, LEVEL_SLOT, mapLevels } from '../src/map/heat';
import { findKnot } from '../src/map/knot';
import { cellRects, fitGeometry, layoutMap, placeLabels } from '../src/map/layout';
import {
  bayer8,
  BLOOM_SPAN_MS,
  BLOOM_STEP_MS,
  bloomDelays,
  bloomEnd,
  bloomFlash,
  bloomSize,
  bloomWaves,
  boxOf,
  CELL_MS,
  centreOf,
  flipAt,
  glowOf,
  hotCount,
  KNOCKOUT_PAD,
  knockouts,
  PATH_FILES,
  pathWidth,
  recentPath,
  RING_CYCLE_S,
  RING_INSET,
  RING_REACH,
  ringAt,
  ringBox,
  ringFade,
  RIPPLE,
  rippleAt,
  rippleLit,
  ROLE_HUE,
  roleInk,
  trailAt,
  trailFade,
  trailStrength,
} from '../src/map/paint';
import { mapSample, MAP_SAMPLE_VARIANTS } from '../src/map/sample';
import { elapsedLabel, roleWord } from '../src/map/view';

const MOBILE = join(import.meta.dir, '..');
const NOW = Date.parse('2026-09-13T15:00:00Z');
const base = { id: 'x1', client_session_id: 'x1', harness: 'claude_code', repo_name: 'gt-transit', state: 'live' } as unknown as SessionDetail;
const sample = (v: (typeof MAP_SAMPLE_VARIANTS)[number]) => mapSample(base, v, NOW);
/** The canvas's margin, read from MapCanvas.tsx (it imports React Native, which bun cannot load). */
const MAP_MARGIN = Number(/export const MAP_MARGIN = (\d+);/.exec(readFileSync(join(MOBILE, 'src/map/MapCanvas.tsx'), 'utf8'))![1]);
const ROLES: PlainRole[] = ['test', 'source', 'config', 'docs', 'migration', 'style', 'build', 'dependency', 'unknown'];

describe('each kind of file wears one hue', () => {
  test('every role but unknown has its own spectrum hue, and none is a data colour', () => {
    const named = ROLES.filter((r) => r !== 'unknown').map((r) => ROLE_HUE[r]);
    expect(named.every((h) => h !== null && h in SPECTRUM)).toBe(true);
    expect(new Set(named).size).toBe(named.length);
    expect(ROLE_HUE.unknown).toBeNull();
    for (const r of ROLES) {
      const ink = roleInk(r);
      expect([ink.ink, ink.partner]).not.toContain(DATA.add);
      expect([ink.ink, ink.partner]).not.toContain(DATA.del);
      expect(ink.ink).not.toBe(ink.partner);
    }
  });

  test('the four roles a repository is mostly made of are four different families', () => {
    const four = (['source', 'test', 'config', 'docs'] as const).map((r) => ROLE_HUE[r]);
    expect(four).toEqual(['cobalt', 'brass', 'orchid', 'heather']);
  });
});

describe('the map draws itself on from the top of the repository outward', () => {
  const files = sample('map').live_state!.map!.files;
  const lay = layoutMap(files);
  const waves = bloomWaves(lay);

  test('deterministic, bit for bit', () => {
    expect(JSON.stringify(bloomWaves(layoutMap(files)))).toBe(JSON.stringify(waves));
    // Row order is not an input: the layout decides, and it sorts by id.
    expect(JSON.stringify(bloomWaves(layoutMap([...files].reverse())))).toBe(JSON.stringify(waves));
  });

  test('the seed is the first cell of the top island, and it lands first', () => {
    const seed = lay.folders[0]!.cells[0]!;
    expect(waves[seed]).toBe(0);
    for (let i = 0; i < waves.length; i++) if (i !== seed) expect(waves[i]!).toBeGreaterThan(0);
  });

  test('inside an island the front moves a cell a wave: neighbours land at most a wave and the jitter apart', () => {
    for (const f of lay.folders) {
      for (const a of f.cells) {
        for (const b of f.cells) {
          const ca = lay.cells[a]!;
          const cb = lay.cells[b]!;
          if (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) !== 1) continue;
          expect(Math.abs(waves[a]! - waves[b]!)).toBeLessThan(1.46);
        }
      }
    }
  });

  test('an island further out starts later: each island blooms from its cell nearest the top, when the front gets there', () => {
    const seed = lay.cells[lay.folders[0]!.cells[0]!]!;
    const starts = lay.folders.map((f) => Math.min(...f.cells.map((c) => waves[c]!)));
    const reach = lay.folders.map((f) => Math.min(...f.cells.map((c) => Math.hypot(lay.cells[c]!.x - seed.x, lay.cells[c]!.y - seed.y))));
    for (let i = 0; i < starts.length; i++) expect(starts[i]!).toBeGreaterThanOrEqual(reach[i]! - 1e-9);
    for (let i = 0; i < starts.length; i++) expect(starts[i]!).toBeLessThan(reach[i]! + 0.46);
  });

  test('the whole bloom fits its span at a small map\'s pace or faster', () => {
    const delays = bloomDelays(waves, 400);
    expect(Math.min(...delays)).toBe(400);
    expect(Math.max(...delays)).toBeLessThanOrEqual(400 + BLOOM_SPAN_MS + 1e-6);
    expect(bloomEnd(delays)).toBeLessThanOrEqual(400 + BLOOM_SPAN_MS + CELL_MS + 1e-6);
    // Three files do not take a second to appear: one wave is at most BLOOM_STEP_MS.
    const tiny = layoutMap(files.slice(0, 3));
    const d = bloomDelays(bloomWaves(tiny), 0);
    expect(Math.max(...d)).toBeLessThanOrEqual(BLOOM_STEP_MS * 3);
    expect(bloomWaves(layoutMap([]))).toEqual([]);
  });

  test('the 400 file map blooms too, every cell reached', () => {
    const cut = layoutMap(sample('cut').live_state!.map!.files);
    const w = bloomWaves(cut);
    expect(w.length).toBe(cut.cells.length);
    expect(w.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
  });

  test('a cell arrives in the sandpile\'s four sizes, bright for the first half, then whole', () => {
    const sizes = [0, 0.1, 0.3, 0.6, 0.9, 1].map(bloomSize);
    expect(sizes[0]).toBe(0);
    expect(sizes[5]).toBe(1);
    expect(new Set([0.01, 0.2, 0.26, 0.49, 0.51, 0.74, 0.76, 0.99].map(bloomSize)).size).toBe(4);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
    expect(bloomSize(0.01)).toBeCloseTo(0.2 / 0.7, 6);
    expect([bloomFlash(0), bloomFlash(0.2), bloomFlash(0.6), bloomFlash(1)]).toEqual([false, true, false, false]);
  });
});

describe('the flip, the rings, the trail and the ripple', () => {
  test('a flip narrows to an edge at the half turn and shows the new face after it', () => {
    expect(flipAt(0)).toEqual([1, 0, 1]);
    const end = flipAt(1);
    expect(end[0]).toBeCloseTo(1, 9);
    expect(end[1]).toBe(1);
    expect(end[2]).toBeCloseTo(1, 9);
    const half = flipAt(0.5);
    expect(half[0]).toBeLessThan(0.01);
    expect(half[1]).toBe(1);
    expect(half[2]).toBeCloseTo(0.945, 6);
    expect(flipAt(0.3)[1]).toBe(0);
  });

  test('MagicRings: fades in over 0.7 s, out by 0.2 s before the cycle ends; three rings, staggered', () => {
    expect(ringFade(0)).toBe(0);
    expect(ringFade(0.7)).toBeCloseTo(1 - 0.0, 1);
    expect(ringFade(RING_CYCLE_S - 0.2)).toBeCloseTo(0, 9);
    const at = [0, 1, 2].map((i) => ringAt(0, i)[0]);
    expect(new Set(at).size).toBe(3);
    expect(ringAt(RING_CYCLE_S, 0)[0]).toBeCloseTo(0, 9);
    for (let s = 0; s < 10; s += 0.37) for (let i = 0; i < 3; i++) {
      const [grow, weight] = ringAt(s, i);
      expect(grow).toBeGreaterThanOrEqual(0);
      expect(grow).toBeLessThan(1);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  test("ShapeGrid's trail and PixelTrail's age", () => {
    expect([0, 1, 2, 3, 4].map((i) => trailStrength(i, 5))).toEqual([5 / 6, 4 / 6, 3 / 6, 2 / 6, 1 / 6]);
    expect(trailStrength(5, 5)).toBe(0);
    expect([0, 450, 900, 1200, -1].map((a) => trailFade(a, 900))).toEqual([1, 0.5, 0, 0, 0]);
  });

  test("PixelBlast's ripple rides out at its speed and dies away, lit only through the Bayer matrix", () => {
    const t = 0.5;
    const peak = RIPPLE.speed * t;
    expect(rippleAt(peak, t)).toBeGreaterThan(rippleAt(peak + 0.2, t));
    expect(rippleAt(peak, t)).toBeGreaterThan(rippleAt(peak - 0.2, t));
    expect(rippleAt(0.3, 0.3)).toBeGreaterThan(rippleAt(0.3 + RIPPLE.speed, 1.3));
    expect(rippleAt(0.1, -1)).toBe(0);
    expect(rippleLit(0, 0.99)).toBe(false);
    expect(rippleLit(0.9, 0.2)).toBe(true);
    expect(rippleLit(0.1, 0.2)).toBe(false);
    expect(rippleLit(0.1, 0.95)).toBe(true);
  });

  test('the 8x8 Bayer matrix: 64 thresholds, each once per tile, the band shader\'s arithmetic', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(Math.round(bayer8(x, y) * 64));
    expect(seen.size).toBe(64);
    expect(bayer8(8, 8)).toBe(bayer8(0, 0));
  });
});

describe('heat, glow and the path', () => {
  test('only the working set glows, softest for a read, most for the file it changes now', () => {
    expect([LEVEL_SLOT, LEVEL_READ, LEVEL_EDIT].map(glowOf)).toEqual([0, 0, 0]);
    expect(glowOf(LEVEL_READ_WARM)).toBeLessThan(glowOf(LEVEL_EDIT_WARM));
    expect(glowOf(LEVEL_EDIT_WARM)).toBeLessThan(glowOf(LEVEL_HOT));
    expect(hotCount([0, 1, 2, 3, 4, 5, 4])).toBe(3);
  });

  test('"3 hot" on the sample: never more than the working set', () => {
    for (const v of ['map', 'circling', 'names', 'cut'] as const) {
      const files = sample(v).live_state!.map!.files;
      const lay = layoutMap(files);
      const hot = hotCount(mapLevels(files, lay.cells.map((c) => c.id)));
      expect(hot).toBeGreaterThanOrEqual(0);
      expect(hot).toBeLessThanOrEqual(3);
    }
  });

  test('the live path: the last six files touched, oldest first, only files on the map, none below two', () => {
    const files = sample('map').live_state!.map!.files;
    const lay = layoutMap(files);
    const path = recentPath(files, lay.index);
    expect(path.length).toBe(PATH_FILES);
    const at = (i: number) => {
      const f = files.find((x) => x.id === lay.cells[i]!.id)!;
      return Math.max(f.last_read_ts ?? -Infinity, f.last_edit_ts ?? -Infinity);
    };
    for (let i = 1; i < path.length; i++) expect(at(path[i]!)).toBeGreaterThanOrEqual(at(path[i - 1]!));
    const f = (id: string, ts: number | null): LiveFile => ({ id, dir_id: null, role: 'source', depth: 0, reads: ts ? 1 : 0, edits: 0, last_read_ts: ts, last_edit_ts: null });
    const two = [f('a'.repeat(16), 10), f('b'.repeat(16), null)];
    expect(recentPath(two, layoutMap(two).index)).toEqual([]);
  });

  test('the replay trail: distinct cells, newest first, off map frames skipped', () => {
    const s = sample('map').live_state!;
    const frames = cleanFrames(s.timelapse)!;
    const lay = layoutMap(s.map!.files);
    const r = buildReplay(frames, lay.index, lay.cells.length);
    const k = frames.length - 1;
    const tr = trailAt(r, k, 6, 240);
    const cells = tr.filter((_, i) => i % 2 === 0);
    const at = tr.filter((_, i) => i % 2 === 1);
    expect(cells.length).toBe(6);
    expect(new Set(cells).size).toBe(6);
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeLessThan(at[i - 1]!);
    expect(cells[0]).toBe(r.cell[k]);
    expect(trailAt(r, -1, 6, 240)).toEqual([]);
  });

  test("the knot's rings grow round its own box and never past the gutter or off the canvas", () => {
    const W = 402;
    const H = 442;
    // A knot in the middle: at rest the box padded by 5, at the end grown by the whole reach.
    expect(ringBox(150, 150, 250, 200, 5, 30, 0, W, H)).toEqual([145, 145, 110, 60]);
    expect(ringBox(150, 150, 250, 200, 5, 30, 1, W, H)).toEqual([115, 115, 170, 120]);
    // A wide knot just under the band and near the left edge (the circling time lapse, 103): the
    // top and left do not grow past the inset; the right and bottom still breathe.
    const tight = ringBox(24, 24, 300, 110, 5, 30, 1, W, H);
    expect(tight[0]).toBeGreaterThanOrEqual(RING_INSET);
    expect(tight[1]).toBeGreaterThanOrEqual(RING_INSET);
    expect(tight[0] + tight[2]).toBe(335);
    expect(tight[1] + tight[3]).toBe(145);
    // Never onto the cells, even where the knot sits inside the inset.
    const edge = ringBox(21, 21, 60, 60, 5, 30, 0.5, W, H);
    expect(edge[0]).toBeLessThanOrEqual(19);
    expect(edge[1]).toBeLessThanOrEqual(19);
    // Growth outside 0 to 1 is held to it.
    expect(ringBox(150, 150, 250, 200, 5, 30, 7, W, H)).toEqual(ringBox(150, 150, 250, 200, 5, 30, 1, W, H));
  });

  test("on every sample, the rings stay inside the canvas by the gutter through their whole cycle", () => {
    for (const v of MAP_SAMPLE_VARIANTS) {
      const live = sample(v).live_state!;
      const frames = cleanFrames(live.timelapse) ?? [];
      const knot = findKnot(frames);
      if (!knot) continue;
      const lay = layoutMap(live.map!.files);
      const geo = fitGeometry(lay, 402, 442, MAP_MARGIN);
      const rects = cellRects(lay, geo);
      const cells = knot.files.map((id) => lay.index[id]).filter((i): i is number => i !== undefined);
      const box = boxOf(cells, rects)!;
      for (let g = 0; g <= 1; g += 0.05) {
        const [x, y, w, h] = ringBox(box[0], box[1], box[2], box[3], geo.pitch * 0.35, RING_REACH * geo.pitch, g, geo.width, geo.height);
        expect(x).toBeGreaterThanOrEqual(Math.min(RING_INSET, box[0] - 2));
        expect(y).toBeGreaterThanOrEqual(Math.min(RING_INSET, box[1] - 2));
        expect(x + w).toBeLessThanOrEqual(Math.max(geo.width - RING_INSET, box[2] + 2));
        expect(y + h).toBeLessThanOrEqual(Math.max(geo.height - RING_INSET, box[3] + 2));
        // Round the knot, never on it.
        expect(x).toBeLessThan(box[0]);
        expect(y).toBeLessThan(box[1]);
        expect(x + w).toBeGreaterThan(box[2]);
        expect(y + h).toBeGreaterThan(box[3]);
      }
    }
  });

  test('every role label has a knockout round it in the ground, and a label keeps clear of every cell', () => {
    expect(knockouts([{ x: 10, y: 20, width: 90, height: 15 }])).toEqual([10 - KNOCKOUT_PAD[0], 20 - KNOCKOUT_PAD[1], 90 + KNOCKOUT_PAD[0] * 2, 15 + KNOCKOUT_PAD[1] * 2]);
    expect(knockouts([])).toEqual([]);
    let labelled = 0;
    for (const v of MAP_SAMPLE_VARIANTS) {
      const live = sample(v).live_state!;
      if (!live.map?.files.length) continue;
      const lay = layoutMap(live.map.files);
      const geo = fitGeometry(lay, 402, 442, MAP_MARGIN);
      const rects = cellRects(lay, geo);
      const placed = placeLabels(lay, geo, rects, (role) => roleWord(role).length * 6.8 + 2, 15);
      const k = knockouts(placed);
      expect(k.length).toBe(placed.length * 4);
      placed.forEach((l, i) => {
        labelled += 1;
        const [x, y, w, h] = k.slice(i * 4, i * 4 + 4) as [number, number, number, number];
        expect(x <= l.x && y <= l.y && x + w >= l.x + l.width && y + h >= l.y + l.height).toBe(true);
        // The knockout never reaches over a cell above or below the word (the pad stays in the
        // two points `placeLabels` leaves).
        rects.x.forEach((cx, ci) => {
          const cy = rects.y[ci]!;
          const across = cx < l.x + l.width && l.x < cx + rects.size;
          if (across) expect(cy + rects.size <= y || y + h <= cy).toBe(true);
        });
      });
    }
    expect(labelled).toBeGreaterThan(0);
  });

  test('geometry: boxes and centres in points, the path between 1.5 and 3 points', () => {
    const rects = { x: [0, 20, 40], y: [0, 0, 20], size: 16 };
    expect(boxOf([0, 2], rects)).toEqual([0, 0, 56, 36]);
    expect(centreOf([0, 1], rects)).toEqual([18, 8]);
    expect(boxOf([], rects)).toBeNull();
    expect([4, 8, 14, 28].map(pathWidth).every((w) => w >= 1.5 && w <= 3)).toBe(true);
  });
});

describe("the band's figure", () => {
  test('"42 files, 3 hot" as parts; no hot clause at zero; numbers grouped', () => {
    expect(headlineParts(42, 3).map((p) => p.text).join('')).toBe('42 files, 3 hot');
    expect(headlineParts(1, 0).map((p) => p.text).join('')).toBe('1 file');
    expect(headlineParts(1204, 2)[0]!.text).toBe('1,204');
  });

  test('fitted to the band, never over its max or under its min', () => {
    const parts = headlineParts(42, 3);
    const size = fitFigure(parts, 350, 92, 40);
    expect(size).toBeLessThanOrEqual(92);
    expect(size).toBeGreaterThanOrEqual(40);
    expect(fitFigure(headlineParts(1204, 3), 350, 92, 40)).toBeLessThanOrEqual(size);
    expect(fitFigure(parts, 20, 92, 40)).toBe(40);
  });

  test('the replay clock holds the width of the widest label it will pass', () => {
    expect(widestLabel(elapsedLabel(3840), 3840)).toBe('59m 59s');
    expect(emsOf('59m 59s')).toBeGreaterThan(emsOf('1h 04m'));
    for (const span of [7, 40, 300, 3840, 40_000]) {
      const widest = emsOf(widestLabel(elapsedLabel(span), span));
      for (let s = 0; s <= span; s += Math.max(1, Math.floor(span / 997))) expect(emsOf(elapsedLabel(s))).toBeLessThanOrEqual(widest + 1e-9);
    }
  });
});

describe('a worklet helper is defined before the worklet that calls it', () => {
  /**
   * Reanimated turns a `'worklet'` function into a value, which is not hoisted: a worklet that
   * calls one defined LATER in the same file captures `undefined` and throws "is not a function"
   * the first time that line runs. It crashed the time lapse at the end of its replay once
   * (`bayer8` called `bayer2`, defined under it). Every worklet in the map's modules is read for
   * calls to another worklet in the same file, and the callee must come first.
   */
  const FILES = ['src/map/paint.ts', 'src/map/heat.ts', 'src/map/view.ts', 'src/map/figure.ts', 'src/map/frames.ts', 'src/map/knot.ts', 'src/map/layout.ts', 'src/insights/motion.ts', 'src/insights/format.ts'];
  for (const file of FILES) {
    test(file, () => {
      const src = readFileSync(join(MOBILE, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      const defs: { name: string; at: number; body: string }[] = [];
      const re = /(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\([^)]*\)[^{]*\{\s*'worklet'/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        // The match ends inside the body, just past the directive: one brace deep.
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
        }
        defs.push({ name: m[1]!, at: m.index, body: src.slice(m.index + m[0].length, i) });
      }
      const at = new Map(defs.map((d) => [d.name, d.at]));
      const late: string[] = [];
      for (const d of defs) {
        for (const call of d.body.matchAll(/(?<![.\w])([A-Za-z_]\w*)\(/g)) {
          const callee = at.get(call[1]!);
          if (callee !== undefined && call[1] !== d.name && callee > d.at) late.push(`${d.name} calls ${call[1]}`);
        }
      }
      expect({ file, late }).toEqual({ file, late: [] });
    });
  }
});

describe('every function a worklet calls per frame is a worklet', () => {
  /**
   * `[Reanimated] Tried to synchronously call a non-worklet function ... on the UI thread` is a
   * crash, not a warning. Every body the UI thread runs here (the pictures, the animated styles,
   * the reactions, the gestures) is read for the calls it makes to this repository's own modules,
   * and each one called must carry the directive in its source.
   */
  const SCREENS = ['src/map/MapCanvas.tsx', 'src/map/MapWords.tsx', 'src/map/Scrubber.tsx', 'src/map/MapParts.tsx', 'app/you/map/[id].tsx', 'app/you/timelapse/[id].tsx'];

  function strip(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  }

  /** The bodies handed to the UI thread: from the hook's opening paren to its balanced close. */
  function uiBodies(src: string): string[] {
    const out: string[] = [];
    const re = /\b(useDerivedValue|useAnimatedStyle|useAnimatedProps|useAnimatedReaction|onStart|onUpdate|onEnd|onFinalize|onTouchesDown)\(/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
      }
      out.push(src.slice(m.index + m[0].length, i));
    }
    // A named worklet (`const seek = (...) => { 'worklet'; ... }`) is a UI body too.
    for (const w of src.matchAll(/=\s*\([^)]*\)\s*=>\s*\{\s*'worklet';[\s\S]*?\n  \};/g)) out.push(w[0]);
    return out;
  }

  /** `import { a, b as c } from './x'` for the repository's own modules, name to file. */
  function localImports(file: string, src: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
      const dir = join(MOBILE, file, '..');
      let path = join(dir, m[2]!);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          readFileSync(path + ext);
          path += ext;
          break;
        } catch {
          // try the next
        }
      }
      for (const raw of m[1]!.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
        if (name && !raw.trim().startsWith('type ')) out.set(name, path);
      }
    }
    return out;
  }

  function isWorklet(path: string, name: string): boolean | null {
    const src = readFileSync(path, 'utf8');
    const fn = new RegExp(`export function ${name}\\b[^{]*\\{\\s*'worklet'`).test(src);
    if (fn) return true;
    if (new RegExp(`export function ${name}\\b`).test(src)) return false;
    return null;
  }

  for (const file of SCREENS) {
    test(file, () => {
      const src = strip(readFileSync(join(MOBILE, file), 'utf8'));
      const imports = localImports(file, src);
      const bad: string[] = [];
      for (const body of uiBodies(src)) {
        for (const call of body.matchAll(/(?<![.\w])([a-zA-Z_]\w*)\(/g)) {
          const name = call[1]!;
          const from = imports.get(name);
          if (!from || !/\.tsx?$/.test(from)) continue;
          const w = isWorklet(from, name);
          if (w === false) bad.push(`${name} (${from.replace(MOBILE + '/', '')})`);
        }
      }
      expect({ file, bad: [...new Set(bad)] }).toEqual({ file, bad: [] });
    });
  }
});
