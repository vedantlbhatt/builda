/**
 * The You tab and its four pages stay on the kit and ship every state. The same rules
 * `screens.test.ts` holds the refit screens to, applied to these files (which that list predates),
 * plus three of their own: every page draws all five states, text effects stay where the design
 * allows them, and every page is a route with a deep link.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(import.meta.dir, '..');

const PAGES = ['app/you/dimensions.tsx', 'app/you/money.tsx', 'app/you/glossary.tsx', 'app/you/stack.tsx'] as const;
const COMPONENTS = readdirSync(join(MOBILE, 'src/you'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => `src/you/${f}`);
const FILES = ['app/(tabs)/you.tsx', ...PAGES, ...COMPONENTS];

const files = FILES.map((name) => ({ name, src: readFileSync(join(MOBILE, name), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the You pages build from the kit', () => {
  test('the scan reads the tab, the four pages and every component beside them', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5 + 6);
  });

  test('text goes through <T>: no bare Text from react-native', () => {
    for (const f of files) {
      const imports = code(f.src).match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
      expect({ file: f.name, bareText: imports.some((i) => /[{,\s]Text[,\s}]/.test(i)) }).toEqual({ file: f.name, bareText: false });
    }
  });

  test('no hand-rolled Section, Row, Stat, Card or Button', () => {
    for (const f of files) {
      const local = [...code(f.src).matchAll(/function (Section|Row|Stat|StatGrid|Card|Button|Chip)\b/g)].map((m) => m[1]);
      expect({ file: f.name, local }).toEqual({ file: f.name, local: [] });
    }
  });

  test('type sizes come from the roles, radii from the rule, every rounded rectangle continuous', () => {
    for (const f of files) {
      const c = code(f.src);
      const sizes = c.match(/fontSize:\s*\d+/g) ?? [];
      const literal = c.match(/borderRadius:\s*\d+/g) ?? [];
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, sizes, literal, curves }).toEqual({ file: f.name, sizes: [], literal: [], curves: radii });
    }
  });

  test('no Menlo, no shouting caption, no amber outline, no gradient, no emoji', () => {
    for (const f of files) {
      const c = code(f.src);
      expect({
        file: f.name,
        menlo: /Menlo/.test(c),
        shouting: [...c.matchAll(/>\s*([A-Z]{2,}(?: [A-Z]{2,})+)\s*</g)].map((m) => m[1]),
        transform: /textTransform:\s*'uppercase'/.test(c),
        amberOutline: /border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/.test(c),
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
      }).toEqual({ file: f.name, menlo: false, shouting: [], transform: false, amberOutline: false, gradient: false, emoji: false });
    }
  });

  test('no colour but amber and the two diff hues: nothing hard coded', () => {
    for (const f of files) {
      const hex = code(f.src).match(/['"]#[0-9a-fA-F]{3,8}['"]/g) ?? [];
      expect({ file: f.name, hex }).toEqual({ file: f.name, hex: [] });
    }
  });
});

describe('motion stays where the design puts it', () => {
  test('the one text effect is the archetype reveal, and nothing on these pages counts up', () => {
    for (const f of files) {
      const c = code(f.src);
      const decrypt = /<DecryptedText\b/.test(c);
      expect({ file: f.name, decrypt: decrypt && f.name !== 'src/you/ArchetypeReveal.tsx', countUp: /<CountUp\b/.test(c) }).toEqual({
        file: f.name,
        decrypt: false,
        countUp: false,
      });
    }
  });

  test('the reveal plays once: it is gated on a saved first view and lands with its one haptic', () => {
    const reveal = code(readFileSync(join(MOBILE, 'src/you/ArchetypeReveal.tsx'), 'utf8'));
    expect(reveal).toContain('useFirstReveal');
    expect(reveal).toMatch(/play=\{phase === 'play'/);
    const hooks = code(readFileSync(join(MOBILE, 'src/you/hooks.ts'), 'utf8'));
    expect(hooks).toMatch(/REVEALED_KEY/);
    expect((hooks.match(/\bsuccess\(\)/g) ?? []).length).toBe(1);
  });
});

describe('every page ships every state', () => {
  test('loading, signed out, error and stale on the tab and all four pages', () => {
    for (const name of ['app/(tabs)/you.tsx', ...PAGES]) {
      const c = code(readFileSync(join(MOBILE, name), 'utf8'));
      expect({
        file: name,
        loading: /Skeleton \/>|Skeleton label=/.test(c),
        signedOut: /<PageSignedOut\b/.test(c),
        error: /<PageError\b/.test(c),
        stale: /<StaleNote\b/.test(c),
      }).toEqual({ file: name, loading: true, signedOut: true, error: true, stale: true });
    }
  });

  test('an empty page is Bit, two lines and the one action', () => {
    for (const name of PAGES) {
      const c = code(readFileSync(join(MOBILE, name), 'utf8'));
      expect({ file: name, empty: /<PageNotSent\b/.test(c) }).toEqual({ file: name, empty: true });
    }
  });
});

describe('every page is a route with a deep link', () => {
  test('the root stack registers each page and DEEPLINKS.md lists its link', () => {
    const layout = readFileSync(join(MOBILE, 'app/_layout.tsx'), 'utf8');
    const links = readFileSync(join(MOBILE, 'src/nav/DEEPLINKS.md'), 'utf8');
    for (const p of ['dimensions', 'money', 'glossary', 'stack']) {
      expect({ p, route: layout.includes(`name="you/${p}"`), link: links.includes(`builder://you/${p}`) }).toEqual({ p, route: true, link: true });
    }
    expect(links).toContain('builder://you');
  });
});
