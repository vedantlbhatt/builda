/**
 * The character's states: what colour the glow and the wash spring to, and what the eyes do.
 * PURE (tokens only), so the island's model and the tests can read it.
 *
 * Colours come from `design/tokens.json` `spectrum.island` (the only place a colour lives); this
 * file only resolves a hue name or a token path to a hex.
 */
import { tokens } from '../generated/tokens';

export type FaceState = 'idle' | 'working' | 'thinking' | 'reading' | 'waiting' | 'error' | 'done' | 'sleep';

/**
 * The eye a state draws, on the pixel creature's two 2 x 2 eye holes (rows 6 and 7, columns
 * 5-6 and 9-10: `src/pixel/frames.ts` EYES).
 *
 *   open    both rows open: looking.
 *   low     only row 7 open, the lids down: waiting on you, or something went wrong. The clip's
 *           "flat lines" at 18% of the eye's height, at pixel resolution.
 *   high    only row 6 open, the eyes pushed up by a smile: done. The clip's arcs.
 *   shut    no holes: asleep.
 */
export type Eyes = 'open' | 'low' | 'high' | 'shut';

export const EYES_FOR: Record<FaceState, Eyes> = {
  idle: 'open',
  working: 'open',
  thinking: 'open',
  reading: 'open',
  waiting: 'low',
  error: 'low',
  done: 'high',
  sleep: 'shut',
};

/** The token each state wears. `idle` is the creature's own hue, so it has no entry. */
const STATE_TOKEN: Record<Exclude<FaceState, 'idle'>, string> = tokens.spectrum.island as never;

function resolve(ref: string): string {
  if (!ref.includes('.')) {
    const h = (tokens.spectrum.hues as Record<string, { dark: string }>)[ref];
    if (!h) throw new Error(`spectrum.island names ${ref}, which is not a hue`);
    return h.dark;
  }
  const [group, key] = ref.split('.') as [string, string];
  const pair = (tokens as unknown as Record<string, Record<string, { dark: string }>>)[group]?.[key];
  if (!pair) throw new Error(`spectrum.island names ${ref}, which is not a token`);
  return pair.dark;
}

/** The glow a state wears on the dark ground, or `own` (the creature's hue) for idle. */
export function stateColor(state: FaceState, own: string): string {
  if (state === 'idle') return own;
  return resolve(STATE_TOKEN[state]);
}

/** `#RRGGBB` plus an alpha, as `rgba()`. For washes and glows, never for text. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * The hardware's black: the colour of the Dynamic Island and the Mac's notch that every island
 * surface grows out of. Not a palette colour (the palette's darkest is the warm ground, which
 * would show a seam against the hardware), so it lives here, once.
 */
export const ISLAND_BLACK = '#000000';
