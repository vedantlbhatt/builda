/**
 * The codebase map's layout (`src/map/layout.ts`, `pack.ts`): deterministic, stable across
 * refreshes, one cell per file, no two cells on one spot, islands apart, and a shape that
 * fits a phone from one file to the 400 the map keeps.
 */
import { describe, expect, test } from 'bun:test';

import type { LiveFile, PlainRole } from '../src/generated/live';
import {
  BASE_FOLDER,
  cellGap,
  cellRects,
  fitGeometry,
  hitTest,
  ISLAND_GAP,
  LABEL_MAX,
  layoutMap,
  MAX_PITCH,
  MIN_PITCH,
  placeLabels,
  spiral,
  type MapLayout,
} from '../src/map/layout';
import { packSiblings } from '../src/map/pack';
import { MAP_SAMPLE_VARIANTS, mapSample, sampleId } from '../src/map/sample';
import type { SessionDetail } from '../src/data/api';

const ROLES: PlainRole[] = ['source', 'source', 'test', 'config', 'docs', 'source', 'migration'];

/** A repository of `folders` folders at depths 0 to 5, `perFolder(i)` files each, ids from paths. */
function repo(folders: number, perFolder: (i: number) => number): LiveFile[] {
  const out: LiveFile[] = [];
  for (let d = 0; d < folders; d++) {
    const dir = d === 0 ? '' : `pkg${d % 4}/mod${d}`;
    const depth = d === 0 ? 0 : 2;
    for (let j = 0; j < perFolder(d); j++) {
      out.push({
        id: sampleId(`${dir}/file${j}`),
        dir_id: dir ? sampleId(dir) : null,
        role: ROLES[(d + j) % ROLES.length]!,
        depth: d === 0 ? 0 : d % 5 === 0 ? null : depth + (d % 3),
        reads: j % 3,
        edits: j % 2,
        last_read_ts: 1_757_000_000 + j,
        last_edit_ts: j % 2 ? 1_757_000_100 + j : null,
      });
    }
  }
  return out;
}

const positions = (l: MapLayout) => Object.fromEntries(l.cells.map((c) => [c.id, [c.x, c.y]]));

describe('deterministic: the same files are always drawn the same way', () => {
  const files = repo(14, (i) => 1 + ((i * 7) % 11));

  test('twice in a row, bit for bit', () => {
    expect(JSON.stringify(layoutMap(files))).toBe(JSON.stringify(layoutMap(files)));
  });

  test('whatever order the rows arrive in (the spec promises none)', () => {
    const reversed = [...files].reverse();
    const rotated = [...files.slice(17), ...files.slice(0, 17)];
    const interleaved = files.filter((_, i) => i % 2).concat(files.filter((_, i) => i % 2 === 0));
    const want = positions(layoutMap(files));
    for (const shuffled of [reversed, rotated, interleaved]) expect(positions(layoutMap(shuffled))).toEqual(want);
  });

  test('a duplicate row is one cell, the first one kept', () => {
    const dup = [...files, { ...files[0]!, role: 'docs' as PlainRole }];
    const l = layoutMap(dup);
    expect(l.cells.length).toBe(files.length);
    expect(l.cells[l.index[files[0]!.id]!]!.role).toBe(files[0]!.role);
  });

  test('the spiral is exact: a cell, a plus, a square, then round', () => {
    const key = (n: number) => spiral(n).map(([x, y]) => `${x},${y}`);
    expect(key(1)).toEqual(['0,0']);
    expect(key(5)).toEqual(['0,0', '1,0', '0,1', '-1,0', '0,-1']);
    expect(new Set(key(9))).toEqual(new Set(['0,0', '1,0', '0,1', '-1,0', '0,-1', '1,1', '-1,1', '-1,-1', '1,-1']));
    const big = spiral(400);
    expect(new Set(big.map(([x, y]) => `${x},${y}`)).size).toBe(400);
  });
});

describe('stable across refreshes', () => {
  test('a new folder deeper than every other moves no island already drawn, only the frame', () => {
    // Every folder inside the checkout, so a depth 9 folder is the last one packed (folders
    // outside the checkout rank after every depth).
    const before = repo(10, (i) => 2 + (i % 5)).map((f) => ({ ...f, depth: f.depth ?? 3 }));
    const extra: LiveFile = {
      id: sampleId('deep/new/file'),
      dir_id: sampleId('deep/new'),
      role: 'test',
      depth: 9,
      reads: 1,
      edits: 0,
      last_read_ts: 1_757_000_500,
      last_edit_ts: null,
    };
    const a = layoutMap(before);
    const b = layoutMap([...before, extra]);
    // Every earlier cell keeps its place relative to the others: one shift for all of them.
    const shift = (c: { id: string; x: number; y: number }) => {
      const o = b.cells[b.index[c.id]!]!;
      return [+(o.x - c.x).toFixed(9), +(o.y - c.y).toFixed(9)];
    };
    const first = shift(a.cells[0]!);
    for (const c of a.cells) expect(shift(c)).toEqual(first);
  });

  test('a file keeps its island when files are added elsewhere', () => {
    const before = repo(8, (i) => 3 + (i % 4));
    const after = repo(8, (i) => 3 + (i % 4) + (i === 7 ? 5 : 0));
    const a = layoutMap(before);
    const b = layoutMap(after);
    for (const c of a.cells) {
      const was = a.folders[c.folder]!.key;
      const now = b.folders[b.cells[b.index[c.id]!]!.folder]!.key;
      expect(now).toBe(was);
    }
  });
});

