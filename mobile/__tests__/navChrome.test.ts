/**
 * The chrome wears the builder's creature's hue (design-refs/HOUSE-STYLE.md, last section): the
 * tab bar's colours and measurements, when a tab's glyph bounces, when the accent is read again,
 * what the Settings band says, that no chrome file paints amber, and that every screen of the
 * app is registered behind the root layout's guards (an unlisted route exists in every state,
 * before onboarding and in release builds alike).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { hasDash } from '../src/copy/plain';
import { contrast } from '../src/insights/palette';
import {
  AMBER,
  CREATURE_GRID,
  CREATURE_PICKERS,
  isTabSelected,
  leftCreaturePicker,
  shouldBounce,
  symbolBounceAvailable,
  TAB_BAR_GROUND,
  TAB_BAR_HEIGHT,
  TAB_BOUNCE,
  TAB_CREATURE_SIZE,
  TAB_LABEL,
  tabTint,
} from '../src/nav/chromeRules';
import { DEV_ROUTES, pathWhileOnboarding } from '../src/nav/rules';
import { colourLine, creatureLabel, identityLines, keysCaption } from '../src/nav/settingsCopy';
import { ANIMALS, ANIMAL_LABELS, DEFAULT_ANIMAL } from '../src/pixel/animals';
import { creatureHue } from '../src/theme';
import { accentOf } from '../src/theme/accentRule';

const MOBILE = join(import.meta.dir, '..');

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function read(path: string): string {
  return readFileSync(join(MOBILE, path), 'utf8');
}

describe('the tab bar wears the creature', () => {
  test('the active glyph and label are the creature hue, for every creature; the rest are the warm grey', () => {
    for (const animal of ANIMALS) {
      const t = tabTint(accentOf(animal));
      const h = creatureHue(animal);
      expect({ animal, icon: t.icon, label: t.label, rest: t.rest }).toEqual({ animal, icon: h.ink, label: h.text, rest: TAB_BAR_GROUND.inactive });
    }
  });

  test('no creature a builder can pick makes the bar amber', () => {
    for (const animal of ANIMALS) {
      const t = tabTint(accentOf(animal));
      expect({ animal, amber: [t.icon, t.label].some((x) => x.toUpperCase() === AMBER.toUpperCase()) }).toEqual({ animal, amber: false });
    }
  });

  test('an 11pt label in any creature hue reads at 4.5:1 or better on the bar; so does the grey at rest', () => {
    for (const animal of ANIMALS) {
      const ratio = contrast(tabTint(accentOf(animal)).label, TAB_BAR_GROUND.bg);
      expect({ animal, ok: ratio >= 4.5 }).toEqual({ animal, ok: true });
    }
    expect(contrast(TAB_BAR_GROUND.inactive, TAB_BAR_GROUND.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('the measurements the references give: 56pt over the home indicator, 11pt labels at 600 and +0.2', () => {
    expect(TAB_BAR_HEIGHT).toBe(56);
    expect(TAB_LABEL).toEqual({ fontSize: 11, fontWeight: '600', letterSpacing: 0.2 });
  });

  test('the You tab creature is whole points per cell, so every pixel is whole at @2x and @3x', () => {
    const perCell = TAB_CREATURE_SIZE / CREATURE_GRID;
    expect(Number.isInteger(perCell)).toBe(true);
    expect(perCell).toBeGreaterThanOrEqual(2);
  });

  test('the default creature is a real accent: the bar is never unthemed before a pick', () => {
    expect(tabTint(accentOf(DEFAULT_ANIMAL)).icon).toBe(creatureHue(DEFAULT_ANIMAL).ink);
  });
});

describe('a tab bounces only when it is selected', () => {
  test('from not selected to selected, and only then', () => {
    expect(shouldBounce(false, true, false)).toBe(true);
    expect(shouldBounce(true, true, false)).toBe(false);
    expect(shouldBounce(true, false, false)).toBe(false);
    expect(shouldBounce(false, false, false)).toBe(false);
  });
  test('never on the first render: a cold start lands on a tab, it does not select one', () => {
    expect(shouldBounce(null, true, false)).toBe(false);
    expect(shouldBounce(undefined, true, false)).toBe(false);
  });
  test('never under Reduce Motion', () => {
    expect(shouldBounce(false, true, true)).toBe(false);
  });
  test('small and short: Spotify\'s like heart, 1.15 and home on a 0.7 damped spring', () => {
    expect(TAB_BOUNCE.peak).toBe(1.15);
    expect(TAB_BOUNCE.settle.dampingRatio).toBe(0.7);
    expect(TAB_BOUNCE.riseMs + TAB_BOUNCE.settle.duration).toBeLessThanOrEqual(450);
  });
  test('selection is read from the navigator state, by key', () => {
    const state = { index: 1, routes: [{ key: 'now-1' }, { key: 'sessions-2' }, { key: 'you-3' }] };
    expect(isTabSelected(state, 'sessions-2')).toBe(true);
    expect(isTabSelected(state, 'now-1')).toBe(false);
    expect(isTabSelected(undefined, 'now-1')).toBe(false);
    expect(isTabSelected({ index: 5, routes: state.routes }, 'you-3')).toBe(false);
  });
  test('the SF Symbol bounce from iOS 17; before that, and off iOS, the spring', () => {
    expect(symbolBounceAvailable('ios', '17.0')).toBe(true);
    expect(symbolBounceAvailable('ios', '26.0')).toBe(true);
    expect(symbolBounceAvailable('ios', 18)).toBe(true);
    expect(symbolBounceAvailable('ios', '16.4')).toBe(false);
    expect(symbolBounceAvailable('android', 34)).toBe(false);
    expect(symbolBounceAvailable('ios', undefined)).toBe(false);
  });
});

describe('the accent is read again when a picker is left', () => {
  test('leaving the picker or onboarding\'s creature step reads it', () => {
    expect(leftCreaturePicker('/icon', '/settings')).toBe(true);
    expect(leftCreaturePicker('/icon', '/you')).toBe(true);
    expect(leftCreaturePicker('/onboarding/creature', '/onboarding/tools')).toBe(true);
  });
  test('arriving at one, staying on one, or any other move does not', () => {
    expect(leftCreaturePicker('/settings', '/icon')).toBe(false);
    expect(leftCreaturePicker('/icon', '/icon')).toBe(false);
    expect(leftCreaturePicker('/now', '/sessions')).toBe(false);
    expect(leftCreaturePicker(null, '/now')).toBe(false);
  });
  test('the pickers named are routes that exist', () => {
    for (const p of CREATURE_PICKERS) {
      expect(statSync(join(MOBILE, 'app', `${p.slice(1)}.tsx`)).isFile()).toBe(true);
    }
  });
});

describe('the Settings band', () => {
  test('signed in: the display name large, the handle under it', () => {
    expect(identityLines({ signedIn: true, me: { handle: 'vedant', display_name: 'Vedant' }, localName: 'V' })).toEqual({
      title: 'Signed in',
      name: 'Vedant',
      handle: '@vedant',
    });
  });
  test('signed in with no display name: the onboarding name, else the handle', () => {
    expect(identityLines({ signedIn: true, me: { handle: 'vb', display_name: null }, localName: 'Ved' }).name).toBe('Ved');
    expect(identityLines({ signedIn: true, me: { handle: 'vb', display_name: '  ' }, localName: null }).name).toBe('vb');
  });
  test('no handle is said once the profile has loaded, and not before', () => {
    expect(identityLines({ signedIn: true, me: { handle: null, display_name: 'A' }, localName: null }).handle).toBe('No handle yet');
    expect(identityLines({ signedIn: true, me: null, localName: 'A' }).handle).toBeNull();
  });
  test('signed out: the name typed in onboarding, no handle, and never a stale account name', () => {
    expect(identityLines({ signedIn: false, me: { handle: 'old', display_name: 'Old' }, localName: 'Ved' })).toEqual({
      title: 'Not signed in',
      name: 'Ved',
      handle: null,
    });
    expect(identityLines({ signedIn: false, me: null, localName: null }).name).toBe('You');
  });
  test('the colour sentence names the creature and its hue, for every creature, with no dash', () => {
    for (const animal of ANIMALS) {
      const a = accentOf(animal);
      const line = colourLine(animal, a.name);
      expect(line).toContain(`the ${ANIMAL_LABELS[animal]}'s ${a.name}`);
      expect(line.startsWith("Builda wears your creature's colour")).toBe(true);
      expect({ line, dash: hasDash(line) }).toEqual({ line, dash: false });
      expect(hasDash(creatureLabel(animal))).toBe(false);
    }
  });
  test('the key count reads as words beside the figure', () => {
    expect(keysCaption(1, 5)).toBe('live key, of 5');
    expect(keysCaption(3, 5)).toBe('live keys, of 5');
  });
});

describe('no amber in the chrome', () => {
  const CHROME = ['app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'app/settings.tsx', 'src/nav/chrome.tsx'] as const;

  test('nothing reads the amber accent, its pressed tone, or amber by name', () => {
    for (const f of CHROME) {
      const hits = code(read(f)).match(/\bnav\.accent\b|\bc\.accent\b|accentPressed|SPECTRUM\.amber|#FFB300|tone="accent"|hues\.amber/gi) ?? [];
      expect({ file: f, hits }).toEqual({ file: f, hits: [] });
    }
  });

  test('Settings uses the kit button only as a word: its primary is the amber capsule', () => {
    const src = code(read('app/settings.tsx'));
    const buttons = [...src.matchAll(/<Button\b([\s\S]*?)\/>/g)].map((m) => m[1]!);
    expect(buttons.length).toBeGreaterThan(0);
    for (const props of buttons) expect({ props: props.trim().slice(0, 60), secondary: /kind="secondary"/.test(props) }).toMatchObject({ secondary: true });
  });

  test('every field in Settings has the accent caret and every switch the accent track', () => {
    const src = code(read('app/settings.tsx'));
    const fields = [...src.matchAll(/<TextField\b([\s\S]*?)\/>/g)].map((m) => m[1]!);
    expect(fields.length).toBeGreaterThan(0);
    for (const props of fields) expect(/selectionColor=\{accent\.ink\}/.test(props) && /cursorColor=\{accent\.ink\}/.test(props)).toBe(true);
    const switches = [...src.matchAll(/<Switch\b([\s\S]*?)\/>/g)].map((m) => m[1]!);
    expect(switches.length).toBeGreaterThan(0);
    for (const props of switches) expect(/trackColor=\{\{\s*true:\s*accent\.fill/.test(props)).toBe(true);
  });
});

// ------------------------------------------------------------------ the route tree

interface Group {
  guard: string;
  names: string[];
}

function groups(): Group[] {
  const src = code(read('app/_layout.tsx'));
  return [...src.matchAll(/<Stack\.Protected guard=\{([^}]+)\}>([\s\S]*?)<\/Stack\.Protected>/g)].map((m) => ({
    guard: m[1]!.trim(),
    names: [...m[2]!.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((n) => n[1]!),
  }));
}

/** Every route the root stack can hold: files under app/, minus layouts, groups' insides and specials. */
function routeFiles(): string[] {
  const app = join(MOBILE, 'app');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx$/.test(name) || name.startsWith('_') || name.startsWith('+')) continue;
      out.push(relative(app, full).replace(/\.tsx$/, ''));
    }
  };
  walk(app);
  return out;
}

