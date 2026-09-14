/**
 * The shader backgrounds (`src/ui/bits/backgrounds`): seven react-bits fields ported to SkSL and
 * printed in three levels of one spectrum hue.
 *
 * Every program is compiled through CanvasKit (canvaskit-wasm is React Native Skia's own
 * dependency: the same SkSL compiler), fed exactly what the components send (`frameUniforms`,
 * the one call each component's derived value makes) and read back pixel by pixel. So these hold
 * what the phone would draw, not what the source says: only paper, partner and ink ever appear (no
 * gradient, no partial alpha, the brief's rule), every cell agrees with the JS twin, the one texel
 * per cell texture draws the cells the one pass draws, and the develop, the edge fade, the cleared
 * rect, the ripples, the shocks and the finger's pool do what DESIGN-V2 says. The rest is the pure
 * logic: the clock's pacing, the resolution plan, the tones, the tuning against react-bits' own
 * source (when the design refs are on the machine), and David Haz's notice in every file.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CanvasKit, RuntimeEffect } from 'canvaskit-wasm';

import { hasDash } from '../src/copy/plain';
import { hash12 as onboardingHash12 } from '../src/onboarding/shaders';
import { colors, creatureHue, hue, HUE_NAMES, type Scheme } from '../src/theme';
import { bayer8, premultiplied } from '../src/ui/dithering';
import * as motionSpec from '../src/ui/motionSpec';
import { GALLERY_NOTES, GALLERY_ORDER, galleryCaption } from '../src/ui/bits/backgrounds/copy';
import {
  BACKGROUND_NAMES,
  COMMON_UNIFORMS,
  PROGRAMS,
  UNIFORM_FLOATS,
  uniformFloatCount,
  type BackgroundName,
} from '../src/ui/bits/backgrounds/shaders';
import * as S from '../src/ui/bits/backgrounds/spec';
import { cellTone, hash12, toneIndex, TONE_DEAD_ZONE, type UniformBag } from '../src/ui/bits/backgrounds/twins';

// ─── CanvasKit ───────────────────────────────────────────────────────────────────────────

const CK_BIN = join(import.meta.dir, '..', 'node_modules', 'canvaskit-wasm', 'bin');
let ck: CanvasKit;
const compiled = new Map<BackgroundName, RuntimeEffect>();
const compileErrors = new Map<BackgroundName, string[]>();

beforeAll(async () => {
  const init = require(join(CK_BIN, 'canvaskit.js')) as (o: { locateFile: (f: string) => string }) => Promise<CanvasKit>;
  ck = await init({ locateFile: (f: string) => join(CK_BIN, f) });
  for (const name of BACKGROUND_NAMES) {
    const errors: string[] = [];
    const effect = ck.RuntimeEffect.Make(PROGRAMS[name].source, (e: string) => errors.push(e));
    compileErrors.set(name, errors);
    if (effect) compiled.set(name, effect);
  }
});

function effectOf(name: BackgroundName): RuntimeEffect {
  const e = compiled.get(name);
  if (!e) throw new Error(`${name} did not compile: ${compileErrors.get(name)?.join('\n')}`);
  return e;
}

/** React Native Skia's `processUniforms`: by the effect's own names and order. */
function flatten(effect: RuntimeEffect, u: UniformBag): number[] {
  const out: number[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const v = u[name];
    if (v === undefined) throw new Error(`uniform ${name} is missing`);
    if (typeof v === 'number') out.push(v);
    else out.push(...v);
  }
  return out;
}

interface Drawn {
  w: number;
  h: number;
  px: Uint8Array;
}

