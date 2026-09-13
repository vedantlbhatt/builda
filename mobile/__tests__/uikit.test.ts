/**
 * The UI kit's logic, without a renderer: the motion vocabulary, the haptics gate, the type
 * roles, the rolling-digit arithmetic, the count-up formatter, the decrypt frames and the
 * verdict and ring geometry. Every component in src/ui draws from these, so a wrong number
 * here is a wrong frame on every screen.
 */
import { describe, expect, test } from 'bun:test';

import { DECRYPT_CHARSET, DECRYPT_MAX_TICKS, decryptFrame, decryptFrames, mulberry32, revealPerTick, visibleCount } from '../src/ui/decrypt';
import { digitOffset, integerDigits, normalizeNearInteger, placesFor, restingDigit, valueAtPlace } from '../src/ui/digits';
import { decimalsOf, formatCount, groupThousands } from '../src/ui/format';
import { HAPTIC_KINDS, HAPTIC_MIN_GAP_MS, shouldFire } from '../src/ui/hapticsGate';
import {
  COUNT_UP_MS,
  DECRYPT_TICK_MS,
  EASE_BEZIER,
  POP,
  PRESS_SCALE,
  REDUCED_FADE,
  SHEET,
  SNAP,
  STAGGER,
  STAGGER_CAP,
  T,
  exitMs,
  staggerDelay,
} from '../src/ui/motionSpec';
import { dottedTrack, ringStroke } from '../src/ui/shape';
import { ROLES, amberTextProblem, roleScaling, roleStyle } from '../src/ui/typeStyle';
import { VERDICTS, VERDICT_PATHS, verdictDash, verdictStroke } from '../src/ui/verdicts';

describe('motion: the vocabulary, exactly as the doc writes it', () => {
  test('springs', () => {
    expect(SNAP).toEqual({ duration: 400, dampingRatio: 1 });
    expect(SHEET).toEqual({ duration: 300, dampingRatio: 0.8 });
    expect(POP).toEqual({ duration: 450, dampingRatio: 0.72 });
  });

  test('the one curve and the durations', () => {
    expect([...EASE_BEZIER]).toEqual([0.23, 1, 0.32, 1]);
    expect(T).toEqual({ press: 120, micro: 180, std: 240, enter: 300 });
    expect(STAGGER).toBe(40);
    expect(PRESS_SCALE).toBe(0.97);
    expect(REDUCED_FADE).toBe(150);
    expect(COUNT_UP_MS).toBe(800);
    expect(DECRYPT_TICK_MS).toBe(40);
  });

  test('every timing is under 300ms except the two first-reveal effects', () => {
    for (const ms of Object.values(T)) expect(ms).toBeLessThanOrEqual(300);
  });

  test('exits are 0.7x their entrance', () => {
    expect(exitMs(T.enter)).toBe(210);
    expect(exitMs(T.press)).toBe(84);
    for (const ms of Object.values(T)) expect(exitMs(ms)).toBeLessThan(ms);
  });

  test('stagger is 40ms per item and stops growing at 8 items', () => {
    expect([0, 1, 2, 7].map(staggerDelay)).toEqual([0, 40, 80, 280]);
    expect(staggerDelay(STAGGER_CAP)).toBe(320);
    expect(staggerDelay(50)).toBe(staggerDelay(STAGGER_CAP));
    expect(staggerDelay(-3)).toBe(0);
  });
});

describe('haptics: five kinds, one per action', () => {
  test('the table has the five rows, in order', () => {
    expect([...HAPTIC_KINDS]).toEqual(['select', 'snap', 'commit', 'success', 'failure']);
  });

  test('a second haptic of one kind inside the gap is one action firing twice, and is dropped', () => {
    expect(shouldFire(1000, undefined)).toBe(true);
    expect(shouldFire(1000 + HAPTIC_MIN_GAP_MS - 1, 1000)).toBe(false);
    expect(shouldFire(1000 + HAPTIC_MIN_GAP_MS, 1000)).toBe(true);
  });

  test('a loop calling it every frame fires at most once per gap', () => {
    let last: number | undefined;
    let fired = 0;
    for (let t = 0; t < 1000; t += 16) {
      if (shouldFire(t, last)) {
        fired += 1;
        last = t;
      }
    }
    expect(fired).toBeLessThanOrEqual(Math.ceil(1000 / HAPTIC_MIN_GAP_MS));
  });
});

