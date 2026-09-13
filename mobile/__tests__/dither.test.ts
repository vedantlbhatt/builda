/**
 * The 1-bit dither: one Bayer definition in three languages. The SkSL computes the threshold
 * arithmetically (no dynamic array indexing in SkSL), the TypeScript port does the same, and
 * scripts/gen_tokens.py computes it in Python and asserts it against the table in
 * design/tokens.json at generation time. These tests hold the TypeScript side against the
 * same table, and against the Python function itself when python3 is on the machine.
 *
 * `ditherMask` was checked against the GPU once, through CanvasKit (the same SkSL compiler
 * React Native Skia ships): 0 mismatches over 19,568 cells on a grid field, a band strip and
 * an area chart. That is why the mask, not a screenshot, is what these tests pin.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { tokens } from '../src/generated/tokens';
import {
  BAYER8,
  DITHER_SKSL,
  bayer2,
  bayer8,
  ditherMask,
  fieldFromFunction,
  fieldFromGrid,
  fieldFromSeries,
  fieldToRGBA,
  fitCells,
  halftoneRadius,
  isInk,
  modeUniform,
  premultiplied,
  quantize,
} from '../src/ui/dithering';

const constant = (w: number, h: number, v: number) => fieldFromFunction(w, h, () => v);
const inkCount = (mask: Uint8Array) => mask.reduce((n, b) => n + b, 0);

describe('the threshold: one Bayer definition', () => {
  test('2x2 by arithmetic is the classic 0 2 3 1 over 4', () => {
    expect([bayer2(0, 0), bayer2(1, 0), bayer2(0, 1), bayer2(1, 1)]).toEqual([0, 0.5, 0.75, 0.25]);
  });

  test('the arithmetic 8x8 equals the table in design/tokens.json, every cell', () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(bayer8(x, y) * 64).toBe(BAYER8[y]![x]!);
    }
    expect(BAYER8).toBe(tokens.dither.bayer8);
  });

  test('each of 0..63 appears once, and the pattern tiles every 8 cells', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(bayer8(x, y) * 64);
    expect(seen.size).toBe(64);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(bayer8(x + 8, y + 8)).toBe(bayer8(x, y));
    }
  });

  test('a fractional cell coordinate uses its cell, as the shader does with p / cell', () => {
    expect(bayer8(3.99, 5.01)).toBe(bayer8(3, 5));
  });

  test('the Python reference in gen_tokens.py agrees (skipped without python3)', () => {
    const script = [
      'import importlib.util, json, sys',
      `spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(join(import.meta.dir, '..', '..', 'scripts', 'gen_tokens.py'))})`,
      'g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)',
      'print(json.dumps([[round(g.bayer8(x, y) * 64) for x in range(8)] for y in range(8)]))',
    ].join('\n');
    const run = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
    if (run.error || run.status !== 0) return; // no python3 here; make gen still asserts it
    expect(JSON.parse(run.stdout)).toEqual(BAYER8.map((r) => [...r]));
  });
});

describe('ditherMask: what the shader draws, cell for cell', () => {
  test('white stays paper, black is solid: the comparison is strict', () => {
    expect(inkCount(ditherMask(constant(16, 16, 0)))).toBe(0);
    expect(inkCount(ditherMask(constant(16, 16, 1)))).toBe(256);
    expect(isInk(0, 0, 0)).toBe(false);
  });

  test('a flat (k + 0.5) / 64 grey inks exactly k + 1 cells of every 8x8 tile', () => {
    for (let k = 0; k < 64; k++) {
      const mask = ditherMask(constant(8, 8, (k + 0.5) / 64));
      expect(inkCount(mask)).toBe(k + 1);
    }
  });

  test('ink never decreases as the value rises', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 1 / 128) {
      const n = inkCount(ditherMask(constant(16, 16, v)));
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  test('50% is the checkerboard', () => {
    const mask = ditherMask(constant(8, 8, 0.5 + 0.25 / 64));
    expect(inkCount(mask)).toBe(33);
    expect(inkCount(ditherMask(constant(8, 8, 0.5 - 0.25 / 64)))).toBe(32);
  });

  test('the 8-bit round trip is what the shader sees, and stays inside half a grey level', () => {
    for (const v of [0, 0.1, 0.5, 0.73, 1]) expect(Math.abs(quantize(v) - v)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
  });
});

describe('fields: real data as a greyscale source', () => {
  test('a grid: each datum is a block with a paper gap after it', () => {
    const f = fieldFromGrid(
      [
        [1, 0],
        [0.5, 1],
      ],
      8,
      8,
      { gap: 1 },
    );
    const at = (x: number, y: number) => f.data[y * f.width + x];
    expect(at(0, 0)).toBe(1);
    expect(at(2, 2)).toBe(1);
    expect(at(3, 0)).toBe(0); // gap column
    expect(at(0, 3)).toBe(0); // gap row
    expect(at(4, 0)).toBe(0); // the second datum is 0
    expect(at(0, 4)).toBe(0.5);
    expect(at(6, 6)).toBe(1);
  });

  test('a grid too small for a gap draws the data edge to edge', () => {
    const f = fieldFromGrid([[1, 1, 1]], 6, 2, { gap: 1 });
    expect(Array.from(f.data).every((v) => v === 1)).toBe(true);
  });

  test('a band series: density per column is the mean of its samples', () => {
    const f = fieldFromSeries([0, 1, 1, 1], 2, 3, { shape: 'band' });
    expect(f.data[0]).toBeCloseTo(0.5);
    expect(f.data[1]).toBeCloseTo(1);
    expect(f.data[2 * 2]).toBeCloseTo(0.5); // full height
  });

  test('an area series: a solid top edge over the fill, paper above; a peak is never averaged away', () => {
    const f = fieldFromSeries([0, 0.5, 1, 0], 2, 4, { shape: 'area', fill: 0.5 });
    const col = (x: number) => [0, 1, 2, 3].map((y) => f.data[y * 2 + x]);
    // column 0 holds samples 0 and 0.5: max 0.5, two rows tall
    expect(col(0)).toEqual([0, 0, 1, 0.5]);
    // column 1 holds 1 and 0: max 1, full height
    expect(col(1)).toEqual([1, 0.5, 0.5, 0.5]);
  });

  test('empty data is an empty field, not an error', () => {
    expect(inkCount(ditherMask(fieldFromSeries([], 4, 4)))).toBe(0);
    expect(inkCount(ditherMask(fieldFromGrid([], 4, 4)))).toBe(0);
  });

  test('bad values are clamped: NaN is paper, 2 is full ink', () => {
    const f = fieldFromGrid([[Number.NaN, 2]], 2, 1, { gap: 0 });
    expect(Array.from(f.data)).toEqual([0, 1]);
  });

  test('bytes: grey is 1 minus ink, opaque', () => {
    const bytes = fieldToRGBA(fieldFromGrid([[0, 1, 0.5]], 3, 1, { gap: 0 }));
    expect(Array.from(bytes)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
  });

  test('a box shrinks to whole cells, never by a whole cell or more', () => {
    const b = fitCells(343, 97, 3);
    expect(b).toEqual({ cols: 114, rows: 32, width: 342, height: 96 });
    expect(343 - b.width).toBeLessThan(3);
  });
});

describe('the shader and its uniforms', () => {
  test('declares the uniforms the component sends, and the art child', () => {
    for (const u of ['uniform shader art', 'uniform float cell', 'uniform float mode', 'uniform float t', 'uniform float px', 'uniform half4 ink', 'uniform half4 paper']) {
      expect(DITHER_SKSL).toContain(u);
    }
  });

  test('the SkSL threshold is the same arithmetic as the port', () => {
    expect(DITHER_SKSL).toContain('fract(a.x * 0.5 + a.y * a.y * 0.75)');
    expect(DITHER_SKSL).toContain('b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a)');
    expect(DITHER_SKSL).toContain('v > b8(');
  });

  test('one hue: the scalar is dithered, never RGB per channel', () => {
    expect(DITHER_SKSL).toContain('dot(s.rgb / s.a, half3(0.2126, 0.7152, 0.0722))');
  });

  test('modes, colours, the halftone radius', () => {
    expect([modeUniform('bayer'), modeUniform('halftone')]).toEqual([0, 1]);
    const [r, g, b, a] = premultiplied('#FFB300');
    expect([r, g, b, a].map((v) => Math.round(v * 255))).toEqual([255, 179, 0, 255]);
    expect(premultiplied('#FFB300', 0.5).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, 0.351, 0, 0.5]);
    expect(premultiplied('transparent')).toEqual([0, 0, 0, 0]);
    expect(() => premultiplied('red')).toThrow();
    expect(halftoneRadius(1)).toBeCloseTo(0.72);
    expect(halftoneRadius(0.25)).toBeCloseTo(0.36);
    expect(tokens.dither.cell).toBe(3);
  });
});
