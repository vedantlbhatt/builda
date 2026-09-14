/**
 * Onboarding's pure rules: the order of the steps and what the progress bar says on each, the
 * name the step accepts and the one it opens with, and the pixel dissolve's cell logic (the
 * JavaScript twin of the shader's hash, so the ordering rules hold without a GPU).
 */
import { describe, expect, test } from 'bun:test';

import { NAME_MAX } from '../src/nav/rules';
import { GRID } from '../src/pixel/frames';
import { MOTION } from '../src/pixel/motion';
import {
  BURST,
  DISSOLVE,
  DONE_CREATURE,
  FINALE,
  FLOW,
  HELLO_BIT,
  HELLO_BLINK,
  NAME_TO_CREATURE_MS,
  PROGRESS,
  PROGRESS_STEPS,
  STAGE_CREATURE,
  WIPE_MS,
  burstBox,
  chromeBack,
  chromeBars,
  chromeFill,
  chromeIndex,
  isFlowStep,
  nextPath,
  pathFor,
  progressFor,
  showsBack,
} from '../src/onboarding/flow';
import { NAME_MESSAGES, appleCallName, nameUsable, prefillName, submitName } from '../src/onboarding/names';
import { BURST_SKSL, DISSOLVE_SKSL, colorUniform, dissolveCell, dissolveTurn, hash12, waveSpan } from '../src/onboarding/shaders';
import { displayNameProblem } from '../src/social/account';

describe('the flow', () => {
  test('seven routes, hello first and "That\'s me" last', () => {
    expect([...FLOW]).toEqual(['hello', 'name', 'creature', 'tools', 'connect', 'notify', 'done']);
  });

  test('each step pushes the next; the last one finishes instead of pushing', () => {
    expect(nextPath('hello')).toBe('/onboarding/name');
    expect(nextPath('name')).toBe('/onboarding/creature');
    expect(nextPath('connect')).toBe('/onboarding/notify');
    expect(nextPath('notify')).toBe('/onboarding/done');
    expect(nextPath('done')).toBeNull();
    for (const s of FLOW) expect(pathFor(s)).toBe(`/onboarding/${s}`);
  });

  test('the bar counts every step that asks something, one more per step', () => {
    expect([...PROGRESS_STEPS]).toEqual(['name', 'creature', 'tools', 'connect', 'notify']);
    expect(progressFor('name')).toEqual({ filled: 1, total: 5 });
    expect(progressFor('creature')).toEqual({ filled: 2, total: 5 });
    expect(progressFor('tools')).toEqual({ filled: 3, total: 5 });
    expect(progressFor('connect')).toEqual({ filled: 4, total: 5 });
    expect(progressFor('notify')).toEqual({ filled: 5, total: 5 });
  });

  test('the bar is full only on the last step that asks: never while a question is still to come', () => {
    const asking = FLOW.filter((s) => s !== 'hello' && s !== 'done');
    for (const s of asking.slice(0, -1)) {
      const p = progressFor(s)!;
      expect(p.filled).toBeLessThan(p.total);
    }
  });

  test('hello and the finale sit outside the bar', () => {
    expect(progressFor('hello')).toBeNull();
    expect(progressFor('done')).toBeNull();
  });

  test('back exists on every step with one before it, except the finale', () => {
    expect(showsBack('hello')).toBe(false);
    for (const s of ['name', 'creature', 'tools', 'connect', 'notify'] as const) expect(showsBack(s)).toBe(true);
    expect(showsBack('done')).toBe(false);
  });

  test('the chrome is drawn from one position: whole on a step, between two during a transition', () => {
    // At rest on each step, the bars say what progressFor says, and the chevron is there
    // exactly where showsBack says.
    for (const s of FLOW) {
      const p = chromeIndex(s);
      const filled = PROGRESS_STEPS.map((_, i) => chromeFill(p, i)).reduce((a, b) => a + b, 0);
      expect(filled).toBe(progressFor(s)?.filled ?? (s === 'hello' ? 0 : PROGRESS_STEPS.length));
      expect(chromeBack(p) === 1).toBe(showsBack(s));
      expect(chromeBars(p)).toBe(progressFor(s) !== null);
    }
  });

  test('half way through the push to tools, the third bar is half full; a swipe back gives it back', () => {
    const creature = chromeIndex('creature');
    expect(chromeFill(creature + 0.5, 2)).toBeCloseTo(0.5);
    expect(chromeFill(creature + 0.5, 1)).toBe(1);
    expect(chromeFill(creature + 0.5, 3)).toBe(0);
    // A swipe from tools abandoned at 30%: the position goes 3 to 2.7 and back to 3.
    const tools = chromeIndex('tools');
    expect(chromeFill(tools - 0.3, 2)).toBeCloseTo(0.7);
    expect(chromeFill(tools, 2)).toBe(1);
  });

  test('toward hello and the finale the chevron fades with the page and the bars cut at half way', () => {
    expect(chromeBack(0.5)).toBeCloseTo(0.5);
    expect(chromeBack(chromeIndex('done') - 0.25)).toBeCloseTo(0.25);
    expect(chromeBars(0.49)).toBe(false);
    expect(chromeBars(0.51)).toBe(true);
    expect(chromeBars(chromeIndex('notify') + 0.49)).toBe(true);
    expect(chromeBars(chromeIndex('notify') + 0.51)).toBe(false);
  });

  test('a route segment is a step only when it names one', () => {
    expect(isFlowStep('tools')).toBe(true);
    expect(isFlowStep('onboarding')).toBe(false);
    expect(isFlowStep('')).toBe(false);
    expect(isFlowStep(undefined)).toBe(false);
  });
});

