/**
 * The react-bits text ports (src/ui/bits/text), without a renderer: the timing spec against the
 * v2 doc, the curve, splitting, the stagger and its 1.2 s fit (rule 7), the typewriter frame for
 * frame against react-bits' TextType, the split flap plans, the shuffle strips and evenodd
 * order, the rotating index, the flat bands, the ink rule, and static rules every port's source
 * must keep (David Haz's notice, token colours only, no gradient, no transform on Animated.Text,
 * a Reduce Motion path).
 *
 * The components themselves need Reanimated and a native text system; what is tested is every
 * number and order they are told, which is where a wrong frame would come from.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  gradientBandX,
  gradientCycle,
  gradientLayout,
  gradientTones,
  mixHex,
  parseHex,
  passCount,
  shineBandWidths,
  shineCycle,
  shineRunMs,
  shineTones,
  skewReach,
  sweepCenter,
} from '../src/ui/bits/text/bands';
import { bezierAt, clamp01, ease, keyframeAt, lerp, localProgress } from '../src/ui/bits/text/curve';
import {
  FLAP_CHARSETS,
  fitFlap,
  flapCharsetFor,
  flapPlans,
  flapStateAt,
  flapTotalMs,
  flapWidth,
  padPhrase,
} from '../src/ui/bits/text/flap';
import { fadeFor, resolveInk, SNAP_FADE_MS, type InkPalette } from '../src/ui/bits/text/ink';
import {
  clampIndex,
  elementCount,
  nextIndex,
  previousIndex,
  rotateDelays,
  rotateElements,
  rotationTiming,
} from '../src/ui/bits/text/rotate';
import {
  graphemes,
  kernedOffsets,
  kerningProbes,
  linesAreText,
  sameLines,
  splitUnits,
  trimLineEnd,
  unitCount,
  unitsForLines,
} from '../src/ui/bits/text/segment';
import {
  BLUR,
  BLUR_KEYFRAMES,
  FLIP,
  GRADIENT,
  ROTATE,
  SHINY,
  SHUFFLE,
  SPLIT,
  SPLIT_WORDS,
  TEXT_EFFECT_DONE_MS,
  TEXT_REDUCED_FADE,
  TYPE,
} from '../src/ui/bits/text/spec';
import { fitStagger, staggeredTotal, staggerRanks, unitWindows } from '../src/ui/bits/text/stagger';
import {
  fitShuffleStagger,
  shuffleCharset,
  shuffleSchedule,
  shuffleStrip,
  shuffleTotalMs,
} from '../src/ui/bits/text/strips';
import {
  caretGoneAt,
  caretVisible,
  fitTypingMs,
  typedText,
  typeFrames,
  untypedText,
  type TypeOptions,
} from '../src/ui/bits/text/typewriter';
import { mulberry32 } from '../src/ui/decrypt';
import { EASE_BEZIER, EXIT_FACTOR, REDUCED_FADE, T } from '../src/ui/motionSpec';
import { colors, HUE_NAMES } from '../src/theme';

/** A "random" source that walks a fixed list. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

// ─── the spec ─────────────────────────────────────────────────────────────────────────

describe('spec: the numbers the v2 doc gives, and react-bits where the doc is silent', () => {
  test('rule 7 and the per effect constants, exactly as DESIGN-V2 3 writes them', () => {
    expect(TEXT_EFFECT_DONE_MS).toBe(1200);
    expect(SPLIT).toEqual({ charMs: 360, staggerMs: 24, risePt: 10 });
    expect(SPLIT_WORDS.staggerMs).toBe(60);
    expect(SPLIT_WORDS.risePt).toBe(6);
    expect(SPLIT_WORDS.fadeMs).toBe(120);
    expect(SPLIT_WORDS.riseMs).toBe(T.enter);
    expect(SHUFFLE.ms).toBe(350);
    expect(SHUFFLE.staggerMs).toBe(30);
    expect(SHUFFLE.rolls).toBe(3);
    expect(FLIP.flipMs).toBe(120);
    expect(FLIP.staggerMs).toBe(60);
    expect(FLIP.flips).toBe(6);
    expect(FLIP.perspective).toBe(600);
    expect(TYPE.charMs).toBe(18);
    expect(TYPE.blinkMs).toBe(500);
    expect(TYPE.blinks).toBe(3);
    expect(TEXT_REDUCED_FADE).toBe(REDUCED_FADE);
  });

  test("react-bits' own tuning where it survives the phone", () => {
    // BlurText: 200 ms per unit, two 0.35 s steps, opacity 0 to 0.5 to 1, blur full to half to none.
    expect(BLUR.staggerMs).toBe(200);
    expect(BLUR.stepMs).toBe(350);
    expect([...BLUR_KEYFRAMES.opacity]).toEqual([0, 0.5, 1]);
    expect([...BLUR_KEYFRAMES.blur]).toEqual([1, 0.5, 0]);
    // RotatingText: 2 s between turns; out is the kit's 0.7x of in.
    expect(ROTATE.intervalMs).toBe(2000);
    expect(ROTATE.enterMs).toBe(T.enter);
    expect(ROTATE.exitMs).toBe(Math.round(T.enter * EXIT_FACTOR));
    expect([ROTATE.fromLines, ROTATE.toLines]).toEqual([1, -1.2]);
    // TextType's multi line mode keeps react-bits' deletion and pause.
    expect(TYPE.deleteMs).toBe(30);
    expect(TYPE.pauseMs).toBe(2000);
    // GradientText's drift is react-bits' `animationSpeed` 8.
    expect(GRADIENT.driftMs).toBe(8000);
    // ShinyText: react-bits' 120 degree band leans 30 degrees; light is three flat steps.
    expect(SHINY.skewDeg).toBe(30);
    expect(SHINY.steps).toBe(3);
    // The flap's back half waits for 45% of a flip, and the falling half darkens to 52%.
    expect(FLIP.backFrom).toBe(0.45);
    expect(1 - FLIP.shade).toBeCloseTo(0.52, 10);
  });

  test('every one shot default lands inside rule 7', () => {
    expect(SHINY.sweepMs).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS);
    expect(GRADIENT.arriveMs).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS);
    expect((FLIP.flips + 1) * FLIP.flipMs).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS);
  });
});

// ─── the curve ────────────────────────────────────────────────────────────────────────

/** A second, brute force bezier: sweep the parameter finely and read y where x is closest. */
function bruteBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= 200_000; i++) {
    const u = i / 200_000;
    const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    const err = Math.abs(bx - x);
    if (err < bestErr) {
      bestErr = err;
      best = 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
    }
  }
  return best;
}