describe('type roles as React Native style', () => {
  test('hero: 56/800/-1.5, line 56, tabular', () => {
    expect(roleStyle('hero')).toEqual({
      fontSize: 56,
      fontWeight: '800',
      letterSpacing: -1.5,
      lineHeight: 56,
      fontVariant: ['tabular-nums'],
    });
  });

  test('every role is tabular, and only mono is SF Mono', () => {
    for (const role of ROLES) {
      const s = roleStyle(role);
      expect(s.fontVariant).toEqual(['tabular-nums']);
      expect(s.fontFamily).toBe(role === 'mono' ? 'ui-monospace' : undefined);
    }
  });

  test('line heights are whole points', () => {
    for (const role of ROLES) expect(Number.isInteger(roleStyle(role).lineHeight)).toBe(true);
    expect(roleStyle('body').lineHeight).toBe(23);
  });

  test('a weight inside the role, for the doc three: stat 700, needs you 600, verdict 500', () => {
    expect(roleStyle('headline', 700).fontWeight).toBe('700');
    expect(roleStyle('meta', 600).fontWeight).toBe('600');
    expect(roleStyle('meta', 500).fontSize).toBe(13);
  });

  test('Dynamic Type: hero, display and label fixed; body and meta to 2x; the rest to 1.5x', () => {
    expect(roleScaling('hero')).toEqual({ allowFontScaling: false });
    expect(roleScaling('display')).toEqual({ allowFontScaling: false });
    expect(roleScaling('label')).toEqual({ allowFontScaling: false });
    expect(roleScaling('body')).toEqual({ allowFontScaling: true, maxFontSizeMultiplier: 2 });
    expect(roleScaling('meta')).toEqual({ allowFontScaling: true, maxFontSizeMultiplier: 2 });
    for (const r of ['title', 'headline', 'row', 'mono'] as const) {
      expect(roleScaling(r)).toEqual({ allowFontScaling: true, maxFontSizeMultiplier: 1.5 });
    }
  });

  test('amber text: 13pt semibold and up, dark only', () => {
    expect(amberTextProblem('meta', 600, 'dark')).toBeNull(); // "needs you"
    expect(amberTextProblem('row', 600, 'dark')).toBeNull(); // the Wrapped question
    expect(amberTextProblem('meta', 400, 'dark')).not.toBeNull();
    expect(amberTextProblem('label', 600, 'dark')).not.toBeNull();
    expect(amberTextProblem('display', 800, 'light')).not.toBeNull();
  });
});

