/**
 * A card, arriving from the portal.
 *
 * It starts at the Dynamic Island, the size of nothing, spinning, and springs to where it lives.
 * One shared value per card drives all three, so the whole arrival is one interpolation and the
 * card is never laid out twice.
 *
 * Reduce Motion gets the card where it belongs with no flight at all: the arrival is theatre, and
 * theatre is the first thing that setting is asking you to turn off.
 */
import React, { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { BORN, FLIGHT, SPIN } from './portal';

export interface FlyInProps {
  /** How far the card has to travel, in points: the portal minus where the card lives. */
  dx: number;
  dy: number;
  /** ms before it leaves. */
  delay: number;
  /** Changing this flies the card again. 0 means it is already home. */
  playKey: number;
  children: React.ReactNode;
  style?: object;
}

export function FlyIn({ dx, dy, delay, playKey, children, style }: FlyInProps) {
  const reduced = useReduceMotion();
  const t = useSharedValue(playKey === 0 || reduced ? 1 : 0);

  useEffect(() => {
    if (playKey === 0 || reduced) {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withDelay(
      delay,
      /**
       * A LAUNCH, then a landing.
       *
       * The first curve here was `bezier(0.16, 1, 0.3, 1)`, which covers half the distance in the
       * first tenth of the flight. Recorded and stepped through frame by frame, the card was never
       * anywhere near the island: it appeared most of the way to its pile and grew, which is a
       * fade in with extra steps. This one holds at the mouth long enough to be seen leaving it,
       * accelerates across the board and settles.
       */
      withTiming(1, { duration: FLIGHT, easing: Easing.bezier(0.5, 0.02, 0.2, 1) }),
    );
  }, [playKey, delay, reduced, t]);

  const anim = useAnimatedStyle(() => {
    const away = 1 - t.value;
    // Up to full in the first twentieth of the flight. At a third of it the card was already
    // halfway home before anybody could see it come out.
    return {
      opacity: Math.min(1, t.value * 20),
      transform: [
        { translateX: dx * away },
        { translateY: dy * away },
        { scale: BORN + (1 - BORN) * t.value },
        { rotate: `${SPIN * away}deg` },
      ],
    };
  }, [dx, dy]);

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
