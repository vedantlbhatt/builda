/**
 * Where a morph that opens a route should land. On a phone the page IS the screen, so the answer
 * is always "the whole screen" (null here, and `motion/MorphNav.tsx` grows to the window exactly as
 * it did before this file existed); `morphTarget.web.ts` answers with the desktop pane the route
 * will be drawn in, and keeps the frame's facts for anything drawn outside it.
 */
import type { PaneRect } from './rules';

export interface FrameFacts {
  desktop: boolean;
  sidebar: number;
  path: string;
}

const PHONE: FrameFacts = { desktop: false, sidebar: 0, path: '/' };

export function morphTarget(_route?: string): PaneRect | null {
  return null;
}

/** The desktop frame telling the web twin where things are; nothing to tell on a phone. */
export function publishFrame(_frame: FrameFacts): void {}

/** A phone has no frame: a constant, so nothing subscribes. */
export function useFrame(): FrameFacts {
  return PHONE;
}