describe('one cell per file, none on another, islands apart', () => {
  const files = repo(24, (i) => 1 + ((i * 5) % 13));
  const l = layoutMap(files);

  test('every file is one cell and every cell is a file', () => {
    expect(l.cells.length).toBe(files.length);
    expect(new Set(l.cells.map((c) => c.id))).toEqual(new Set(files.map((f) => f.id)));
    expect(l.folders.reduce((n, f) => n + f.cells.length, 0)).toBe(files.length);
  });

  test('no two unit cells overlap, and cells of two islands keep the gap between them', () => {
    const minGap = 1 + ISLAND_GAP / Math.SQRT2 - 1e-9;
    for (let i = 0; i < l.cells.length; i++) {
      for (let j = i + 1; j < l.cells.length; j++) {
        const a = l.cells[i]!;
        const b = l.cells[j]!;
        const cheb = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        if (a.folder === b.folder) expect(cheb).toBeGreaterThanOrEqual(1 - 1e-9);
        else expect({ a: a.id, b: b.id, ok: cheb >= minGap }).toEqual({ a: a.id, b: b.id, ok: true });
      }
    }
  });

  test('the shape starts at 0 and its box holds every cell', () => {
    const xs = l.cells.map((c) => c.x);
    const ys = l.cells.map((c) => c.y);
    expect(Math.min(...xs) - 0.5).toBeCloseTo(0, 9);
    expect(Math.min(...ys) - 0.5).toBeCloseTo(0, 9);
    expect(Math.max(...xs) + 0.5).toBeCloseTo(l.width, 9);
    expect(Math.max(...ys) + 0.5).toBeCloseTo(l.height, 9);
  });

  test('the top of the repository is the first island, at the middle; deeper folders come after', () => {
    expect(l.folders[0]!.key).toBe(BASE_FOLDER);
    const rank = (d: number | null, k: string) => (k === BASE_FOLDER ? -1 : d === null ? Infinity : d);
    for (let i = 1; i < l.folders.length; i++) {
      expect(rank(l.folders[i]!.depth, l.folders[i]!.key)).toBeGreaterThanOrEqual(rank(l.folders[i - 1]!.depth, l.folders[i - 1]!.key));
    }
    const cx = l.width / 2;
    const cy = l.height / 2;
    const d = (f: { x: number; y: number }) => Math.hypot(f.x - cx, f.y - cy);
    const outside = l.folders.filter((f) => f.depth === null);
    const inner = l.folders[0]!;
    for (const f of outside) expect(d(f)).toBeGreaterThan(d(inner));
  });

  test('no files, no cells; one file, one cell', () => {
    expect(layoutMap([])).toEqual({ cells: [], folders: [], width: 0, height: 0, index: {} });
    const one = layoutMap(files.slice(0, 1));
    expect(one.cells.length).toBe(1);
    expect([one.width, one.height]).toEqual([1, 1]);
  });

  test('the packer places circles that never overlap, the same way every time', () => {
    const circles = () => Array.from({ length: 30 }, (_, i) => ({ r: 0.5 + ((i * 37) % 11) / 3, x: 0, y: 0 }));
    const a = packSiblings(circles());
    const b = packSiblings(circles());
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const dist = Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y);
        expect(dist).toBeGreaterThanOrEqual(a[i]!.r + a[j]!.r - 1e-6);
      }
    }
  });
});

