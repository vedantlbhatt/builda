/**
 * The web twin of `formFactor.ts`: the same rule, read off the window's width as it changes. A
 * window dragged below `DESKTOP_MIN_WIDTH` gets the phone layout, tab bar and all, and back.
 *
 * The REAL window, never a pane: inside the desktop layout `useWindowDimensions` answers with the
 * pane a screen sits in (`src/web/useWindowDimensions.web.ts`), and a detail pane narrower than
 * 900 must not decide that the whole window is a phone.
 */
import { Platform } from 'react-native';

import { useWindowSize } from '../web/useWindowDimensions.web';
import { formFactorFor, type FormFactor } from './rules';

export { DESKTOP_MIN_WIDTH, formFactorFor, type FormFactor } from './rules';

export function useFormFactor(): FormFactor {
  const { width } = useWindowSize();
  return formFactorFor(Platform.OS, width);
}

export function useIsDesktop(): boolean {
  return useFormFactor() === 'desktop';
}