/** The program over a `w` x `h` canvas at one pixel per point, read back as RGBA. */
function draw(name: BackgroundName, u: UniformBag, w: number, h: number): Drawn {
  const effect = effectOf(name);
  const surface = ck.MakeSurface(w, h);
  if (!surface) throw new Error('no surface');
  const canvas = surface.getCanvas();
  canvas.clear(ck.Color(255, 0, 255, 1));
  const paint = new ck.Paint();
  paint.setBlendMode(ck.BlendMode.Src);
  const shader = effect.makeShader(flatten(effect, u));
  paint.setShader(shader);
  canvas.drawRect(ck.LTRBRect(0, 0, w, h), paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array;
  shader.delete();
  paint.delete();
  image.delete();
  surface.delete();
  return { w, h, px };
}

const key8 = (v: readonly number[]) => v.map((x) => Math.round(x * 255)).join(',');

const palettes = new WeakMap<UniformBag, Map<string, number>>();

/** The tone index of each colour a program may draw: paper 0, partner 1, ink 2, a resting dot 3. */
function palette(u: UniformBag): Map<string, number> {
  const known = palettes.get(u);
  if (known) return known;
  const m = new Map<string, number>();
  m.set(key8(u.paper as number[]), 0);
  m.set(key8(u.partner as number[]), 1);
  m.set(key8(u.ink as number[]), 2);
  if (u.base) m.set(key8(u.base as number[]), 3);
  palettes.set(u, m);
  return m;
}

function pixelKey(d: Drawn, x: number, y: number): string {
  const i = (y * d.w + x) * 4;
  return [d.px[i], d.px[i + 1], d.px[i + 2], d.px[i + 3]].join(',');
}

const CELL = 3;

/** The tone the GPU drew in cell (ix, iy): the pixel at the cell's centre. */
function drawnTone(d: Drawn, u: UniformBag, ix: number, iy: number): number {
  const k = pixelKey(d, ix * CELL + 1, iy * CELL + 1);
  return palette(u).get(k) ?? -1;
}

/**
 * Every whole cell's tone, drawn the cheap way: one texel per cell (`unit = cell`), which the
 * texture test below holds equal to the one pass, cell for cell. Indexed `[iy][ix]`.
 */
function cellTones(name: BackgroundName, u: UniformBag, w: number, h: number): number[][] {
  const cols = Math.floor(w / CELL);
  const rows = Math.floor(h / CELL);
  const d = draw(name, { ...u, unit: CELL }, cols, rows);
  const p = palette(u);
  const out: number[][] = [];
  for (let iy = 0; iy < rows; iy++) {
    const row: number[] = [];
    for (let ix = 0; ix < cols; ix++) row.push(p.get(pixelKey(d, ix, iy)) ?? -1);
    out.push(row);
  }
  return out;
}

function cellsOf(w: number, h: number) {
  const out: [number, number][] = [];
  for (let iy = 0; iy < Math.floor(h / CELL); iy++) for (let ix = 0; ix < Math.floor(w / CELL); ix++) out.push([ix, iy]);
  return out;
}

// ─── what the components send ────────────────────────────────────────────────────────────

interface Setup {
  width: number;
  height: number;
  scheme?: Scheme;
  hue?: Parameters<typeof S.resolveTones>[1];
  levels?: 2 | 3;
  edgeFade?: number;
  clear?: S.ClearRect | null;
  own?: Record<string, unknown>;
}

/** `common` and the component's own uniforms, as the component memoises them (paper opaque). */
function fixedFor(name: BackgroundName, s: Setup): Record<string, number | S.Vec> {
  const scheme = s.scheme ?? 'dark';
  const c = colors(scheme);
  const tones = { ...S.resolveTones(scheme, s.hue, S.DEFAULT_HUE[name]), paper: c.bg };
  const common = S.commonUniforms({
    width: s.width,
    height: s.height,
    cell: CELL,
    levels: s.levels,
    edgeFade: s.edgeFade ?? (name === 'PixelBlast' ? S.PIXEL_BLAST.edgeFade : 0),
    clear: s.clear,
    tones,
  });
  const o = (s.own ?? {}) as never;
  const own: Record<string, number | S.Vec> = (() => {
    switch (name) {
      case 'FieldDither':
        return S.ditherWavesUniforms(o);
      case 'PixelBlast':
        return S.pixelBlastUniforms(o);
      case 'Silk':
        return S.silkUniforms(o);
      case 'Grainient':
        return S.grainientUniforms(o);
      case 'Radar':
        return S.radarUniforms({ width: s.width, height: s.height, ...(s.own ?? {}) });
      case 'Topography':
        return S.topographyUniforms(o);
      case 'DotGrid':
        return S.dotGridUniforms({ width: s.width, height: s.height, cell: CELL, base: c.border, ...(s.own ?? {}) });
    }
  })();
  return { ...common, ...own } as Record<string, number | S.Vec>;
}

function frameFor(name: BackgroundName, s: Setup, f: Partial<S.FrameInputs> = {}): UniformBag {
  return S.frameUniforms(name, fixedFor(name, s), { t: 0, now: 0, reveal: 1, ...f });
}

/** A lively frame for each program: some time, a tap, a shock, a finger. */
function livelyFrame(name: BackgroundName, w: number, h: number, t: number, scheme: Scheme = 'dark', hueName?: (typeof HUE_NAMES)[number]): UniformBag {
  const s: Setup = { width: w, height: h, scheme, hue: hueName };
  switch (name) {
    case 'PixelBlast':
      return frameFor(name, s, { t, now: 1.2, taps: [[w * 0.5, h * 0.5, 0.2, 1]] });
    case 'DotGrid':
      return frameFor(name, s, { now: 0.25, taps: [[w * 0.4, h * 0.5, 0, 1]], touch: [w * 0.8, h * 0.3, 1] });
    case 'FieldDither':
    case 'Topography':
      return frameFor(name, s, { t, touch: [w * 0.3, h * 0.4, 0.8] });
    default:
      return frameFor(name, s, { t });
  }
}

// ─── the programs ────────────────────────────────────────────────────────────────────────

describe('the programs', () => {
  test('every program compiles in the SkSL compiler React Native Skia ships', () => {
    for (const name of BACKGROUND_NAMES) {
      expect(compileErrors.get(name)).toEqual([]);
      expect(compiled.has(name)).toBe(true);
    }
    expect(BACKGROUND_NAMES).toEqual(['FieldDither', 'PixelBlast', 'Silk', 'Grainient', 'Radar', 'Topography', 'DotGrid']);
  });

  test('the declared uniforms are the table, in order, with the sizes the table says', () => {
    for (const name of BACKGROUND_NAMES) {
      const effect = effectOf(name);
      const layout = PROGRAMS[name].uniforms;
      expect(effect.getUniformCount()).toBe(layout.length);
      layout.forEach(([n, kind], i) => {
        expect(effect.getUniformName(i)).toBe(n);
        const u = effect.getUniform(i);
        expect(u.columns * u.rows).toBe(UNIFORM_FLOATS[kind]);
      });
      expect(effect.getUniformFloatCount()).toBe(uniformFloatCount(layout));
      expect(layout.slice(0, COMMON_UNIFORMS.length)).toEqual([...COMMON_UNIFORMS]);
    }
  });

  test('what each component sends covers every uniform with the right number of floats (Skia throws on a missing one)', () => {
    for (const name of BACKGROUND_NAMES) {
      const u = livelyFrame(name, 120, 90, 1);
      for (const [n, kind] of PROGRAMS[name].uniforms) {
        const v = u[n];
        expect(v === undefined ? `${name}.${n} missing` : n).toBe(n);
        expect(typeof v === 'number' ? 1 : (v as readonly number[]).length).toBe(UNIFORM_FLOATS[kind]);
      }
    }
  });

  test('no sine hash anywhere, and the threshold is fixed to the screen (DESIGN-V2 1.4)', () => {
    for (const name of BACKGROUND_NAMES) {
      const src = PROGRAMS[name].source;
      expect(src).not.toMatch(/fract\s*\(\s*sin\s*\(/);
      expect(src).not.toMatch(/b8\([^)]*\+\s*t/);
      expect(src).toMatch(/b8\((idx|g)\)/);
    }
  });

  test('no smoothstep with reversed edges (undefined on Metal)', () => {
    for (const name of BACKGROUND_NAMES) {
      for (const m of PROGRAMS[name].source.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        expect(Number(m[1])).toBeLessThan(Number(m[2]));
      }
    }
  });

  test('each program names the react-bits file it was ported from', () => {
    for (const name of BACKGROUND_NAMES) expect(PROGRAMS[name].reactBits).toMatch(/^Backgrounds\/\w+\/\w+\.tsx$/);
  });
});

// ─── what they draw ──────────────────────────────────────────────────────────────────────

describe('what they draw', () => {
  test('only paper, partner and ink ever appear: no gradient, no partial alpha, in both schemes', () => {
    const w = 96;
    const h = 72;
    for (const name of BACKGROUND_NAMES) {
      for (const scheme of ['dark', 'light'] as const) {
        for (const t of [0, 7.3]) {
          const u = livelyFrame(name, w, h, t, scheme, 'cobalt');
          const allowed = palette(u);
          const d = draw(name, u, w, h);
          const seen = new Set<string>();
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) seen.add(pixelKey(d, x, y));
          const strays = [...seen].filter((k) => !allowed.has(k) || !k.endsWith(',255'));
          expect(strays.length === 0 ? name : `${name} ${scheme} t=${t}: ${strays.slice(0, 4).join(' | ')}`).toBe(name);
        }
      }
    }
  });

  test('a whole cell is one tone: the grain is the 3 pt cell, never a pixel', () => {
    for (const name of BACKGROUND_NAMES) {
      const u = livelyFrame(name, 90, 60, 2);
      const d = draw(name, u, 90, 60);
      for (const [ix, iy] of cellsOf(90, 60)) {
        const first = pixelKey(d, ix * CELL, iy * CELL);
        for (let dy = 0; dy < CELL; dy++) for (let dx = 0; dx < CELL; dx++) expect(pixelKey(d, ix * CELL + dx, iy * CELL + dy)).toBe(first);
      }
    }
  });

  test('the GPU draws what the JS twins say, cell by cell (at least 99%: doubles against 32 bit floats)', () => {
    const w = 150;
    const h = 108;
    for (const name of BACKGROUND_NAMES) {
      const u = livelyFrame(name, w, h, 2.5);
      const d = draw(name, u, w, h);
      let agree = 0;
      const cells = cellsOf(w, h);
      for (const [ix, iy] of cells) if (drawnTone(d, u, ix, iy) === cellTone(name, u, ix, iy)) agree++;
      expect([name, agree / cells.length >= 0.99]).toEqual([name, true]);
    }
  });

  test('every field at its defaults puts something on a hero band and leaves paper around it', () => {
    const w = 390;
    const h = 240;
    for (const name of BACKGROUND_NAMES) {
      const u = frameFor(name, { width: w, height: h }, { t: 3 });
      const tones = cellTones(name, u, w, h).flat();
      const counts = [0, 0, 0, 0];
      for (const t of tones) counts[t]!++;
      const marked = (counts[1]! + counts[2]! + counts[3]!) / tones.length;
      const cells = tones;
      expect([name, marked > 0.02, counts[0]! / cells.length > 0.02, counts.includes(-1)]).toEqual([name, true, true, false]);
    }
  });

  test('two levels is ink over paper: no partner anywhere', () => {
    for (const name of BACKGROUND_NAMES) {
      const u = frameFor(name, { width: 150, height: 90, levels: 2 }, { t: 1.5 });
      const tones = cellTones(name, u, 150, 90).flat();
      expect(tones.includes(1) || tones.includes(-1)).toBe(false);
      expect(tones.includes(name === 'DotGrid' ? 3 : 2)).toBe(true);
    }
  });

  test('the one texel per cell texture draws exactly the cells the one pass draws', () => {
    const w = 120;
    const h = 90;
    for (const name of BACKGROUND_NAMES) {
      const u = livelyFrame(name, w, h, 4);
      const pass = draw(name, u, w, h);
      const plan = S.planField(w, h, CELL, 'texture');
      const tex = draw(name, { ...u, unit: CELL }, plan.cols, plan.rows);
      let differ = 0;
      for (const [ix, iy] of cellsOf(w, h)) {
        if ((palette(u).get(pixelKey(tex, ix, iy)) ?? -1) !== drawnTone(pass, u, ix, iy)) differ++;
      }
      expect(`${name}: ${differ}`).toBe(`${name}: 0`);
    }
  });

  test('the same seed draws the same frame every time (a still is deterministic)', () => {
    for (const name of BACKGROUND_NAMES) {
      const u = frameFor(name, { width: 60, height: 45 }, { t: 5 });
      expect(Buffer.from(draw(name, u, 60, 45).px).equals(Buffer.from(draw(name, u, 60, 45).px))).toBe(true);
    }
  });
});

// ─── the frame: develop, edge fade, the cleared rect ────────────────────────────────────

describe('the frame', () => {
  test('reveal 0 is all paper and the develop only ever switches cells on, in Bayer order', () => {
    const w = 120;
    const h = 90;
    const steps = [0, 0.2, 0.45, 0.7, 1];
    const tones = steps.map((r) => cellTones('FieldDither', frameFor('FieldDither', { width: w, height: h }, { t: 2, reveal: r }), w, h).flat());
    expect(tones[0]!.every((v) => v === 0)).toBe(true);
    for (let s = 1; s < steps.length; s++) {
      tones[s]!.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(tones[s - 1]![i]!));
    }
    const lit = tones.map((ts) => ts.filter((v) => v > 0).length);
    expect(lit[4]!).toBeGreaterThan(lit[1]!);
  });

  test('a cleared rect, grown by one cell, is paper, and nothing outside it changes', () => {
    const w = 150;
    const h = 120;
    const clear = { x: 51, y: 42, width: 48, height: 36 };
    const own = { density: 1.4 };
    const plain = frameFor('PixelBlast', { width: w, height: h, edgeFade: 0, own }, { t: 2 });
    const cleared = frameFor('PixelBlast', { width: w, height: h, edgeFade: 0, own, clear }, { t: 2 });
    const a = cellTones('PixelBlast', plain, w, h);
    const b = cellTones('PixelBlast', cleared, w, h);
    let inside = 0;
    for (const [ix, iy] of cellsOf(w, h)) {
      const cx = (ix + 0.5) * CELL;
      const cy = (iy + 0.5) * CELL;
      const within = cx >= clear.x - CELL && cx <= clear.x + clear.width + CELL && cy >= clear.y - CELL && cy <= clear.y + clear.height + CELL;
      if (within) {
        inside++;
        expect(b[iy]![ix]).toBe(0);
      } else {
        expect(b[iy]![ix]).toBe(a[iy]![ix]!);
      }
    }
    expect(inside).toBe(18 * 14);
    expect(S.clearRectUniform(clear, CELL)).toEqual([48, 39, 54, 42]);
  });

  test('the edge fade thins the field to paper at the edge and leaves the middle alone', () => {
    const w = 150;
    const h = 150;
    const own = { density: 1.6 };
    const faded = frameFor('PixelBlast', { width: w, height: h, edgeFade: 0.5, own }, { t: 1 });
    const flat = frameFor('PixelBlast', { width: w, height: h, edgeFade: 0, own }, { t: 1 });
    const d = cellTones('PixelBlast', faded, w, h);
    const e = cellTones('PixelBlast', flat, w, h);
    const n = Math.floor(w / CELL);
    let rim = 0;
    let rimFlat = 0;
    for (let i = 0; i < n; i++) {
      for (const [ix, iy] of [
        [i, 0],
        [0, i],
        [i, n - 1],
        [n - 1, i],
      ] as const) {
        rim += d[iy]![ix]! > 0 ? 1 : 0;
        rimFlat += e[iy]![ix]! > 0 ? 1 : 0;
      }
    }
    expect(rim).toBe(0);
    expect(rimFlat).toBeGreaterThan(0);
  });

  test('a value under half a Bayer step is paper, so a faded edge never speckles on the zero threshold', () => {
    expect(TONE_DEAD_ZONE).toBe(1 / 128);
    expect(toneIndex(TONE_DEAD_ZONE * 0.99, 0, 3)).toBe(0);
    expect(toneIndex(TONE_DEAD_ZONE * 0.99, 0, 2)).toBe(0);
    expect(toneIndex(TONE_DEAD_ZONE * 1.01, 0, 3)).toBe(1);
  });

  test('the three levels: a flat 0 is paper, 0.5 solid partner, 1 solid ink, and between them the Bayer shares', () => {
    const share = (v: number, levels: number) => {
      const c = [0, 0, 0];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c[toneIndex(v, bayer8(x, y), levels)]!++;
      return c;
    };
    expect(share(0, 3)).toEqual([64, 0, 0]);
    expect(share(0.5, 3)).toEqual([0, 64, 0]);
    expect(share(1, 3)).toEqual([0, 0, 64]);
    expect(share(0.25, 3)).toEqual([32, 32, 0]);
    expect(share(0.75, 3)).toEqual([0, 32, 32]);
    expect(share(0.5, 2)).toEqual([32, 0, 32]);
  });
});

// ─── fingers ─────────────────────────────────────────────────────────────────────────────

describe('fingers', () => {
  const diff = (name: BackgroundName, a: UniformBag, b: UniformBag, w: number, h: number) => {
    const ta = cellTones(name, a, w, h);
    const tb = cellTones(name, b, w, h);
    return cellsOf(w, h).filter(([ix, iy]) => ta[iy]![ix] !== tb[iy]![ix]);
  };

  test('PixelBlast: a tap sends a ring out from where it landed, and it is gone after RIPPLE_LIFE_S', () => {
    const w = 180;
    const h = 180;
    const s: Setup = { width: w, height: h, edgeFade: 0, own: { density: 0 } };
    const start = 1;
    const tap: S.Vec = [90, 90, start, 1];
    const calm = frameFor('PixelBlast', s, { t: 0, now: start + 0.8 });
    const rippled = frameFor('PixelBlast', s, { t: 0, now: start + 0.8, taps: [tap] });
    const changed = diff('PixelBlast', calm, rippled, w, h);
    expect(changed.length).toBeGreaterThan(20);
    // the ring is around the tap: radius rippleSpeed x age on the ripple clock, in 300 pt units
    const radius = S.PIXEL_BLAST.rippleSpeed * 0.8 * S.PIXEL_BLAST.rippleRate * S.PIXEL_BLAST.ref;
    const mean = changed.reduce((a, [ix, iy]) => a + Math.hypot((ix + 0.5) * CELL - 90, (iy + 0.5) * CELL - 90), 0) / changed.length;
    expect(Math.abs(mean - radius)).toBeLessThan(S.PIXEL_BLAST.rippleThickness * S.PIXEL_BLAST.ref);
    const gone = frameFor('PixelBlast', s, { t: 0, now: start + S.RIPPLE_LIFE_S + 0.05, taps: [tap] });
    const calmLater = frameFor('PixelBlast', s, { t: 0, now: start + S.RIPPLE_LIFE_S + 0.05 });
    expect(diff('PixelBlast', calmLater, gone, w, h)).toEqual([]);
  });

  test('FieldDither: the finger carves a pool in the wave, and only near it', () => {
    const w = 180;
    const h = 150;
    const base = frameFor('FieldDither', { width: w, height: h }, { t: 3 });
    const pooled = frameFor('FieldDither', { width: w, height: h }, { t: 3, touch: [90, 75, 1] });
    const a = cellTones('FieldDither', base, w, h);
    const b = cellTones('FieldDither', pooled, w, h);
    let near = 0;
    let nearPooled = 0;
    for (const [ix, iy] of cellsOf(w, h)) {
      const d = Math.hypot((ix + 0.5) * CELL - 90, (iy + 0.5) * CELL - 75);
      const ta = a[iy]![ix]!;
      const tb = b[iy]![ix]!;
      if (d < 40) {
        near += ta;
        nearPooled += tb;
      }
      expect(tb).toBeLessThanOrEqual(ta);
      if (d > S.DITHER_WAVES.touchRadius * S.DITHER_WAVES.ref + CELL) expect(tb).toBe(ta);
    }
    expect(nearPooled).toBeLessThan(near);
  });

  test('Topography: a finger raises a hill that moves the contours under it and not far away', () => {
    const w = 300;
    const h = 120;
    const flat = frameFor('Topography', { width: w, height: h }, { t: 2 });
    const hill = frameFor('Topography', { width: w, height: h }, { t: 2, touch: [40, 60, 1] });
    const changed = diff('Topography', flat, hill, w, h);
    expect(changed.length).toBeGreaterThan(10);
    // four radii out the bump is 0.4 e^-16: nothing moves
    const far = S.TOPOGRAPHY.touchRadius * 4 * h;
    expect(w - 40).toBeGreaterThan(far + 30);
    for (const [ix, iy] of changed) expect(Math.hypot((ix + 0.5) * CELL - 40, (iy + 0.5) * CELL - 60)).toBeLessThan(far);
  });

  test('DotGrid: at rest every dot sits on its home cell in `base`; nothing else is drawn', () => {
    const w = 150;
    const h = 99;
    const u = frameFor('DotGrid', { width: w, height: h });
    const tones = cellTones('DotGrid', u, w, h);
    const g = S.dotGridLayout(w, h, CELL);
    const home = new Set<string>();
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) home.add(`${g.origin[0]! + c * g.pitch},${g.origin[1]! + r * g.pitch}`);
    for (const [ix, iy] of cellsOf(w, h)) expect(tones[iy]![ix]).toBe(home.has(`${ix},${iy}`) ? 3 : 0);
  });

  test('DotGrid: a tap shoves the dots out and lights them, and they settle home by rise + settle', () => {
    const w = 180;
    const h = 150;
    const s: Setup = { width: w, height: h };
    const rest = frameFor('DotGrid', s);
    const shock: S.Vec = [90, 75, 1, 1];
    const peak = frameFor('DotGrid', s, { now: 1 + S.DOT_GRID.rise, taps: [shock] });
    const tones = cellTones('DotGrid', peak, w, h);
    const g = S.dotGridLayout(w, h, CELL);
    let lit = 0;
    let moved = 0;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const ix = g.origin[0]! + c * g.pitch;
        const iy = g.origin[1]! + r * g.pitch;
        const t = tones[iy]![ix]!;
        if (t === 1 || t === 2) lit++;
        if (t === 0) moved++;
      }
    }
    expect(lit).toBeGreaterThan(5);
    expect(moved).toBeGreaterThan(5);
    const settled = frameFor('DotGrid', s, { now: 1 + S.DOT_GRID.rise + S.DOT_GRID.settle + 0.01, taps: [shock] });
    expect(diff('DotGrid', rest, settled, w, h)).toEqual([]);
  });

  test('DotGrid: the finger lights the dots near it and none beyond `proximity`', () => {
    const w = 240;
    const h = 150;
    const touched = frameFor('DotGrid', { width: w, height: h }, { touch: [30, 30, 1] });
    const tones = cellTones('DotGrid', touched, w, h);
    let near = 0;
    for (const [ix, iy] of cellsOf(w, h)) {
      const t = tones[iy]![ix]!;
      if (t !== 1 && t !== 2) continue;
      near++;
      expect(Math.hypot((ix + 0.5) * CELL - 30, (iy + 0.5) * CELL - 30)).toBeLessThan(S.DOT_GRID.proximity + CELL);
    }
    expect(near).toBeGreaterThan(3);
  });

  test('the tap ring keeps four slots and overwrites the oldest', () => {
    let taps: S.Vec[] = [S.NO_TAP, S.NO_TAP, S.NO_TAP, S.NO_TAP];
    let next = 0;
    for (let i = 0; i < 6; i++) ({ taps, next } = S.pushTap(taps, next, i, i * 2, i * 0.5));
    expect(taps.map((t) => t[0])).toEqual([4, 5, 2, 3]);
    expect(taps.every((t) => t[3] === 1)).toBe(true);
    expect(next).toBe(2);
    expect(S.pushTap(taps, next, 9, 9, 9, 0.45).taps[2]).toEqual([9, 9, 9, 0.45]);
  });
});

