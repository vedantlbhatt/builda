/**
 * The type the session screens add to the chapter kit's (`insights/kit.tsx` `type` and `figure`,
 * the analysis page's scale): the engineer voice title set large on the hero band, the word a
 * doorway opens with, a row's figure, and the small labels on a chart. Named here once, so no
 * component in `src/session` carries a size of its own.
 *
 * The scale is the analysis page's (heavy against light: figures and titles at 800, words at 400
 * to 600, every figure tabular) with Strava's activity feed for the list (design-md/fitness/
 * strava: the title 17 semibold, the stat beside it bold and tabular).
 */
import type { TextStyle } from 'react-native';

/** The engineer voice title on the hero band, in dark ink. */
export const BAND_TITLE: TextStyle = { fontSize: 31, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8 };

/** A long title steps down so three lines still fit beside the creature. */
export const BAND_TITLE_LONG: TextStyle = { fontSize: 26, lineHeight: 29, fontWeight: '800', letterSpacing: -0.6 };

/** A doorway's name: "Codebase map", set large, the page it opens. */
export const DOOR_TITLE: TextStyle = { fontSize: 28, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6 };

/** A row's figure in the Sessions list: its active time, beside the title. */
export const ROW_FIGURE: TextStyle = { fontSize: 20, lineHeight: 24, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] };

/** A number over a bar in a chart. */
export const BAR_TOP: TextStyle = { fontSize: 17, lineHeight: 20, fontWeight: '800', letterSpacing: -0.3, fontVariant: ['tabular-nums'] };

/** A label under a chart: a day's letter, a bar's duration. */
export const AXIS: TextStyle = { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.2 };

/** The stat a doorway or a live row puts beside its words. */
export const SMALL_FIGURE: TextStyle = { fontSize: 15, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] };

/** The model's headline on the reading band. */
export const READING_HEADLINE: TextStyle = { fontSize: 27, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6 };
