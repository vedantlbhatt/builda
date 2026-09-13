import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useReducedMotion as useReducedMotionAtLaunch,
  type WithTimingConfig,
} from 'react-native-reanimated';

import { EASE_BEZIER, REDUCED_FADE } from './motionSpec';

export * from './motionSpec';

/**
 * The one timing curve: strong ease out. Built-in curves are too weak, and an entrance never
 * eases in. `Easing.bezier(0.23, 1, 0.32, 1)`.
 */
export const EASE = Easing.bezier(EASE_BEZIER[0], EASE_BEZIER[1], EASE_BEZIER[2], EASE_BEZIER[3]);

/** `withTiming` config on `EASE`. Reanimated jumps to the end under Reduce Motion. */
export function timing(duration: number): WithTimingConfig {
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

/** The fade every spatial animation collapses to under Reduce Motion. */
export const REDUCED_TIMING: WithTimingConfig = { duration: REDUCED_FADE, easing: EASE };

/**
 * Whether the person has asked for less motion. Starts from Reanimated's synchronous
 * launch-time answer, so the first frame is already right (no flash of an animation they
 * opted out of), then follows the system toggle live, which Reanimated's own hook does not.
 */
export function useReduceMotion(): boolean {
  const atLaunch = useReducedMotionAtLaunch();
  const [reduced, setReduced] = useState(atLaunch);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