// ─── the clock ───────────────────────────────────────────────────────────────────────────

describe('the clock', () => {
  const run = (frames: number, dt: number, fps: number, live = true) => {
    let s = { real: 0, since: 0 };
    let published = 0;
    for (let i = 0; i < frames; i++) {
      const tick = S.clockStep(s, i === 0 ? null : dt, fps, live);
      s = { real: tick.real, since: tick.since };
      if (tick.publish) published++;
    }
    return { published, real: s.real };
  };

  test('AMBIENT is the design: 20 fps at react-bits speeds x 0.3, and motionSpec agrees the day it carries it', () => {
    expect(S.AMBIENT).toEqual({ fps: 20, speed: 0.3 });
    expect(S.REVEAL_MS).toBe(500);
    const spec = motionSpec as unknown as Record<string, unknown>;
    if ('AMBIENT' in spec) expect(spec.AMBIENT).toEqual(S.AMBIENT);
    if ('REVEAL_MS' in spec) expect(spec.REVEAL_MS).toBe(S.REVEAL_MS);
  });

  test('20 fps on a 60 Hz display is every third frame, on 120 Hz every sixth, never an uneven fourth', () => {
    expect(run(61, 1000 / 60, 20).published).toBe(20);
    expect(run(121, 1000 / 120, 20).published).toBe(20);
    expect(run(61, 1000 / 60, 30).published).toBe(30);
    // jitter around 16.67 ms still lands on every third frame
    let s = { real: 0, since: 0 };
    const at: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const tick = S.clockStep(s, i % 2 ? 16.6 : 16.74, 20, true);
      s = { real: tick.real, since: tick.since };
      if (tick.publish) at.push(i);
    }
    expect(at).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });

  test('the first frame and a hitch never jump the field: dt null is 0, and a frame counts at most 100 ms', () => {
    expect(S.clockStep({ real: 0, since: 0 }, null, 20, true)).toEqual({ dt: 0, real: 0, since: 0, publish: false });
    const hitch = S.clockStep({ real: 1000, since: 10 }, 2000, 20, true);
    expect(hitch.dt).toBe(S.MAX_FRAME_DT_MS);
    expect(hitch.real).toBe(1000 + S.MAX_FRAME_DT_MS);
    expect(hitch.publish).toBe(true);
    expect(hitch.since).toBe(0);
  });

  test('a field that neither moves nor has a ripple alive never publishes, while its running time still counts', () => {
    const r = run(120, 1000 / 60, 20, false);
    expect(r.published).toBe(0);
    expect(r.real).toBeCloseTo((119 * 1000) / 60, 6);
    expect(S.clockStep({ real: 0, since: 40 }, 16, 20, false).since).toBe(0);
  });

  test('field time integrates rate times speed: a speed change bends the pace, speed 0 holds the frame', () => {
    let t = 2;
    for (let i = 0; i < 600; i++) t = S.advanceField(t, 1000 / 60, 0.3, 1);
    expect(t).toBeCloseTo(2 + 10 * 0.3, 10);
    const before = t;
    t = S.advanceField(t, 1000 / 60, 0.3, 4);
    expect(t - before).toBeCloseTo((0.3 * 4) / 60, 10);
    expect(S.advanceField(t, 1000 / 60, 0.3, 0)).toBe(t);
  });

  test('ambient fields run react-bits clocks x 0.3; the radar keeps its own; the dot grid has none', () => {
    expect(S.RATE.FieldDither).toBeCloseTo(0.3, 10);
    expect(S.RATE.PixelBlast).toBeCloseTo(0.3 * 0.5, 10);
    expect(S.RATE.Silk).toBeCloseTo(0.3 * 0.1, 10);
    expect(S.RATE.Grainient).toBeCloseTo(0.3, 10);
    expect(S.RATE.Topography).toBeCloseTo(0.3, 10);
    expect(S.RATE.Radar).toBe(1);
    expect(S.RATE.DotGrid).toBe(0);
    // a radar turn: 2 pi / (sweepSpeed x rate) seconds
    expect((2 * Math.PI) / (S.RADAR.sweepSpeed * S.RATE.Radar)).toBeCloseTo(6.28, 2);
  });
});

