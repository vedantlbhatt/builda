import type { TextStyle } from 'react-native';

/**
 * Onboarding's sizes that are not kit roles, spelled here and nowhere else in the flow
 * (`__tests__/onboardingCopy.test.ts` holds that). The house style sets words on a band the way
 * the analysis page does (`insights/Band.tsx`, `insights/kit.tsx`): a small title in heavy ink,
 * then one thing set huge, heavy against light, tight, tabular where it is a number.
 *
 * Colour is never here: on a band every word is the band's ink, and the screens say so.
 */

/**
 * The step headline where a step has words rather than a figure (connect, notify): 40/800, the
 * kit's `display` size, tight. Fixed under Dynamic Type past 1.2x: it is already large.
 */
export const HEADLINE: TextStyle = {
  fontSize: 40,
  fontWeight: '800',
  letterSpacing: -1,
  lineHeight: 44,
  fontVariant: ['tabular-nums'],
};

/** How far the typed name may grow with Dynamic Type: it is already set as large as it fits. */
export const HEADLINE_SCALE = 1.2;

/** A band's title, over its one big thing: the analysis page's band title (15/700). */
export const BAND_TITLE: TextStyle = { fontSize: 15, fontWeight: '700', letterSpacing: 0.1, lineHeight: 20 };

/** The line on a band under its big thing (17/600, the analysis page's `bandCaption`). */
export const BAND_CAPTION: TextStyle = { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 };

/**
 * Type set as a graphic at `size`: heavy, tight, and on a line box just over the size, the
 * analysis page's `figure()` for words. Used for the typed name, the creature's name and
 * hello's headline, each sized to its width first.
 */
export function display(size: number, weight: TextStyle['fontWeight'] = '800'): TextStyle {
  return {
    fontSize: size,
    lineHeight: Math.round(size * 1.08),
    fontWeight: weight,
    letterSpacing: -Math.round(size * 0.035 * 10) / 10,
  };
}

/** The same, for a TextInput: no line height (on iOS a single line input with one sits its text low). */
export function displayInput(size: number): TextStyle {
  return { fontSize: size, fontWeight: '800', letterSpacing: -Math.round(size * 0.035 * 10) / 10 };
}

/** The creature's name on its band ("the crab"), in the range it is fitted to. */
export const CREATURE_NAME = { max: 60, min: 36 } as const;

/** The big count on a band (the tools found, the sessions arrived): `BandFigure`'s range. */
export const BAND_FIGURE = { max: 120, min: 56 } as const;

/** A tool tile's name (13/600) and its count (15/800, tabular). */
export const TILE_NAME: TextStyle = { fontSize: 13, fontWeight: '600', lineHeight: 17 };
export const TILE_COUNT: TextStyle = { fontSize: 15, fontWeight: '800', lineHeight: 19, letterSpacing: -0.2 };
/** The word after a tile's count. */
export const TILE_UNIT: TextStyle = { fontSize: 12, fontWeight: '500', lineHeight: 16 };

/** The primary action's label: the kit's 17pt, heavier, as duolingo sets its slab's label. */
export const ACTION_LABEL: TextStyle = { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 };

/** The hint under hello's page. */
export const HINT: TextStyle = { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 };
