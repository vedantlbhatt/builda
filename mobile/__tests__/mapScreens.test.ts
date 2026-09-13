/**
 * The codebase map and the time lapse stay on the kit and the design rules (DESIGN-DIRECTION 9,
 * the slop pre-flight), every state is drawn, and both are routes a link can open.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(import.meta.dir, '..');

const SCREENS = ['app/you/map/[id].tsx', 'app/you/timelapse/[id].tsx'] as const;
const COMPONENTS = ['src/map/MapCanvas.tsx', 'src/map/Scrubber.tsx', 'src/map/MapParts.tsx'] as const;
const FILES = [...SCREENS, ...COMPONENTS].map((name) => ({ name, src: readFileSync(join(MOBILE, name), 'utf8') }));
const MODULES = readdirSync(join(MOBILE, 'src/map'))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ name: `src/map/${f}`, src: readFileSync(join(MOBILE, 'src/map', f), 'utf8') }));

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('built from the kit', () => {
  test('text goes through <T>: no bare Text from react-native', () => {
    for (const f of FILES) {
      const imports = code(f.src).match(/import[^;]*from 'react-native';/g) ?? [];
      expect({ file: f.name, bare: imports.some((i) => /[{,\s]Text[,\s}]/.test(i)) }).toEqual({ file: f.name, bare: false });
    }
  });

  test('no hand rolled Section, Row, Stat, Card, Button or Chip', () => {
    for (const f of FILES) {
      const local = [...code(f.src).matchAll(/function (Section|Row|Stat|StatGrid|Card|Button|Chip)\b/g)].map((m) => m[1]);
      expect({ file: f.name, local }).toEqual({ file: f.name, local: [] });
    }
  });

  test('type sizes come from the roles, radii from the rule, every rounded rectangle continuous', () => {
    for (const f of FILES) {
      const c = code(f.src);
      const sizes = c.match(/fontSize:\s*\d+/g) ?? [];
      const literal = c.match(/borderRadius:\s*\d+/g) ?? [];
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, sizes, literal, curves }).toEqual({ file: f.name, sizes: [], literal: [], curves: radii });
    }
  });

  test('colours only from the tokens: no hex, no rgb, no system grey anywhere in the map', () => {
    for (const f of MODULES) {
      const c = code(f.src);
      expect({ file: f.name, colours: c.match(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/g) ?? [] }).toEqual({ file: f.name, colours: [] });
    }
  });

  test('no amber outline, no gradient, no emoji, no uppercase caption', () => {
    for (const f of FILES) {
      const c = code(f.src);
      expect({
        file: f.name,
        amberOutline: /border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/.test(c),
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
        shouting: [...c.matchAll(/>\s*([A-Z]{2,}(?: [A-Z]{2,})+)\s*</g)].map((m) => m[1]),
        transform: /textTransform:\s*'uppercase'/.test(c),
      }).toEqual({ file: f.name, amberOutline: false, gradient: false, emoji: false, shouting: [], transform: false });
    }
  });

  test('the layout is never random: no Math.random and no clock anywhere a position is decided', () => {
    for (const f of MODULES) expect({ file: f.name, random: /Math\.random/.test(code(f.src)) }).toEqual({ file: f.name, random: false });
    for (const name of ['src/map/layout.ts', 'src/map/pack.ts', 'src/map/heat.ts', 'src/map/knot.ts', 'src/map/frames.ts']) {
      expect({ file: name, clock: /Date\.now\(/.test(code(readFileSync(join(MOBILE, name), 'utf8'))) }).toEqual({ file: name, clock: false });
    }
  });

  test('haptics: a selection tick for a picked cell and a crossed spike, and nothing that fires in a loop', () => {
    const canvas = code(readFileSync(join(MOBILE, 'src/map/MapCanvas.tsx'), 'utf8'));
    const scrubber = code(readFileSync(join(MOBILE, 'src/map/Scrubber.tsx'), 'utf8'));
    expect(canvas).toMatch(/\bselect\(\)/);
    expect(scrubber).toMatch(/runOnJS\(select\)\(\)/);
    for (const f of FILES) expect({ file: f.name, heavy: /Heavy|impactAsync|notificationAsync/.test(code(f.src)) }).toEqual({ file: f.name, heavy: false });
  });

  test('Reduce Motion: the canvas stops the pulse and the glide, the replay does not autoplay', () => {
    const canvas = code(readFileSync(join(MOBILE, 'src/map/MapCanvas.tsx'), 'utf8'));
    expect(canvas).toMatch(/const pulsing = knot\.length > 0 && !reduce/);
    expect(canvas).toMatch(/if \(!moved \|\| reduce\)/);
    const lapse = code(readFileSync(join(MOBILE, 'app/you/timelapse/[id].tsx'), 'utf8'));
    expect(lapse).toMatch(/if \(reduce\) return;\s*const t = setTimeout/);
  });
});

describe('every state is drawn', () => {
  test('loading, signed out, missing, error, stale, and the refusals, on both screens', () => {
    for (const name of SCREENS) {
      const c = code(readFileSync(join(MOBILE, name), 'utf8'));
      expect({
        file: name,
        loading: /Skeleton width=/.test(c),
        signedOut: /<SessionSignedOut\b/.test(c),
        missing: /<SessionMissing\b/.test(c),
        error: /<SessionError\b/.test(c),
        stale: /<StaleLine\b/.test(c),
        refusal: /<MapRefusal\b/.test(c),
        skeletonRoute: /RouteSkeleton/.test(c),
      }).toEqual({ file: name, loading: true, signedOut: true, missing: true, error: true, stale: true, refusal: true, skeletonRoute: false });
    }
  });
});

describe('both are routes a link opens', () => {
  test('the root stack registers them and DEEPLINKS.md lists the sample links and every variant', () => {
    const layout = readFileSync(join(MOBILE, 'app/_layout.tsx'), 'utf8');
    const links = readFileSync(join(MOBILE, 'src/nav/DEEPLINKS.md'), 'utf8');
    expect(layout).toContain('name="you/map/[id]"');
    expect(layout).toContain('name="you/timelapse/[id]"');
    for (const link of ['builder://you/map/sample', 'builder://you/timelapse/sample']) expect(links).toContain(link);
    for (const v of ['circling', 'names', 'cut', 'empty']) expect(links).toContain(`variant=${v}`);
  });
});