describe('the numbers the motion uses', () => {
  test('the segmented bar is the welcome study converted to points', () => {
    // speak-language: 44 x 6 px bars, 15 px apart, on a 640 wide canvas (about 1.63 to 1).
    expect(PROGRESS.width).toBe(27);
    expect(PROGRESS.height).toBe(3.7);
    expect(PROGRESS.gap).toBe(9);
    expect(PROGRESS.pageMs).toBe(267);
    expect(Math.round(44 / 1.63)).toBe(PROGRESS.width);
  });

  test('the dissolve turns over in about a third of a second; Reduce Motion fades in 150', () => {
    expect(DISSOLVE.ms).toBeGreaterThanOrEqual(300);
    expect(DISSOLVE.ms).toBeLessThanOrEqual(400);
    expect(DISSOLVE.reducedMs).toBe(150);
    expect(DISSOLVE.band).toBeGreaterThan(0);
    expect(DISSOLVE.band).toBeLessThan(0.25);
    // The last cell turns exactly as the progress reaches the end.
    expect(DISSOLVE.wave + DISSOLVE.jitter).toBeCloseTo(1, 10);
  });

  test("the dissolve's cells are whole blocks of Bit's pixels, so no cell edge slices one", () => {
    const bitPixel = HELLO_BIT / GRID;
    expect(Number.isInteger(bitPixel)).toBe(true);
    expect(DISSOLVE.cell % bitPixel).toBe(0);
  });

  test("Bit blinks twice, each a cut held for the family's 120ms; the headline wipes in 520ms", () => {
    expect(HELLO_BLINK.atMs.length).toBe(2);
    expect(HELLO_BLINK.closedMs).toBe(MOTION.blink.closedMs);
    expect(HELLO_BLINK.atMs[1]! - HELLO_BLINK.atMs[0]!).toBeGreaterThan(HELLO_BLINK.closedMs * 4);
    expect(WIPE_MS).toBe(520);
  });

  test('pixel art only at whole points per cell: Bit, the stage, the finale, the burst', () => {
    expect(HELLO_BIT % GRID).toBe(0);
    expect(STAGE_CREATURE % GRID).toBe(0);
    expect(DONE_CREATURE % GRID).toBe(0);
    expect(Number.isInteger(BURST.cell)).toBe(true);
    expect(Number.isInteger(BURST.ring)).toBe(true);
  });

  test('the finale shows the creature at the size it was picked at, not a smaller copy', () => {
    expect(DONE_CREATURE).toBe(STAGE_CREATURE);
  });

  test("the burst's squares are the creature's own cells, laid on the creature's grid", () => {
    expect(BURST.cell).toBe(DONE_CREATURE / GRID);
    const box = burstBox();
    expect(box).toBeGreaterThanOrEqual(2 * (BURST.to + BURST.ring));
    const offset = (box - DONE_CREATURE) / 2;
    expect(offset % BURST.cell).toBe(0);
    // One cell thick: a ring of whole squares, never a mix of single and double ones.
    expect(BURST.ring).toBe(BURST.cell);
  });

  test('the burst is about 600ms and starts outside the creature', () => {
    expect(BURST.ms).toBe(600);
    // The 12 cell live area reaches 6 cells from the centre, its corners about 8.5.
    expect(BURST.from).toBeGreaterThan((6 * DONE_CREATURE) / GRID);
    expect(BURST.to).toBeGreaterThan(BURST.from);
  });

  test('the finale: the creature is cut on the dense ring; the gate flips once the ring has gone', () => {
    expect(FINALE.creatureCutMs).toBeLessThan(BURST.ms * 0.25);
    // The belt only: the ring's end flips the gate. Never before the ring can have finished.
    expect(FINALE.flipFallbackMs).toBeGreaterThan(BURST.ms);
    expect(FINALE.flipFallbackMs).toBeLessThan(BURST.ms + 500);
    expect(FINALE.actionAtMs).toBeGreaterThan(FINALE.nameAtMs);
    expect(FINALE.actionAtMs).toBeLessThan(500);
  });

  test('the name step cross fades into the creature step faster than a push', () => {
    expect(NAME_TO_CREATURE_MS).toBeLessThan(350);
    expect(NAME_TO_CREATURE_MS).toBeGreaterThanOrEqual(150);
  });
});

