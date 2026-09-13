/**
 * Onboarding's words and the house rules on them (brief.md, DESIGN-DIRECTION 9): no dashes,
 * labels and captions in lower case, one label per intent ("Continue" wherever the flow moves
 * forward), no emoji. And the screens' code: built from the kit, radii from the rule, no
 * gradients, no amber outlines, and the one size that is not a role spelled in one place.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANIMALS } from '../src/pixel/animals';
import { HARNESS_MARKS } from '../src/pixel/harness';
import {
  ALL_STATIC,
  CONNECT,
  CONTINUE,
  CREATURE,
  DONE,
  NAME,
  NOT_NOW,
  NOTIFY,
  THATS_ME,
  TOOLS,
  creatureCaption,
  doneCaption,
  listOf,
  pairedWith,
  positionLine,
  sessionsArrived,
  toolsFound,
} from '../src/onboarding/copy';
import * as copy from '../src/onboarding/copy';
import { NAME_MESSAGES } from '../src/onboarding/names';

/** The three ways a dash gets typed (the same rule as `copy.test.ts`). */
const DASH = /[—–]|\s-\s/;

const dynamic: string[] = [
  ...ANIMALS.flatMap((a) => [creatureCaption('Vedant', a), creatureCaption(null, a), creatureCaption('  ', a)]),
  doneCaption([]),
  doneCaption(HARNESS_MARKS.map((m) => m.name)),
  doneCaption(['Claude Code']),
  ...[0, 1, 2, 77, 1000, 1234567].flatMap((n) => [
    toolsFound(n, false),
    toolsFound(n, true),
    toolsFound(n, false, ['Claude Code']),
    toolsFound(n, true, ['Claude Code', 'Codex']),
    sessionsArrived(n, false),
    sessionsArrived(n, true),
  ]),
  positionLine(6, 8),
  pairedWith('MacBook Pro'),
  pairedWith('  '),
  listOf(['a', 'b', 'c', 'd', 'e']),
];

const every = [...ALL_STATIC, ...Object.values(NAME_MESSAGES), ...dynamic];

