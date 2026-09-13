/**
 * The You tab and its four pages hold to the house style the owner picked
 * (design-refs/HOUSE-STYLE.md): chapters, not cards; every number counts up on the reveal clock;
 * navigation is words and bands, never a row with a chevron; the theme is the builder's creature's
 * hue; every page ships every state; refusals are sentences; no dash and no "you spent" in
 * anything a person reads. And every page is a route with a deep link.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(import.meta.dir, '..');

const TAB = 'app/(tabs)/you.tsx';
const PAGES = ['app/you/money.tsx', 'app/you/dimensions.tsx', 'app/you/glossary.tsx', 'app/you/stack.tsx'] as const;
// `States.tsx` is the old kit states the map and mission control still import; it is not part of
// these pages and is left out of their rules.
const COMPONENTS = readdirSync(join(MOBILE, 'src/you'))
  .filter((f) => f.endsWith('.tsx') && f !== 'States.tsx')
  .map((f) => `src/you/${f}`);
const FILES = [TAB, ...PAGES, ...COMPONENTS];

const read = (name: string) => readFileSync(join(MOBILE, name), 'utf8');
const files = FILES.map((name) => ({ name, src: read(name) }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** What a person can read: string literals and JSX text, from code with comments removed. */
function said(src: string): string[] {
  const c = code(src).replace(/^import .*$/gm, '');
  const literals = [...c.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]!);
  // JSX text sits between a tag's closing `>` and the next `<`; an arrow's `=>` is code, not text.
  const jsx = [...c.matchAll(/(?<![=])>([^<>{}=;]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);
  return [...literals, ...jsx];
}

describe('chapters, not cards', () => {
  test('the scan reads the tab, the four pages and every component beside them', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5 + 4);
  });

  test('no kit card, row, stat grid or chevron: the owner read those as generated', () => {
    for (const f of files) {
      const c = code(f.src);
      expect({
        file: f.name,
        kit: /<(Surface|Row|StatGrid|Stat|PageRows)\b/.test(c),
        chevron: /chevron/i.test(c),
      }).toEqual({ file: f.name, kit: false, chevron: false });
    }
  });

  test('every page is a column of chapters on the reveal clock: a ChapterPage, bands, sections', () => {
    for (const name of [TAB, ...PAGES]) {
      const c = code(read(name));
      expect({
        file: name,
        page: /<ChapterPage\b/.test(c),
        band: /<(Band|RefusalChapter|DoorBand|YouHero)\b/.test(c),
        section: /<(Section|Band|RefusalChapter|DoorBand|DoorWord|YouHero|HeroSection)\b/.test(c),
      }).toEqual({ file: name, page: true, band: true, section: true });
    }
    // The frame itself is the analysis page's reveal clock, not a second one.
    const frame = code(read('src/you/ChapterPage.tsx'));
    expect(frame).toMatch(/usePageReveal/);
    expect(frame).toMatch(/useRevealScroll/);
    expect(frame).toMatch(/useChapterStages/);
  });

  test('numbers count on the clock: Num, BandFigure, Ledger or DollarFigure, never the kit counters', () => {
    for (const name of [TAB, ...PAGES, 'src/you/Hero.tsx', 'src/you/Doors.tsx']) {
      const c = code(read(name));
      expect({ file: name, counts: /<(Num|BandFigure|Ledger|DollarFigure|DoorBand|DoorWord|YouHero|FiveChapter)\b/.test(c), kitCount: /<(CountUp|Counter)\b/.test(c) }).toEqual({
        file: name,
        counts: true,
        kitCount: false,
      });
    }
  });

  test('every chart draws on: the bars, the ring and the squares are the analysis page own', () => {
    const money = code(read('app/you/money.tsx'));
    for (const part of ['<Donut', '<DiffBar', '<StackBar', '<Ledger', '<BurnBody']) expect({ part, used: money.includes(part) }).toEqual({ part, used: true });
    expect(code(read('app/you/dimensions.tsx'))).toMatch(/<GrowBar/);
    expect(code(read('app/you/glossary.tsx'))).toMatch(/<TermSquares/);
    expect(code(read('app/you/stack.tsx'))).toMatch(/<HarnessLogo/);
    expect(code(read('app/you/stack.tsx'))).toMatch(/<GrowBar/);
  });
});

describe('the theme is the builder’s creature', () => {
  test('the tab and every page take their hues from the accent, never the retired amber', () => {
    for (const name of [TAB, ...PAGES]) {
      const c = code(read(name));
      expect({ file: name, accent: /useAccent\(\)/.test(c) }).toEqual({ file: name, accent: true });
    }
    for (const f of files) {
      const c = code(f.src);
      expect({ file: f.name, amber: /SPECTRUM\.amber|\bc\.accent\b|colors\('dark'\)/.test(c) }).toEqual({ file: f.name, amber: false });
    }
  });

  test('the hero band wears the accent and prints the accent creature', () => {
    const tab = code(read(TAB));
    expect(tab).toMatch(/<YouHero[^>]*animal=\{accent\.animal\}[^>]*hue=\{accent\}/);
  });
});

