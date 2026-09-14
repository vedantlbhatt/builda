/**
 * Every screen the app ships stays inside the design law, so a later edit cannot quietly bring
 * back a hand-rolled section, a literal type size, a 10pt radius, an amber outline or a
 * capitalised caption.
 *
 * THE LIST IS THE ROUTES, never a hand-kept list. FOUND IN REVIEW (2026-09-13): this file
 * named 22 files by hand, 8 of them modules nothing imported any more (the old profile
 * screen's parts, the You links) and not one of the screens rebuilt in the house style, so it
 * passed while guarding nothing anybody could open. Now it walks `app/`: every route file
 * Expo Router serves, less layouts (`_layout`), special files (`+native-intent`) and the dev
 * routes, which redirect in a release build (their component opens with
 * `if (!__DEV__) return <Redirect`), so a new screen is covered the day it lands.
 * MEASURED, pointed at the 27 routes before their fixes: 4 of these 7 rules failed, with 38
 * literal type sizes in 8 screens, 8 literal radii in 3, 3 capitalised captions ("CREATE",
 * "JOIN BY CODE", "COMMENTS") and 1 amber outline (the follow button). After: all pass.
 *
 * ONE RULE WAS RETIRED, AND WHY. "Text goes through `<T>`" was the foundation refit's rule,
 * for its kit. The house style the owner picked (design-refs/HOUSE-STYLE.md; the reference is
 * the analysis page) sets words on React Native's `Text` with the role sized styles in
 * `src/insights/kit.tsx`, and draws a heavy word or number as a graphic through `figure()`,
 * so the rule failed the reference implementation itself. What it protected still holds, and
 * is below: no literal type size, only the roles (`typeRoles`) or a figure.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it. A
 * failure names the file and the offending code.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MOBILE = join(import.meta.dir, '..');
const APP = join(MOBILE, 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** A dev route redirects to the app in a release build before it renders anything. */
const DEV_ONLY = /if \(!__DEV__\) return <Redirect/;

const all = walk(APP).map((p) => ({ name: relative(MOBILE, p), src: readFileSync(p, 'utf8') }));
const files = all.filter((f) => !/(^|\/)[_+][^/]*$/.test(f.name)).filter((f) => !DEV_ONLY.test(f.src));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the list is the routes', () => {
  test('every shipped route is here, and nothing that is not a route', () => {
    const names = files.map((f) => f.name);
    // The rebuilt screens and the rest, by the paths Expo Router serves them at.
    for (const must of ['app/(tabs)/now.tsx', 'app/(tabs)/you.tsx', 'app/analysis.tsx', 'app/wrapped.tsx', 'app/live.tsx', 'app/you/money.tsx', 'app/onboarding/hello.tsx', 'app/session/[id].tsx', 'app/factions.tsx']) {
      expect(names).toContain(must);
    }
    expect(names.every((n) => n.startsWith('app/'))).toBe(true);
    expect(names.some((n) => /_layout\.tsx$/.test(n))).toBe(false);
    expect(names.length).toBeGreaterThanOrEqual(27);
  });

  test('a dev route is left out only because a release build never renders it', () => {
    const dev = all.filter((f) => DEV_ONLY.test(f.src)).map((f) => f.name).sort();
    expect(dev).toEqual(['app/debug/live.tsx', 'app/dev-auth.tsx', 'app/dev-gallery.tsx']);
  });
});

describe('every shipped screen builds from the kit', () => {
  test('no hand-rolled Section, Row, Stat, Card or Button', () => {
    for (const f of files) {
      const local = [...code(f.src).matchAll(/function (Section|Row|Stat|Card|Button|Chip)\b/g)].map((m) => m[1]);
      expect({ file: f.name, local }).toEqual({ file: f.name, local: [] });
    }
  });

  test('type sizes come from the roles: no fontSize literal', () => {
    for (const f of files) {
      const hits = code(f.src).match(/fontSize:\s*\d+/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('radii come from the rule, and every rounded rectangle is continuous', () => {
    for (const f of files) {
      const c = code(f.src);
      const literal = c.match(/borderRadius:\s*\d+/g) ?? [];
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, literal, curves }).toEqual({ file: f.name, literal: [], curves: radii });
    }
  });

  test('SF Mono through the mono role, never Menlo', () => {
    for (const f of files) expect({ file: f.name, menlo: /Menlo/.test(code(f.src)) }).toEqual({ file: f.name, menlo: false });
  });

  test('captions are lower case: no capitalised caption and no uppercase transform', () => {
    for (const f of files) {
      const c = code(f.src);
      const shouting = [...c.matchAll(/>\s*([A-Z]{2,}(?: [A-Z]{2,})*)\s*</g)].map((m) => m[1]);
      const transform = /textTransform:\s*'uppercase'/.test(c);
      expect({ file: f.name, shouting, transform }).toEqual({ file: f.name, shouting: [], transform: false });
    }
  });

  test('no tinted chip: nothing outlined in amber', () => {
    // The pairing frame over the camera turns amber when the code is read: a state on a
    // live preview with no text in it, the one amber stroke on purpose.
    const allowed = new Set(['app/pair.tsx']);
    for (const f of files) {
      if (allowed.has(f.name)) continue;
      // A ternary counts too: `borderColor: name ? c.accent : c.border` is still an amber outline.
      const hits = code(f.src).match(/border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('no gradients and no emoji', () => {
    for (const f of files) {
      expect({ file: f.name, gradient: /Gradient\b/.test(code(f.src)), emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({
        file: f.name,
        gradient: false,
        emoji: false,
      });
    }
  });
});
