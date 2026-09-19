/**
 * The web twin of `morphTarget.ts`: the rectangle a pushed route will be drawn in, in the desktop
 * layout, and the frame's own few facts for anything drawn outside it (the in-app island).
 *
 * WHY. On a phone a row grows into the whole screen because the page it opens IS the whole screen.
 * On a desktop a push opens BESIDE the list (a session to the right of Sessions, a drop to the
 * right of the wall), so a window growing over the whole screen covered the sidebar and the list
 * that were about to stay exactly where they were, and then vanished off them: a morph that lies
 * about where the page is. It grows into the pane instead, the same rectangle the frame lays the
 * page out in (`rules.frameLayout`, one rule for both).
 *
 * The frame publishes its sidebar width here (`publishFrame`, from `DesktopFrame.web.tsx`); the
 * window size is read at the moment of the tap. Null outside the desktop layout (a window under
 * 900 points is the phone layout, whose pages are the whole window), on a bare route, and on a
 * route with no page of its own.
 */
import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';

import { morphRectFor, type PaneRect } from './rules';

export interface FrameFacts {
  /** The desktop layout is up: sidebar, lists, panes. */
  desktop: boolean;
  /** The sidebar's width, open or folded; 0 outside the desktop layout. */
  sidebar: number;
  /** The path on show, so a morph knows whether the list it opens beside is already there. */
  path: string;
}

const NONE: FrameFacts = { desktop: false, sidebar: 0, path: '/' };
let frame: FrameFacts = NONE;
const listeners = new Set<() => void>();

export function publishFrame(next: FrameFacts): void {
  if (next.desktop === frame.desktop && next.sidebar === frame.sidebar && next.path === frame.path) return;
  frame = next;
  listeners.forEach((l) => l());
}

/** The frame's facts, re-rendering when the sidebar folds or the window crosses 900. */
export function useFrame(): FrameFacts {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => frame,
    () => frame,
  );
}

export function morphTarget(route?: string): PaneRect | null {
  if (!frame.desktop || !route) return null;
  const win = Dimensions.get('window');
  return morphRectFor(frame.path, route, win.width, win.height, frame.sidebar);
}