describe('the name', () => {
  test('usable at 1 to 24 characters after trimming', () => {
    expect(nameUsable('')).toBe(false);
    expect(nameUsable('   ')).toBe(false);
    expect(nameUsable('V')).toBe(true);
    expect(nameUsable('x'.repeat(NAME_MAX))).toBe(true);
    expect(nameUsable('x'.repeat(NAME_MAX + 1))).toBe(false);
    expect(nameUsable(`  ${'x'.repeat(NAME_MAX)}  `)).toBe(true);
  });

  test('characters are counted as a person sees them, not as UTF-16 units', () => {
    expect(nameUsable('é'.repeat(NAME_MAX))).toBe(true);
  });

  test('submitting normalises; refusing says why in a sentence', () => {
    expect(submitName('  Vedant   Bhatt ')).toEqual({ ok: true, name: 'Vedant Bhatt' });
    expect(submitName('')).toEqual({ ok: false, problem: 'empty', message: NAME_MESSAGES.empty });
    expect(submitName('x'.repeat(30))).toEqual({ ok: false, problem: 'too_long', message: NAME_MESSAGES.too_long });
  });

  test('every name this step accepts, the server accepts as display_name too', () => {
    for (const n of ['a', 'Vedant', 'x'.repeat(NAME_MAX), '  spaced   out  ', 'Zoë Ålund']) {
      const v = submitName(n);
      if (v.ok) expect(displayNameProblem(v.name)).toBeNull();
    }
  });

  test('a name made of astral characters the server would count past 40 is refused, not sent', () => {
    // 24 code points that are 2 UTF-16 units each: 48 by the server's count.
    const astral = '𝒱'.repeat(NAME_MAX);
    expect(submitName(astral).ok).toBe(false);
  });

  test('the prefill: what they typed here, then the account, then Apple', () => {
    expect(prefillName({ local: 'Ved', server: 'Vedant', apple: 'V' })).toBe('Ved');
    expect(prefillName({ local: null, server: 'Vedant', apple: 'V' })).toBe('Vedant');
    expect(prefillName({ local: '', server: null, apple: 'Vedant' })).toBe('Vedant');
    expect(prefillName({})).toBe('');
  });

  test('a candidate the step would refuse is skipped rather than prefilled into a disabled button', () => {
    expect(prefillName({ local: null, server: 'x'.repeat(30), apple: 'Vedant' })).toBe('Vedant');
    expect(prefillName({ local: '   ', server: null, apple: null })).toBe('');
  });

  test("Apple's name: the nickname, else the given name, else the family name", () => {
    expect(appleCallName({ givenName: 'Vedant', familyName: 'Bhatt' })).toBe('Vedant');
    expect(appleCallName({ nickname: 'Ved', givenName: 'Vedant' })).toBe('Ved');
    expect(appleCallName({ givenName: '  ', familyName: 'Bhatt' })).toBe('Bhatt');
    expect(appleCallName({ givenName: null, familyName: null })).toBeNull();
    expect(appleCallName(null)).toBeNull();
  });
});

