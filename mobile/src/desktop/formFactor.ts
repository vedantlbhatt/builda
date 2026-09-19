/**
 * Phone or desktop: which layout a window gets (the rule is `rules.formFactorFor`).
 *
 * iOS and Android are always the phone, and this is the file they load (`formFactor.web.ts` is
 * the web twin), so the hook subscribes to nothing there and the phone's tree is exactly what it
 * was. On web the desktop layout (sidebar, split views) takes over from `DESKTOP_MIN_WIDTH` up.
 */
import type { FormFactor } from './rules';

export { DESKTOP_MIN_WIDTH, formFactorFor, type FormFactor } from './rules';

export function useFormFactor(): FormFactor {
  return 'phone';
}

export function useIsDesktop(): boolean {
  return false;
}
