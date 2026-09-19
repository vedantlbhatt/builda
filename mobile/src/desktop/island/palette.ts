/**
 * The island's colours, every one a token (design/tokens.json is the only place a colour lives).
 *
 * States wear `tokens.spectrum.island` through `stateColor` (src/motion/states.ts), the same
 * resolution the phone's island uses, so a state is one colour on every surface.
 *
 * The pill itself is black, the hardware's black: on a notched Mac it IS the notch grown out, and
 * the warm near-black ground would show a seam against it.
 */
import { tokens } from '../../generated/tokens';
import { stateColor } from '../../motion/states';
import type { FaceState } from './model';

const h = tokens.spectrum.hues;
const STATES: readonly FaceState[] = ['working', 'thinking', 'reading', 'waiting', 'error', 'done', 'sleep'];

export const STATE_INK = Object.fromEntries(STATES.map((s) => [s, stateColor(s, h.cobalt.dark)])) as Record<FaceState, string>;

export function stateInk(s: FaceState): string {
  return STATE_INK[s];
}

/** The hardware's black. Not a palette colour: the colour of the notch this grows out of. */
export { ISLAND_BLACK } from '../../motion/states';
export const INK = tokens.surface.text.dark;
export const DIM = tokens.surface.textDim.dark;
export const FAINT = tokens.surface.textFaint.dark;
export const AMBER = h.amber.dark;
export const ADD = tokens.data.add.dark;

export { withAlpha } from '../../motion/states';
