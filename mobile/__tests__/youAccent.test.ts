/**
 * Builda's accent is the builder's creature's hue (design-refs/HOUSE-STYLE.md, the owner at 11:58:
 * "what even is the theme of this app? this ugly orange?"). The rule is `src/theme/accentRule.ts`:
 * the creature they picked, else the one their archetype earned, else the pack's default; the same
 * order the analysis page and the You hero resolve the creature in, so the accent and the creature
 * printed on the hero can never disagree.
 */
import { describe, expect, test } from 'bun:test';

import fixture from '../src/insights/fixtures/report-2026-09-13.json';
import { creatureHue as chapterHue } from '../src/insights/palette';
import { ANIMALS, DEFAULT_ANIMAL, resolveAnimal } from '../src/pixel/animals';
import { creatureHue } from '../src/theme';
import { accentAnimal, accentOf, savedArchetype } from '../src/theme/accentRule';

const SAVED = JSON.stringify(fixture.builder);

describe('which creature is the accent', () => {
  test('the pick wins', () => {
    expect(accentAnimal('owl', SAVED)).toBe('owl');
  });

  test("no pick: the archetype's creature, the Mac's type over the server's (the crab for the quality guardian)", () => {
    expect(savedArchetype(SAVED)).toBe('quality_guardian');
    expect(accentAnimal(null, SAVED)).toBe('crab');
    expect(accentAnimal(null, SAVED)).toBe(resolveAnimal(null, 'quality_guardian'));
  });

  test('nothing saved, a stale pick or an unreadable profile falls to the default creature, not amber', () => {
    expect(accentAnimal(null, null)).toBe(DEFAULT_ANIMAL);
    expect(accentAnimal('unicorn', null)).toBe(DEFAULT_ANIMAL);
    expect(accentAnimal(null, '{not json')).toBe(DEFAULT_ANIMAL);
    expect(accentOf(DEFAULT_ANIMAL).name).not.toBe('amber');
  });
});

describe('the accent, in both shapes', () => {
  test('every creature: the kit hue and the chapter hue agree, so a band, a link and a button match', () => {
    for (const a of ANIMALS) {
      const x = accentOf(a);
      const kit = creatureHue(a);
      const chapter = chapterHue(a);
      expect({ a, ink: x.ink, partner: x.partner, name: x.name }).toEqual({ a, ink: kit.ink, partner: kit.partner, name: kit.name });
      expect({ a, ink: x.ink, light: x.light }).toEqual({ a, ink: chapter.ink, light: chapter.light });
      expect(x.animal).toBe(a);
    }
  });
});
