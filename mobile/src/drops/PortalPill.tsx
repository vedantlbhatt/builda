/**
 * The island, opening.
 *
 * A black capsule drawn at the Dynamic Island's own frame, which swells for a beat as the first
 * card leaves and settles back. iOS does not let an app expand the real island without a Live
 * Activity, and a Live Activity is a different surface with its own rules; this is the honest
 * version of the effect, and on a device with no island it draws nothing at all.
 *
 * Pure black on purpose: the island is a hole in the screen, and anything but black beside it
 * reads as a rectangle stuck near the camera.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { ISLAND_H, ISLAND_W, islandOf, PILL_LEAD } from './portal';

export function PortalPill({
  width,
  topInset,
  offsetY = 0,
  playKey,
}: {
  width: number;
  topInset: number;
  /**
   * How far this component's own top sits below the screen's, negated. The island is at a fixed
   * place on the DEVICE and this draws inside whatever laid it out, so without it the capsule
   * appears a header's height down the board, beside the cards instead of above them.
   */
  offsetY?: number;
  /** Changing this opens the portal once. */
  playKey: number;
}) {
  const island = islandOf(width, topInset);
  const reduced = useReduceMotion();
  const swell = useSharedValue(0);

  useEffect(() => {
    if (!island || reduced || playKey === 0) return;
    swell.value = 0;
    swell.value = withSequence(
      withTiming(1, { duration: PILL_LEAD, easing: Easing.out(Easing.cubic) }),
      withDelay(260, withSpring(0, { damping: 16, stiffness: 150 })),
    );
  }, [playKey, island, reduced, swell]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: 1 + swell.value * 0.26 }, { scaleY: 1 + swell.value * 0.5 }],
    opacity: swell.value > 0.01 ? 1 : 0,
  }));

  if (!island) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.pill,
          {
            left: island.x - ISLAND_W / 2,
            top: island.y - ISLAND_H / 2 + offsetY,
            width: ISLAND_W,
            height: ISLAND_H,
          },
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    backgroundColor: '#000000',
    borderRadius: ISLAND_H / 2,
    borderCurve: 'continuous',
  },
});