describe('curve: EASE evaluated where a worklet can call it', () => {
  test("it is the kit's curve, and a second implementation agrees with it", () => {
    const [x1, y1, x2, y2] = EASE_BEZIER;
    for (const x of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(ease(x)).toBeCloseTo(bruteBezier(x, x1, y1, x2, y2), 4);
    }
  });

  test('the CSS reference values: linear is the identity, `ease` at 0.5 is 0.8024', () => {
    for (const x of [0, 0.2, 0.5, 0.8, 1]) expect(bezierAt(x, 0, 0, 1, 1)).toBeCloseTo(x, 6);
    expect(bezierAt(0.5, 0.25, 0.1, 0.25, 1)).toBeCloseTo(0.8024033877, 4);
  });

  test('ends pinned, monotonic, and a strong ease out (never eases in)', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(ease(0.25)).toBeGreaterThan(0.7);
    for (let i = 1; i < 100; i++) expect(ease(i / 100)).toBeGreaterThan(i / 100);
  });

  test('local progress, clamping and keyframes', () => {
    expect(localProgress(50, 100, 200)).toBe(0);
    expect(localProgress(200, 100, 200)).toBe(0.5);
    expect(localProgress(400, 100, 200)).toBe(1);
    expect(localProgress(99, 100, 0)).toBe(0);
    expect(localProgress(100, 100, 0)).toBe(1);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(lerp(-12, 0, 0.25)).toBe(-9);
    expect(keyframeAt([0, 0.5, 1], 0.25)).toBe(0.25);
    expect(keyframeAt([-12, 1.2, 0], 0)).toBe(-12);
    expect(keyframeAt([-12, 1.2, 0], 0.5)).toBe(1.2);
    expect(keyframeAt([-12, 1.2, 0], 0.75)).toBeCloseTo(0.6, 10);
    expect(keyframeAt([-12, 1.2, 0], 1)).toBe(0);
    expect(keyframeAt([-12, 1.2, 0], 7)).toBe(0);
    expect(keyframeAt([3], 0.4)).toBe(3);
    expect(keyframeAt([], 0.4)).toBe(0);
  });
});

// ─── splitting ────────────────────────────────────────────────────────────────────────