describe('what the pages say', () => {
  test('no dash and never "you spent", in any string a person can read', () => {
    for (const f of files) {
      for (const s of said(f.src)) {
        expect({ file: f.name, s, dash: /[—–―−]|\s-\s/.test(s), spent: /you spent/i.test(s) }).toEqual({ file: f.name, s, dash: false, spent: false });
      }
    }
  });

  test('the money page answers the owner under the number, in words', () => {
    const money = code(read('app/you/money.tsx'));
    expect(money).toMatch(/NOT_WHAT_YOU_PAY/);
    // The figure sits in the band and the sentence right under it.
    const sentence = money.search(/\n\s*\{NOT_WHAT_YOU_PAY\}\s*\n\s*<\/Text>/);
    expect(sentence).toBeGreaterThan(0);
    expect(money.indexOf('<DollarFigure')).toBeLessThan(sentence);
  });

  test('no hard coded colour, gradient, emoji, Menlo or shouting caption', () => {
    for (const f of files) {
      const c = code(f.src);
      expect({
        file: f.name,
        hex: c.match(/['"]#[0-9a-fA-F]{3,8}['"]/g) ?? [],
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
        menlo: /Menlo/.test(c),
        transform: /textTransform:\s*'uppercase'/.test(c),
      }).toEqual({ file: f.name, hex: [], gradient: false, emoji: false, menlo: false, transform: false });
    }
  });
});

describe('motion stays where the design puts it', () => {
  test('the type still lands with its one haptic, once per type', () => {
    const hero = code(read('src/you/Hero.tsx'));
    expect(hero).toContain('useFirstReveal');
    expect(hero).toMatch(/onEnd=\{phase === 'play' \? revealed : undefined\}/);
    const hooks = code(read('src/you/hooks.ts'));
    expect(hooks).toMatch(/REVEALED_KEY/);
    expect((hooks.match(/\bsuccess\(\)/g) ?? []).length).toBe(1);
  });

  test('an animated style or reaction here calls only worklets: the curve, the clock, runOnJS', () => {
    // A plain function called on the UI thread is a crash ("Tried to synchronously call a
    // non-worklet function"), which reached the owner once already. Every bare call inside a
    // worklet body must be one of the page's worklets; `Math.*` and other member calls are fine.
    const WORKLETS = new Set(['ease', 'phase', 'spring', 'eased', 'sprung', 'formatWith', 'runOnJS']);
    let bodies = 0;
    for (const f of files) {
      const c = code(f.src);
      for (const m of c.matchAll(/\buse(?:AnimatedStyle|AnimatedReaction|DerivedValue|AnimatedProps|FrameCallback|AnimatedScrollHandler)\(/g)) {
        let depth = 1;
        let i = m.index! + m[0].length;
        const start = i;
        for (; i < c.length && depth > 0; i++) {
          if (c[i] === '(') depth++;
          else if (c[i] === ')') depth--;
        }
        const body = c.slice(start, i - 1);
        bodies++;
        for (const call of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
          const name = call[1]!;
          if (['if', 'for', 'while', 'return', 'switch'].includes(name)) continue;
          expect({ file: f.name, name, worklet: WORKLETS.has(name) }).toEqual({ file: f.name, name, worklet: true });
        }
      }
    }
    expect(bodies).toBeGreaterThan(0);
  });
});

describe('every page ships every state', () => {
  test('loading, signed out, error and stale on the tab and all four pages', () => {
    for (const name of [TAB, ...PAGES]) {
      const c = code(read(name));
      expect({
        file: name,
        loading: /<ChapterSkeleton \/>/.test(c),
        signedOut: /<SignedOutChapter\b/.test(c),
        error: /<ErrorChapter\b/.test(c),
        stale: /<StaleLine\b/.test(c),
      }).toEqual({ file: name, loading: true, signedOut: true, error: true, stale: true });
    }
  });

  test('a page whose block has not arrived says why on its band, and gives the command', () => {
    for (const name of ['app/you/money.tsx', 'app/you/glossary.tsx', 'app/you/stack.tsx']) {
      const c = code(read(name));
      expect({ file: name, refusal: /<RefusalChapter\b/.test(c), command: /REPORT_COMMAND/.test(c) }).toEqual({ file: name, refusal: true, command: true });
    }
    expect(code(read('app/you/dimensions.tsx'))).toMatch(/<CommandLine command=\{ANALYSE_COMMAND\}/);
  });
});

describe('every page is a route with a deep link', () => {
  test('the root stack registers each page and DEEPLINKS.md lists its link', () => {
    const layout = read('app/_layout.tsx');
    const links = read('src/nav/DEEPLINKS.md');
    for (const p of ['dimensions', 'money', 'glossary', 'stack']) {
      expect({ p, route: layout.includes(`name="you/${p}"`), link: links.includes(`builder://you/${p}`) }).toEqual({ p, route: true, link: true });
    }
    expect(links).toContain('builder://you');
  });
});
