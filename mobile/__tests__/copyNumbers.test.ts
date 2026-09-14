/**
 * Numbers said exactly as the engine says them (`src/copy/numbers.ts`).
 *
 * ONE ROUNDING RULE on both sides (`analysis/plain.half_up`, `scaledHalfUp` here): a tie AWAY
 * from zero, read off the number as it is written, the decimal point moved in decimal. FOUND
 * IN THE CAPTURE (2026-09-14): "18% of instructions landed clean" for 120 of 647, a share sent
 * as 0.185 and rounded the way Python's `round` rounds, a tie to the even digit, off the double
 * a hair under 0.185; every other percentage rounded half up. Every helper is held to hand
 * checked values here, and to Python itself when python3 is on the machine (the `dither.test.ts`
 * rule).
 */
import { describe, expect, test } from 'bun:test';

import {
  clock,
  about,
  commas,
  count,
  fill,
  floorMins,
  human,
  inTen,
  mins,
  n,
  pct,
  percentOf,
  pyFixed,
  pyFloorDiv,
  pyRound,
  scaledHalfUp,
  shareWords,
} from '../src/copy/numbers';
import { hasDash, ordinal, spoken } from '../src/copy/plain';
import { python } from './pythonRef';

describe('one rounding rule: a tie up, off the number as written', () => {
  test('the capture: 120 of 647 instructions landed clean is 19%, however it arrives', () => {
    expect(pct(0.185)).toBe('19%');
    expect(pct(120 / 647)).toBe('19%');
    expect(percentOf(0.185)).toBe(19);
  });

  test('an exact tie goes UP, never to the even digit', () => {
    expect(pyRound(0.5)).toBe(1);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5)).toBe(3);
    expect(pyRound(-2.5)).toBe(-3);
    expect(pyRound(0.125, 2)).toBe(0.13);
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyFixed(12.5, 0)).toBe('13');
    expect(pyFixed(13.5, 0)).toBe('14');
    expect(pct(0.125)).toBe('13%');
  });

  test('a value that LOOKS like a tie is one: the digits a person reads, not the double under them', () => {
    // 2.675 is stored as 2.67499999999999982236431605997495353221893310546875; it is written 2.675.
    expect(pyRound(2.675, 2)).toBe(2.68);
    expect(pyRound(1.005, 2)).toBe(1.01);
    expect(pyRound(0.15, 1)).toBe(0.2);
    expect(pyRound(0.35, 1)).toBe(0.4);
    expect(pct(0.285)).toBe('29%');
  });

  test('the point moves in decimal: a share as a percent, tokens as thousands or millions', () => {
    expect(scaledHalfUp(0.185, 0, 2)).toBe(19n);
    expect(scaledHalfUp(12_500, 0, -3)).toBe(13n);
    expect(scaledHalfUp(3_631_450_000, 1, -6)).toBe(36315n);
    expect(scaledHalfUp(-0.185, 0, 2)).toBe(-19n);
  });

  test('not a tie goes to the nearer side', () => {
    expect(pct(0.1849)).toBe('18%');
    expect(pct(0.004)).toBe('0%');
    expect(pyRound(0.18547, 3)).toBe(0.185);
  });

  test('pyFixed groups thousands only when asked', () => {
    expect(pyFixed(1873.42, 0, true)).toBe('1,873');
    expect(pyFixed(1234567.891, 1, true)).toBe('1,234,567.9');
    expect(pyFixed(1234567.891, 1)).toBe('1234567.9');
    expect(pyFixed(0.004, 2)).toBe('0.00');
    expect(pyFixed(-0.04, 1)).toBe('-0.0');
    expect(commas(64680)).toBe('64,680');
    expect(commas(999)).toBe('999');
    expect(() => commas(1.5)).toThrow();
  });

  test("Python's float floor division, not Math.floor of a rounded quotient", () => {
    expect(pyFloorDiv(3585, 60)).toBe(59);
    expect(pyFloorDiv(3600, 60)).toBe(60);
    expect(pyFloorDiv(59.999, 60)).toBe(0);
  });
});

