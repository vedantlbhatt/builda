/**
 * The spectrum: nine identity hues and every table that says who wears which
 * (design/tokens.json `spectrum`, design-refs/DESIGN-V2-COLOUR-MOTION.md).
 *
 * OWNER OVERRIDE, 2026-09-13 09:22 (brief.md): "why are all of them the same color? Looks
 * horrible." The one accent rule is lifted for identity; amber stays the brand and the only
 * action colour. `scripts/gen_tokens.py` already refuses a spectrum under its contrast floors;
 * this file holds the TypeScript side: that `theme.ts` resolves what the tokens say, and that
 * the tokens' tables agree with the tables the app already has (the archetype animals, the
 * harness marks, the Wrapped card order, the dimensions), so a rename on either side is a red
 * test and not a creature quietly falling back to amber.
 */
import { describe, expect, test } from 'bun:test';

import { ANALYSIS_ENUMS } from '../src/generated/analysis';
import { REPORT_ENUMS } from '../src/generated/report';
import { tokens } from '../src/generated/tokens';
import { ANIMALS, ARCHETYPE_ANIMALS, CORPUS_ARCHETYPE_ANIMALS } from '../src/pixel/animals';
import { HARNESSES, HARNESS_MARKS, markFor } from '../src/pixel/harness';
import {
  CREW_RING,
  HUE_NAMES,
  archetypeHue,
  cardHue,
  colors,
  creatureHue,
  dimensionHue,
  harnessHue,
  hue,
  isHueName,
  verdictColor,
  type CardId,
  type HueName,
  type Scheme,
} from '../src/theme';

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SCHEMES: Scheme[] = ['dark', 'light'];

