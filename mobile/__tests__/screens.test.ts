/**
 * The screens that were refit onto the kit stay on it. The kit itself is held by
 * `designTokens.test.ts`; this holds the screens and components built from it, so a later
 * edit cannot quietly bring back a hand-rolled section, a 10pt radius, an amber outline or
 * a capitalised caption.
 *
 * Each rule reads the code with comments removed, so prose about a rule never trips it.
 * A failure names the file and the offending code.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(import.meta.dir, '..');

/** Everything the refit touched. Social screens (feed, post, factions, u/) are out of scope. */
const REFIT = [
  'app/(tabs)/now.tsx',
  'app/(tabs)/sessions.tsx',
  'app/(tabs)/you.tsx',
  'app/session/[id].tsx',
  'app/settings.tsx',
  'app/pair.tsx',
  'app/icon.tsx',
  'src/analysis/AnalysisView.tsx',
  'src/live/LiveSessions.tsx',
  'src/nav/YouLinks.tsx',
  'src/pixel/PixelBadge.tsx',
  'src/profile/ArchetypeHero.tsx',
  'src/profile/BuilderProfileCard.tsx',
  'src/profile/ContributionGrid.tsx',
  'src/profile/FactList.tsx',
  'src/profile/NarrativeSection.tsx',
  'src/profile/ReportSections.tsx',
  'src/profile/ShareBars.tsx',
  'src/recap/RecapSheet.tsx',
  'src/social/MediaPicker.tsx',
  'src/social/PhotoGrid.tsx',
  'src/social/UploadLine.tsx',
] as const;

const files = REFIT.map((name) => ({ name, src: readFileSync(join(MOBILE, name), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the refit screens build from the kit', () => {
  test('text goes through <T>: no bare Text from react-native', () => {
    for (const f of files) {
      const imports = code(f.src).match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
      const bare = imports.some((i) => /[{,\s]Text[,\s}]/.test(i));
      expect({ file: f.name, bareText: bare }).toEqual({ file: f.name, bareText: false });
    }
  });

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
      const shouting = [...c.matchAll(/>\s*([A-Z]{2,}(?: [A-Z]{2,})+)\s*</g)].map((m) => m[1]);
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
