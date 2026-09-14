/**
 * The codebase map and the time lapse are built in the house style (design-refs/HOUSE-STYLE.md:
 * chapters, not cards; a band in the builder's hue with its one big number counting up; custom
 * Skia charts that draw on; plain sentences; navigation as words), every state is drawn as a
 * sentence, the sources they took from are named where they were taken, and both are routes a
 * link can open.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';

const MOBILE = join(import.meta.dir, '..');

const SCREENS = ['app/you/map/[id].tsx', 'app/you/timelapse/[id].tsx'] as const;
const COMPONENTS = ['src/map/MapCanvas.tsx', 'src/map/Scrubber.tsx', 'src/map/MapParts.tsx', 'src/map/MapWords.tsx'] as const;
const read = (name: string) => readFileSync(join(MOBILE, name), 'utf8');
const FILES = [...SCREENS, ...COMPONENTS].map((name) => ({ name, src: read(name) }));
const MODULES = readdirSync(join(MOBILE, 'src/map'))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ name: `src/map/${f}`, src: read(`src/map/${f}`) }));

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The words a person can read in a file: JSX text and quoted strings with a space in them. */
function copyOf(src: string): string[] {
  const c = code(src);
  const out: string[] = [];
  // JSX text: words between a tag's end and a closing tag, never code (no `;`, `=` or parens).
  for (const m of c.matchAll(/>\s*([^<>{}=;()]+?)\s*<\//g)) if (/[a-z]/i.test(m[1]!)) out.push(m[1]!.trim());
  // Whole string literals, consumed left to right so a closing quote never opens the next one.
  for (const m of c.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
    const s = m[0].slice(1, -1);
    if (/ /.test(s) && /[a-z]/i.test(s)) out.push(s);
  }
  return out;
}

describe('the house style, not the kit of cards', () => {
  test('no stack of cards, no rows with chevrons, no three up stat grid, no chip', () => {
    for (const f of FILES) {
      const c = code(f.src);
      expect({
        file: f.name,
        cards: /<(Surface|Row|StatGrid|Stat|Card|Chip)\b/.test(c),
        chevron: /chevron/.test(c),
        local: [...c.matchAll(/function (Row|Stat|StatGrid|Card|Chip)\b/g)].map((m) => m[1]),
      }).toEqual({ file: f.name, cards: false, chevron: false, local: [] });
    }
  });

  test('each screen opens on a band in the builder\'s hue, its figure counting up, over a Skia map in the same hue', () => {
    for (const name of SCREENS) {
      const c = code(read(name));
      expect({
        file: name,
        accent: /useAccent\(\)/.test(c),
        band: /<SessionBand\b/.test(c),
        figure: /<(FigureLine|ReplayFigure)\b/.test(c),
        map: /<MapCanvas\b[\s\S]*?hue=\{accent\}/.test(c),
        chapters: /<Section\b/.test(c) && /<Block\b/.test(c),
      }).toEqual({ file: name, accent: true, band: true, figure: true, map: true, chapters: true });
    }
    const words = code(read('src/map/MapWords.tsx'));
    expect(words).toMatch(/<Band hue=\{hue\}/);
    expect(words).toMatch(/<Num\b/);
    expect(words).toMatch(/<CreaturePrint\b/);
    expect(words).toMatch(/<SplitText\b/);
  });

  test('a band waits for the saved creature, so it never prints in the wrong hue first', () => {
    for (const name of SCREENS) expect(code(read(name))).toMatch(/const ready = load\.kind === 'ready' && accent\.ready;/);
  });

  test('colours only from the tokens: no hex, no rgb, no system grey anywhere in the map or on its screens', () => {
    for (const f of [...MODULES, ...SCREENS.map((name) => ({ name, src: read(name) }))]) {
      const c = code(f.src);
      expect({ file: f.name, colours: c.match(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/g) ?? [] }).toEqual({ file: f.name, colours: [] });
    }
  });

  test('no gradient, no emoji, no uppercase caption, every rounded rectangle continuous', () => {
    for (const f of FILES) {
      const c = code(f.src);
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({
        file: f.name,
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
        shouting: [...c.matchAll(/>\s*([A-Z]{2,}(?: [A-Z]{2,})+)\s*</g)].map((m) => m[1]),
        transform: /textTransform:\s*'uppercase'/.test(c),
        curves: curves >= radii,
      }).toEqual({ file: f.name, gradient: false, emoji: false, shouting: [], transform: false, curves: true });
    }
  });

  test('no dash in a word anyone reads', () => {
    for (const f of FILES) expect({ file: f.name, dashed: copyOf(f.src).filter(hasDash) }).toEqual({ file: f.name, dashed: [] });
  });

  test('the layout is never random: no Math.random and no clock anywhere a position is decided', () => {
    for (const f of MODULES) expect({ file: f.name, random: /Math\.random/.test(code(f.src)) }).toEqual({ file: f.name, random: false });
    for (const name of ['src/map/layout.ts', 'src/map/pack.ts', 'src/map/heat.ts', 'src/map/knot.ts', 'src/map/frames.ts', 'src/map/paint.ts']) {
      expect({ file: name, clock: /Date\.now\(/.test(code(read(name))) }).toEqual({ file: name, clock: false });
    }
  });

  test('names only when the builder opted in: a file is named through the one door, never read off the session', () => {
    for (const f of FILES) expect({ file: f.name, direct: /live_names/.test(code(f.src)) }).toEqual({ file: f.name, direct: false });
    for (const name of SCREENS) expect(code(read(name))).toMatch(/cellCaption\(pickedFile, names\?\.\[pickedFile\.id\], now\)/);
  });
});

describe('motion: drawn on, then still, and quiet under Reduce Motion', () => {
  const canvas = code(read('src/map/MapCanvas.tsx'));

  test('the map draws itself on from its block\'s clock: the sea develops, the islands bloom, the path traces', () => {
    expect(canvas).toMatch(/const clock = useClock\(\)/);
    expect(canvas).toMatch(/bloomDelays\(bloomWaves\(layout\), BLOOM_AT\)/);
    expect(canvas).toMatch(/reveal=\{sea\}/);
    expect(canvas).toMatch(/ease\(phase\(t, landed, PATH_MS\)\)/);
  });

  test('the knot pulses only while it is on screen and not under Reduce Motion; the glide and the flips hold still too', () => {
    expect(canvas).toMatch(/const pulsing = knot\.length > 0 && !reduce && focused/);
    expect(canvas).toMatch(/if \(!moved \|\| reduce\)/);
    expect(canvas).toMatch(/if \(!levels \|\| reduce \|\|/);
    expect(canvas).toMatch(/if \(!reduce\) \{\s*if \(replay\)/);
  });

  test('glow is a Skia blur, and only the working set wears it', () => {
    expect(canvas).toMatch(/Skia\.MaskFilter\.MakeBlur\(BlurStyle\.Normal/);
    expect(canvas).toMatch(/glowOf\(lv\)/);
  });

  test('the replay starts on its own once the map has drawn, never under Reduce Motion', () => {
    const lapse = code(read('app/you/timelapse/[id].tsx'));
    expect(lapse).toMatch(/if \(reduce \|\| started\.current\) return;/);
    expect(lapse).toMatch(/<AutoPlay at=\{landed \+ AUTOPLAY_AFTER_MS\}/);
    expect(lapse).toMatch(/usePlayback\(span, reduce, onEnd\)/);
  });

  test('haptics: a selection tick for a picked cell and a crossed spike, and nothing heavy', () => {
    const scrubber = code(read('src/map/Scrubber.tsx'));
    expect(canvas).toMatch(/\bselect\(\)/);
    expect(scrubber).toMatch(/runOnJS\(select\)\(\)/);
    for (const f of FILES) expect({ file: f.name, heavy: /Heavy|impactAsync|notificationAsync/.test(code(f.src)) }).toEqual({ file: f.name, heavy: false });
  });

  test('a tapped file sparks in its own hue (ClickSpark), and the dots under it shove (DotGrid)', () => {
    expect(canvas).toMatch(/<SparkBurst\b[\s\S]*?variant="pixel"/);
    expect(canvas).toMatch(/<DotGrid\b[\s\S]*?onTap=\{onTap\}/);
    expect(canvas).toMatch(/ROLE_HUE\[role\] \?\? hue\.name/);
  });
});

describe('the sources are named where they were used', () => {
  test('react-bits, Strava and the Appllama loaders, each at the code it shaped; the GPL loaders as ideas only', () => {
    const paint = read('src/map/paint.ts');
    const canvas = read('src/map/MapCanvas.tsx');
    const parts = read('src/map/MapParts.tsx');
    const words = read('src/map/MapWords.tsx');
    for (const name of ['Sandpile Bloom', 'Braille Flipwave', 'MagicRings', 'ShapeGrid', 'PixelTrail', 'PixelBlast', 'Strava']) expect(paint).toContain(name);
    expect(paint).toMatch(/GPL 3\.0/);
    expect(paint).toMatch(/nothing of theirs is copied here/);
    for (const name of ['DotGrid', 'ClickSpark', 'MagicRings', 'PixelBlast', 'Strava']) expect(canvas).toContain(name);
    expect(parts).toContain('GridMotion');
    expect(words).toContain('SplitText');
  });
});

describe('every state is drawn, as a sentence', () => {
  test('loading, signed out, missing, error, stale, and the refusals, on both screens', () => {
    for (const name of SCREENS) {
      const c = code(read(name));
      expect({
        file: name,
        loading: /<MapLoading sentence=/.test(c),
        signedOut: /<MapSignedOut\b/.test(c),
        missing: /<MapMissing\b/.test(c),
        error: /<MapError\b/.test(c),
        stale: /<StaleNote\b/.test(c),
        refusal: /<MapRefusal\b/.test(c),
      }).toEqual({ file: name, loading: true, signedOut: true, missing: true, error: true, stale: true, refusal: true });
    }
  });

  test('a refusal still prints its band and says why in words, with one way on', () => {
    const parts = code(read('src/map/MapParts.tsx'));
    expect(parts).toMatch(/<Band hue=\{hue\} title=\{title\}>[\s\S]*?<BandHeadline>\{copy\.title\}<\/BandHeadline>/);
    expect(parts).toMatch(/<BandSentence text=\{copy\.text\}/);
    expect(parts).toMatch(/copy\.action === 'copy'[\s\S]*?Copy the command[\s\S]*?Try again[\s\S]*?Open the session/);
  });
});

describe('both are routes a link opens', () => {
  test('the root stack registers them and DEEPLINKS.md lists the sample links and every variant', () => {
    const layout = read('app/_layout.tsx');
    const links = read('src/nav/DEEPLINKS.md');
    expect(layout).toContain('name="you/map/[id]"');
    expect(layout).toContain('name="you/timelapse/[id]"');
    for (const link of ['builder://you/map/sample', 'builder://you/timelapse/sample']) expect(links).toContain(link);
    for (const v of ['circling', 'names', 'cut', 'empty']) expect(links).toContain(`variant=${v}`);
  });
});