describe('profile.py and feedback.py, said the same way', () => {
  test('_n: one decimal at most, no trailing .0, rounded FIRST', () => {
    expect(n(4.96)).toBe('5');
    expect(n(4.94)).toBe('4.9');
    expect(n(30.25)).toBe('30.3');
    expect(n(1234.55)).toBe('1,234.6');
    expect(n(64680)).toBe('64,680');
    expect(n(1234.56)).toBe('1,234.6');
    expect(n(0)).toBe('0');
  });

  test('_count agrees the noun with the number as given', () => {
    expect(count(1, 'session')).toBe('1 session');
    expect(count(3, 'session')).toBe('3 sessions');
    expect(count(1, 'fix', 'fixes')).toBe('1 fix');
    expect(count(2, 'fix', 'fixes')).toBe('2 fixes');
    // Python compares `n == 1` before rounding: 1.04 prints "1" and keeps the plural.
    expect(count(1.04, 'prompt')).toBe('1 prompts');
  });

  test('_pct, in_ten, _mins and _floor_mins', () => {
    expect(pct(0.222)).toBe('22%');
    expect(pct(0.596)).toBe('60%');
    expect(inTen(0.45)).toBe(5);
    expect(inTen(0.433)).toBe(4);
    expect(mins(20)).toBe('under a minute');
    expect(mins(60)).toBe('1 minute');
    expect(mins(90)).toBe('2 minutes');
    expect(mins(150)).toBe('3 minutes');
    expect(mins(30)).toBe('1 minute');
    expect(mins(3900)).toBe('1h 05m');
    expect(floorMins(3585)).toBe('59 minutes');
    expect(floorMins(3900)).toBe('1h 05m');
    expect(floorMins(59)).toBe('under a minute');
  });

  test("burn's token counts and shares", () => {
    expect(human(999)).toBe('999');
    expect(human(1_499)).toBe('1k');
    expect(human(999_499)).toBe('999k');
    expect(human(999_500)).toBe('1.0M');
    expect(human(12_900_311)).toBe('12.9M');
    // The millions are grouped like every other number (the phone's one departure from _human).
    expect(human(3_766_512_000)).toBe('3,766.5M');
    expect(human(999_949_999)).toBe('999.9M');
    expect(human(999_950_000)).toBe('1,000.0M');
    expect(human(12_500)).toBe('13k');
    expect(shareWords(0.004)).toBe('under 1%');
    expect(shareWords(0)).toBe('0%');
    expect(shareWords(0.996)).toBe('over 99%');
    expect(shareWords(1)).toBe('100%');
    expect(shareWords(0.945)).toBe('95%');
    expect(shareWords(0.005)).toBe('1%');
    expect(about(0.4)).toBe('About 40%');
    expect(about(0.996)).toBe('Over 99%');
    expect(about(1)).toBe('All of it'); // never "About 100%" (the now3 pass)
  });

  test('fill: slots, agreed nouns, forms by n, and a hole is null, never a sentence', () => {
    expect(fill('{n:session} with you there, {needed} needed', { n: 1, needed: 3 })).toBe('1 session with you there, 3 needed');
    expect(fill('{n:session} with you there, {needed} needed', { n: 2, needed: 3 })).toBe('2 sessions with you there, 3 needed');
    const forms = { zero: 'none at all', one: 'just the 1', other: '{n:thing} in all' };
    expect(fill(forms, { n: 0 })).toBe('none at all');
    expect(fill(forms, { n: 1 })).toBe('just the 1');
    expect(fill(forms, { n: 1234 })).toBe('1,234 things in all');
    expect(fill('{commit_refusal}; {n}', { commit_refusal: 'no commit subjects were read', n: 2 })).toBe('no commit subjects were read; 2');
    expect(fill('fewer than {needed} sessions', { needed: null })).toBeNull();
    expect(fill('fewer than {needed} sessions', {})).toBeNull();
  });
});

describe('plain.py', () => {
  test('spoken and ordinal', () => {
    expect([0, 6, 20, 21, 34].map(spoken)).toEqual(['zero', 'six', 'twenty', '21', '34']);
    expect([1, 3, 10, 11, 12, 13, 21, 22, 23, 111, 0].map(ordinal)).toEqual([
      'first', 'third', 'tenth', '11th', '12th', '13th', '21st', '22nd', '23rd', '111th', '0th',
    ]);
  });

  test('has_dash: the four characters and a spaced hyphen; a hyphen in a word or before a digit is not one', () => {
    for (const cp of [0x2014, 0x2013, 0x2015, 0x2212]) expect(hasDash(`a ${String.fromCharCode(cp)} b`)).toBe(true);
    expect(hasDash('one thing - another')).toBe(true);
    expect(hasDash('one thing -- another')).toBe(true);
    expect(hasDash("What's your go-to prompt?")).toBe(false);
    expect(hasDash('+64,680 -9,021')).toBe(false);
    expect(hasDash('--json')).toBe(false);
  });
});