describe('segment: characters are graphemes, words keep their spaces, lines are the layout', () => {
  const E_ACUTE = 'e\u0301';
  const FLAGS = '\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}';
  const THUMB = 'a\u{1F44D}\u{1F3FD}b';
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  test('an accented letter, a flag, a skin tone and a joined family are one character each', () => {
    for (const useIntl of [true, false]) {
      expect(graphemes(`caf${E_ACUTE}`, useIntl)).toEqual(['c', 'a', 'f', E_ACUTE]);
      expect(graphemes(FLAGS, useIntl)).toHaveLength(2);
      expect(graphemes(THUMB, useIntl)).toHaveLength(3);
      expect(graphemes(FAMILY, useIntl)).toHaveLength(1);
      expect(graphemes('Hi. I\u2019m Bit.', useIntl)).toHaveLength(12);
    }
  });

  test('the fallback agrees with Intl.Segmenter on everything the app writes', () => {
    for (const s of ['Generalist', 'about 18m left', 'npx builda pair 4821', `caf${E_ACUTE} ${FLAGS}`, THUMB, FAMILY, '']) {
      expect(graphemes(s, false)).toEqual(graphemes(s, true));
    }
  });

  test('characters: every glyph a unit, numbered; a run of spaces one still unit', () => {
    const { units, next } = splitUnits("Hi.  I'm", 'chars');
    expect(units.map((u) => u.text)).toEqual(['H', 'i', '.', '  ', 'I', "'", 'm']);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2, -1, 3, 4, 5]);
    expect(next).toBe(6);
  });

  test('words: a word and the spaces after it are a unit, so the gap is the text system own', () => {
    const { units, next } = splitUnits("  Hi. I'm Bit.", 'words', 4);
    expect(units.map((u) => u.text)).toEqual(['  ', 'Hi. ', "I'm ", 'Bit.']);
    expect(units.map((u) => u.index)).toEqual([-1, 4, 5, 6]);
    expect(next).toBe(7);
    expect(unitCount('How long are your prompts?', 'words')).toBe(5);
    expect(unitCount('   ', 'words')).toBe(0);
    expect(unitCount('', 'chars')).toBe(0);
  });

  test('lines: the text system line breaks, trimmed of the space they broke on, numbered through', () => {
    const lines = [{ text: 'How long are \n' }, { text: 'your prompts?' }];
    const { lines: split, count } = unitsForLines(lines, 'words');
    expect(split.map((l) => l.map((u) => u.text))).toEqual([['How ', 'long ', 'are'], ['your ', 'prompts?']]);
    expect(split.flat().map((u) => u.index)).toEqual([0, 1, 2, 3, 4]);
    expect(count).toBe(5);
    expect(trimLineEnd('are \n')).toBe('are');
    expect(unitsForLines(lines, 'chars').count).toBe('Howlongareyourprompts?'.length);
  });

  test('kerning: each visible character is measured as the line through it, and alone', () => {
    expect(kerningProbes("Hi. I'm")).toEqual({
      prefixes: ['H', 'Hi', 'Hi.', 'Hi. I', "Hi. I'", "Hi. I'm"],
      glyphs: ['H', 'i', '.', 'I', "'", 'm'],
    });
    expect(kerningProbes('  a b')).toEqual({ prefixes: ['  a', '  a b'], glyphs: ['a', 'b'] });
    expect(kerningProbes('   ')).toEqual({ prefixes: [], glyphs: [] });
    // Through "Bi" is 30 wide and "i" alone 8: the "i" starts at 22, where the pair's kerning put it.
    expect(kernedOffsets([20, 30, 36], [20, 8, 6])).toEqual([0, 22, 30]);
    // The same trailing letter spacing sits in both widths and cancels.
    const ls = -0.8;
    expect(kernedOffsets([20 + ls, 30 + ls], [20 + ls, 8 + ls])).toEqual([0, 22]);
  });

  test('a layout event is used only when it is this text: a stale or truncated one is not', () => {
    expect(linesAreText([{ text: 'How long are ' }, { text: 'your prompts?' }], 'How long are your prompts?')).toBe(true);
    expect(linesAreText([{ text: 'How long are ' }], 'How long are your prompts?')).toBe(false);
    expect(linesAreText([{ text: 'Codex' }], 'Cursor')).toBe(false);
    const a = [{ text: 'x', x: 0, y: 0, width: 10, height: 20 }];
    expect(sameLines(a, [{ ...a[0]! }])).toBe(true);
    expect(sameLines(a, [{ ...a[0]!, x: 3 }])).toBe(false);
    expect(sameLines(a, null)).toBe(false);
    expect(sameLines(null, null)).toBe(true);
  });
});

// ─── the stagger ──────────────────────────────────────────────────────────────────────

describe("stagger: react-bits' staggerFrom, squeezed into rule 7", () => {
  test("ranks, as RotatingText's getStaggerDelay computes them", () => {
    expect(staggerRanks(5, 'first')).toEqual([0, 1, 2, 3, 4]);
    expect(staggerRanks(5, 'last')).toEqual([4, 3, 2, 1, 0]);
    expect(staggerRanks(5, 'center')).toEqual([2, 1, 0, 1, 2]);
    expect(staggerRanks(5, 1)).toEqual([1, 0, 1, 2, 3]);
    // One pivot for the whole text, not a new one per character.
    expect(staggerRanks(5, 'random', () => 0.99)).toEqual([4, 3, 2, 1, 0]);
    expect(staggerRanks(5, 'random', () => 0)).toEqual([0, 1, 2, 3, 4]);
    expect(staggerRanks(0, 'random')).toEqual([]);
  });

  test('the fit never slows a stagger down and never lets the last unit land late', () => {
    expect(fitStagger(9, 360, 24)).toBe(24);
    expect(fitStagger(59, 360, 24)).toBeCloseTo((1200 - 360) / 59, 10);
    expect(fitStagger(10, 1500, 24)).toBe(0);
    expect(fitStagger(0, 360, 24)).toBe(24);
    expect(staggeredTotal([0, 1, 2], 24, 360)).toBe(408);
    expect(staggeredTotal([], 24, 360)).toBe(0);
  });

  test("the hello greeting runs at the doc's own pace", () => {
    const plan = unitWindows(unitCount("Hi. I'm Bit.", 'chars'), { unitMs: SPLIT.charMs, staggerMs: SPLIT.staggerMs });
    expect(plan.staggerMs).toBe(24);
    expect(plan.totalMs).toBe(9 * 24 + 360);
    expect(plan.windows[3]).toEqual({ start: 72, duration: 360 });
  });

  test('every length, by characters and by words, lands within 1.2 s', () => {
    for (let n = 1; n <= 240; n++) {
      const chars = unitWindows(n, { unitMs: SPLIT.charMs, staggerMs: SPLIT.staggerMs });
      const words = unitWindows(n, { unitMs: SPLIT_WORDS.riseMs, staggerMs: SPLIT_WORDS.staggerMs });
      const blur = unitWindows(n, { unitMs: BLUR.stepMs * 2, staggerMs: BLUR.staggerMs });
      for (const p of [chars, words, blur]) {
        expect(p.totalMs).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS + 1e-9);
        for (const w of p.windows) expect(w.start + w.duration).toBeLessThanOrEqual(p.totalMs + 1e-9);
      }
    }
  });
});

