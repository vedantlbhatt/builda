/**
 * Every thing the Stack page can name wears exactly one mark (`src/stack/stackLogos.ts`, generated
 * by `scripts/gen_stack_logos.py` from the vocab STACK catalog and Simple Icons), and every mark is
 * one the app may ship: no NonCommercial licence, an attribution licence only with its credit,
 * and never a same named brand that is not the thing (the oil company for Shell, Mastercard for
 * Maestro). The colour rules hold for every logo against the grounds it is drawn on.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPORT_ENUMS } from '../src/generated/report';
import { contrast, GROUND, ON_HUE } from '../src/insights/palette';
import { brandInk, creditsFor, discOf, DISC_CONTRAST, isAchromatic, lift, MARK_CONTRAST, markOf } from '../src/stack/marks';
import { SIMPLE_ICONS, STACK_LOGO_COVERAGE, STACK_MARKS, type StackMark } from '../src/stack/stackLogos';

const IDS = REPORT_ENUMS.stack_item;
const LOGOS = Object.entries(STACK_MARKS).filter((e): e is [string, Extract<StackMark, { kind: 'logo' }>] => e[1].kind === 'logo');
const MONOGRAMS = Object.entries(STACK_MARKS).filter((e): e is [string, Extract<StackMark, { kind: 'monogram' }>] => e[1].kind === 'monogram');

describe('one mark for every thing the catalog can name', () => {
  test('the marks are keyed by exactly the report spec’s stack items, in the catalog’s order', () => {
    expect(Object.keys(STACK_MARKS)).toEqual([...IDS]);
  });

  test('62 of the 80 draw a real logo, and the coverage the file states is the one it holds', () => {
    expect({ ...STACK_LOGO_COVERAGE } as { logos: number; catalog: number }).toEqual({ logos: LOGOS.length, catalog: IDS.length });
    expect([LOGOS.length, IDS.length]).toEqual([62, 80]);
    expect(LOGOS.length + MONOGRAMS.length).toBe(IDS.length);
  });

  test('a logo is one path on the 24 unit grid in a brand hex; a monogram is two or three letters with a reason', () => {
    for (const [id, m] of LOGOS) {
      expect({ id, hex: /^#[0-9A-F]{6}$/.test(m.hex), path: /^[Mm][-\d.]/.test(m.path), chars: /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\- ]+$/.test(m.path) }).toEqual({ id, hex: true, path: true, chars: true });
      expect(m.slug).toMatch(/^[a-z0-9]+$/);
    }
    for (const [id, m] of MONOGRAMS) {
      expect({ id, ok: m.text.length >= 2 && m.text.length <= 3 && m.why.length > 8 }).toEqual({ id, ok: true });
    }
  });

  test('a same named brand that is not the thing is never drawn: Shell and Maestro are monograms', () => {
    expect(markOf('shell')?.kind).toBe('monogram');
    expect(markOf('maestro')?.kind).toBe('monogram');
    for (const [, m] of LOGOS) expect(['shell', 'maestro']).not.toContain(m.slug);
  });

  test('where one brand’s mark is another thing’s, it is on purpose and said in the generator', () => {
    const shared = new Map<string, string[]>();
    for (const [id, m] of LOGOS) shared.set(m.slug, [...(shared.get(m.slug) ?? []), id]);
    const twice = [...shared.entries()].filter(([, ids]) => ids.length > 1).map(([slug, ids]) => [slug, ids]);
    expect(twice).toEqual([
      ['react', ['react', 'react_native']],
      ['expo', ['expo', 'eas']],
      ['bun', ['bun_test', 'bun']],
    ]);
    const gen = readFileSync(join(import.meta.dir, '../../scripts/gen_stack_logos.py'), 'utf8');
    for (const id of ['react_native', 'eas', 'bun_test']) expect(gen).toMatch(new RegExp(`"${id}": "[a-z]+",\\s+# `));
  });
});

describe('only marks the app may ship', () => {
  test('Simple Icons is CC0, pinned, and no NonCommercial icon is used', () => {
    expect(SIMPLE_ICONS.license).toBe('CC0-1.0');
    expect(SIMPLE_ICONS.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [id, m] of LOGOS) expect({ id, nc: /(^|-)NC(-|$)/.test(m.license ?? '') }).toEqual({ id, nc: false });
    // Vue.js and CocoaPods are the two Simple Icons ships under an NC licence.
    expect(markOf('vue')?.kind).toBe('monogram');
    expect(markOf('cocoapods')?.kind).toBe('monogram');
  });

  test('every attribution licence carries its credit, and only those do', () => {
    for (const [id, m] of LOGOS) {
      const attribution = /^CC-BY/.test(m.license ?? '');
      expect({ id, credit: m.credit !== null }).toEqual({ id, credit: attribution });
    }
    expect(creditsFor(['python', 'git', 'android_sdk', 'git'])).toEqual(['Git logo by Jason Long, CC BY 3.0', 'Android robot by Google, CC BY 3.0']);
    expect(creditsFor(['python', 'sql'])).toEqual([]);
  });

  test('the package is a dev dependency only: the app never imports it, it ships the generated paths', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies['simple-icons']).toBeUndefined();
    expect(pkg.devDependencies['simple-icons']).toBeDefined();
  });
});

describe('the brand’s colour, wherever it can be seen', () => {
  test('every logo reads at 3:1 on every ground a mark sits on', () => {
    for (const [id, m] of LOGOS) {
      const ink = brandInk(m.hex);
      for (const ground of [GROUND.bg, GROUND.card, GROUND.raised]) {
        expect({ id, ground, reads: contrast(ink, ground) >= MARK_CONTRAST }).toEqual({ id, ground, reads: true });
      }
    }
  });

  test('a colour that already reads is the brand’s own, exactly', () => {
    expect(brandInk('#3776AB')).toBe('#3776AB');
    expect(brandInk('#F03C2E')).toBe('#F03C2E');
    expect(brandInk('#f7df1e')).toBe('#F7DF1E');
  });

  test('a black or grey brand is the ground’s text colour (Vercel on dark), a dark coloured one keeps its hue, lifted', () => {
    for (const black of ['#000000', '#0B0D0E', '#1C2024', '#191919', '#0A0A0A']) {
      expect(isAchromatic(black)).toBe(true);
      expect(brandInk(black)).toBe(GROUND.text);
    }
    const sqlite = brandInk('#003B57');
    expect(sqlite).not.toBe(GROUND.text);
    expect(contrast(sqlite, GROUND.raised)).toBeGreaterThanOrEqual(MARK_CONTRAST);
    // Lifted toward white, never past what it needs: one step less would not read.
    const steps = [...Array(21).keys()].map((i) => lift('#003B57', i * 0.05));
    const first = steps.findIndex((c) => contrast(c, GROUND.raised) >= MARK_CONTRAST);
    expect(sqlite).toBe(steps[first]!);
    expect(isAchromatic('#003B57')).toBe(false);
  });

  test('a disc of brand colour stands off the ground, and its mark reads on it', () => {
    for (const [id, m] of LOGOS) {
      const d = discOf(m.hex);
      expect({ id, disc: contrast(d.fill, GROUND.bg) >= DISC_CONTRAST, mark: contrast(d.mark, d.fill) >= MARK_CONTRAST }).toEqual({ id, disc: true, mark: true });
      expect([GROUND.text, ON_HUE] as string[]).toContain(d.mark);
    }
    expect(discOf('#000000')).toEqual({ fill: GROUND.text, mark: ON_HUE });
    expect(discOf('#0B0D0E')).toEqual({ fill: GROUND.text, mark: ON_HUE });
    expect(discOf('#F7DF1E')).toEqual({ fill: '#F7DF1E', mark: ON_HUE });
  });
});