describe('against Python itself (skipped without python3)', () => {
  const VALUES = [0, 0.004, 0.005, 0.0049, 0.125, 0.15, 0.222, 0.35, 0.375, 0.45, 0.5, 0.596, 0.945, 0.9449, 0.995, 0.996, 1,
    1.005, 1.04, 1.5, 2.5, 2.675, 4.94, 4.95, 4.96, 29.85, 30.25, 60.5, 999, 999.5, 1499, 999_499, 999_500, 1234.56,
    64680, 12_900_311, 4_168_469_723];
  const SECONDS = [0, 29, 30, 31, 89, 90, 91, 149, 150, 3585, 3599, 3600, 3629, 3630, 3900, 11_100];

  test('n, count, pct, in_ten, mins, _floor_mins, human and share words agree on every value', () => {
    const py = python<Record<string, unknown[]>>(
      `
import json
from analysis import profile as pf, feedback as fb, burn as b, wrapped as w, plain as pl
vals = json.loads(sys.argv[1]); secs = json.loads(sys.argv[2])
print(json.dumps({
  "n": [pf._n(v) for v in vals],
  "count": [pf._count(v, "prompt") for v in vals],
  "pct": [pf._pct(v) for v in vals],
  "in_ten": [pf.in_ten(v) for v in vals],
  "round2": [pl.rounded(v, 2) for v in vals],
  "fixed1": [str(pl.half_up(v, 1)) for v in vals],
  "share": [b._share_words(v) for v in vals if v <= 1],
  "human": [b._human(int(v)) for v in vals],
  "mins": [fb._mins(s) for s in secs],
  "floor": [w._floor_mins(s) for s in secs],
}))`,
      JSON.stringify(VALUES),
      JSON.stringify(SECONDS)
    );
    if (py === null) return; // no python3 new enough to import the engine here
    expect(VALUES.map(n)).toEqual(py.n as string[]);
    expect(VALUES.map((v) => count(v, 'prompt'))).toEqual(py.count as string[]);
    expect(VALUES.map(pct)).toEqual(py.pct as string[]);
    expect(VALUES.map(inTen)).toEqual(py.in_ten as number[]);
    expect(VALUES.map((v) => pyRound(v, 2))).toEqual(py.round2 as number[]);
    expect(VALUES.map((v) => pyFixed(v, 1))).toEqual(py.fixed1 as string[]);
    expect(VALUES.filter((v) => v <= 1).map(shareWords)).toEqual(py.share as string[]);
    // One grouping rule on both sides (`burn._human` writes `plain.half_up(n, 1, scale=-6)` with
    // `,`), so the pin is the bytes at every size, 4,168.5M included.
    expect(VALUES.map((v) => human(Math.trunc(v)))).toEqual(py.human as string[]);
    expect(SECONDS.map(mins)).toEqual(py.mins as string[]);
    expect(SECONDS.map(floorMins)).toEqual(py.floor as string[]);
  });
});

describe('clock: exact seconds for a block of numbers', () => {
  test('the CLI numbers block\'s rule, against analysis/__main__._clock', () => {
    const secs = [0, 1, 59, 60, 61, 162, 215, 420, 3585, 3600, 3661, 11_173, 45_296.4];
    const py = python<string[]>(
      `
import json
from analysis import __main__ as m
print(json.dumps([m._clock(s) for s in json.loads(sys.argv[1])]))`,
      JSON.stringify(secs)
    );
    expect(clock(162)).toBe('2m 42s');
    expect(clock(3661)).toBe('1h 01m 01s');
    expect(clock(-5)).toBe('0s');
    if (py === null) return;
    expect(secs.map(clock)).toEqual(py);
  });

  test('162 seconds reads true beside both the paragraph\'s rounding and the card\'s floor', () => {
    // the session screen said "3 minutes of it with you there" above "2m attended" (integration, 2026-09-13)
    expect(mins(162)).toBe('3 minutes');
    expect(clock(162)).toBe('2m 42s');
  });
});