describe('points: a shape that fits a phone', () => {
  test('three files are three thumb sized cells, not three posters', () => {
    const g = fitGeometry(layoutMap(repo(2, (i) => (i ? 1 : 2))), 370, 480, 12);
    expect(g.pitch).toBe(MAX_PITCH);
    expect(g.cell).toBe(MAX_PITCH - cellGap(MAX_PITCH));
  });

  test('the 400 rows the map keeps fit a 370 point column, every cell inside the canvas', () => {
    const l = layoutMap(repo(40, () => 10));
    expect(l.cells.length).toBe(400);
    const g = fitGeometry(l, 370, 480, 12);
    expect(Number.isInteger(g.pitch)).toBe(true);
    expect(g.pitch).toBeGreaterThanOrEqual(MIN_PITCH);
    const r = cellRects(l, g);
    for (let i = 0; i < r.x.length; i++) {
      expect(r.x[i]!).toBeGreaterThanOrEqual(0);
      expect(r.y[i]!).toBeGreaterThanOrEqual(0);
      expect(r.x[i]! + r.size).toBeLessThanOrEqual(g.width);
      expect(r.y[i]! + r.size).toBeLessThanOrEqual(g.height);
    }
  });

  test('cells land on whole points and an island keeps one pitch between its cells', () => {
    const l = layoutMap(repo(6, (i) => 4 + i));
    const g = fitGeometry(l, 361, 480, 12);
    const r = cellRects(l, g);
    for (const v of [...r.x, ...r.y]) expect(Number.isInteger(v)).toBe(true);
    for (const f of l.folders) {
      for (const i of f.cells) {
        for (const j of f.cells) {
          const dx = r.x[i]! - r.x[j]!;
          const dy = r.y[i]! - r.y[j]!;
          expect(Math.abs(dx % g.pitch)).toBe(0);
          expect(Math.abs(dy % g.pitch)).toBe(0);
        }
      }
    }
  });

  test('a tap finds the nearest cell within reach, and open water finds nothing', () => {
    const l = layoutMap(repo(5, () => 3));
    const g = fitGeometry(l, 361, 480, 12);
    const r = cellRects(l, g);
    const i = 4;
    expect(hitTest(r, r.x[i]! + r.size / 2, r.y[i]! + r.size / 2, 22)).toBe(i);
    expect(hitTest(r, -500, -500, 22)).toBeNull();
  });

  test('role labels: deterministic, one per role, never on a cell or on each other', () => {
    const l = layoutMap(repo(12, (i) => (i % 3 === 0 ? 9 : 2)));
    const g = fitGeometry(l, 361, 480, 12);
    const r = cellRects(l, g);
    const measure = (role: PlainRole) => role.length * 7;
    const a = placeLabels(l, g, r, measure, 14);
    expect(placeLabels(l, g, r, measure, 14)).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(new Set(a.map((x) => x.role)).size).toBe(a.length);
    const over = (p: { x: number; y: number; width: number; height: number }, q: { x: number; y: number; width: number; height: number }) =>
      p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
    for (const lab of a) {
      for (let i = 0; i < r.x.length; i++) expect(over(lab, { x: r.x[i]!, y: r.y[i]!, width: r.size, height: r.size })).toBe(false);
      for (const other of a) if (other !== lab) expect(over(lab, other)).toBe(false);
      expect(lab.x).toBeGreaterThanOrEqual(0);
      expect(lab.x + lab.width).toBeLessThanOrEqual(g.width);
    }
  });
});

describe('the samples are the spec\'s shape', () => {
  const base = { id: 'sample', repo_name: 'gt-transit', state: 'final' } as unknown as SessionDetail;
  const now = Date.parse('2026-09-13T15:00:00Z');

  for (const v of MAP_SAMPLE_VARIANTS) {
    test(`${v}: 16 hex ids, at most 400 rows and 600 frames, known kinds, in time order`, () => {
      const s = mapSample(base, v, now);
      const live = s.live_state!;
      const hex = /^[0-9a-f]{16}$/;
      expect(s.state).toBe('live');
      expect(live.map!.files.length).toBeLessThanOrEqual(400);
      expect(live.map!.files_total).toBeGreaterThanOrEqual(live.map!.files.length);
      for (const f of live.map!.files) {
        expect(hex.test(f.id)).toBe(true);
        if (f.dir_id !== null && f.dir_id !== undefined) expect(hex.test(f.dir_id)).toBe(true);
      }
      const frames = live.timelapse!;
      expect(frames.length).toBeLessThanOrEqual(600);
      for (let i = 0; i < frames.length; i++) {
        expect(hex.test(frames[i]!.file_id)).toBe(true);
        expect(['read', 'edit', 'fail']).toContain(frames[i]!.kind);
        if (i) expect(frames[i]!.t).toBeGreaterThanOrEqual(frames[i - 1]!.t);
      }
      expect(Date.parse(live.computed_at)).toBeLessThanOrEqual(now);
      expect(Date.parse(live.computed_at)).toBeGreaterThan(now - 120_000);
      if (v === 'names') expect(s.live_names!.files.length).toBe(live.map!.files.length);
      else expect(s.live_names).toBeNull();
    });
  }

  test('the cut sample keeps the 400 rows touched most recently of more than 400, and its frames are thinned', () => {
    const s = mapSample(base, 'cut', now);
    expect(s.live_state!.map!.files.length).toBe(400);
    expect(s.live_state!.map!.files_total).toBeGreaterThan(400);
    expect(s.live_state!.timelapse!.length).toBeLessThanOrEqual(600);
  });
});
