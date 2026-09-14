import { useEffect } from 'react';

import { usePageReveal } from '../insights/reveal';
import { useReduceMotion } from '../ui/motion';

/**
 * A step's reveal clock: the analysis page's (`insights/reveal.tsx`: `RevealPage` > `Section` >
 * `Block`), so a band prints itself, a figure counts up from 0 and a word fades up on a step
 * exactly as they do on the page the owner picked the style from.
 *
 * A step does not scroll away from anything, so everything on it is in view the moment the step
 * is ready: the viewport is set past any position a block can have, and `ready` arms the page.
 * Every block plays once per mount; a step walked back to is still mounted and shows as it was
 * left. Reduce Motion: every block is at rest behind the page's 150ms fade.
 */
const EVERYTHING_IN_VIEW = 1_000_000;

export function useStepPage(ready: boolean) {
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  useEffect(() => {
    page.viewport.value = EVERYTHING_IN_VIEW;
  }, [page]);
  useEffect(() => {
    if (ready) page.armed.value = 1;
  }, [ready, page]);
  return page;
}
