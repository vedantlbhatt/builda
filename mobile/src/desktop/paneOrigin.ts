/**
 * Where the pane a screen is laid out in starts, from the window's left edge. On a phone the
 * screen is the window, so it is 0, a constant, and nothing subscribes; `paneOrigin.web.ts` reads
 * the desktop frame's pane (`src/web/useWindowDimensions.web.ts`).
 */
export function usePaneOriginX(): number {
  return 0;
}
