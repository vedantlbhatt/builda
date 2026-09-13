/**
 * A number that counts up from 0 the first time its block plays, then rests on the string the
 * copy helpers write for it. Every frame is formatted on the UI thread by `formatWith`, with the
 * final value's decimals, grouping and unit, so "$2,952" never reads "$2952.4" on the way and a
 * width never jumps mid count.
 *
 * Ported from react-bits `TextAnimations/CountUp/CountUp.tsx` by David Haz, MIT + Commons Clause
 * (Copyright (c) 2026 David Haz; the notice is in `src/ui/digits.ts`; used as part of this
 * application, not redistributed), by way of the kit's `src/ui/CountUp.tsx`, whose approach it
 * keeps: the text drawn into a TextInput's `text` prop so no React render runs per frame. What
 * changed: it reads its block's clock (`reveal.tsx`) instead of starting its own animation, so a
 * stagger is a delay and the whole page costs one animation per block; and a transform, if a
 * caller wants one, goes on a wrapping view, because on this build a transform on an animated
 * text is dropped at mount.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';

import { formatWith, type NumSpec } from './format';
import { COUNT_MS, ease, phase } from './motion';
import { useClock } from './reveal';

// `text` rides the native prop path, as in the kit's CountUp (see the comment there).
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface NumProps {
  spec: NumSpec;
  /** Font, size, weight, colour: the one style both the sizer and the counter wear. */
  textStyle: StyleProp<TextStyle>;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  /** Read aloud instead of the number alone ("44 percent of the time"). */
  accessibilityLabel?: string;
}

export function Num({ spec, textStyle, delay = 0, duration = COUNT_MS, style, accessibilityLabel }: NumProps) {
  const clock = useClock();
  const { value, final, fmt } = spec;

  const animatedProps = useAnimatedProps(() => {
    const p = phase(clock.value, delay, duration);
    const text = p >= 1 ? final : formatWith(fmt, value * ease(p));
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });

  // Not read off the clock during render (Reanimated warns about that); the first UI frame
  // corrects it within a frame if the block has already played.
  const startsAt = formatWith(fmt, 0);
  const flat = StyleSheet.flatten(textStyle) ?? {};

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? final} style={style}>
      {/* Holds the resting width and height, so nothing beside the number moves while it counts. */}
      <Text
        allowFontScaling={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={[flat, styles.sizer, { fontVariant: ['tabular-nums'] }]}
      >
        {final}
      </Text>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        allowFontScaling={false}
        scrollEnabled={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        underlineColorAndroid="transparent"
        defaultValue={startsAt}
        animatedProps={animatedProps}
        style={[StyleSheet.absoluteFill, flat, styles.input, { fontVariant: ['tabular-nums'] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sizer: { opacity: 0 },
  input: { padding: 0, margin: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: 'transparent' },
});
