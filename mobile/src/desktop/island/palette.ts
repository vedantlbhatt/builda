/**
 * The island's colours, every one a token (design/tokens.json is the only place a colour lives).
 *
 * States wear the hue that already means that thing here, the mapping the motion branch writes
 * into `tokens.spectrum.island` (docs/motion.md 5): cobalt working, iris thinking, tide reading,
 * amber waiting (amber is "needs you" everywhere in this app), the data red for an error, the
 * data green for done, and the warm grey for asleep. Until that token block is on this branch the
 * mapping is spelled here from the same hues.
 *
 * The pill itself is black, the hardware's black: on a notched Mac it IS the notch grown out, and
 * the warm near-black ground would show a seam against it.
 */
import { tokens } from '../../generated/tokens';
import type { FaceState } from './model';

const h = tokens.spectrum.hues;

export const STATE_INK: Record<FaceState, string> = {
  working: h.cobalt.dark,
  thinking: h.iris.dark,
  reading: h.tide.dark,
  waiting: h.amber.dark,
  error: tokens.data.del.dark,
  done: tokens.data.add.dark,
  sleep: tokens.surface.textFaint.dark,
};

export function stateInk(s: FaceState): string {
  return STATE_INK[s];
}

/** The hardware's black. Not a palette colour: the colour of the notch this grows out of. */
export const ISLAND_BLACK = '#000000';
export const INK = tokens.surface.text.dark;
export const DIM = tokens.surface.textDim.dark;
export const FAINT = tokens.surface.textFaint.dark;
export const AMBER = h.amber.dark;
export const ADD = tokens.data.add.dark;

/** `#RRGGBB` plus an alpha, for washes and glows, never for text. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
