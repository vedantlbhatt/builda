/**
 * Which colour is Builda's accent, decided in one pure function (`__tests__/youAccent.test.ts`).
 *
 * THE THEME IS YOUR CREATURE'S COLOUR (design-refs/HOUSE-STYLE.md, the owner 2026-09-13 11:58:
 * "what even is the theme of this app? this ugly orange?"). The rose chapter the owner loved is
 * rose because their creature is the crab; that is now the rule for the chrome. Amber is retired
 * as the default accent and stays only as Bit's own hue and a data colour.
 *
 * Which creature: the one they picked (`profile.animal.v1`), else the one their archetype earned
 * (the saved builder profile, through `archetypeView`, the one choice every page reads), else the
 * pack's default. The same order `resolveAnimal` gives the analysis page and the You tab, so the
 * accent and the creature printed on the hero can never disagree.
 */
import { creatureHue as chapterCreatureHue } from '../insights/palette';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { creatureHue, type HueName } from '../theme';
import { builderArchetype } from '../you/archetype';

/**
 * The accent, in both shapes the app reads a hue in: the kit's (`theme.Hue`: ink, text, partner,
 * fill, onFill) and the chapter components' (`insights/palette.Hue`: ink, partner, light), so a
 * band, a link and a button take the same object.
 */
export interface Accent {
  animal: Animal;
  name: HueName;
  /** Marks, figures and fills on the dark ground. */
  ink: string;
  /** The hue as a label (13 pt semibold and up). */
  text: string;
  /** The dither's middle tone. Never text. */
  partner: string;
  /** A solid fill; `onFill` reads on it. */
  fill: string;
  onFill: string;
  /** The hue on a light ground. */
  light: string;
}

/** The archetype the saved builder profile names (`builderArchetype`), or null when it names none or does not parse. */
export function savedArchetype(builderJson: string | null | undefined): string | null {
  return builderArchetype(builderJson)?.id ?? null;
}

/** The creature whose hue is the accent: the pick, else the archetype's, else the default. */
export function accentAnimal(chosen: string | null | undefined, builderJson: string | null | undefined): Animal {
  return resolveAnimal(chosen, savedArchetype(builderJson));
}

export function accentOf(animal: Animal): Accent {
  const h = creatureHue(animal);
  return {
    animal,
    name: h.name,
    ink: h.ink,
    text: h.text,
    partner: h.partner,
    fill: h.fill,
    onFill: h.onFill,
    light: chapterCreatureHue(animal).light,
  };
}