describe('the nine hues', () => {
  test('nine, amber first, and amber is the accent', () => {
    expect(HUE_NAMES).toEqual(['amber', 'brass', 'tide', 'cobalt', 'iris', 'heather', 'orchid', 'coral', 'ember']);
    expect(tokens.spectrum.hues.amber.dark).toBe(tokens.surface.accent.dark);
    expect(isHueName('tide')).toBe(true);
    expect(isHueName('teal')).toBe(false);
    expect(isHueName('toString')).toBe(false);
  });

  test('every hue clears the floors the doc states for its use', () => {
    const d = colors('dark');
    const l = colors('light');
    for (const n of HUE_NAMES) {
      const t = tokens.spectrum.hues[n];
      expect(contrast(t.dark, d.bg), `${n} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.dark, d.card), `${n} on card`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(String(d.onAccent), t.dark), `ink on ${n}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.partner, d.card), `${n} partner on card`).toBeGreaterThanOrEqual(3);
      const step = contrast(t.dark, t.partner);
      expect(step, `${n} partner step`).toBeGreaterThanOrEqual(1.5);
      expect(step, `${n} partner step`).toBeLessThanOrEqual(2.6);
      expect(contrast(t.light, l.bg), `${n} light mark`).toBeGreaterThanOrEqual(3);
      expect(contrast(t.lightText, l.bg), `${n} light text on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.lightText, l.card), `${n} light text on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('hue() resolves the scheme: marks, text, the dither tone, and a fill that is the dark ink in both', () => {
    for (const n of HUE_NAMES) {
      const t = tokens.spectrum.hues[n];
      expect(hue(n)).toEqual(hue(n, 'dark'));
      expect(hue(n, 'dark')).toEqual({ name: n, ink: t.dark, text: t.dark, partner: t.partner, fill: t.dark, onFill: '#1C1917' });
      expect(hue(n, 'light')).toEqual({ name: n, ink: t.light, text: t.lightText, partner: t.lightPartner, fill: t.dark, onFill: '#1C1917' });
    }
  });

  test('colors(scheme).hues is hue() for every name, so useColors() carries the spectrum', () => {
    for (const s of SCHEMES) {
      const c = colors(s);
      expect(Object.keys(c.hues)).toEqual(HUE_NAMES);
      for (const n of HUE_NAMES) expect(c.hues[n]).toEqual(hue(n, s));
    }
  });
});

describe('who wears which', () => {
  test('creatures: Bit is amber, each animal its own hue, all nine different', () => {
    expect(creatureHue('bit').name).toBe('amber');
    const names = ANIMALS.map((a) => creatureHue(a).name);
    expect(new Set([...names, 'amber']).size).toBe(9);
    expect(names).not.toContain('amber');
    expect(Object.fromEntries(ANIMALS.map((a) => [a, creatureHue(a).name]))).toEqual({
      cat: 'orchid',
      dog: 'cobalt',
      fox: 'ember',
      owl: 'heather',
      bee: 'brass',
      whale: 'tide',
      octopus: 'iris',
      crab: 'coral',
    });
  });

  test('the crew ring is the eight animals once each, never Bit, so no session is ever amber', () => {
    expect([...CREW_RING].sort()).toEqual([...ANIMALS].sort());
    expect(CREW_RING).not.toContain('bit' as never);
    // Warm and cool alternate round the ring, so a session stepped past a clash lands far away.
    const warm = new Set<HueName>(['ember', 'brass', 'coral', 'orchid']);
    for (let i = 0; i < CREW_RING.length; i++) {
      const a = warm.has(creatureHue(CREW_RING[i]!).name);
      const b = warm.has(creatureHue(CREW_RING[(i + 1) % CREW_RING.length]!).name);
      expect(a === b, `${CREW_RING[i]} then ${CREW_RING[(i + 1) % CREW_RING.length]}`).toBe(false);
    }
  });

  test("an archetype wears its creature's hue: the tokens agree with ARCHETYPE_ANIMALS", () => {
    const animals = { ...ARCHETYPE_ANIMALS, ...CORPUS_ARCHETYPE_ANIMALS } as Record<string, (typeof ANIMALS)[number]>;
    for (const [archetype, animal] of Object.entries(animals)) {
      expect(archetypeHue(archetype).name, archetype).toBe(creatureHue(animal).name);
    }
    // The generalist is Bit's amber, and so is anything the engine did not name.
    expect(archetypeHue('generalist').name).toBe('amber');
    expect(archetypeHue(null).name).toBe('amber');
    expect(archetypeHue(undefined).name).toBe('amber');
    expect(archetypeHue('a_newer_archetype').name).toBe('amber');
    expect(archetypeHue('constructor').name).toBe('amber');
    // Every archetype either engine can name has a row.
    const spec = [...ANALYSIS_ENUMS.archetype, 'director', 'skeptic', 'generalist'];
    expect(Object.keys(tokens.spectrum.archetype).sort()).toEqual([...new Set(spec)].sort());
  });

  test('each dimension wears the hue of the archetype whose rule reads it', () => {
    expect(Object.keys(tokens.spectrum.dimension).sort()).toEqual([...ANALYSIS_ENUMS.dimension].sort() as string[]);
    // analysis/profile.py ARCHETYPE_RULES: steer_rate is the skeptic's, code_velocity the
    // velocity machine's, test_runs_per_hour the quality guardian's, planning_ratio the architect's.
    expect(dimensionHue('steering').name).toBe(archetypeHue('skeptic').name);
    expect(dimensionHue('execution').name).toBe(archetypeHue('velocity_machine').name);
    expect(dimensionHue('engineering').name).toBe(archetypeHue('quality_guardian').name);
    expect(dimensionHue('planning').name).toBe(archetypeHue('architect').name);
    expect(dimensionHue('product_instinct').name).toBe(archetypeHue('director').name);
    expect(new Set(ANALYSIS_ENUMS.dimension.map((d) => dimensionHue(d).name)).size).toBe(5);
  });

  test('harnesses: every mark and every wire value has a hue, none amber, unknown is undefined', () => {
    for (const m of HARNESS_MARKS) {
      const h = harnessHue(m.id);
      expect(h, m.id).toBeDefined();
      expect(h!.name).not.toBe('amber');
    }
    for (const w of HARNESSES) expect(harnessHue(w), w).toEqual(harnessHue(markFor(w).id));
    expect(new Set(HARNESS_MARKS.map((m) => harnessHue(m.id)!.name)).size).toBe(HARNESS_MARKS.length);
    expect(harnessHue('claude_code')!.name).toBe('heather');
    expect(harnessHue('cursor_agent')!.name).toBe('brass');
    expect(harnessHue('windsurf')).toBeUndefined();
    expect(harnessHue('toString')).toBeUndefined();
    expect(harnessHue('codex', 'light')).toEqual(hue('tide', 'light'));
  });

  test('the fifteen cards are the engine\'s fifteen, in its order', () => {
    expect(Object.keys(tokens.spectrum.card)).toEqual([...REPORT_ENUMS.wrapped_card]);
  });

  test('no card meets its own hue across or down the grid, whatever card one wears', () => {
    const cards = REPORT_ENUMS.wrapped_card as readonly CardId[];
    for (const archetype of Object.keys(tokens.spectrum.archetype)) {
      const worn = cards.map((c) => cardHue(c, archetype).name);
      expect(worn[0]).toBe(archetypeHue(archetype).name);
      for (let i = 0; i < worn.length; i++) {
        for (const j of [i + 1, i + 2]) {
          if (j < worn.length) expect(worn[i] === worn[j], `${archetype}: cards ${i + 1} and ${j + 1}`).toBe(false);
        }
      }
    }
    // A velocity machine is brass, so card two (brass) steps to coral.
    expect(cardHue('shipped', 'velocity_machine').name).toBe('coral');
    expect(cardHue('shipped', 'architect').name).toBe('brass');
    expect(cardHue('time_put_in', null).name).toBe('amber');
    expect(cardHue('streak', 'skeptic', 'light')).toEqual(hue('coral', 'light'));
  });

  test('verdicts are state colours: add, textDim, del', () => {
    for (const s of SCHEMES) {
      const c = colors(s);
      expect(verdictColor('converging', s)).toBe(c.data.add);
      expect(verdictColor('circling', s)).toBe(c.textDim);
      expect(verdictColor('lost', s)).toBe(c.data.del);
    }
    expect(verdictColor('circling')).toBe('#A8A29A');
  });
});
