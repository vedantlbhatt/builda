/**
 * Onboarding in the house style (design-refs/HOUSE-STYLE.md, 2026-09-13): the numbers taken from
 * the owner's sources held to those sources, the band's program held to the kit's own Bayer and
 * hash, the pixel cover's sequence across two routes, and the rules on the flow's code that make
 * it the house style and not a restyle of one screen: every step opens on a band, every step
 * wears the builder's colour, and nothing in the flow paints the retired amber.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import CanvasKitInit from 'canvaskit-wasm';

import { fitSize } from '../src/insights/format';
import { BAYER_SKSL, HASH_SKSL } from '../src/ui/bits/components/fills';
import { T as DUR } from '../src/ui/motionSpec';
import { tokens } from '../src/generated/tokens';
import { modeOf, PIXEL_MOTIONS } from '../src/motion/pixelMotion';
import { bandArrival, bandDensity, bandShifted, STEP_BAND_SKSL } from '../src/onboarding/bandShader';
import { creatureWord, grouped, readsList, sessionsCaption, sessionWord } from '../src/onboarding/copy';
import { covered, coverWith, currentDissolve, finish, isCovering, reveal, resetDissolve } from '../src/onboarding/dissolve';
import { colorUniform, DISSOLVE_SKSL, dissolveCell, dissolveTurn, hash12, waveSpan } from '../src/onboarding/shaders';
import {
  BAND_SHIFT,
  DISSOLVE,
  HELLO_BLINK,
  HELLO_PRINT,
  HELLO_PRINT_MS,
  HELLO_SWIPE,
  LINE_CYCLE,
  NAME_SIZES,
  nameSize,
  STAGE_CREATURE,
  swipeCommits,
  swipeProgress,
  TILE_POP,
  tilePopAt,
  tilePopTurn,
  TIMELINE,
} from '../src/onboarding/flow';

describe('the swipe up hero is liquid glass’s (appllama-liquid-glass-screens, "The sphere")', () => {
  test('the numbers', () => {
    expect(HELLO_SWIPE.rubber).toBe(0.25);
    expect(HELLO_SWIPE.flick).toBe(0.18);
    expect(HELLO_SWIPE.commit).toBe(0.5);
    expect(HELLO_SWIPE.spring).toEqual({ damping: 15, stiffness: 120, mass: 1.05 });
    expect(HELLO_SWIPE.reducedSpring).toEqual({ damping: 30, stiffness: 160, mass: 1 });
    expect([HELLO_SWIPE.hintFrom, HELLO_SWIPE.hintTo]).toEqual([0.06, 0.3]);
  });

  test('the finger lifts the page 1:1 inside its travel, and at a quarter past either end', () => {
    const travel = 240;
    expect(swipeProgress(0, travel)).toBe(0);
    expect(swipeProgress(-120, travel)).toBeCloseTo(0.5);
    expect(swipeProgress(-240, travel)).toBeCloseTo(1);
    expect(swipeProgress(-480, travel)).toBeCloseTo(1.25);
    expect(swipeProgress(120, travel)).toBeCloseTo(-0.125);
    expect(swipeProgress(-100, 0)).toBe(0);
  });

  test('a release goes on when p + 0.18 v passes half way: a slow lift past half, a flick from low, never a pull back', () => {
    expect(swipeCommits(0.49, 0)).toBe(false);
    expect(swipeCommits(0.51, 0)).toBe(true);
    expect(swipeCommits(0.2, 1.7)).toBe(true);
    expect(swipeCommits(0.2, 1.6)).toBe(false);
    expect(swipeCommits(0.6, -1)).toBe(false);
  });
});

describe('hello', () => {
  test('the line under the headline turns over on liquid glass’s third line: 560 in, 1950 held, 400 out, 460 apart', () => {
    expect(LINE_CYCLE).toEqual({ inMs: 560, holdMs: 1950, outMs: 400, gapMs: 460 });
  });

  test('Bit has printed before it blinks, and blinks where duolingo’s owl does, counted from there', () => {
    expect(HELLO_PRINT_MS).toBe(HELLO_PRINT.fromMs + HELLO_PRINT.spreadMs + HELLO_PRINT.cellMs);
    expect([...HELLO_BLINK.atMs]).toEqual([400, 2467]);
  });
});

describe('the name is the headline (design-md/finance/cash-app, the one huge value)', () => {
  const fit = fitSize;
  test('it opens at 96pt and steps down through 72 and 60, largest first', () => {
    expect(NAME_SIZES[0]).toBe(96);
    expect(NAME_SIZES).toContain(72);
    expect(NAME_SIZES).toContain(60);
    for (let i = 1; i < NAME_SIZES.length; i++) expect(NAME_SIZES[i]!).toBeLessThan(NAME_SIZES[i - 1]!);
  });

  test('always one of the steps, and a longer name is never set larger', () => {
    const width = 362;
    let last = Number.POSITIVE_INFINITY;
    for (let n = 1; n <= 24; n++) {
      const s = nameSize('v'.repeat(n), width, fit);
      expect(NAME_SIZES as readonly number[]).toContain(s);
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
  });

  test('a short name opens large, and an empty field is sized for its placeholder', () => {
    expect(nameSize('Ved', 362, fit)).toBe(96);
    expect(nameSize('', 362, fit)).toBe(nameSize('Your name', 362, fit));
  });
});

describe('the tools arrive as yazio’s welcome assets do (appllama-top-welcome-screens)', () => {
  test('67ms apart, about 250ms each on out(back(1.5)), from 0.94 and a 13 to 24 degree turn', () => {
    expect(TILE_POP.stepMs).toBe(67);
    expect(TILE_POP.ms).toBe(250);
    expect(TILE_POP.back).toBe(1.5);
    expect(TILE_POP.fromScale).toBe(0.94);
    for (const t of TILE_POP.turns) {
      expect(Math.abs(t)).toBeGreaterThanOrEqual(13);
      expect(Math.abs(t)).toBeLessThanOrEqual(24);
    }
    // 25 to 45px on the 640 canvas.
    expect(TILE_POP.dropPt).toBeGreaterThanOrEqual(Math.round(25 / 1.63));
    expect(TILE_POP.dropPt).toBeLessThanOrEqual(Math.round(45 / 1.63));
  });

  test('each tile starts one step after the last, and the turns go round', () => {
    expect([0, 1, 2, 6].map(tilePopAt)).toEqual([0, 67, 134, 402]);
    expect(tilePopTurn(0)).toBe(TILE_POP.turns[0]!);
    expect(tilePopTurn(TILE_POP.turns.length)).toBe(TILE_POP.turns[0]!);
    expect(tilePopTurn(6)).toBe(TILE_POP.turns[1]!);
  });
});

describe('the priming timeline is facetune’s (appllama-top-paywall-screens)', () => {
  test('32pt marks on a 3pt connector 52pt long, the words 25pt past the mark', () => {
    expect(TIMELINE).toEqual({ mark: 32, connector: 3, connectorLength: 52, textGap: 25 });
    // facetune: the mark at x 40, 32 wide; the words at x 97.
    expect(97 - 40 - 32).toBe(TIMELINE.textGap);
  });
});

describe('the band', () => {
  test('its program is the kit’s Bayer threshold and the kit’s hash, composed, with no sine', () => {
    for (const line of BAYER_SKSL.trim().split('\n')) expect(STEP_BAND_SKSL).toContain(line.trim());
    for (const line of HASH_SKSL.trim().split('\n')) expect(STEP_BAND_SKSL).toContain(line.trim());
    for (const u of ['uniform half4 ink0;', 'uniform half4 ink1;', 'uniform float shift;', 'uniform float block;', 'uniform float reveal;']) {
      expect(STEP_BAND_SKSL).toContain(u);
    }
    expect(STEP_BAND_SKSL).not.toMatch(/\bsin\(/);
  });

  test('it prints top first: the top rows arrive earlier than the bottom ones, all inside the print', () => {
    const cell = tokens.dither.cell;
    const rows = 120;
    const total = rows * cell;
    const mean = (r0: number, r1: number) => {
      let s = 0;
      let n = 0;
      for (let r = r0; r < r1; r++)
        for (let x = 0; x < 60; x++) {
          const a = bandArrival(x, r, cell, total);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(1);
          s += a;
          n++;
        }
      return s / n;
    };
    expect(mean(0, 20)).toBeLessThan(mean(100, 120) - 0.3);
  });

  test('a new hue switches block by block: none at 0, all at 1, about half at half, and a switched block stays switched', () => {
    const b = BAND_SHIFT.block;
    const pts: [number, number][] = [];
    for (let y = 0; y < 400; y += b) for (let x = 0; x < 400; x += b) pts.push([x, y]);
    const at = (s: number) => pts.filter(([x, y]) => bandShifted(x, y, b, s)).length;
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(pts.length);
    expect(at(0.5) / pts.length).toBeGreaterThan(0.35);
    expect(at(0.5) / pts.length).toBeLessThan(0.65);
    for (const [x, y] of pts.slice(0, 50)) {
      let seen = false;
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const on = bandShifted(x, y, b, s);
        if (seen) expect(on).toBe(true);
        if (on) seen = true;
      }
    }
  });

  test('the switch is the kit’s standard 240ms, in blocks of whole dither cells', () => {
    expect(BAND_SHIFT.ms).toBe(DUR.std);
    expect(BAND_SHIFT.block % tokens.dither.cell).toBe(0);
  });

  test('whole across the band, none past its fringe, falling in between', () => {
    expect(bandDensity(10, 100, 36)).toBe(1);
    expect(bandDensity(118, 100, 36)).toBeCloseTo(0.5);
    expect(bandDensity(140, 100, 36)).toBe(0);
    expect(bandDensity(101, 100, 0)).toBe(0);
  });

  test('the stage prints the creature large: twelve whole points a cell, its neighbours six', () => {
    expect(STAGE_CREATURE / 16).toBe(12);
    expect((STAGE_CREATURE / 2) % 16).toBe(0);
  });
});

describe('the pixel cover across two routes (react-bits PixelTransition’s rule)', () => {
  beforeEach(() => resetDissolve());
  const geometry = { origin: [200, 790] as const, anchor: [137, 250] as const };

  test('cover, then the page goes under it once every cell is on, then it clears, then idle', () => {
    let pushed = 0;
    expect(coverWith('#FCA0A6', '#D36D86', geometry, () => pushed++)).toBe(true);
    expect(isCovering()).toBe(true);
    // A second press while one runs is refused.
    expect(coverWith('#FCA0A6', '#D36D86', geometry, () => pushed++)).toBe(false);
    // Only the cover that asked can say it has landed.
    covered(999);
    expect(pushed).toBe(0);
    covered(currentId());
    expect(pushed).toBe(1);
    reveal();
    expect(phase()).toBe('reveal');
    finish(999);
    expect(phase()).toBe('reveal');
    finish(currentId());
    expect(phase()).toBe('idle');
    expect(isCovering()).toBe(false);
  });

  test('a page that asks to be revealed before the cover has landed is revealed the moment it lands', () => {
    coverWith('#FCA0A6', '#D36D86', geometry, () => undefined);
    reveal();
    expect(phase()).toBe('cover');
    covered(currentId());
    expect(phase()).toBe('reveal');
  });

  test('a reveal with no cover up does nothing', () => {
    reveal();
    expect(phase()).toBe('idle');
  });
});

function phase(): string {
  return currentDissolve().phase;
}
function currentId(): number {
  const d = currentDissolve();
  return d.phase === 'idle' ? -1 : d.id;
}

describe('the words', () => {
  test('the creature’s name on its own, the counts, and what VoiceOver hears for the drifting marks', () => {
    expect(creatureWord('crab')).toBe('the crab');
    expect(sessionsCaption(1, false)).toBe('session uploaded to your account');
    expect(sessionsCaption(1, true)).toBe('sessions uploaded to your account');
    expect(sessionsCaption(77, false)).toBe('sessions uploaded to your account');
    expect(sessionWord(1)).toBe('session');
    expect(sessionWord(2)).toBe('sessions');
    expect(grouped(1234567)).toBe('1,234,567');
    expect(readsList(['Claude Code', 'Codex', 'Cursor', 'Gemini CLI'])).toBe('Builda reads Claude Code, Codex, Cursor and 1 more.');
    expect(readsList([])).toBe('');
  });
});

// ─── the code ─────────────────────────────────────────────────────────────────────────

const MOBILE = join(import.meta.dir, '..');
const STEPS = readdirSync(join(MOBILE, 'app/onboarding'))
  .filter((f) => /\.tsx$/.test(f) && f !== '_layout.tsx')
  .map((f) => `app/onboarding/${f}`);
const FLOW_FILES = [
  ...readdirSync(join(MOBILE, 'app/onboarding')).map((f) => `app/onboarding/${f}`),
  ...readdirSync(join(MOBILE, 'src/onboarding')).map((f) => `src/onboarding/${f}`),
  'app/icon.tsx',
].filter((f) => /\.tsx?$/.test(f));
const read = (f: string) => readFileSync(join(MOBILE, f), 'utf8');

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the flow is built in the house style', () => {
  test('there is something to check: all seven steps', () => {
    expect(STEPS.length).toBe(7);
  });

  test('every step opens on a band, and the picker outside the flow does too', () => {
    for (const f of [...STEPS, 'app/icon.tsx']) expect({ file: f, band: /<StepBand\b/.test(code(read(f))) }).toEqual({ file: f, band: true });
  });

  test('every step wears the builder’s colour: the accent, or the creature’s own hue where it is being chosen', () => {
    for (const f of [...STEPS, 'app/icon.tsx']) {
      const c = code(read(f));
      expect({ file: f, themed: /useAccent\(|creatureHue\(/.test(c) }).toEqual({ file: f, themed: true });
    }
  });

  test('nothing in the flow paints the retired amber (the owner: "this ugly orange?")', () => {
    for (const f of FLOW_FILES) {
      const c = code(read(f));
      const hits = c.match(/\bc\.accent\b|accentPressed|glyphInk\(|'amber'/g) ?? [];
      expect({ file: f, hits }).toEqual({ file: f, hits: [] });
    }
  });

  test('the tools are shown with the owner’s own marks wherever a tool is named', () => {
    for (const f of ['src/onboarding/ToolTiles.tsx', 'src/onboarding/ReadsLine.tsx', 'app/onboarding/tools.tsx', 'app/onboarding/done.tsx']) {
      expect({ file: f, logo: /<HarnessLogo\b/.test(code(read(f))) }).toEqual({ file: f, logo: true });
    }
  });
});

// ─── the flow's two live programs, compiled and drawn by a real Skia ─────────────────────

const CK = await CanvasKitInit();

function draw(shader: ReturnType<typeof CK.Shader.MakeColor>, w: number, h: number): Uint8Array {
  const surface = CK.MakeSurface(w, h)!;
  const canvas = surface.getCanvas();
  canvas.clear(CK.TRANSPARENT);
  const paint = new CK.Paint();
  paint.setShader(shader);
  canvas.drawRect(CK.XYWHRect(0, 0, w, h), paint);
  const img = surface.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  paint.delete();
  surface.delete();
  return px;
}

const rgbOf = (px: Uint8Array, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
};
const hexRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 2);
/** A hash within this of a boundary is a float32 question, not a claim (the kit's own caveat). */
const hair = (h: number, edge: number) => Math.abs(h - edge) < 0.01;