describe('Counter: the rolling digit arithmetic (react-bits port)', () => {
  test('columns, most significant first, with grouping and decimals', () => {
    expect(placesFor(7)).toEqual([1]);
    expect(placesFor(1204)).toEqual([1000, ',', 100, 10, 1]);
    expect(placesFor(1204, { grouping: false })).toEqual([1000, 100, 10, 1]);
    expect(placesFor(1204.5, { decimals: 1 })).toEqual([1000, ',', 100, 10, 1, '.', 0.1]);
    expect(placesFor(3.42, { decimals: 2 })).toEqual([1, '.', 0.1, 0.01]);
    expect(placesFor(1234567)).toEqual([1000000, ',', 100000, 10000, 1000, ',', 100, 10, 1]);
    expect(placesFor(5, { minDigits: 3 })).toEqual([100, 10, 1]);
  });

  test('integer digits', () => {
    expect([0, 9, 10, 999, 1000, 12.9].map(integerDigits)).toEqual([1, 1, 2, 3, 4, 2]);
  });

  test('the value each column springs to', () => {
    expect(valueAtPlace(1204, 1000)).toBe(1);
    expect(valueAtPlace(1204, 100)).toBe(12);
    expect(valueAtPlace(1204, 10)).toBe(120);
    expect(valueAtPlace(1204, 1)).toBe(1204);
    // 0.3 / 0.1 is 2.9999999999999996 in binary, so a plain floor shows the digit 2 for
    // 0.3; the port's guard snaps it to 3. Same for 4.35 at the hundredths.
    expect(Math.floor(0.3 / 0.1)).toBe(2);
    expect(valueAtPlace(0.3, 0.1)).toBe(3);
    expect(Math.floor(4.35 / 0.01)).toBe(434);
    expect(valueAtPlace(4.35, 0.01)).toBe(435);
    expect(normalizeNearInteger(2.9999999999999996)).toBe(3);
    expect(normalizeNearInteger(122.5)).toBe(122.5);
  });

  test('at rest, the matching numeral sits at 0 and its neighbours one row away', () => {
    const h = 20;
    expect(digitOffset(7, 7, h)).toBe(0);
    expect(digitOffset(8, 7, h)).toBe(h); // next waits below
    expect(digitOffset(6, 7, h)).toBe(-h); // previous above
    expect(digitOffset(2, 7, h)).toBe(5 * h); // five away stays below
    expect(digitOffset(1, 7, h)).toBe(4 * h);
    expect(digitOffset(3, 7, h)).toBe(-4 * h); // six away wraps above
  });

  test('9 to 10 rolls one row up, the short way: 0 waits just below 9', () => {
    const h = 20;
    expect(digitOffset(0, 9, h)).toBe(h);
    expect(digitOffset(0, 10, h)).toBe(0);
    expect(digitOffset(9, 10, h)).toBe(-h);
  });

  test('mid spring, the outgoing and incoming numerals are exactly one row apart', () => {
    const h = 20;
    const a = digitOffset(7, 7.25, h);
    const b = digitOffset(8, 7.25, h);
    expect(a).toBeCloseTo(-0.25 * h);
    expect(b).toBeCloseTo(0.75 * h);
    expect(b - a).toBeCloseTo(h);
  });

  test('every numeral stays inside the ten row band, and exactly one is at 0 at rest', () => {
    const h = 17;
    for (let v = 0; v < 40; v++) {
      const offsets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => digitOffset(d, v, h));
      for (const o of offsets) {
        expect(o).toBeGreaterThanOrEqual(-4 * h);
        expect(o).toBeLessThanOrEqual(5 * h);
      }
      expect(offsets.filter((o) => o === 0)).toHaveLength(1);
      expect(offsets.indexOf(0)).toBe(restingDigit(v));
    }
  });
});

describe('CountUp: the worklet formatter', () => {
  test('grouping, decimals, prefix and suffix, without Intl', () => {
    expect(formatCount(229367, 0, true, '', '')).toBe('229,367');
    expect(formatCount(229367, 0, false, '', '')).toBe('229367');
    expect(formatCount(1234.5, 1, true, '', '')).toBe('1,234.5');
    expect(formatCount(3.4, 2, true, '$', '')).toBe('$3.40');
    expect(formatCount(108, 0, true, '', ' words')).toBe('108 words');
    expect(formatCount(0, 0, true, '', '')).toBe('0');
  });

  test('rounds half away from zero, and a value that rounds to zero has no sign', () => {
    expect(formatCount(0.5, 0, true, '', '')).toBe('1');
    expect(formatCount(2.675, 2, true, '', '')).toBe('2.68');
    expect(formatCount(-88, 0, true, '', '')).toBe('-88');
    expect(formatCount(-0.004, 2, true, '', '')).toBe('0.00');
  });

  test('thousands by hand', () => {
    expect(['1', '12', '123', '1234', '1234567'].map(groupThousands)).toEqual(['1', '12', '123', '1,234', '1,234,567']);
  });

  test('decimal places written in a number (the original getDecimalPlaces)', () => {
    expect([12, 12.5, 12.25, 1e21, 0.1].map(decimalsOf)).toEqual([0, 1, 2, 0, 1]);
  });

  test('a count from 0 to 1,204 never changes width except where a comma arrives', () => {
    const frames = Array.from({ length: 49 }, (_, i) => formatCount((1204 * i) / 48, 0, true, '', ''));
    expect(frames[0]).toBe('0');
    expect(frames[48]).toBe('1,204');
    for (let i = 1; i < frames.length; i++) {
      expect(Number(frames[i]!.replace(/,/g, ''))).toBeGreaterThanOrEqual(Number(frames[i - 1]!.replace(/,/g, '')));
    }
  });
});

