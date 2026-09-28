/**
 * The Projects list's rows (`src/projects/rows.ts`) and the ink under a row with no demo
 * (`src/motion/fluid.ts`, the solver the trailer shares): what a stage shows, in what order, what
 * it never says before the server has, a row's weeks in cells, and the ink's two promises (it never
 * makes ink out of nothing, and the same seed pours alike).
 */
import { describe, expect, test } from 'bun:test';

import type { GalleryEntry } from '../src/demos/model';
import { Fluid, rng, scalar } from '../src/motion/fluid';
import { rowMeta, stageLabel, stageVisual, weekCells, type KitSeen } from '../src/projects/rows';
import type { KitFileRow, ShipKitResponse } from '../src/shipkit/types';

function file(slot: string, id = slot): KitFileRow {
  return { id, slot: slot as KitFileRow['slot'], content_type: 'video/mp4', width: 1920, height: 1080, duration_ms: 20000, bytes: 1, position: 0, label: null, url: `/v1/kit-media/${id}` };
}
function kit(...files: KitFileRow[]): KitSeen {
  return { kind: 'ready', kit: { document: {} as ShipKitResponse['document'], published_at: '2026-09-28T00:00:00Z', files } };
}
const print = { id: 'p1', kind: 'image', label: 'a screen', source: null, mark: null, count: '1 of 1', aspect: 0.46, url: '/p1', posterUrl: null, duration: null, a11y: 'a screen' } as GalleryEntry;

describe('what a stage shows', () => {
  test('the trailer first, then the kit wide video, then the stills, then the ink', () => {
    expect(stageVisual(kit(file('video_landscape'), file('trailer_landscape')), [print])).toMatchObject({ kind: 'video', from: 'trailer', id: 'trailer_landscape' });
    expect(stageVisual(kit(file('video_landscape'), file('video_vertical')), [print])).toMatchObject({ kind: 'video', from: 'kit', id: 'video_landscape' });
    expect(stageVisual(kit(file('video_vertical')), [print])).toEqual({ kind: 'prints', prints: [print] });
    expect(stageVisual({ kind: 'none' }, [])).toEqual({ kind: 'none' });
  });

  test('never "no demo yet" before the server said so', () => {
    expect(stageVisual({ kind: 'unknown' }, [])).toEqual({ kind: 'unknown' });
    expect(stageVisual({ kind: 'none' }, undefined)).toEqual({ kind: 'unknown' });
    // Prints heard before the kit: they show at once.
    expect(stageVisual({ kind: 'unknown' }, [print]).kind).toBe('prints');
  });

  test('VoiceOver hears which picture it is', () => {
    expect(stageLabel('RideGT', { kind: 'video', from: 'trailer', id: 'x', url: '', posterId: null, width: 1, height: 1 })).toBe('RideGT, its trailer, playing');
    expect(stageLabel('RideGT', { kind: 'prints', prints: [print, print] })).toBe('RideGT, 2 screens of its demo');
    expect(stageLabel('RideGT', { kind: 'none' })).toBe('RideGT has no demo yet');
  });
});

describe('a row line and its weeks', () => {
  test('the meta line joins what there is with the middle dot', () => {
    expect(rowMeta('Active', '2 hours ago')).toBe('Active · 2 hours ago');
    expect(rowMeta(null, '2 hours ago')).toBe('2 hours ago');
    expect(rowMeta('Dormant', '  ')).toBe('Dormant');
  });

  test('weeks against the row own busiest, and a week with any time is at least one cell', () => {
    const series = { key: 'k', label: { text: 'x', source: 'public' }, hue: 'tide', attended: [0, 36, 3600, 7200], sessions: [0, 1, 1, 2], ranks: [null, 1, 1, 1], totalSeconds: 10836 } as never;
    expect(weekCells(series)).toEqual([0, 1, 3, 6]);
    expect(weekCells(undefined)).toEqual([]);
  });
});

describe('the ink', () => {
  function pool(seed: number) {
    const f = new Fluid(30, 18);
    const d = scalar(f);
    const W = f.nx + 2;
    for (let j = 0; j <= f.ny + 1; j++) for (let i = 0; i <= f.nx + 1; i++) d.field[i + W * j] = j > 11 ? 1 : 0;
    const r = rng(seed);
    for (let k = 0; k < 4; k++) f.swirl(1 + r() * f.nx, 1 + r() * f.ny, 5, (k % 2 ? -1 : 1) * 1.5);
    return { f, d };
  }

  test('sharp advection never makes ink out of nothing, nor more than there was', () => {
    const { f, d } = pool(3);
    for (let k = 0; k < 60; k++) f.step(1, { carry: [d], sharp: true });
    let lo = Infinity, hi = -Infinity;
    for (const v of d.field) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  test('it leaves less haze than plain advection in the first second, when a row is looked at', () => {
    // fluid.ts advectSharp has the measurement: less haze at 10 and 30 steps, level by 60.
    const edgy = (sharp: boolean) => {
      const { f, d } = pool(5);
      for (let k = 0; k < 24; k++) f.step(1, { carry: [d], sharp, vorticity: 2, damping: 0.99 });
      // The share of cells neither ground nor ink: the haze the dither would print as dots.
      return d.field.filter((v) => v > 0.15 && v < 0.85).length / d.field.length;
    };
    expect(edgy(true)).toBeLessThan(edgy(false));
  });

  test('the same seed pours alike', () => {
    const a = pool(9), b = pool(9);
    for (let k = 0; k < 20; k++) {
      a.f.step(1, { carry: [a.d], sharp: true });
      b.f.step(1, { carry: [b.d], sharp: true });
    }
    expect(Array.from(a.d.field)).toEqual(Array.from(b.d.field));
  });
});
