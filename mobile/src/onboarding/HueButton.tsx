import React, { useCallback } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { hitSlopToReach } from '../theme';
import { haptics, type HapticKind } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { SHAPE } from '../ui/shape';
import { T } from '../ui/Text';
import { ACTION_LABEL } from './type';

/**
 * Onboarding's action, in the builder's colour: the theme is the creature's hue (HOUSE-STYLE,
 * the owner at 11:58), and the primary is the first place a person sees it. The kit's `Button`
 * still fills with amber, which the owner called "this ugly orange", so the flow draws its own.
 *
 * The shape is duolingo's slab (design-md/misc/duolingo, "The 3D Primary Button"): a face on a
 * ledge 4pt deep in a darker tone of the same colour, no shadow and no blur. Pressed, the face
 * goes down onto the ledge in 80ms, linear; let go, it springs back in 250ms at damping 0.7.
 * The ledge is the hue's partner, the dither's middle tone, so the button is two tones of one
 * colour and never a colour at partial opacity.
 *
 * `onBand`: the action sits on a band of its own hue, so the face is the band's dark ink with
 * the label in the hue (Cash App's rule turned over: dark on the colour, the colour on dark).
 * Disabled sits flat on the ground with faint words: it is not pressable, so it has no ledge.
 * `secondary` is a text button of the same prominence ("Not now" beside "Continue").
 */
export interface HueButtonHue {
  fill: string;
  onFill: string;
  partner: string;
}

export interface HueButtonProps {
  label: string;
  onPress?: () => void;
  hue: HueButtonHue;
  kind?: 'primary' | 'secondary';
  onBand?: boolean;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  haptic?: HapticKind;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** The face and the ledge (the kit's large action is 52pt; duolingo's slab adds its ledge). */
export const ACTION_HEIGHT = 52;
export const LEDGE = 4;
const PRESS_MS = 80;
const RELEASE = { duration: 250, dampingRatio: 0.7 };

export function HueButton({
  label,
  onPress,
  hue,
  kind = 'primary',
  onBand = false,
  disabled = false,
  busy = false,
  busyLabel,
  haptic,
  accessibilityHint,
  style,
}: HueButtonProps) {
  const c = useColors();
  const down = useSharedValue(0);
  const inert = disabled || busy;
  const primary = kind === 'primary';

  const face = !primary ? 'transparent' : disabled ? c.raised : onBand ? hue.onFill : hue.fill;
  const ink = disabled ? c.textFaint : primary ? (onBand ? hue.fill : hue.onFill) : onBand ? hue.onFill : c.text;
  const ledge = primary && !disabled;

  const onPressIn = useCallback(() => {
    if (!ledge) return;
    down.value = withTiming(1, { duration: PRESS_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [down, ledge]);
  const onPressOut = useCallback(() => {
    down.value = withSpring(0, { ...RELEASE, reduceMotion: ReduceMotion.Never });
  }, [down]);
  const handlePress = useCallback(() => {
    if (haptic) haptics[haptic]();
    onPress?.();
  }, [haptic, onPress]);

  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: down.value * LEDGE }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
      disabled={inert}
      hitSlop={hitSlopToReach(ACTION_HEIGHT)}
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[{ height: ACTION_HEIGHT + LEDGE, alignSelf: 'stretch' }, style]}
    >
      {ledge ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: LEDGE,
            height: ACTION_HEIGHT,
            borderRadius: SHAPE.action,
            borderCurve: 'continuous',
            backgroundColor: hue.partner,
          }}
        />
      ) : null}
      <Animated.View
        style={[
          {
            height: ACTION_HEIGHT,
            marginTop: primary && !ledge ? LEDGE : 0,
            borderRadius: SHAPE.action,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: face,
          },
          faceStyle,
        ]}
      >
        <T role="headline" numberOfLines={1} style={[ACTION_LABEL, { color: ink, opacity: busy ? 0.6 : 1 }]}>
          {busy ? (busyLabel ?? label) : label}
        </T>
      </Animated.View>
    </Pressable>
  );
}