describe('DecryptedText: the frames (react-bits port), seeded', () => {
  const text = 'Q7ZK2XW9PL somehow the agent knew';

  test('a seed makes the scramble exactly repeatable', () => {
    expect(decryptFrames(text, mulberry32(42))).toEqual(decryptFrames(text, mulberry32(42)));
    expect(decryptFrames(text, mulberry32(42))).not.toEqual(decryptFrames(text, mulberry32(43)));
  });

  test('mulberry32 is pinned: the first values for seed 1 never change', () => {
    const r = mulberry32(1);
    const first = [r(), r(), r()].map((v) => Math.round(v * 1e6));
    expect(first).toEqual([627074, 2736, 527447]);
  });

  test('the first frame is fully scrambled, the last is the text, spaces never move', () => {
    const frames = decryptFrames(text, mulberry32(7));
    expect(frames[frames.length - 1]).toBe(text);
    for (const f of frames) {
      expect(f).toHaveLength(text.length);
      for (let i = 0; i < text.length; i++) if (text[i] === ' ') expect(f[i]).toBe(' ');
    }
    const first = frames[0]!;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ' ') expect(DECRYPT_CHARSET).toContain(first[i]!);
    }
  });

  test('sequential from the start: frame k shows the first k visible characters', () => {
    const short = 'Generalist';
    const frames = decryptFrames(short, mulberry32(3));
    expect(frames).toHaveLength(short.length + 1);
    frames.forEach((f, k) => {
      expect(f.slice(0, k)).toBe(short.slice(0, k));
    });
  });

  test('a space never costs a tick', () => {
    expect(visibleCount('a b  c')).toBe(3);
    const f = decryptFrame('ab cd', 3, mulberry32(1));
    expect(f.slice(0, 4)).toBe('ab c');
  });

  test('a long quote reveals several characters a tick and still ends inside 1.6s', () => {
    const long = 'We have all been there. '.repeat(10);
    const step = revealPerTick(long);
    expect(step).toBeGreaterThan(1);
    const frames = decryptFrames(long, mulberry32(9));
    expect(frames.length - 1).toBeLessThanOrEqual(DECRYPT_MAX_TICKS);
    expect((frames.length - 1) * DECRYPT_TICK_MS).toBeLessThanOrEqual(1600);
  });

  test('the charset is Builder\'s, not the original alphabet', () => {
    expect(DECRYPT_CHARSET).toBe('01{}[]<>/=+*');
  });
});

describe('verdict glyphs and the ring: drawn geometry', () => {
  test('three verdicts, drawn with lines and arcs inside the 16 unit grid', () => {
    expect([...VERDICTS]).toEqual(['converging', 'circling', 'lost']);
    for (const v of VERDICTS) {
      const d = VERDICT_PATHS[v].d;
      expect(/^[MLA0-9.\s-]+$/.test(d)).toBe(true);
      const coords = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (const n of coords) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(16);
      }
    }
  });

  test('only lost is dashed; the stroke lands as 2pt at any size', () => {
    expect(VERDICTS.filter((v) => VERDICT_PATHS[v].dashed)).toEqual(['lost']);
    for (const size of [12, 16, 24, 48]) expect((verdictStroke(size) * size) / 18).toBeCloseTo(2);
    const [on, off] = verdictDash(verdictStroke(12));
    expect(off).toBeGreaterThan(on);
  });

  test('ring stroke is 5pt at the Lock Screen size and never under 2', () => {
    expect(ringStroke(44)).toBe(5);
    expect(ringStroke(24)).toBe(3);
    expect(ringStroke(8)).toBe(2);
  });

  test('the no ETA track is whole dots evenly round the circle', () => {
    for (const size of [24, 44, 64]) {
      const stroke = ringStroke(size);
      const { count, interval } = dottedTrack(size, stroke);
      const circumference = Math.PI * (size - stroke);
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count * interval).toBeCloseTo(circumference);
      expect(interval).toBeGreaterThan(stroke); // dots, not a solid line
    }
  });
});
