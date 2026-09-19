/**
 * The web twin of `islandHost.ts`.
 *
 * WHY. The phone draws its island fused to the hardware one; a desktop window has no hardware
 * island, so the merged build drew the phone's compact pill (the crew's face and "2:53") in the
 * middle of the window's top edge, over the page title and, on a Mac, in the title bar's drag
 * strip, while the desktop island a few centimetres above it said the same thing. And the shell's
 * island window renders this same bundle, so it would draw a second island inside the first.
 *
 * So: nothing at all in the island window; in the desktop layout, the standing states (the crew,
 * a run waiting on you, a demo) stay with the desktop island and the Now stage, and only the app's
 * own passing beats (a notice, shipped, a reel being read) show, as a toast; under 900 points wide
 * the window is the phone layout and gets the phone's island.
 */
import { useWindowSize } from '../web/useWindowDimensions.web';
import type { IslandHost } from './islandHost';
import { useFrame } from './morphTarget';
import { isIslandWindow } from './windowKind';

export type { IslandHost } from './islandHost';

const OFF: IslandHost = { kind: 'off' };

export function useIslandHost(): IslandHost | null {
  const frame = useFrame();
  const { width } = useWindowSize();
  if (isIslandWindow()) return OFF;
  if (!frame.desktop) return null;
  return { kind: 'pane', centerX: frame.sidebar + (width - frame.sidebar) / 2 };
}
