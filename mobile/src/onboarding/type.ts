import type { TextStyle } from 'react-native';

/**
 * The one onboarding size that is not a kit role: the step headline, 34/800. The name step's
 * field IS its headline (DESIGN-DIRECTION 4, "Your name"), and every other step's headline
 * sits in the same place at the same size, so the name typed on one step is the start of the
 * caption on the next ("Vedant" becomes "Vedant, the fox" without moving).
 *
 * Fixed under Dynamic Type past 1.2x like the kit's `display`: it is already large, and a
 * name that fits the field at 1x must still fit it.
 */
export const HEADLINE: TextStyle = {
  fontSize: 34,
  fontWeight: '800',
  letterSpacing: -0.6,
  lineHeight: 40,
  fontVariant: ['tabular-nums'],
};

/** The TextInput wears the headline without its line height: on iOS a single line input with a
 * line height sits its text low in the box. */
export const HEADLINE_INPUT: TextStyle = {
  fontSize: 34,
  fontWeight: '800',
  letterSpacing: -0.6,
};

export const HEADLINE_SCALE = 1.2;
