import React, { useCallback } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { hitSlopToReach, space } from '../theme';
import { haptics, type HapticKind } from './haptics';
import { usePressFeedback } from './PressableScale';
import { useColors } from './scheme';
import { SHAPE } from './shape';
import { T } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonKind = 'primary' | 'secondary';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * `primary`: the amber capsule with dark ink, one per screen, where the money is.
   * `secondary`: a text button of equal prominence ("Not now" beside "Continue").
   */
  kind?: ButtonKind;
  /**
   * Secondary only: the ink is the `del` red, for an action that removes something (Delete,
   * Revoke). A primary is never red: a destructive act is confirmed by an alert, not
   * advertised by a fill.
   */
  destructive?: boolean;
  disabled?: boolean;
  /** A request in flight: the press is off and the label says what is happening. */
  busy?: boolean;
  busyLabel?: string;
  /**
   * Stretch to the container's width, label centred. Default true for both kinds, so
   * "Continue" and "Not now" stacked read with equal prominence. A non-block secondary is
   * a bare text button: no side padding, so its label sits on the text column's edge.
   */
  block?: boolean;
  /** 52pt with a 17pt label (the onboarding CTA), or 44pt with 15pt, the tap floor. */
  size?: 'large' | 'compact';
  /** On the press, same frame as the visual. Usually none; `commit` for "That's me". */
  haptic?: HapticKind;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT = { large: 52, compact: 44 } as const;

/**
 * The two buttons. A capsule (actions are capsules), the `raised` surface with the text colour,
 * press scale 0.97 over 120ms while the fill moves to `border`. No glow, no gradient, no border.
 * NOT an accent fill with dark ink (2026-09-19, the owner: "stop showing the buttons that are
 * yellow with black text"). Disabled keeps the capsule and fades the words.
 */
export function Button({
  label,
  onPress,
  kind = 'primary',
  destructive = false,
  disabled = false,
  busy = false,
  busyLabel,
  block,
  size = 'large',
  haptic,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const c = useColors();
  const fb = usePressFeedback();
  const inert = disabled || busy;
  const primary = kind === 'primary';
  const height = HEIGHT[size];

  const fill = primary ? c.raised : 'transparent';
  const fillPressed = primary && !disabled ? c.border : fill;
  const ink = disabled ? c.textFaint : destructive ? c.danger : c.text;

  const stretch = block ?? true;
  const bare = !primary && !stretch;

  const fillStyle = useAnimatedStyle(
    () => ({ backgroundColor: interpolateColor(fb.pressed.value, [0, 1], [fill, fillPressed]) }),
    [fill, fillPressed],
  );

  const handlePress = useCallback(() => {
    if (haptic) haptics[haptic]();
    onPress?.();
  }, [haptic, onPress]);

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
      disabled={inert}
      hitSlop={hitSlopToReach(height)}
      onPress={handlePress}
      onPressIn={fb.onPressIn}
      onPressOut={fb.onPressOut}
      style={[
        {
          height,
          paddingHorizontal: bare ? 0 : space.lg,
          borderRadius: SHAPE.action,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: stretch ? 'stretch' : 'flex-start',
        },
        fillStyle,
        fb.animatedStyle,
        style,
      ]}
    >
      <T role={size === 'large' ? 'headline' : 'row'} numberOfLines={1} style={{ color: ink, opacity: busy ? 0.6 : 1 }}>
        {busy ? (busyLabel ?? label) : label}
      </T>
    </AnimatedPressable>
  );
}
