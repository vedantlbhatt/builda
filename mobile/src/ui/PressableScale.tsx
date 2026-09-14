import React, { useCallback } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptics, type HapticKind } from './haptics';
import { PRESS_SCALE, SNAP, T, timing, useReduceMotion } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press feedback for buttons and cards: scale to 0.97 on press-in over 120ms on `EASE`,
 * and a `SNAP` spring home on release, because a finger was involved. Under Reduce Motion
 * the scale becomes an opacity dip. Rows do not use this: they highlight (`Row.tsx`).
 *
 * `pressed` runs 0 to 1 with the finger, for callers that tie a colour to the press.
 */
export function usePressFeedback(scaleTo: number = PRESS_SCALE) {
  const reduce = useReduceMotion();
  const pressed = useSharedValue(0);

  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, timing(T.press));
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, SNAP);
  }, [pressed]);

  const animatedStyle = useAnimatedStyle(() => {
    if (reduce) return { opacity: 1 - pressed.value * 0.3 };
    return { transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }] };
  }, [reduce, scaleTo]);

  return { pressed, onPressIn, onPressOut, animatedStyle, reduce };
}

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** Default 0.97. */
  scaleTo?: number;
  /** Fired with the press, on the same frame. See `hapticsGate.ts` for which one. */
  haptic?: HapticKind;
}

export function PressableScale({
  style,
  children,
  scaleTo,
  haptic,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const fb = usePressFeedback(scaleTo);
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (haptic) haptics[haptic]();
      onPress?.(e);
    },
    [haptic, onPress],
  );
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={(e) => {
        fb.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        fb.onPressOut();
        onPressOut?.(e);
      }}
      style={[style, fb.animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
