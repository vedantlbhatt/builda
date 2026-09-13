/**
 * What the simulator review pass (shots/foundation, p2) fixed, held so it stays fixed:
 *
 * - a session's day reads "yesterday" or "Aug 29", never "8/29/2026";
 * - the tab roots wear a left-aligned large title, not the tab navigator's centred 17pt one;
 * - every rounded rectangle in the app has continuous corners, social screens included.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { spriteLeftInset } from '../src/pixel/optical';
import { SPRITE_STATES } from '../src/pixel/sprites';
import { DAY_BOUNDARY_HOUR, dayLabel } from '../src/theme';

const MOBILE = join(import.meta.dir, '..');

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'generated' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const APP_FILES = [...sources(join(MOBILE, 'app')), ...sources(join(MOBILE, 'src'))];

describe('dayLabel: the day a session happened, the way a list says it', () => {
  // Local wall-clock times, so the test means the same thing in every time zone.
  const now = new Date(2026, 8, 13, 15, 0).getTime(); // Sunday 13 Sep 2026, 15:00

  test('today and yesterday are words', () => {
    expect(dayLabel(new Date(2026, 8, 13, 9, 12).getTime(), now)).toBe('today');
    expect(dayLabel(new Date(2026, 8, 12, 22, 0).getTime(), now)).toBe('yesterday');
  });

  test('the day starts at 04:00, as it does on the Mac', () => {
    expect(DAY_BOUNDARY_HOUR).toBe(4);
    // 01:30 on the 13th is still the 12th's sitting.
    expect(dayLabel(new Date(2026, 8, 13, 1, 30).getTime(), now)).toBe('yesterday');
    // And at 02:00 on the 14th, a session from 23:00 on the 13th is today's.
    const lateNow = new Date(2026, 8, 14, 2, 0).getTime();
    expect(dayLabel(new Date(2026, 8, 13, 23, 0).getTime(), lateNow)).toBe('today');
  });

  test('inside the last week it is the weekday', () => {
    const t = new Date(2026, 8, 10, 12, 0);
    expect(dayLabel(t.getTime(), now)).toBe(t.toLocaleDateString(undefined, { weekday: 'long' }));
  });

  test('older is a short month and day, with the year only when it is not this one', () => {
    const aug = new Date(2026, 7, 29, 9, 12);
    expect(dayLabel(aug.getTime(), now)).toBe(aug.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(dayLabel(aug.toISOString(), now)).toBe(dayLabel(aug.getTime(), now));
    const last = new Date(2025, 11, 30, 12, 0);
    const label = dayLabel(last.getTime(), now);
    expect(label).toContain('2025');
    expect(label).not.toMatch(/^\d+\/\d+\/\d+$/);
  });

  test('a string that is not a date is nothing, not "Invalid Date"', () => {
    expect(dayLabel('not a date', now)).toBe('');
  });
});

describe('dates are said like a product', () => {
  test('no bare toLocaleDateString() anywhere: it prints 8/29/2026', () => {
    const hits = APP_FILES.flatMap((f) =>
      /\.toLocaleDateString\(\s*\)/.test(code(readFileSync(f, 'utf8'))) ? [f.slice(MOBILE.length + 1)] : [],
    );
    expect(hits).toEqual([]);
  });
});

describe('the tab roots', () => {
  const layout = code(readFileSync(join(MOBILE, 'app/(tabs)/_layout.tsx'), 'utf8'));

  test('wear the large title header, left aligned', () => {
    expect(layout).toContain('<TabHeader');
    expect(layout).not.toContain('headerTitleStyle');
    expect(layout).not.toContain("headerTitleAlign: 'center'");
  });

  test('the large title is the platform one, 34/700', () => {
    const chrome = code(readFileSync(join(MOBILE, 'src/nav/chrome.tsx'), 'utf8'));
    expect(chrome).toMatch(/fontSize: 34, lineHeight: 41, letterSpacing: 0\.37, fontWeight: '700'/);
  });
});

describe('Bit sits on the text edge, not its transparent frame', () => {
  test('the 64pt empty state pulls Bit left by its four empty columns', () => {
    expect(spriteLeftInset('idle', 64)).toBe(16);
    expect(spriteLeftInset('sleeping', 48)).toBe(12);
  });

  test('no state is pulled past its own first drawn cell', () => {
    for (const s of SPRITE_STATES) {
      for (const size of [32, 48, 64]) {
        const inset = spriteLeftInset(s, size);
        expect(inset).toBeGreaterThanOrEqual(0);
        expect(inset).toBeLessThan(size / 2);
      }
    }
  });
});

describe('continuous corners everywhere', () => {
  test('every file that rounds a corner makes it continuous as often as it rounds one', () => {
    const off = APP_FILES.flatMap((f) => {
      const c = code(readFileSync(f, 'utf8'));
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      return radii > curves ? [`${f.slice(MOBILE.length + 1)}: ${radii} radii, ${curves} continuous`] : [];
    });
    expect(off).toEqual([]);
  });
});
