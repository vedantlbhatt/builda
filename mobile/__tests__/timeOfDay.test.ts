/**
 * One way to write a time of day (`src/copy/time.ts`): "9:12am", lower case, no space. FOUND IN
 * THE FINAL CAPTURE (2026-09-13): "9:12am" on a session page, "9:12 AM" on its card, "15:19" on
 * the map, "since 15:22" on mission control and "work after 22:00" in the trends. This holds the
 * rule and walks the app for a clock written any other way.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { clocksInWords, clockWords, hourOfDay, timeOfDay } from '../src/copy/time';
import { when } from '../src/copy/wrapped';
import { formatWith } from '../src/insights/format';

describe('the one clock', () => {
  test('lower case am and pm, no space, no leading zero, minutes always two digits', () => {
    expect(clockWords(9, 12)).toBe('9:12am');
    expect(clockWords(0, 40)).toBe('12:40am');
    expect(clockWords(12, 0)).toBe('12:00pm');
    expect(clockWords(15, 19)).toBe('3:19pm');
    expect(clockWords(23, 5)).toBe('11:05pm');
    expect(timeOfDay(new Date(2026, 8, 13, 21, 37).getTime())).toBe('9:37pm');
  });

  test('a whole hour the data names: "10pm", the analysis page dial and the count up frame agree', () => {
    expect([0, 4, 11, 12, 22].map(hourOfDay)).toEqual(['12am', '4am', '11am', '12pm', '10pm']);
    for (let h = 0; h < 24; h++) expect(formatWith({ kind: 'hour' }, h)).toBe(hourOfDay(h));
  });

  test("the engine's words keep their meaning in the house clock", () => {
    expect(clocksInWords('work after 22:00')).toBe('work after 10pm');
    expect(clocksInWords('between 22:00 and 04:00')).toBe('between 10pm and 4am');
    expect(clocksInWords('at 14:05')).toBe('at 2:05pm');
    // Not a clock: a ratio, a version, a clock already in the house form.
    expect(clocksInWords('a 3:1 split')).toBe('a 3:1 split');
    expect(clocksInWords('at 9:12am')).toBe('at 9:12am');
    expect(clocksInWords('Opus 4.1')).toBe('Opus 4.1');
  });

  test("Wrapped's sentence (Python's wrapped._when) comes through the same clock", () => {
    // 2026-09-08 is a Tuesday. At UTC, 23:42 is "11:42pm".
    expect(when('2026-09-08T23:42:00Z', 0)).toBe('A Tuesday, at 11:42pm');
  });
});

describe('no other clock anywhere in the app', () => {
  const ROOT = join(import.meta.dir, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'generated' || name === 'node_modules') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'app'));

  test('only copy/time.ts turns an hour into words, and nothing asks the locale for a time', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (rel === join('src', 'copy', 'time.ts')) continue;
      const code = readFileSync(f, 'utf8');
      // The locale's clock ("9:12 AM", "21:37", whatever the phone is set to).
      if (/toLocaleTimeString|hour12|hour:\s*'(?:2-digit|numeric)'/.test(code)) offenders.push(`${rel}: a locale clock`);
      // An hour and minutes glued together by hand ("15:19", "09:37").
      if (/getHours\(\)[^;\n]*getMinutes\(\)/.test(code) || /getUTCHours\(\)[^;\n]*getUTCMinutes\(\)[^;\n]*padStart/.test(code)) offenders.push(`${rel}: a hand written clock`);
      // am and pm written anywhere but here, outside the count up's worklet frame (it cannot call out).
      if (/\?\s*'am'\s*:\s*'pm'/.test(code) && rel !== join('src', 'insights', 'format.ts')) offenders.push(`${rel}: its own am and pm`);
    }
    expect(offenders).toEqual([]);
  });
});
