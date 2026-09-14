/**
 * The chrome's rules that need no React: the tab bar's measurements and colours, when an icon
 * bounces, and when the accent must be read again. Pure, so `__tests__/navChrome.test.ts` holds
 * every one in bun.
 *
 * THE THEME IS THE BUILDER'S CREATURE'S HUE (design-refs/HOUSE-STYLE.md, last section). The tab
 * bar is the one piece of chrome on every screen, so it is where that rule is seen most: the
 * active tab's glyph and label are the accent (`src/theme/accent.tsx`), the rest are the warm
 * greys, and amber appears nowhere in it.
 *
 * What was taken from the owner's references (design-refs/awesome-ios-design-md/design-md/):
 *   - 56 pt plus the home indicator: Revolut, Spotify and Robinhood all give that bar height.
 *   - Opaque, with one hairline on top: Robinhood (0.5 pt divider over the canvas) and Duolingo
 *     (1 pt border). Revolut's and Spotify's material blur is left out on purpose: the chapter
 *     bands scroll under the bar, and a hue seen through a translucent bar over the warm ground
 *     is the brown smudge DESIGN-V2 1.3 forbids.
 *   - Labels 11 pt, always shown, +0.2 tracking: Spotify and Duolingo (11 pt, 0.2); weight 600
 *     from Revolut and Robinhood. Not scaled with Dynamic Type (Revolut's platform note).
 *   - The accent in the active label: Spotify's "green text exists only in the active tab label".
 *   - Filled glyph when active, outlined at rest: Spotify and Duolingo.
 *   - The bounce: Spotify's like heart, 1.0 to 1.15 and home over about 300 ms, settling on
 *     its damping 0.7 spring; on iOS 17 and later the SF Symbol's own bounce instead.
 */
import { tokens } from '../generated/tokens';

/** The bar's content height, over the home indicator's inset. */
export const TAB_BAR_HEIGHT = 56;

/** SF Symbol size in the bar. */
export const TAB_SYMBOL_SIZE = 26;

/**
 * The You tab's creature: 16 cells at 2 pt, so every pixel is whole at @2x and @3x, and its
 * 12 cell live area (24 pt) sits at the optical size of a 26 pt symbol beside it.
 */
export const TAB_CREATURE_SIZE = 32;
export const CREATURE_GRID = 16;

export const TAB_LABEL = { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 } as const;

/** The warm near black and its hairline: the bar is the ground, not a card. */
export const TAB_BAR_GROUND = {
  bg: tokens.surface.bg.dark,
  border: tokens.surface.border.dark,
  inactive: tokens.surface.textDim.dark,
} as const;

/** The only amber in the palette. Chrome never wears it (the owner, 2026-09-13 11:58). */
export const AMBER = tokens.surface.accent.dark;

export interface TabTint {
  /** The active glyph. */
  icon: string;
  /** The active label. */
  label: string;
  /** Glyph and label at rest. */
  rest: string;
}

/** What the bar paints, given the accent. */
export function tabTint(accent: { ink: string; text: string }): TabTint {
  return { icon: accent.ink, label: accent.text, rest: TAB_BAR_GROUND.inactive };
}

// ------------------------------------------------------------------ the bounce

/** Peak scale, rise and settle of the spring the creature (and a pre iOS 17 symbol) uses. */
export const TAB_BOUNCE = {
  peak: 1.15,
  riseMs: 110,
  settle: { duration: 320, dampingRatio: 0.7 },
  /** How long the SF Symbol effect is left attached before it is taken off again. */
  symbolMs: 900,
} as const;

/**
 * Whether an icon bounces now. Only on the move from not selected to selected: never on the
 * first render (a cold start lands on a tab, it does not select one), never on a re-tap, never
 * on the way out, and never under Reduce Motion, where the colour change alone says it.
 */
export function shouldBounce(was: boolean | null | undefined, now: boolean, reduced: boolean): boolean {
  return !reduced && was === false && now === true;
}

/**
 * Whether `key` is the tab the navigator shows. From the navigator's own state, not from
 * `navigation.isFocused()`: that is also false while a screen is pushed over the tabs, so
 * coming back from Settings would read as a new selection and bounce.
 */
export function isTabSelected(state: { index: number; routes: readonly { key: string }[] } | null | undefined, key: string): boolean {
  if (!state) return false;
  return state.routes[state.index]?.key === key;
}

/** The SF Symbol effects exist from iOS 17 (`expo-symbols` checks the same, natively). */
export function symbolBounceAvailable(os: string, version: string | number | undefined): boolean {
  if (os !== 'ios' || version === undefined) return false;
  const major = parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 17;
}

// ------------------------------------------------------------------ the accent, read again

/**
 * The routes that write the creature (`profile.animal.v1`): the picker and onboarding's step.
 * Neither tells the accent store, so the root reads it again when one of them is left.
 */
export const CREATURE_PICKERS = ['/icon', '/onboarding/creature'] as const;

/** True when the path moved off a picker, so the chosen creature may have changed. */
export function leftCreaturePicker(was: string | null | undefined, now: string): boolean {
  if (!was || was === now) return false;
  return (CREATURE_PICKERS as readonly string[]).includes(was);
}
