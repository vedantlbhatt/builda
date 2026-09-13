import { colors, type Scheme } from '../theme';
import type { Animal, AnimalGlyph } from './animals';
import type { Glyph } from './frames';

/**
 * ONE INK for the whole pixel family: Bit, the eight creatures, every state and every
 * frame. There is no second tone, no data hue and no per-animal colour.
 *
 * The pack used to be twelve colours across nine icons: a teal octopus, a grey cat, a bone
 * owl, a sage whale, and a dark amber (the accent x0.45, 2.6:1 on the background) for the
 * crab's eyes and feet that read as black at 32 pt. That second tone is the "orange and
 * black" the owner asked to lose. Now a creature is told apart by its shape, and the colour
 * only says which state its tile is in:
 *
 *   rest      the accent amber on a dark surface (10.4:1 on `bg`), and ink on a light one,
 *             where amber is 1.7:1 and DESIGN-DIRECTION 3.1 keeps it off glyphs and text.
 *             The creature as the subject: the mascot hero, the carousel centre, the icon
 *   idle      `text`, on an unselected picker tile. The harness picker draws its glyphs in
 *             `text` until a tile is chosen, so a creature on a tile does too: in both
 *             pickers amber means "selected" and nothing else (the owner's "the same picker
 *             thing"; DESIGN-DIRECTION 3.1 spends amber on the selected state)
 *   selected  `onAccent` ink, on the amber tile of the picker (DESIGN-DIRECTION 5)
 *   faint     `textFaint`, for a carousel neighbour. Never the amber at reduced opacity:
 *             amber at 0.45 over `bg` is the muddy brown CLAUDE.md already warns about
 *
 * Every value is a token from `design/tokens.json` through `colors()`, so re-tuning the accent
 * re-tunes every creature with it. If a second tone ever returns it must be at least 3:1 on
 * `bg`, which is no darker than the accent x0.55.
 */
export type InkTone = 'rest' | 'idle' | 'selected' | 'faint';

/** The `colors()` key each tone resolves to, per scheme. */
export type InkToken = 'accent' | 'text' | 'textFaint' | 'onAccent';

export const GLYPH_INK: Record<Scheme, Record<InkTone, InkToken>> = {
  dark: { rest: 'accent', idle: 'text', selected: 'onAccent', faint: 'textFaint' },
  light: { rest: 'text', idle: 'text', selected: 'onAccent', faint: 'textFaint' },
};

/** The one ink, as sRGB hex, for a scheme and a tone. */
export function glyphInk(scheme: Scheme, tone: InkTone = 'rest'): string {
  return colors(scheme)[GLYPH_INK[scheme][tone]];
}

/**
 * Glyph → sRGB hex for Bit. Four roles and one colour: the roles only tell `motion.ts` which
 * pixels are a spark, a tool or a trail (`frames.ts`), so every one of them is the same ink.
 */
export type SpritePalette = Record<Glyph, string>;

export function spritePalette(scheme: Scheme, tone: InkTone = 'rest'): SpritePalette {
  const ink = glyphInk(scheme, tone);
  return { b: ink, w: ink, h: ink, z: ink };
}

/** The one role of an animal frame (`animals.ts`). */
export type AnimalPalette = Record<AnimalGlyph, string>;

/**
 * An animal's palette. The animal is accepted so a caller never has to know that every
 * creature shares one ink, and so a per-animal tone would be a change here and nowhere else;
 * today it is the same for all eight, which the tests assert.
 */
export function animalPalette(_animal: Animal, scheme: Scheme, tone: InkTone = 'rest'): AnimalPalette {
  return { b: glyphInk(scheme, tone) };
}
