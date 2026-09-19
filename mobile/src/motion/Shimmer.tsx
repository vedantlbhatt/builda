/**
 * A line of text with a band of light passing across its letters: the ACTIVE line, the one thing
 * that is happening now. The clip does this to its current step ("Prep workspace") and nothing
 * else, which is why it reads as "this one"; used on two lines at once it reads as a loading
 * skeleton. One per surface.
 *
 * Built with a clip rather than a mask (no masked view in this app, and it has to run on the
 * web): the text is drawn twice, dim underneath and bright inside a narrow window that slides
 * across, with the bright copy slid the other way by the same amount so its letters stay exactly
 * over the dim ones. Under Reduce Motion the light does not move and the line is simply bright.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { SHIMMER_MS } from './spec';

/** How wide the light is, in points. Wide enough to cover two letters at 15 pt. */
const BAND = 34;

export function Shimmer({
  text,
  style,
  dim,
  bright,
  active = true,
}: {
  text: string;
  style?: TextStyle | TextStyle[];
  /** The resting colour of the letters. */
  dim: string;
  /** The colour inside the light. */
  bright: string;
  active?: boolean;
}) {
  const reduced = useReduceMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(-BAND);

  useEffect(() => {
    cancelAnimation(x);
    if (!active || reduced || w === 0) return;
    x.value = -BAND;
    // A pause between passes: continuous light reads as a progress bar; a pass, a rest, a pass
    // reads as something alive.
    x.value = withRepeat(
      withDelay(500, withTiming(w + BAND, { duration: SHIMMER_MS, easing: Easing.inOut(Easing.cubic) })),
      -1,
    );
    return () => cancelAnimation(x);
  }, [active, reduced, w, x]);

  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -x.value }] }));

  const still = !active || reduced;
  return (
    <View>
      <Text numberOfLines={1} onLayout={(e) => setW(Math.ceil(e.nativeEvent.layout.width))} style={[style, { color: still && active ? bright : dim }]}>
        {text}
      </Text>
      {still || w === 0 ? null : (
        <Animated.View pointerEvents="none" style={[styles.window, { width: BAND }, windowStyle]}>
          <Animated.View style={[{ width: w }, innerStyle]}>
            <Text numberOfLines={1} style={[style, { color: bright }]}>
              {text}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
});