describe('the pixel dissolve', () => {
  const COLS = 13; // a 402 x 874 screen in 32pt cells
  const ROWS = 28;
  const cells: number[] = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) cells.push(hash12(x, y));

  // The wave on an iPhone 16 Pro: out of Continue's centre, the grid laid on Bit's corner.
  const W = 402;
  const H = 874;
  const origin = [W / 2, 790] as const;
  const anchor = [137, 250] as const;
  const g = { cell: DISSOLVE.cell, anchor, origin, span: waveSpan(origin, W, H), wave: DISSOLVE.wave, jitter: DISSOLVE.jitter };
  const turns: { x: number; y: number; h: number }[] = [];
  const ix0 = Math.floor((0 - anchor[0]) / DISSOLVE.cell);
  const iy0 = Math.floor((0 - anchor[1]) / DISSOLVE.cell);
  const ix1 = Math.floor((W - anchor[0]) / DISSOLVE.cell);
  const iy1 = Math.floor((H - anchor[1]) / DISSOLVE.cell);
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) turns.push({ x: ix, y: iy, h: dissolveTurn(ix, iy, g) });

  test('every cell on screen turns inside the run: none before it starts, none after it ends', () => {
    for (const t of turns) {
      expect(t.h).toBeGreaterThanOrEqual(0);
      expect(t.h).toBeLessThanOrEqual(1);
      expect(dissolveCell(t.h, 0, DISSOLVE.band)).toBe('old');
      expect(dissolveCell(t.h, 1 + DISSOLVE.band, DISSOLVE.band)).toBe('new');
    }
  });

  test('the wave leaves the finger: the button clears in the first third, the top row turns last', () => {
    const cellAt = (px: number, py: number) => turns.find((t) => t.x === Math.floor((px - anchor[0]) / DISSOLVE.cell) && t.y === Math.floor((py - anchor[1]) / DISSOLVE.cell))!;
    expect(cellAt(origin[0], origin[1]).h).toBeLessThan(0.35);
    const top = turns.filter((t) => anchor[1] + t.y * DISSOLVE.cell < 120).map((t) => t.h);
    const bottom = turns.filter((t) => anchor[1] + (t.y + 1) * DISSOLVE.cell > H - 120).map((t) => t.h);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(top)).toBeGreaterThan(mean(bottom) + 0.3);
  });

  test('ragged, not a wipe: neighbours at the same distance do not all turn together', () => {
    const row = turns.filter((t) => t.y === Math.floor((400 - anchor[1]) / DISSOLVE.cell)).map((t) => t.h.toFixed(3));
    expect(new Set(row).size).toBeGreaterThan(row.length * 0.8);
  });

  test('the hash lands in [0, 1) for every cell', () => {
    for (const h of cells) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  test('the order is scattered, not a sweep: no row or column turns over as a block', () => {
    const distinct = new Set(cells.map((h) => h.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(cells.length * 0.98);
    // Each quarter of the progress turns over roughly a quarter of the cells.
    for (let q = 0; q < 4; q++) {
      const n = cells.filter((h) => h >= q / 4 && h < (q + 1) / 4).length;
      expect(n).toBeGreaterThan(cells.length * 0.15);
      expect(n).toBeLessThan(cells.length * 0.35);
    }
  });

  test('every cell is old at the start and new at the end, and flashes on the way', () => {
    for (const h of cells) {
      expect(dissolveCell(h, 0, DISSOLVE.band)).toBe('old');
      expect(dissolveCell(h, 1 + DISSOLVE.band, DISSOLVE.band)).toBe('new');
      expect(dissolveCell(h, h + DISSOLVE.band / 2, DISSOLVE.band)).toBe('flash');
    }
  });

  test('a cell never turns back: once new, it stays new as the progress grows', () => {
    for (const h of cells.slice(0, 40)) {
      let seenNew = false;
      const end = Math.round((1 + DISSOLVE.band) * 100);
      for (let i = 0; i <= end; i++) {
        const s = dissolveCell(h, i / 100, DISSOLVE.band);
        if (seenNew) expect(s).toBe('new');
        if (s === 'new') seenNew = true;
      }
      expect(seenNew).toBe(true);
    }
  });

  test('both shaders declare the hash they are tested against, with no sine in it', () => {
    for (const sksl of [DISSOLVE_SKSL, BURST_SKSL]) {
      expect(sksl).toContain('float hash12(float2 c)');
      expect(sksl).toContain('0.1031');
      expect(sksl).toContain('33.33');
      expect(sksl).not.toMatch(/\bsin\(/);
    }
    expect(DISSOLVE_SKSL).toContain('uniform shader snapshot;');
    expect(DISSOLVE_SKSL).toContain('uniform float2 origin;');
    expect(DISSOLVE_SKSL).toContain('uniform float2 anchor;');
    expect(BURST_SKSL).toContain('uniform half4 ink;');
  });

  test('colour uniforms are premultiplied 0..1', () => {
    expect(colorUniform('#FFB300')).toEqual([1, 179 / 255, 0, 1]);
    expect(colorUniform('#282420', 0.5)).toEqual([(0x28 / 255) * 0.5, (0x24 / 255) * 0.5, (0x20 / 255) * 0.5, 0.5]);
    expect(colorUniform('nope')).toEqual([0, 0, 0, 0]);
  });
});
