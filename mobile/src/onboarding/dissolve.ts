import type { SkImage } from '@shopify/react-native-skia';
import { useSyncExternalStore } from 'react';

import { DISSOLVE } from './flow';

/**
 * The hello to name transition, as a tiny store shared by three places: hello takes a picture
 * of itself and `cover`s the screen with it, the name step `reveal`s once it has mounted
 * underneath, and `PixelDissolve` (in the onboarding layout, above the stack) draws the picture
 * breaking into cells and calls `finish` when the last one has turned.
 *
 *   idle, then warm(image), then cover(image), then reveal(), then finish(id), and idle again
 *
 * `warm`: hello hands over its picture as soon as it is taken, while the person reads, and the
 * dissolve draws it once through the shader fully turned (every cell transparent), so the
 * canvas exists and the shader is compiled before Continue is pressed. Doing both on the press
 * stalled the first fifth of a second of the effect.
 *
 * A cover that nobody reveals (the push failed, the step threw) reveals itself after
 * `STALE_COVER_MS`, so a picture of hello can never be left over the app.
 */
/**
 * Where the wave starts and where the grid is laid, in window points. `origin` is the centre of
 * the Continue that was pressed; `anchor` is Bit's top left corner, so the cells fall on Bit's
 * pixel grid. Either missing: the bottom centre of the screen, and the screen's corner.
 */
export interface DissolveGeometry {
  origin: readonly [number, number] | null;
  anchor: readonly [number, number] | null;
}

export type DissolveState =
  | { phase: 'idle' }
  | { phase: 'warm'; id: number; image: SkImage }
  | { phase: 'cover'; id: number; image: SkImage; geometry: DissolveGeometry }
  | { phase: 'reveal'; id: number; image: SkImage; geometry: DissolveGeometry };

const STALE_COVER_MS = 600;
const DISPOSE_AFTER_MS = 1000;

let state: DissolveState = { phase: 'idle' };
let nextId = 1;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
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

/** Draw `image` through the shader, invisibly, so the first real frame is not the first frame. */
export function warmWith(image: SkImage): void {
  if (state.phase !== 'idle') return;
  publish({ phase: 'warm', id: nextId++, image });
}

/** Hello let go of its picture without a dissolve: stop drawing it. The caller disposes it. */
export function coolDown(image: SkImage): void {
  if (state.phase === 'warm' && state.image === image) publish({ phase: 'idle' });
}

export function coverWith(image: SkImage, geometry: DissolveGeometry = { origin: null, anchor: null }): void {
  // The warm picture is the same picture: it is covered with, not disposed.
  if (state.phase !== 'idle' && state.image !== image) state.image.dispose?.();
  const id = nextId++;
  publish({ phase: 'cover', id, image, geometry });
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => reveal(), STALE_COVER_MS);
}

/** Start turning the cells over. A no-op unless a cover is up. */
export function reveal(): void {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  if (state.phase !== 'cover') return;
  publish({ phase: 'reveal', id: state.id, image: state.image, geometry: state.geometry });
}

/** The last cell has turned. Only the transition that asked can end itself. */
export function finish(id: number): void {
  if (state.phase === 'idle' || state.phase === 'warm' || state.id !== id) return;
  const image = state.image;
  publish({ phase: 'idle' });
  // Well after the canvas has let go of it: the overlay unmounts on this render, and a draw
  // already queued on the UI thread must not find the picture freed under it.
  setTimeout(() => image.dispose?.(), DISPOSE_AFTER_MS);
}

export function isCovering(): boolean {
  return state.phase === 'cover' || state.phase === 'reveal';
}

export function useDissolve(): DissolveState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** How long the cells take to turn, or the fade that stands in for them. */
export function revealTailMs(reduced: boolean): number {
  return reduced ? DISSOLVE.reducedMs : DISSOLVE.ms;
}