describe('every screen sits behind a guard', () => {
  test('the analysis page is in the onboarded group and nowhere else', () => {
    const g = groups();
    const onboarded = g.find((x) => x.guard === 'onboarded');
    expect(onboarded?.names).toContain('analysis');
    for (const other of g.filter((x) => x.guard !== 'onboarded')) expect(other.names).not.toContain('analysis');
  });

  test('a link to it while onboarding is dropped, not queued at a route that does not exist', () => {
    expect(pathWhileOnboarding('builder://analysis')).toBeNull();
    expect(pathWhileOnboarding('/analysis')).toBeNull();
  });

  test('every route file is listed in exactly one group, or is inside a listed group', () => {
    const listed = groups().flatMap((g) => g.names);
    // A group route stands for everything inside it: `(tabs)` holds the tabs, `onboarding` its steps.
    const covered = (route: string) =>
      listed.includes(route) || listed.some((name) => !name.includes('[') && route.startsWith(`${name}/`) && (name === '(tabs)' || name === 'onboarding'));
    const missing = routeFiles().filter((r) => !covered(r));
    expect(missing).toEqual([]);
    const twice = listed.filter((n, i) => listed.indexOf(n) !== i);
    expect(twice).toEqual([]);
  });

  test('the dev group is the dev routes, and a link to one passes while onboarding', () => {
    const dev = groups().find((x) => x.guard === '__DEV__');
    expect(new Set(dev?.names)).toEqual(new Set(DEV_ROUTES));
    for (const r of DEV_ROUTES) expect(pathWhileOnboarding(`/${r}`)).toBe(`/${r}`);
  });
});
