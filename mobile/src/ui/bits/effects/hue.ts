/**
 * How an effect is told its colour. Identity colour comes from the spectrum through
 * `theme.ts` only (DESIGN-V2 6: "identity hues come from theme.ts only"), so an effect takes
 * a hue NAME (or a `Hue` a caller already resolved with `creatureHue`, `cardHue`, ...) and
 * never a hex. Amber is the default because it is the action colour and, on a live surface,
 * "needs you": a spark on Share, the comet on the tile that is waiting.
 */
import { hue as resolveHue, isHueName, type Hue, type HueName, type Scheme } from '../../../theme';

/** A hue by name, or one already resolved (`creatureHue(...)`, `cardHue(...)`). */
export type HueProp = HueName | Hue;

/** The ink a mark in `prop` draws with in `scheme`: the dark ink on dark, the 3:1 mark tone on light. */
export function inkOf(prop: HueProp | undefined, scheme: Scheme = 'dark', fallback: HueName = 'amber'): string {
  if (prop === undefined) return resolveHue(fallback, scheme).ink;
  if (typeof prop === 'string') return resolveHue(isHueName(prop) ? prop : fallback, scheme).ink;
  return prop.ink;
}