// ─── the plan ────────────────────────────────────────────────────────────────────────────

describe('the resolution plan', () => {
  test('a hero band draws in one pass; a full screen draws one texel per cell', () => {
    const band = S.planField(390, 300, 3);
    expect(band).toEqual({ path: 'pass', cols: 130, rows: 100, large: false });
    const screen = S.planField(393, 852, 3);
    expect(screen.path).toBe('texture');
    expect([screen.cols, screen.rows]).toEqual([131, 284]);
    expect(390 * 300).toBeLessThan(S.LARGE_FIELD_PT2);
    expect(393 * 852).toBeGreaterThan(S.LARGE_FIELD_PT2);
  });

  test('a forced path is honoured, a partial cell is still a texel, and a zero box is one cell', () => {
    expect(S.planField(390, 300, 3, 'texture').path).toBe('texture');
    expect(S.planField(393, 852, 3, 'pass').path).toBe('pass');
    expect(S.planField(10, 10, 3)).toMatchObject({ cols: 4, rows: 4 });
    expect(S.planField(0, 0, 3)).toMatchObject({ cols: 1, rows: 1, large: false });
  });

  test('a large field drawn in one pass cuts its octaves to 2 (DESIGN-V2 3.3); anything else keeps them', () => {
    expect(S.PASS_OCTAVE_CAP).toBe(2);
    expect(S.octavesFor(5, { path: 'pass', large: true })).toBe(2);
    expect(S.octavesFor(5, { path: 'texture', large: true })).toBe(5);
    expect(S.octavesFor(4, { path: 'pass', large: false })).toBe(4);
    expect(S.clampOctaves(9, 4, 4)).toBe(4);
    expect(S.clampOctaves(0, 4, 4)).toBe(1);
    expect(S.clampOctaves(undefined, 4, 4)).toBe(4);
  });
});

