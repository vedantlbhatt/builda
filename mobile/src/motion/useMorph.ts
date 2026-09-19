/**
 * One spring per morph (docs/motion.md rule 2).
 *
 * `progress` runs 0 to 1 on `ISLAND` every time the target box changes, and width, height and
 * corner radius all interpolate off it. Size EXTENDS past the target (the spring passes 1, so the
 * box really grows past its size and comes back); radius CLAMPS (an overshooting radius looks
 * like a bug). A change that lands mid-morph first freezes the box where it is, so an
 * interrupted morph turns around from where it visibly was rather than jumping.
 *
 * `contentOut` and `contentIn` are the two content layers' styles (the outgoing one is gone by
 * 0.28 and grows as it leaves; the incoming one starts at 0.34 and hangs down 5 points into
 * place), so any container can use the same choreography.
 */
import { useEffect } from 'react';
import { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { CONTENT_IN, CONTENT_OUT, IN_RISE, IN_SCALE, OUT_SCALE } from './spec';
import { SPRING } from './springs';

export interface Box {
  w: number;
  h: number;
  r: number;
}

export function lerpBox(a: Box, b: Box, p: number): Box {
  'worklet';
  const clamped = Math.max(0, Math.min(1, p));
  return { w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p, r: a.r + (b.r - a.r) * clamped };
}

export function useMorph(target: Box, changeKey: string | number = '') {
  const progress = useSharedValue(1);
  const from = useSharedValue<Box>(target);
  const to = useSharedValue<Box>(target);

  useEffect(() => {
    const here = lerpBox(from.value, to.value, progress.value);
    from.value = here;
    to.value = target;
    progress.value = 0;
    progress.value = withSpring(1, SPRING.island);
    // `changeKey` re-runs the morph when the content changes but the box does not (a toast
    // replacing a toast of the same size still has to read as a change).
  }, [target.w, target.h, target.r, changeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = useAnimatedStyle(() => {
    const b = lerpBox(from.value, to.value, progress.value);
    return { width: b.w, height: b.h, borderRadius: b.r, borderCurve: 'continuous' as const };
  });

  const contentOut = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, CONTENT_OUT as unknown as number[], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, OUT_SCALE], Extrapolation.CLAMP) }],
  }));

  const contentIn = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, CONTENT_IN as unknown as number[], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(progress.value, [CONTENT_IN[0] - 0.04, 1], [IN_SCALE, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(progress.value, [CONTENT_IN[0] - 0.04, 1], [-IN_RISE, 0], Extrapolation.CLAMP) },
    ],
  }));

  return { progress, box, contentOut, contentIn };
}
