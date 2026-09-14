/**
 * A drawing's own clock, which runs only while the drawing can be seen, and says once when the
 * drawing has landed so the caller can put a still picture in place of the moving one.
 *
 * FOUND IN REVIEW (2026-09-13), with dropped frames the owner saw: the rivers, the race, the swarm
 * and the commit days read their block's clock, which runs 3.2 seconds, re-recording their whole
 * picture every frame long after the drawing had landed (by 1.5 to 2.2 seconds), and a fast scroll
 * started fifteen block clocks at once, every one of them redrawing off screen. Now:
 *
 *   - the clock starts when the block has arrived AND the drawing itself is on screen (enough of
 *     it above the bottom edge), measured on the UI thread one frame at a time, the Money chart's
 *     rule (`src/money/Sankey.tsx useFlowClock`);
 *   - it runs `total` milliseconds, and a drawing scrolled out of sight while it runs lands at once,
 *     rather than animating for nobody;
 *   - it flips `landed` once (`runOnJS`), and the caller draws a still picture recorded once on the
 *     JavaScript thread from then on, so a picture at rest costs nothing per frame.
 *
 * Under Reduce Motion it lands the moment it is armed. The resting state never waits on the
 * animation: a timer puts it at rest whatever happened to the timing (reveal.tsx's rule).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  measure,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useClock, useReducedSV } from '../insights/reveal';

/** How much of a drawing must be above the bottom edge before it starts: a third, at most 140 points. */
const SHOWN = 1 / 3;
const SHOWN_MAX_PT = 140;

export function useDrawClock(total: number): { clock: SharedValue<number>; box: ReturnType<typeof useAnimatedRef<View>>; landed: boolean } {
  const block = useClock();
  const reduced = useReducedSV();
  const { height: screen } = useWindowDimensions();
  const clock = useSharedValue(0);
  const started = useSharedValue(0);
  const box = useAnimatedRef<View>();
  const [landed, setLanded] = useState(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watch = useFrameCallback(() => {
    const m = measure(box);
    if (!m || m.height <= 0) return;
    if (!started.value) {
      if (reduced.value) {
        started.value = 1;
        clock.value = total;
        return;
      }
      if (m.pageY + Math.min(m.height * SHOWN, SHOWN_MAX_PT) > screen || m.pageY + m.height < 0) return;
      started.value = 1;
      clock.value = withTiming(total, { duration: total, easing: Easing.linear });
      runOnJS(arm)();
      return;
    }
    // Under way and scrolled out of sight: land now, rather than draw for nobody.
    if (clock.value < total && (m.pageY > screen || m.pageY + m.height < 0)) {
      cancelAnimation(clock);
      clock.value = total;
    }
  }, false);

  function arm() {
    if (safety.current) return;
    safety.current = setTimeout(() => {
      if (clock.value < total) clock.value = total;
    }, total + 400);
  }
  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const activate = useCallback(() => watch.setActive(true), [watch]);
  const land = useCallback(() => {
    watch.setActive(false);
    setLanded(true);
  }, [watch]);
  useAnimatedReaction(
    () => block.value > 0,
    (arrived, was) => {
      if (arrived && !was) runOnJS(activate)();
    },
  );
  useAnimatedReaction(
    () => clock.value >= total,
    (done, was) => {
      if (done && !was) runOnJS(land)();
    },
  );
  return { clock, box, landed };
}