describe('the band’s program, drawn (CanvasKit)', () => {
  const W = 48;
  const SOLID = 48;
  const FR = 12;
  const H = SOLID + FR;
  const OLD = '#FCA0A6';
  const NEW = '#F9833E';
  const fx = CK.RuntimeEffect.Make(STEP_BAND_SKSL)!;
  const band = (reveal: number, shift: number) => {
    // mode 0 (rain, the old print), the grid in cells, the ripple's origin (unused by rain).
    const cols = Math.ceil(W / tokens.dither.cell);
    const rows = Math.ceil(H / tokens.dither.cell);
    const sh = fx.makeShader([tokens.dither.cell, SOLID, FR, reveal, shift, BAND_SHIFT.block, ...colorUniform(OLD), ...colorUniform(NEW), 0, cols, rows, 0.5, 1]);
    const px = draw(sh, W, H);
    sh.delete();
    return px;
  };

  test('it compiles', () => {
    let error = '';
    const made = CK.RuntimeEffect.Make(STEP_BAND_SKSL, (e: string) => {
      error = e;
    });
    expect({ ok: made !== null, error }).toEqual({ ok: true, error: '' });
    made?.delete();
  });

  test('printed, the band is the hue edge to edge; unprinted, nothing', () => {
    const on = band(1, 0);
    const off = band(0, 0);
    for (let y = 0; y < SOLID; y += 5) for (let x = 0; x < W; x += 5) {
      expect(near(rgbOf(on, W, x, y), hexRgb(OLD))).toBe(true);
      expect(rgbOf(off, W, x, y)[3]).toBe(0);
    }
  });

  test('a new hue: every block is the old one at 0, the new one at 1, and between them exactly where the twin says', () => {
    const at0 = band(1, 0);
    const at1 = band(1, 1);
    const mid = band(1, 0.5);
    const b = BAND_SHIFT.block;
    let checked = 0;
    for (let y = b / 2; y < SOLID; y += b) {
      for (let x = b / 2; x < W; x += b) {
        expect(near(rgbOf(at0, W, x, y), hexRgb(OLD))).toBe(true);
        expect(near(rgbOf(at1, W, x, y), hexRgb(NEW))).toBe(true);
        const h = hash12(Math.floor(x / b) + 71, Math.floor(y / b) + 113);
        if (hair(h, 0.5)) continue;
        expect(near(rgbOf(mid, W, x, y), hexRgb(bandShifted(x, y, b, 0.5) ? NEW : OLD))).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  test('under the band it dissolves: nothing past the fringe', () => {
    const on = band(1, 0);
    for (let x = 0; x < W; x++) expect(rgbOf(on, W, x, H - 1)[3]).toBe(0);
  });
});

describe('the cover’s program over one colour, drawn (CanvasKit)', () => {
  const W = 128;
  const H = 128;
  const INK = '#FCA0A6';
  const FRONT = '#D36D86';
  const origin = [64, 128] as const;
  const anchor = [0, 0] as const;
  const span = waveSpan(origin, W, H);
  const fx = CK.RuntimeEffect.Make(DISSOLVE_SKSL)!;
  const colour = CK.Shader.MakeColor(CK.parseColorString(INK), CK.ColorSpace.SRGB);
  const at = (progress: number) => {
    const u = [DISSOLVE.cell, ...anchor, ...origin, span, DISSOLVE.wave, DISSOLVE.jitter, progress, DISSOLVE.band, ...colorUniform(FRONT)];
    const sh = fx.makeShaderWithChildren(u, [colour]);
    const px = draw(sh, W, H);
    sh.delete();
    return px;
  };
  const g = { cell: DISSOLVE.cell, anchor, origin, span, wave: DISSOLVE.wave, jitter: DISSOLVE.jitter };

  test('gathered, every cell is the colour; cleared, none is', () => {
    const full = at(0);
    const clear = at(1 + DISSOLVE.band);
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) {
      expect(near(rgbOf(full, W, x, y), hexRgb(INK))).toBe(true);
      expect(rgbOf(clear, W, x, y)[3]).toBe(0);
    }
  });

  test('half way, each cell is clear, the front or the colour exactly as the twin turns it', () => {
    const p = 0.5;
    const px = at(p);
    let checked = 0;
    for (let iy = 0; iy < H / DISSOLVE.cell; iy++) {
      for (let ix = 0; ix < W / DISSOLVE.cell; ix++) {
        const h = dissolveTurn(ix, iy, g);
        if (hair(h, p) || hair(h, p - DISSOLVE.band)) continue;
        const want = dissolveCell(h, p, DISSOLVE.band);
        const got = rgbOf(px, W, ix * DISSOLVE.cell + 16, iy * DISSOLVE.cell + 16);
        if (want === 'new') expect(got[3]).toBe(0);
        else expect(near(got, hexRgb(want === 'flash' ? FRONT : INK))).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('every pixel order, drawn (CanvasKit) against its JavaScript twin', () => {
  const W = 72;
  const SOLID = 72;
  const FR = 12;
  const H = SOLID + FR;
  const cell = tokens.dither.cell;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const INK = '#F9833E';
  const fx = CK.RuntimeEffect.Make(STEP_BAND_SKSL)!;

  test('at half way through the print, a cell is inked in the shader exactly when the twin says it has arrived', () => {
    for (const m of PIXEL_MOTIONS) {
      const reveal = 0.5;
      // Origin 0,0: the JS twin's default, so the ripple is compared from the same point.
      const sh = fx.makeShader([cell, SOLID, FR, reveal, 0, BAND_SHIFT.block, ...colorUniform(INK), ...colorUniform(INK), modeOf(m), cols, rows, 0, 0]);
      const px = draw(sh, W, H);
      sh.delete();
      let checked = 0;
      for (let row = 0; row < Math.floor(SOLID / cell); row++) {
        for (let col = 0; col < cols; col++) {
          const want = bandArrival(col, row, cell, H, m, cols);
          // A cell within a hair of the line is a float32 question (the kit's own caveat), and so is
          // a hash within a hair of 1: in float32 its fract can wrap to 0 (cell 17,13 hashes to
          // 0.9971 in doubles and printed at the very start in the shader).
          if (Math.abs(want - reveal * 1.02) < 0.01) continue;
          const hs = [hash12(col, row), hash12(col + 78.43, 40.7), hash12(Math.floor(col / 8) + 35.65, Math.floor(row / 8) + 18.5)];
          if (hs.some((h) => h > 0.99 || h < 0.01)) continue;
          const inked = rgbOf(px, W, col * cell + 1, row * cell + 1)[3]! > 0;
          expect({ m, col, row, inked }).toEqual({ m, col, row, inked: want < reveal * 1.02 });
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(400);
    }
  });
});
