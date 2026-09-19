/**
 * The two things every chaptered page does around its scroll view, written once so the analysis
 * page and the You pages cannot drift apart on either:
 *
 *   `useRevealScroll`  nothing plays until the page is on screen and still: the scroll view is
 *                      measured on the UI thread every frame until it has sat at the left edge for
 *                      three frames (a push has landed, however long a deep link took to start it).
 *                      A navigation event could fire before the slide began, which played the first
 *                      chapter behind it; the page's own position cannot. It also feeds the reveal
 *                      clock the scroll offset and the viewport, and says when a finger first
 *                      scrolls.
 *
 *   `useChapterStages` the chapters mount one at a time, the first alone: a page of thirty canvases
 *                      mounted in one commit holds the UI thread long enough that the first count up
 *                      would finish before a frame of it was drawn. The rest follow the first
 *                      chapter's count, or as soon as a finger scrolls.
 *
 * Both were inline in `AnalysisScreen.tsx`, unchanged in behaviour here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  measure,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import { usePaneOriginX } from '../desktop/paneOrigin';
import type { usePageReveal } from './reveal';

type Page = ReturnType<typeof usePageReveal>;

/** If the page never measures as settled, play anyway after this. */
export const ARM_FALLBACK_MS = 2500;
/** The first chapter plays alone for this long, unless a finger scrolls first. */
export const FIRST_CHAPTER_MS = 1400;
/** Chapters after the first mount one per this. */
export const NEXT_CHAPTER_MS = 80;
/** How far a finger has to scroll before the rest of the page is hurried in. */
const HURRY_AT = 40;

export function useRevealScroll(page: Page, onFirstScroll: () => void) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const still = useSharedValue(0);
  // Settled means at its pane's left edge: the screen's on a phone (0), the pane's beside the
  // desktop sidebar (`src/desktop/paneOrigin`), where a list never sits at 0 and would only ever
  // arm on the fallback, two and a half seconds late.
  const originX = usePaneOriginX();
  const watch = useFrameCallback(() => {
    if (page.armed.value) return;
    const m = measure(scrollRef);
    if (m && m.width > 0 && Math.abs(m.pageX - originX) < 0.5) {
      still.value += 1;
      if (still.value >= 3) page.armed.value = 1;
    } else {
      still.value = 0;
    }
  }, true);
  const stopWatching = useCallback(() => watch.setActive(false), [watch]);
  useAnimatedReaction(
    () => page.armed.value,
    (armed) => {
      if (armed) runOnJS(stopWatching)();
    },
  );
  useEffect(() => {
    // Should the measure never settle (an unusual container), play anyway.
    const fallback = setTimeout(() => {
      page.armed.value = 1;
    }, ARM_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [page]);

  const scrolled = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    page.scrollY.value = e.contentOffset.y;
    if (e.contentOffset.y > HURRY_AT && !scrolled.value) {
      scrolled.value = 1;
      runOnJS(onFirstScroll)();
    }
  });
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      page.viewport.value = e.nativeEvent.layout.height;
    },
    [page],
  );
  return { scrollRef, onScroll, onLayout };
}

/**
 * How many chapters after the first have mounted (0 to `total`), and the hurry a first scroll
 * calls. Nothing is staged until `ready`.
 */
export function useChapterStages(total: number, ready: boolean): { stage: number; hurry: () => void } {
  const [stage, setStage] = useState(0);
  const hurried = useRef(false);
  const [isHurried, setHurried] = useState(false);
  useEffect(() => {
    if (!ready || stage >= total) return;
    const t = setTimeout(() => setStage((x) => x + 1), stage === 0 && !isHurried ? FIRST_CHAPTER_MS : NEXT_CHAPTER_MS);
    return () => clearTimeout(t);
  }, [ready, stage, isHurried, total]);
  const hurry = useCallback(() => {
    if (hurried.current) return;
    hurried.current = true;
    setHurried(true);
  }, []);
  return { stage, hurry };
}