// ─── tones ───────────────────────────────────────────────────────────────────────────────

describe('tones', () => {
  test('a hue name resolves through theme.ts in each scheme: ink and partner, paper transparent', () => {
    for (const scheme of ['dark', 'light'] as const) {
      for (const name of HUE_NAMES) {
        const t = S.resolveTones(scheme, name, 'amber');
        expect(t).toEqual({ ink: hue(name, scheme).ink, partner: hue(name, scheme).partner, paper: 'transparent' });
      }
    }
  });

  test('a resolved Hue is taken as given, an unknown name falls back, and each tone can be overridden', () => {
    const fox = creatureHue('fox', 'light');
    expect(S.resolveTones('dark', fox, 'amber')).toEqual({ ink: fox.ink, partner: fox.partner, paper: 'transparent' });
    expect(S.resolveTones('dark', 'mauve' as never, 'tide').ink).toBe(hue('tide').ink);
    expect(S.resolveTones('dark', undefined, 'iris').partner).toBe(hue('iris').partner);
    expect(S.resolveTones('dark', 'amber', 'amber', { paper: '#141210', ink: '#FFFFFF' })).toEqual({
      ink: '#FFFFFF',
      partner: hue('amber').partner,
      paper: '#141210',
    });
  });

  test('every default hue is a spectrum hue; Bit’s amber for hello and pairing, as the design says', () => {
    for (const name of BACKGROUND_NAMES) expect(HUE_NAMES).toContain(S.DEFAULT_HUE[name]);
    expect(S.DEFAULT_HUE.PixelBlast).toBe('amber');
    expect(S.DEFAULT_HUE.Radar).toBe('amber');
  });

  test('the common uniforms: premultiplied tones, the clear rect grown one cell, three levels unless two', () => {
    const tones = { ink: '#FFB300', partner: '#D07506', paper: 'transparent' };
    const u = S.commonUniforms({ width: 200, height: 100, cell: 3, tones, clear: { x: 10, y: 20, width: 64, height: 64 } });
    expect(u.ink).toEqual(premultiplied('#FFB300'));
    expect(u.paper).toEqual([0, 0, 0, 0]);
    expect(u.clearRect).toEqual([7, 17, 70, 70]);
    expect(u.levels).toBe(3);
    expect(u.reveal).toBe(1);
    expect(u.unit).toBe(1);
    expect(S.commonUniforms({ width: 1, height: 1, cell: 3, tones, levels: 2 }).levels).toBe(2);
    expect(S.clearRectUniform(null, 3)).toEqual([0, 0, 0, 0]);
    expect(S.clearRectUniform({ x: 0, y: 0, width: 0, height: 10 }, 3)).toEqual([0, 0, 0, 0]);
  });
});

