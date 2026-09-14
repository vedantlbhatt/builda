/**
 * One hue, one meaning, on the money screens (`src/money/hues.ts`). FOUND IN THE CAPTURE
 * (2026-09-14, shots/now2): cyan was the output tokens and Fable 5 in keys one above the other
 * (22-money-02, 21-analysis-14), orange was cache reads and "stretches where nothing was written" in
 * two keys on one screen (21-analysis-15), and inside the flow orange and yellow were each a kind of
 * token and a project (22-money-04). The flow's own checks are in `moneySankey.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GROUND, HUE_NAMES, SPECTRUM, type HueName } from '../src/insights/palette';
import { projectHuesApart } from '../src/money/flow';
import { bucketColor, bucketHues, BURN_GREYS, FAMILY_HUE, familyHue, flowHue, modelColors, modelHueNames, NO_COMMIT_HUE, reservedForProjects, TOKEN_HUE } from '../src/money/hues';
import { PROJECT_HUES } from '../src/projects/model';

const KINDS = ['cache_read', 'cache_write', 'output', 'input'] as const;
const FAMILIES = Object.keys(FAMILY_HUE);

/** Every set of up to three families the price table knows, and one it does not. */
function familySets(): string[][] {
  const out: string[][] = [[]];
  const all = [...FAMILIES, 'unknown_family'];
  for (let i = 0; i < all.length; i++) {
    out.push([all[i]!]);
    for (let j = i + 1; j < all.length; j++) {
      out.push([all[i]!, all[j]!]);
      for (let k = j + 1; k < all.length; k++) out.push([all[i]!, all[j]!, all[k]!]);
    }
  }
  return out;
}

const spectrumInks = new Set(HUE_NAMES.flatMap((h) => [SPECTRUM[h].ink, SPECTRUM[h].partner]));

describe('the kinds of token wear no hue at all', () => {
  test('every kind is the ground\'s white, for every mix of families: no kind shares a hue with a model, a project or no commit', () => {
    for (const fam of familySets()) {
      const h = bucketHues(fam);
      for (const k of KINDS) expect({ fam, k, ink: bucketColor(k, h) }).toEqual({ fam, k, ink: GROUND.text });
    }
    expect(spectrumInks.has(TOKEN_HUE.ink)).toBe(false);
    // FOUND IN THE CAPTURE: output was Fable 5's cyan (22-money-02); then, in this fix's first
    // pass, cache writes were amber on the page where project 1 is brass, two yellows.
    for (const h of HUE_NAMES) expect(KINDS.map((k) => bucketColor(k, bucketHues(['opus', 'fable'])))).not.toContain(SPECTRUM[h].ink);
  });

  test('the token keys are words, never a swatch (a source check on both screens)', () => {
    const analysis = readFileSync(join(import.meta.dir, '../src/insights/sections/Money.tsx'), 'utf8');
    const money = readFileSync(join(import.meta.dir, '../app/you/money.tsx'), 'utf8');
    expect(analysis).not.toMatch(/<Swatch color=\{bucketColor/);
    expect(money).toMatch(/<LegendLine key=\{x\.key\} text=\{x\.label\} value=\{x\.text\} \/>/);
  });
});

describe('on the analysis page\'s Money and burn chapter, every key is its own colour', () => {
  test('the token bar, the models and the burn\'s three parts: no colour twice, and none the chapter\'s ember', () => {
    for (const fam of familySets().filter((f) => f.length > 0 && !f.includes('unknown_family'))) {
      // The token bar is one colour; a second model of one family takes the family's partner.
      const families = [...new Set(fam)];
      const keys = [TOKEN_HUE.ink, ...modelColors(families), BURN_GREYS.barren, BURN_GREYS.unread, BURN_GREYS.rest];
      expect({ fam, clash: new Set(keys).size !== keys.length }).toEqual({ fam, clash: false });
      expect({ fam, ember: keys.includes(SPECTRUM.ember.ink) }).toEqual({ fam, ember: false });
    }
  });

  test('the stretches that changed nothing are the grey stream\'s grey, and the three parts are neutrals', () => {
    expect(BURN_GREYS.barren).toBe(GROUND.dim);
    for (const g of Object.values(BURN_GREYS)) expect(spectrumInks.has(g)).toBe(false);
    expect(new Set(Object.values(BURN_GREYS)).size).toBe(3);
  });

  test('the chapter draws its keys from money/hues, never its own ink (a source check)', () => {
    const src = readFileSync(join(import.meta.dir, '../src/insights/sections/Money.tsx'), 'utf8');
    // The burn's bar and key.
    expect(src).toMatch(/key: 'barren', value: burn\.share, color: BURN_GREYS\.barren/);
    expect(src).toMatch(/<LegendLine color=\{BURN_GREYS\.barren\}/);
    expect(src).not.toMatch(/key: 'barren', value: burn\.share, color: ink/);
    // The token bar, in the one neutral.
    expect(src).toMatch(/color: bucketColor\(x\.key, buckets\)/);
    expect(src).not.toMatch(/BUCKET_COLOR/);
  });
});

describe('on the Money page, a project steps past every hue something else on the page wears', () => {
  test('this account: project 1 (tide, Fable\'s) steps to a free hue, project 2 keeps its ember', () => {
    const fam = ['opus', 'fable', 'fable'];
    const apart = projectHuesApart({ p1: 'tide', p2: 'ember' } as Record<string, HueName>, PROJECT_HUES, modelHueNames(fam), reservedForProjects(fam));
    expect(apart).toEqual({ p1: 'brass', p2: 'ember' });
    expect(reservedForProjects(fam)).not.toContain(apart.p1);
  });

  test('reserved is every model\'s hue and no commit\'s (the kinds of token wear none)', () => {
    const fam = ['sonnet', 'haiku'];
    expect(new Set(reservedForProjects(fam))).toEqual(new Set<HueName>([familyHue('sonnet'), familyHue('haiku'), NO_COMMIT_HUE]));
  });

  test('the flow\'s band takes a hue nobody inside it wears, and gives up a neighbour\'s before a key\'s', () => {
    expect(flowHue(['cobalt', 'brass', 'orchid', 'coral', 'iris', 'tide', 'heather', 'ember'])).toBe('amber');
    expect(flowHue([], ['iris', 'ember'])).toBe('cobalt');
    // FOUND ON THE SIMULATOR: a crab (coral) on this account's page. Every hue is inside the flow
    // or beside it; the band takes the crab's coral, which no stream wears, never cache reads' cobalt.
    const inside: HueName[] = ['cobalt', 'amber', 'orchid', 'iris', 'tide', 'tide', 'brass', 'ember', 'heather'];
    expect(flowHue(inside, ['coral', 'ember', 'heather'])).toBe('coral');
    // This account's flow as it is now: models, the two projects and no commit inside it.
    expect(flowHue(['iris', 'tide', 'brass', 'ember', 'heather'], ['coral', 'ember', 'heather'])).toBe('cobalt');
    expect(flowHue(['iris', 'tide'], ['orchid', 'ember', 'heather'])).toBe('cobalt');
  });
});