describe('the words', () => {
  test('no dashes anywhere, static or built', () => {
    const hits = every.filter((s) => DASH.test(s));
    expect(hits).toEqual([]);
  });

  test('no emoji', () => {
    expect(every.filter((s) => /\p{Extended_Pictographic}/u.test(s))).toEqual([]);
  });

  test('labels over headlines are lower case', () => {
    const labels: string[] = [NAME.label, CREATURE.label, CREATURE.suggested, TOOLS.label, CONNECT.label, CONNECT.codeLabel, NOTIFY.label, DONE.label];
    for (const l of labels) expect(l).toBe(l.toLowerCase());
  });

  test('the timeline row titles are titles: sentence case, like the bodies under them', () => {
    for (const r of NOTIFY.rows) {
      expect(r.title[0]).toBe(r.title[0]!.toUpperCase());
      expect(r.body[0]).toBe(r.body[0]!.toUpperCase());
    }
  });

  test("one label per intent: Continue moves on, Not now skips (everywhere), That's me commits", () => {
    expect(CONTINUE).toBe('Continue');
    expect(new Set([CONTINUE, NOT_NOW, THATS_ME]).size).toBe(3);
    // No second skip label: "Later" beside "Not now" was two words for one intent.
    expect('LATER' in copy).toBe(false);
    const banned = /\b(Next|Get started|Start now|Begin|Done|Skip|Later)\b/;
    // The chevrons' VoiceOver names say which creature they lead to; they are not a way on.
    const directions = new Set<string>([CREATURE.previous, CREATURE.next]);
    expect(every.filter((s) => !directions.has(s) && banned.test(s))).toEqual([]);
  });

  test('apostrophes are typographic', () => {
    expect(THATS_ME).toBe('That\u2019s me');
    expect(every.filter((s) => s.includes("'"))).toEqual([]);
  });

  test('the caption uses the real creature names', () => {
    expect(creatureCaption('Vedant', ANIMALS[0]!)).toBe(`Vedant, the ${ANIMALS[0]}`);
    expect(creatureCaption(null, ANIMALS[0]!)).toBe(`The ${ANIMALS[0]}`);
  });

  test('the finale says the tools as a sentence, and nothing when there are none', () => {
    expect(doneCaption([])).toBe('');
    expect(doneCaption(['Claude Code', 'Codex'])).toBe('Building with Claude Code and Codex.');
    expect(listOf(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listOf(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
    expect(listOf([])).toBe('');
  });

  test('counts read like a product: grouped, singular when one, a lower bound said as one', () => {
    expect(toolsFound(1234, false)).toContain('1,234 sessions');
    expect(toolsFound(1, false)).toContain('1 session ');
    expect(toolsFound(1000, true)).toContain('more than 1,000');
    expect(sessionsArrived(1, false)).toStartWith('1 session has');
    expect(sessionsArrived(1000, true)).toStartWith('More than 1,000 sessions have');
  });

  test('the tools sentence names the tools the count came from', () => {
    expect(toolsFound(77, false, ['Claude Code'])).toBe('Builder found 77 sessions from Claude Code on your account and picked it.');
    expect(toolsFound(80, false, ['Claude Code', 'Codex'])).toBe('Builder found 80 sessions on your account, from Claude Code and Codex, and picked them.');
  });

  test('connect says what it can do: signing in when signed out, nothing to connect when sessions arrive', () => {
    expect(CONNECT.signedOutHeadline.toLowerCase()).toContain('sign in');
    expect(CONNECT.arrivingHeadline).not.toContain('Connect');
    // The label is not the headline said again.
    expect(CONNECT.headline.toLowerCase()).not.toContain(CONNECT.label);
  });
});

// ─── the code ─────────────────────────────────────────────────────────────────────────

const MOBILE = join(import.meta.dir, '..');
const FILES = [
  ...readdirSync(join(MOBILE, 'app/onboarding')).map((f) => `app/onboarding/${f}`),
  ...readdirSync(join(MOBILE, 'src/onboarding')).map((f) => `src/onboarding/${f}`),
  'app/icon.tsx',
].filter((f) => /\.tsx?$/.test(f));
const sources = FILES.map((name) => ({ name, src: readFileSync(join(MOBILE, name), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the onboarding screens build from the kit', () => {
  test('there is something to check', () => {
    expect(FILES).toContain('app/onboarding/name.tsx');
    expect(FILES).toContain('src/onboarding/CreatureCarousel.tsx');
  });

  test('text goes through <T>: no bare Text from react-native', () => {
    for (const f of sources) {
      const imports = code(f.src).match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
      expect({ file: f.name, bareText: imports.some((i) => /[{,\s]Text[,\s}]/.test(i)) }).toEqual({ file: f.name, bareText: false });
    }
  });

  test('one size that is not a role, spelled once: the 34/800 headline in type.ts', () => {
    for (const f of sources) {
      if (f.name === 'src/onboarding/type.ts') continue;
      expect({ file: f.name, hits: code(f.src).match(/fontSize:\s*\d+/g) ?? [] }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('radii come from the rule, and every rounded rectangle is continuous', () => {
    for (const f of sources) {
      const c = code(f.src);
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, literal: c.match(/borderRadius:\s*\d+/g) ?? [], curves }).toEqual({ file: f.name, literal: [], curves: radii });
    }
  });

  test('no gradient, no emoji, no amber outline', () => {
    for (const f of sources) {
      const c = code(f.src);
      expect({
        file: f.name,
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
        amberOutline: /border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/.test(c),
      }).toEqual({ file: f.name, gradient: false, emoji: false, amberOutline: false });
    }
  });

  test('no system blue and no cool grey literal', () => {
    for (const f of sources) {
      const hits = code(f.src).match(/#(?:007AFF|0A84FF|8E8E93|666666|999999|CCCCCC)\b/gi) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('every forward button on a step says Continue (the label comes from copy.ts, never typed)', () => {
    for (const f of sources.filter((s) => s.name.startsWith('app/onboarding/'))) {
      const typed = code(f.src).match(/label=["'][^"']+["']/g) ?? [];
      expect({ file: f.name, typed }).toEqual({ file: f.name, typed: [] });
    }
  });
});