// ─── tuning ──────────────────────────────────────────────────────────────────────────────

describe('tuning', () => {
  const REF = join(import.meta.dir, '..', '..', '..', 'design-refs', 'react-bits', 'src', 'ts-default', 'Backgrounds');
  const src = (name: string) => {
    const p = join(REF, name, `${name}.tsx`);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  /** A destructured default: a line reading `  prop = 0.5,`. */
  const dflt = (text: string, prop: string) => {
    const m = new RegExp(`^\\s*${prop}\\s*=\\s*(-?[\\d.]+),?\\s*$`, 'm').exec(text);
    return m ? Number(m[1]) : NaN;
  };

  test('the numbers kept from react-bits are react-bits’ own (read from its source when it is on this machine)', () => {
    const dither = src('Dither');
    if (dither) {
      expect(dflt(dither, 'waveSpeed')).toBe(S.DITHER_WAVES.waveSpeed);
      expect(dflt(dither, 'waveFrequency')).toBe(S.DITHER_WAVES.waveFrequency);
      expect(dflt(dither, 'waveAmplitude')).toBe(S.DITHER_WAVES.waveAmplitude);
      expect(dither).toContain(`const int OCTAVES = ${S.DITHER_WAVES.octaves};`);
    }
    const blast = src('PixelBlast');
    if (blast) {
      expect(dflt(blast, 'patternScale')).toBe(S.PIXEL_BLAST.patternScale);
      expect(dflt(blast, 'patternDensity')).toBe(S.PIXEL_BLAST.density);
      expect(dflt(blast, 'edgeFade')).toBe(S.PIXEL_BLAST.edgeFade);
      expect(dflt(blast, 'rippleSpeed')).toBe(S.PIXEL_BLAST.rippleSpeed);
      expect(dflt(blast, 'rippleThickness')).toBe(S.PIXEL_BLAST.rippleThickness);
      expect(dflt(blast, 'speed')).toBe(S.PIXEL_BLAST.rippleRate);
      expect(blast).toContain(`#define FBM_OCTAVES     ${S.PIXEL_BLAST.octaves}`);
      expect(blast).toContain('#define FBM_LACUNARITY  1.25');
      expect(blast).toContain('float cellPixelSize = 8.0 * pixelSize;');
    }
    const silk = src('Silk');
    if (silk) {
      expect(dflt(silk, 'noiseIntensity')).toBe(S.SILK.noiseIntensity);
      expect(dflt(silk, 'rotation')).toBe(S.SILK.rotation);
      expect(dflt(silk, 'speed')).toBe(5);
    }
    const grain = src('Grainient');
    if (grain) {
      const web: Record<string, number> = S.GRAINIENT_WEB;
      for (const [k, v] of Object.entries(S.GRAINIENT)) expect(`${k} ${dflt(grain, k)}`).toBe(`${k} ${k in web ? web[k] : v}`);
    }
    const radar = src('Radar');
    if (radar) {
      for (const [k, v] of Object.entries(S.RADAR)) {
        if (k === 'sweepWidth') expect(dflt(radar, k)).toBe(2);
        else expect(`${k} ${dflt(radar, k)}`).toBe(`${k} ${v}`);
      }
      expect(dflt(radar, 'scale')).toBe(0.5);
    }
    const topo = src('Topography');
    if (topo) {
      expect(dflt(topo, 'speed')).toBe(S.TOPOGRAPHY.speed);
      expect(dflt(topo, 'morphAmount')).toBe(S.TOPOGRAPHY.morphAmount);
      expect(dflt(topo, 'morphSpeed')).toBe(S.TOPOGRAPHY.morphSpeed);
      expect(dflt(topo, 'glow')).toBe(S.TOPOGRAPHY.glow);
      expect(dflt(topo, 'contrast')).toBe(S.TOPOGRAPHY.contrast);
      expect(dflt(topo, 'mouseRadius')).toBe(S.TOPOGRAPHY.touchRadius);
      expect(dflt(topo, 'mouseStrength')).toBe(S.TOPOGRAPHY.touchStrength);
      expect(dflt(topo, 'bands')).toBe(2);
      const rows = S.TOPOGRAPHY_CTRL_INDICES.map((r) => `[${r.join(', ')}]`);
      for (const r of rows) expect(topo).toContain(r);
    }
    const grid = src('DotGrid');
    if (grid) {
      expect(dflt(grid, 'returnDuration')).toBe(S.DOT_GRID.settle);
      expect(dflt(grid, 'speedTrigger')).toBe(S.DOT_GRID.speedTrigger);
      expect(grid).toContain("ease: 'elastic.out(1,0.75)'");
    }
  });

  test('Topography’s control points are react-bits’ loop: morphAmount sin(time speed sin(i morphSpeed) + i)', () => {
    for (const time of [0, 1.7, 42]) {
      const got = S.topographyCtrl(time);
      S.TOPOGRAPHY_CTRL_INDICES.forEach((row, g) =>
        row.forEach((i, j) => expect(got[g]![j]!).toBeCloseTo(3 * Math.sin(time * 0.35 * Math.sin(i * 0.05) + i), 12)),
      );
    }
  });

  test('elastic.out(1, 0.75) is GSAP’s, and a dot’s envelope rises, overshoots once and rests at 0', () => {
    expect(S.elasticOut(0)).toBe(0);
    expect(S.elasticOut(1)).toBe(1);
    // GSAP: 2^(-10p) sin((p - p/4) 2pi / 0.75) + 1, with p/4 = 0.1875
    for (const p of [0.1, 0.3, 0.55, 0.9]) {
      expect(S.elasticOut(p)).toBeCloseTo(Math.pow(2, -10 * p) * Math.sin(((p - 0.1875) * 2 * Math.PI) / 0.75) + 1, 12);
    }
    expect(S.dotEnvelope(-1)).toBe(0);
    expect(S.dotEnvelope(0)).toBe(0);
    expect(S.dotEnvelope(S.DOT_GRID.rise)).toBeCloseTo(1, 12);
    expect(S.dotEnvelope(S.DOT_GRID.rise + S.DOT_GRID.settle)).toBe(0);
    let min = 1;
    for (let a = S.DOT_GRID.rise; a < S.DOT_GRID.rise + S.DOT_GRID.settle; a += 0.01) min = Math.min(min, S.dotEnvelope(a));
    expect(min).toBeLessThan(0);
    expect(min).toBeGreaterThan(-0.3);
  });

  test('PixelBlast density: what the doc says it lights on a 390 x 220 band is what it lights', () => {
    const tones = { ink: '#FFB300', partner: '#D07506', paper: '#141210' };
    const share = (density: number) => {
      let total = 0;
      let frames = 0;
      for (let t = 0; t < 400; t += 13.7) {
        const u = S.frameUniforms(
          'PixelBlast',
          { ...S.commonUniforms({ width: 390, height: 220, cell: 3, tones, edgeFade: 0.5 }), ...S.pixelBlastUniforms({ density }) },
          { t, now: 0, reveal: 1 },
        );
        let on = 0;
        let n = 0;
        for (let iy = 0; iy < 73; iy += 2) {
          for (let ix = 0; ix < 130; ix += 2) {
            n++;
            if (cellTone('PixelBlast', u, ix, iy) > 0) on++;
          }
        }
        total += on / n;
        frames++;
      }
      return total / frames;
    };
    const one = share(1);
    expect(one).toBeGreaterThan(0.08);
    expect(one).toBeLessThan(0.14);
    expect(share(1.5)).toBeGreaterThan(0.18);
    expect(share(0.35)).toBeLessThan(0.05);
    expect(share(0.25)).toBeLessThan(0.04);
    expect(S.PIXEL_BLAST.density).toBe(1);
  });

  test('a ripple’s life ends where its bound falls under the dead zone', () => {
    expect(Math.exp(-S.RIPPLE_LIFE_S * S.PIXEL_BLAST.rippleRate)).toBeCloseTo(S.DEAD_ZONE, 12);
    expect(S.PIXEL_BLAST.maxTaps).toBe(4);
  });

  test('the dot grid is centred, its dots never outrun the nine cells each cell checks', () => {
    const g = S.dotGridLayout(390, 300, 3);
    expect([g.cols, g.rows, g.pitch, g.dot]).toEqual([33, 25, 4, 1]);
    const usedX = (g.cols - 1) * g.pitch + g.dot;
    const usedY = (g.rows - 1) * g.pitch + g.dot;
    expect(Math.abs(130 - usedX - 2 * g.origin[0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(100 - usedY - 2 * g.origin[1]!)).toBeLessThanOrEqual(1);
    const u = S.dotGridUniforms({ width: 390, height: 300, cell: 3, base: '#2F2B27', push: 99 });
    expect(u.push).toBeLessThan(1.5 * u.pitch);
    expect(S.dotGridUniforms({ width: 390, height: 300, cell: 3, base: '#2F2B27' }).push).toBe(S.DOT_GRID.push);
  });

  test('the radar sits in the middle and fades out three quarters of the shorter side away', () => {
    expect(S.radarGeometry(390, 300)).toEqual({ center: [195, 150], reach: 225 });
    expect(S.radarGeometry(390, 300, 2, { x: 10, y: 20 })).toEqual({ center: [10, 20], reach: 450 });
    expect(S.RADAR_REACH).toBe(0.75);
  });
});

// ─── the notice, the hash, the copy ─────────────────────────────────────────────────────

describe('the notice and the copy', () => {
  const DIR = join(import.meta.dir, '..', 'src', 'ui', 'bits', 'backgrounds');

  test('every file in the backgrounds carries David Haz’s notice and says what changed', () => {
    const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const f of files) {
      const text = readFileSync(join(DIR, f), 'utf8');
      const head = text.slice(0, 6000);
      expect(`${f}: ${head.includes('by David Haz')}`).toBe(`${f}: true`);
      expect(`${f}: ${head.includes('Copyright (c) 2026 David Haz')}`).toBe(`${f}: true`);
      expect(`${f}: ${head.includes('Commons Clause Restriction')}`).toBe(`${f}: true`);
      expect(`${f}: ${head.includes('What changed in the port')}`).toBe(`${f}: true`);
    }
  });

  test('one hash: the prelude’s JS twin is onboarding’s, bit for bit', () => {
    for (const [x, y] of [
      [0, 0],
      [3, 7],
      [130, 283],
      [-5, 12],
    ] as const) {
      expect(hash12(x, y)).toBe(onboardingHash12(x, y));
    }
  });

  test('the gallery names every field, in order, with no dash', () => {
    expect([...GALLERY_ORDER].sort()).toEqual([...BACKGROUND_NAMES].sort());
    for (const name of BACKGROUND_NAMES) {
      expect(GALLERY_NOTES[name].source).toContain('react-bits');
      for (const running of [true, false]) {
        const cap = galleryCaption(name, running);
        expect(hasDash(cap.title)).toBe(false);
        expect(hasDash(cap.line)).toBe(false);
        expect(cap.title.startsWith(`${name.toLocaleLowerCase()} · react-bits `)).toBe(true);
      }
    }
  });
});
