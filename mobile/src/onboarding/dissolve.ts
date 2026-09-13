import { useSyncExternalStore } from 'react';

import { DISSOLVE } from './flow';

/**
 * Hello to the name step, as a tiny store shared by three places: hello asks for a `cover` in
 * the builder's colour, `PixelDissolve` (in the onboarding layout, above the stack) gathers the
 * cells over the screen and says when it is `covered`, hello then pushes the name step under
 * the full cover, the name step `reveal`s once it has mounted, and the dissolve clears the
 * cells and calls `finish`.
 *
 *   idle, then cover, then covered, then reveal, then idle again
 *
 * It is react-bits PixelTransition's rule (cells switch on over the content, the content
 * changes while every cell is on, the cells switch off) stretched across two routes. It used
 * to lay a picture of hello over the screen and break THAT into cells; hello now draws Skia
 * canvases (its band, Bit, the field), and a picture of a view is not a promise of what a Metal
 * layer showed, so the cover is drawn live, in one colour, and nothing is photographed.
 *
 * A cover nobody reveals (the push failed, the step threw) reveals itself after
 * `STALE_COVER_MS`, so the colour can never be left over the app.
 */

/**
 * Where the wave starts and where the grid is laid, in window points. `origin` is where the
 * finger left the page (or the centre of the Continue that was pressed); `anchor` is Bit's top
 * left corner, so the cells fall on Bit's pixel grid. Either missing: the bottom centre of the
 * screen, and the screen's corner.
 */
export interface DissolveGeometry {
  origin: readonly [number, number] | null;
  anchor: readonly [number, number] | null;
}

interface Cover {
  id: number;
  /** The cells, and the front's tone (the partner: the dither's middle tone of the same hue). */
  ink: string;
  front: string;
  geometry: DissolveGeometry;
}

export type DissolveState =
  | { phase: 'idle' }
  | ({ phase: 'cover' } & Cover)
  | ({ phase: 'covered' } & Cover)
  | ({ phase: 'reveal' } & Cover);

const STALE_COVER_MS = 600;

let state: DissolveState = { phase: 'idle' };
let nextId = 1;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let onCovered: (() => void) | null = null;
/** The next page asked to be revealed before the cover had finished gathering. */
let revealAsked = false;
const listeners = new Set<() => void>();

function publish(s: DissolveState): void {
  state = s;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot(): DissolveState {
  return state;
}

function clearStale(): void {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
}

/**
 * Gather the cells over the screen in `ink`, the front in `front`, and call `then` once every
 * cell is on (that is when the next page goes under it). Refused while one is already running.
 */
export function coverWith(ink: string, front: string, geometry: DissolveGeometry, then: () => void): boolean {
  if (state.phase !== 'idle') return false;
  clearStale();
  onCovered = then;
  revealAsked = false;
  publish({ phase: 'cover', id: nextId++, ink, front, geometry });
  return true;
}

/** Every cell is on. Only the cover that asked can say so. */
export function covered(id: number): void {
  if (state.phase !== 'cover' || state.id !== id) return;
  publish({ phase: 'covered', id: state.id, ink: state.ink, front: state.front, geometry: state.geometry });
  const then = onCovered;
  onCovered = null;
  then?.();
  if (revealAsked) {
    reveal();
    return;
  }
  clearStale();
  staleTimer = setTimeout(() => reveal(), STALE_COVER_MS);
}

/** Start clearing the cells. The page that went under the cover calls this once it has mounted. */
export function reveal(): void {
  if (state.phase === 'cover') {
    revealAsked = true;
    return;
  }
  if (state.phase !== 'covered') return;
  clearStale();
  publish({ phase: 'reveal', id: state.id, ink: state.ink, front: state.front, geometry: state.geometry });
}

/** The last cell has cleared. Only the transition that asked can end itself. */
export function finish(id: number): void {
  if (state.phase !== 'reveal' || state.id !== id) return;
  publish({ phase: 'idle' });
}

/** A cover is up, or on its way up, or clearing: the page under it arrived through the cells. */
export function isCovering(): boolean {
  return state.phase !== 'idle';
}

export function useDissolve(): DissolveState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The current state, outside React. */
export function currentDissolve(): DissolveState {
  return state;
}

/** How long the cells take to turn, or the fade that stands in for them. */
export function revealTailMs(reduced: boolean): number {
  return reduced ? DISSOLVE.reducedMs : DISSOLVE.ms;
}

/** Forget a transition (a test, a reset). */
export function resetDissolve(): void {
  clearStale();
  onCovered = null;
  revealAsked = false;
  publish({ phase: 'idle' });
}
