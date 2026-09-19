/** The web twin of `paneOrigin.ts`: the desktop pane's left edge, 0 outside the desktop layout. */
import { usePaneX } from '../web/useWindowDimensions.web';

export function usePaneOriginX(): number {
  return usePaneX();
}