// ─── the typewriter ───────────────────────────────────────────────────────────────────

const RB: TypeOptions = { typingMs: 50, deletingMs: 30, pauseMs: 2000, startMs: 0, loop: false };

describe("typewriter: react-bits' TextType, frame for frame", () => {
  test('one line: a character every typingSpeed, then it rests typed', () => {
    const plan = typeFrames(['abc'], RB);
    expect(plan.frames.map((f) => [f.at, f.typed])).toEqual([
      [0, 0],
      [50, 1],
      [100, 2],
      [150, 3],
    ]);
    expect(plan.cycleMs).toBeNull();
  });

  test('initialDelay comes before every line; the last line of a non loop is never deleted', () => {
    const plan = typeFrames(['ab', 'cd'], { ...RB, startMs: 100 });
    expect(plan.frames.map((f) => [f.at, f.index, f.typed, f.deleting])).toEqual([
      [0, 0, 0, false],
      [150, 0, 1, false],
      [200, 0, 2, false],
      [2200, 0, 2, true],
      [2230, 0, 1, true],
      [2260, 0, 0, true],
      [2410, 1, 1, false],
      [2460, 1, 2, false],
    ]);
    expect(plan.cycleMs).toBeNull();
  });

  test('loop: the last line is deleted too, and the cycle length is when the first comes back', () => {
    const plan = typeFrames(['ab', 'cd'], { ...RB, loop: true });
    const last = plan.frames[plan.frames.length - 1]!;
    expect(last).toEqual({ at: 100 + 2000 + 60 + 100 + 2000 + 60, index: 1, typed: 0, deleting: true });
    expect(plan.cycleMs).toBe(last.at);
  });

  test('characters are graphemes: a flag is one keystroke', () => {
    const plan = typeFrames(['go \u{1F1FA}\u{1F1F8}'], RB);
    expect(plan.frames).toHaveLength(1 + 4);
    expect(typedText(['go \u{1F1FA}\u{1F1F8}'], plan.frames[4]!)).toBe('go \u{1F1FA}\u{1F1F8}');
    expect(untypedText(['go \u{1F1FA}\u{1F1F8}'], plan.frames[2]!)).toBe(' \u{1F1FA}\u{1F1F8}');
  });

  test('variableSpeed draws each gap between min and max, and a seed repeats it', () => {
    const opts = { ...RB, variableSpeed: { min: 20, max: 80 } };
    const a = typeFrames(['npx builda pair 4821'], { ...opts, rng: mulberry32(3) });
    const b = typeFrames(['npx builda pair 4821'], { ...opts, rng: mulberry32(3) });
    expect(a).toEqual(b);
    for (let i = 1; i < a.frames.length; i++) {
      const gap = a.frames[i]!.at - a.frames[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThanOrEqual(80);
    }
  });

  test("the doc's single line: 18 ms a character, squeezed only when it would run past 1.2 s", () => {
    expect(fitTypingMs(20, TYPE.charMs, TEXT_EFFECT_DONE_MS)).toBe(18);
    expect(fitTypingMs(100, TYPE.charMs, TEXT_EFFECT_DONE_MS)).toBe(12);
    expect(fitTypingMs(10_000, TYPE.charMs, TEXT_EFFECT_DONE_MS)).toBe(1);
    expect(fitTypingMs(0, TYPE.charMs, TEXT_EFFECT_DONE_MS)).toBe(18);
    const line = 'npx builda pair 4821';
    const plan = typeFrames([line], { ...RB, typingMs: fitTypingMs(line.length, TYPE.charMs, TEXT_EFFECT_DONE_MS) });
    expect(plan.frames[plan.frames.length - 1]!.at).toBe(line.length * 18);
  });

  test('the caret: on, then three blinks, then gone; Infinity keeps blinking', () => {
    const beats = [0, 499, 500, 999, 1000, 1500, 2000, 2500, 3000, 3499, 3500, 9000].map((t) => caretVisible(t, 500, 3));
    expect(beats).toEqual([true, true, false, false, true, false, true, false, true, true, false, false]);
    expect(caretGoneAt(500, 3)).toBe(3500);
    expect(caretGoneAt(500, Infinity)).toBe(Infinity);
    expect(caretVisible(1_000_000, 500, Infinity)).toBe(true);
    expect(caretVisible(-5, 500, 3)).toBe(true);
  });
});

// ─── the split flap ───────────────────────────────────────────────────────────────────

describe("flap: react-bits' SplitFlapText plans", () => {
  test('charsets: react-bits named sets, a custom string, and auto by the target character', () => {
    expect(flapCharsetFor('numeric', 'x')).toBe('0123456789');
    expect(flapCharsetFor('alpha', 'x')).toBe(FLAP_CHARSETS.alpha);
    expect(flapCharsetFor('alphanumeric', 'x')).toBe(FLAP_CHARSETS.alphanumeric);
    expect(flapCharsetFor('xyz', 'q')).toBe('xyz');
    expect(flapCharsetFor('', 'q')).toBe(FLAP_CHARSETS.alphanumeric);
    expect(flapCharsetFor('auto', '7')).toBe(FLAP_CHARSETS.numeric);
    expect(flapCharsetFor('auto', 'Q')).toBe(FLAP_CHARSETS.alpha);
    expect(flapCharsetFor('auto', 'q')).toBe(FLAP_CHARSETS.lower);
    expect(flapCharsetFor('auto', ' ')).toBe(FLAP_CHARSETS.lower);
  });

  test("normalizePhrase: padded with spaces or cut, and the board's width", () => {
    expect(padPhrase('abc', 5)).toEqual(['a', 'b', 'c', ' ', ' ']);
    expect(padPhrase('abcdef', 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(flapWidth(['LAUNCH READY', 'SYNC ONLINE', 'SIGNAL LIVE'], 12)).toBe(12);
    expect(flapWidth(['no ETA yet', 'about 18m left'])).toBe(14);
    expect(flapWidth([])).toBe(1);
  });

  test('only changed tiles flip; each through `flips` characters then its target; tile i at i * stagger', () => {
    const from = padPhrase('no ETA yet', 14);
    const to = padPhrase('about 18m left', 14);
    const plans = flapPlans(from, to, { flips: FLIP.flips, staggerMs: FLIP.staggerMs, charset: 'auto', rng: mulberry32(7) });
    const changed = to.map((ch, i) => (ch !== from[i] ? i : -1)).filter((i) => i >= 0);
    expect(plans.map((p) => p.index)).toEqual(changed);
    for (const p of plans) {
      expect(p.sequence).toHaveLength(FLIP.flips + 1);
      expect(p.sequence[p.sequence.length - 1]).toBe(p.target);
      expect(p.start).toBe(p.index * FLIP.staggerMs);
      const set = flapCharsetFor('auto', p.target);
      for (const ch of p.sequence.slice(0, -1)) expect(set.includes(ch)).toBe(true);
    }
    // Seeded, so a screenshot of the same build shows the same flips.
    expect(flapPlans(from, to, { flips: 6, staggerMs: 60, rng: mulberry32(7) })).toEqual(
      flapPlans(from, to, { flips: 6, staggerMs: 60, rng: mulberry32(7) }),
    );
  });

  test("a tile's tick: before its start, each flip's current and next, then the target", () => {
    const [plan] = flapPlans(['a'], ['b'], { flips: 2, staggerMs: 0, charset: 'xy', rng: seq([0, 0.9]) });
    expect(plan!.sequence).toEqual(['x', 'y', 'b']);
    const at = (ms: number) => flapStateAt({ ...plan!, start: 60 }, ms, 120);
    expect(at(0)).toEqual({ current: 'a', next: 'a', flipping: false, step: -1 });
    expect(at(60)).toEqual({ current: 'a', next: 'x', flipping: true, step: 0 });
    expect(at(179)).toEqual({ current: 'a', next: 'x', flipping: true, step: 0 });
    expect(at(180)).toEqual({ current: 'x', next: 'y', flipping: true, step: 1 });
    expect(at(300)).toEqual({ current: 'y', next: 'b', flipping: true, step: 2 });
    expect(at(420)).toEqual({ current: 'b', next: 'b', flipping: false, step: 3 });
    expect(flapTotalMs([{ ...plan!, start: 60 }], 120)).toBe(420);
  });

  test('a flip shows every character of its sequence, in order, and nothing else', () => {
    const plans = flapPlans(padPhrase('no ETA yet', 14), padPhrase('about 18m left', 14), { flips: 6, staggerMs: 60, rng: mulberry32(1) });
    for (const p of plans) {
      const seen: string[] = [];
      let step = -1;
      for (let t = 0; t <= flapTotalMs(plans, 120); t += 5) {
        const s = flapStateAt(p, t, 120);
        if (s.flipping && s.step !== step) {
          step = s.step;
          seen.push(s.next);
        }
      }
      expect(seen).toEqual(p.sequence);
    }
  });

  test('the ETA change lands inside 1.2 s, by a tighter stagger before any fewer flips', () => {
    const to = padPhrase('about 18m left', 14);
    const from = padPhrase('no ETA yet', 14);
    let last = -1;
    to.forEach((ch, i) => {
      if (ch !== from[i]) last = i;
    });
    const fit = fitFlap(last, { flipMs: FLIP.flipMs, staggerMs: FLIP.staggerMs, flips: FLIP.flips }, TEXT_EFFECT_DONE_MS);
    expect(fit.flips).toBe(FLIP.flips);
    expect(fit.staggerMs).toBeLessThan(FLIP.staggerMs);
    const plans = flapPlans(from, to, { flips: fit.flips, staggerMs: fit.staggerMs, rng: mulberry32(2) });
    expect(flapTotalMs(plans, FLIP.flipMs)).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS + 1e-9);
    // A single tile whose own run is too long loses flips; a short change keeps the full stagger.
    expect(fitFlap(0, { flipMs: 300, staggerMs: 60, flips: 6 }, 1200).flips).toBe(3);
    expect(fitFlap(2, { flipMs: 120, staggerMs: 60, flips: 6 }, 1200)).toEqual({ staggerMs: 60, flips: 6 });
  });
});

// ─── the shuffle ──────────────────────────────────────────────────────────────────────

describe("strips: react-bits' Shuffle order", () => {
  test("the copies come from the word's own letters", () => {
    expect(shuffleCharset('Generalist')).toBe('Generalist'.split('').filter((c, i, a) => a.indexOf(c) === i).join(''));
    expect(shuffleCharset('A back and forth')).not.toContain(' ');
  });

  test('right and down start on the original at the far end and slide home; left and up the other way', () => {
    const rng = mulberry32(4);
    const right = shuffleStrip('G', 3, 'Generalist', rng, 'right');
    expect(right.cells).toHaveLength(5);
    expect(right.cells[0]).toBe('G');
    expect(right.cells[4]).toBe('G');
    expect([right.from, right.to]).toEqual([-4, 0]);
    for (const c of right.cells.slice(1, 4)) expect('Generalist'.includes(c)).toBe(true);
    expect([shuffleStrip('G', 3, '', rng, 'down').from, shuffleStrip('G', 3, '', rng, 'down').to]).toEqual([-4, 0]);
    const left = shuffleStrip('G', 1, '', rng, 'left');
    expect(left).toEqual({ cells: ['G', 'G', 'G'], from: 0, to: -2 });
    expect(shuffleStrip('G', 1, '', rng, 'up')).toEqual({ cells: ['G', 'G', 'G'], from: 0, to: -2 });
  });

  test('evenodd: odd characters from 0, 30 ms apart; even ones from 70% of the odd run', () => {
    const s = shuffleSchedule(10, { durationMs: 350, staggerMs: 30 });
    const odd = s.filter((_, i) => i % 2 === 1).map((t) => t.delay);
    const even = s.filter((_, i) => i % 2 === 0).map((t) => t.delay);
    expect(odd).toEqual([0, 30, 60, 90, 120]);
    const evenStart = (350 + 4 * 30) * 0.7;
    expect(even.map((d) => Math.round(d * 1000) / 1000)).toEqual([0, 1, 2, 3, 4].map((k) => Math.round((evenStart + k * 30) * 1000) / 1000));
    expect(shuffleTotalMs(s)).toBeCloseTo(evenStart + 120 + 350, 6);
    // One character has no odd group: it starts at once.
    expect(shuffleSchedule(1, { durationMs: 350, staggerMs: 30 })).toEqual([{ delay: 0, duration: 350 }]);
  });

  test('random: each waits up to maxDelay', () => {
    const s = shuffleSchedule(12, { mode: 'random', durationMs: 350, staggerMs: 30, maxDelayMs: 200, rng: mulberry32(9) });
    for (const t of s) {
      expect(t.delay).toBeGreaterThanOrEqual(0);
      expect(t.delay).toBeLessThan(200);
    }
  });

  test('every answer length lands within 1.2 s', () => {
    for (let n = 1; n <= 120; n++) {
      const stagger = fitShuffleStagger(n, SHUFFLE.ms, SHUFFLE.staggerMs);
      expect(stagger).toBeLessThanOrEqual(SHUFFLE.staggerMs);
      const s = shuffleSchedule(n, { durationMs: SHUFFLE.ms, staggerMs: stagger });
      expect(shuffleTotalMs(s)).toBeLessThanOrEqual(TEXT_EFFECT_DONE_MS + 1e-6);
    }
    expect(fitShuffleStagger('Generalist'.length, SHUFFLE.ms, SHUFFLE.staggerMs)).toBe(30);
  });
});

// ─── the rotation ─────────────────────────────────────────────────────────────────────

describe("rotate: react-bits' RotatingText bookkeeping", () => {
  test('next, previous, jumpTo; loop wraps and no loop rests on the ends', () => {
    expect(nextIndex(0, 3, false)).toBe(1);
    expect(nextIndex(2, 3, false)).toBe(2);
    expect(nextIndex(2, 3, true)).toBe(0);
    expect(previousIndex(0, 3, false)).toBe(0);
    expect(previousIndex(0, 3, true)).toBe(2);
    expect(previousIndex(2, 3, true)).toBe(1);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(-4, 3)).toBe(0);
    expect(nextIndex(0, 0, true)).toBe(0);
  });

  test('elements: characters by word with the space between, words, lines, any separator', () => {
    const chars = rotateElements('Claude Code');
    expect(chars).toEqual([
      { characters: ['C', 'l', 'a', 'u', 'd', 'e'], needsSpace: true },
      { characters: ['C', 'o', 'd', 'e'], needsSpace: false },
    ]);
    expect(elementCount(chars)).toBe(10);
    expect(rotateElements('Gemini CLI', 'words')).toEqual([
      { characters: ['Gemini'], needsSpace: true },
      { characters: ['CLI'], needsSpace: false },
    ]);
    expect(rotateElements('a\nb', 'lines').map((w) => w.characters)).toEqual([['a'], ['b']]);
    expect(rotateElements('a|b|c', '|')).toHaveLength(3);
  });

  test('delays across the words, and wait against sync', () => {
    expect(rotateDelays(rotateElements('ab cd'), 25)).toEqual([0, 25, 50, 75]);
    expect(rotateDelays(rotateElements('ab cd'), 25, 'last')).toEqual([75, 50, 25, 0]);
    const wait = rotationTiming({ lastDelayMs: 0, exitMs: ROTATE.exitMs }, { lastDelayMs: 0, enterMs: ROTATE.enterMs });
    expect(wait).toEqual({ enterAt: ROTATE.exitMs, exitDone: ROTATE.exitMs, done: ROTATE.exitMs + ROTATE.enterMs });
    const sync = rotationTiming({ lastDelayMs: 0, exitMs: ROTATE.exitMs }, { lastDelayMs: 0, enterMs: ROTATE.enterMs }, 'sync');
    expect(sync).toEqual({ enterAt: 0, exitDone: ROTATE.exitMs, done: ROTATE.enterMs });
    expect(rotationTiming(null, { lastDelayMs: 50, enterMs: 300 })).toEqual({ enterAt: 0, exitDone: 0, done: 350 });
  });
});

// ─── the bands ────────────────────────────────────────────────────────────────────────

describe('bands: flat steps, never a smooth ramp', () => {
  const dark = colors('dark');

  test('mixing is opaque sRGB between two token colours', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex(dark.textDim, dark.text, 0)).toBe(dark.textDim);
    expect(mixHex(dark.textDim, dark.text, 1)).toBe(dark.text);
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030');
    expect(() => parseHex('rgba(0,0,0,0.5)')).toThrow();
  });

  test('the shine: three steps from just above the base up to the peak, widest first', () => {
    const tones = shineTones(dark.textDim, dark.text, 3);
    expect(tones).toHaveLength(3);
    expect(tones[2]).toBe(dark.text);
    expect(new Set(tones).size).toBe(3);
    expect(tones).not.toContain(dark.textDim);
    expect(shineBandWidths(300)).toEqual([120, 80, 40]);
    expect(shineBandWidths(100)).toEqual([60, 40, 20]);
    expect(shineBandWidths(10)).toEqual([18, 12, 6]);
  });

  test('a pass runs off to off, and the cycle is react-bits (pass, hold, yoyo back)', () => {
    expect(skewReach(40, 30)).toBeCloseTo(Math.tan(Math.PI / 6) * 20, 10);
    expect(skewReach(40, 0)).toBe(0);
    expect(sweepCenter(0, 200, 30)).toBe(-30);
    expect(sweepCenter(1, 200, 30)).toBe(230);
    expect([0, 500, 999, 1500, 2000].map((t) => shineCycle(t, 1000, 1000, false))).toEqual([0, 0.5, 0.999, 1, 0]);
    expect([0, 500, 1500, 2500, 3500, 4000].map((t) => shineCycle(t, 1000, 1000, true))).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  test("a finite run ends as its last pass leaves; passes are whole", () => {
    expect(passCount(1)).toBe(1);
    expect(passCount(2.7)).toBe(2);
    expect(passCount(0)).toBe(1);
    expect(passCount(Infinity)).toBe(Infinity);
    expect(shineRunMs(1, SHINY.sweepMs, SHINY.pauseMs)).toBe(SHINY.sweepMs);
    expect(shineRunMs(3, 1000, 500)).toBe(2 * 1500 + 1000);
    expect(shineRunMs(Infinity, 1000, 500)).toBe(Infinity);
  });

  test("gradient tones: one hue's ink, lighter toward the text colour, deeper toward its own partner", () => {
    for (const name of HUE_NAMES) {
      const h = dark.hues[name];
      const tones = gradientTones(h.text, dark.text, GRADIENT.lifts, h.partner);
      expect(tones).toEqual([h.text, mixHex(h.text, dark.text, 0.3), h.text, mixHex(h.text, h.partner, 0.35)]);
      expect(new Set(tones).size).toBe(3);
      // Never the partner itself (it is never text), never the text colour itself.
      expect(tones).not.toContain(h.partner);
      expect(tones).not.toContain(dark.text);
    }
    // A bare colour has no partner: its deep band stays the ink.
    expect(gradientTones('#53A3F2', dark.text, [0, -0.35])).toEqual(['#53A3F2', '#53A3F2']);
  });

  test('the tiling covers the text at every shift, and a whole period lands on the same picture', () => {
    const W = 300;
    const H = 56;
    for (const reach of [0, skewReach(H, GRADIENT.skewDeg)]) {
      const L = gradientLayout(W, 4, GRADIENT.bandFraction, reach);
      expect(L.band).toBeCloseTo(100, 10);
      expect(L.period).toBeCloseTo(400, 10);
      const toneAt = (x: number, shift: number) => {
        for (let k = 0; k < L.count; k++) {
          const x0 = gradientBandX(k, shift, L.band, L.period, L.reach);
          if (x >= x0 && x < x0 + L.band) return k % 4;
        }
        return -1;
      };
      for (let shift = 0; shift <= L.period; shift += L.period / 16) {
        const first = gradientBandX(0, shift, L.band, L.period, L.reach);
        const end = gradientBandX(L.count - 1, shift, L.band, L.period, L.reach) + L.band;
        expect(first).toBeLessThanOrEqual(-L.reach + 1e-9);
        expect(end).toBeGreaterThanOrEqual(W + L.reach - 1e-9);
      }
      for (let x = -L.reach; x < W + L.reach; x += 7) expect(toneAt(x, L.period)).toBe(toneAt(x, 0));
    }
  });

  test("the drift: react-bits' yoyo triangle, or round and round", () => {
    expect([0, 4000, 8000, 12000, 16000].map((t) => gradientCycle(t, 8000, true))).toEqual([0, 0.5, 1, 0.5, 0]);
    expect([0, 4000, 7999, 8000].map((t) => Math.round(gradientCycle(t, 8000, false) * 1000) / 1000)).toEqual([0, 0.5, 1, 0]);
  });
});

// ─── the ink ──────────────────────────────────────────────────────────────────────────

describe('ink: a hue never fades slowly (DESIGN-V2 1.3)', () => {
  const c = colors('dark') as unknown as InkPalette;

  test('neutral tones fade as asked; a hue, amber, a data colour or a passed colour is identity', () => {
    expect(resolveInk(c, {})).toEqual({ color: c.text, identity: false });
    expect(resolveInk(c, { tone: 'dim' })).toEqual({ color: c.textDim, identity: false });
    expect(resolveInk(c, { tone: 'accent' }).identity).toBe(true);
    expect(resolveInk(c, { tone: 'add' }).identity).toBe(true);
    expect(resolveInk(c, { hue: 'tide' })).toEqual({ color: c.hues.tide.text, identity: true });
    expect(resolveInk(c, { color: c.hues.orchid.text }).identity).toBe(true);
    expect(resolveInk(c, { color: c.textDim }).identity).toBe(false);
    // `color` wins over `hue`, which wins over `tone`.
    expect(resolveInk(c, { tone: 'dim', hue: 'coral', color: c.hues.ember.text }).color).toBe(c.hues.ember.text);
    expect(resolveInk(c, { tone: 'dim', hue: 'coral' }).color).toBe(c.hues.coral.text);
  });

  test('an identity fade is capped at 120 ms; a neutral one is not', () => {
    expect(SNAP_FADE_MS).toBe(120);
    expect(fadeFor(true, 360)).toBe(120);
    expect(fadeFor(true, 60)).toBe(60);
    expect(fadeFor(false, 360)).toBe(360);
  });
});

// ─── the source ───────────────────────────────────────────────────────────────────────

const DIR = join(import.meta.dir, '..', 'src', 'ui', 'bits', 'text');
const sources = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ name: f, src: readFileSync(join(DIR, f), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const COMPONENTS = ['SplitText', 'BlurText', 'RotatingText', 'TextType', 'ShinyText', 'GradientText', 'Shuffle', 'SplitFlapText'];

describe('the ports keep their licence and the kit rules (static checks on src/ui/bits/text)', () => {
  test('all eight components exist and the barrel exports them', () => {
    const index = sources.find((f) => f.name === 'index.ts')!.src;
    for (const name of COMPONENTS) {
      expect(sources.some((f) => f.name === `${name}.tsx`)).toBe(true);
      expect(index).toContain(`export { ${name},`);
    }
  });

  test("every file carries David Haz's notice: the copyright, the permission and the Commons Clause", () => {
    for (const f of sources) {
      // The header comment, its line breaks and leading stars folded into single spaces.
      const head = f.src.slice(0, f.src.indexOf('*/') + 2).replace(/\s*\n\s*\*?\s*/g, ' ');
      expect({ file: f.name, haz: head.includes('David Haz') }).toEqual({ file: f.name, haz: true });
      expect({ file: f.name, year: head.includes('Copyright (c) 2026 David Haz') }).toEqual({ file: f.name, year: true });
      expect({ file: f.name, grant: head.includes('Permission is hereby granted') }).toEqual({ file: f.name, grant: true });
      expect({ file: f.name, clause: head.includes('Commons Clause Restriction') }).toEqual({ file: f.name, clause: true });
    }
  });

  test('each component port names its react-bits source', () => {
    for (const name of COMPONENTS) {
      const src = sources.find((f) => f.name === `${name}.tsx`)!.src;
      expect(src).toContain(`TextAnimations/${name}/${name}.tsx`);
    }
  });

  test('no colour literal: colours come from the tokens through theme.ts', () => {
    for (const f of sources) {
      const hits = code(f.src).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('no gradient anywhere: no gradient shader or component, only flat bands', () => {
    for (const f of sources) {
      const used = /(Linear|Radial|Sweep|TwoPointConical)Gradient\b|linear-gradient|<Shader\b/.test(code(f.src));
      expect({ file: f.name, used }).toEqual({ file: f.name, used: false });
    }
  });

  test('no transform ever rides an Animated.Text (dropped at mount on this build)', () => {
    for (const f of sources) expect({ file: f.name, animatedText: code(f.src).includes('Animated.Text') }).toEqual({ file: f.name, animatedText: false });
  });

  test('every radius is from the scale, and continuous', () => {
    for (const f of sources) {
      const c = code(f.src);
      for (const m of c.matchAll(/borderRadius:\s*([^,}\n]+)/g)) expect(/^SHAPE[.[]/.test((m[1] ?? '').trim())).toBe(true);
      expect((c.match(/borderRadius:/g) ?? []).length).toBe((c.match(/borderCurve:\s*'continuous'/g) ?? []).length);
    }
  });

  test('every component has a Reduce Motion path', () => {
    for (const name of COMPONENTS) {
      const src = code(sources.find((f) => f.name === `${name}.tsx`)!.src);
      expect({ name, reduce: src.includes('useReduceMotion()') }).toEqual({ name, reduce: true });
    }
  });

  test('no emoji, and no haptic: a text effect never adds one of its own (rule 10)', () => {
    for (const f of sources) {
      expect({ file: f.name, emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({ file: f.name, emoji: false });
      expect({ file: f.name, haptics: /expo-haptics|haptics\./.test(code(f.src)) }).toEqual({ file: f.name, haptics: false });
    }
  });

  test('the pure modules import no React Native, so this file can hold them', () => {
    for (const name of ['spec.ts', 'curve.ts', 'segment.ts', 'stagger.ts', 'bands.ts', 'typewriter.ts', 'flap.ts', 'strips.ts', 'rotate.ts', 'ink.ts']) {
      const src = code(sources.find((f) => f.name === name)!.src);
      expect({ name, rn: /from 'react-native|from 'react'/.test(src) }).toEqual({ name, rn: false });
    }
  });
});
