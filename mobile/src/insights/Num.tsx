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
 *
 * What React renders follows the clock too (`restingText`): the first frame while the count is
 * ahead, the resting string once it has landed. A Num that mounts into a block that has already
 * played, or gets its data after it played, shows its value at once instead of the "0" React
 * rendered and nothing on the UI thread would ever rewrite (the clock at rest never moves again).
 */
import React, { useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedProps, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';

import { NUM_MOTIONS, numFrame, numMotionFor, tickStep, type NumMotion } from '../motion/pixelMotion';
import { countLanded, formatWith, restingText, type NumSpec } from './format';
import { COUNT_MS, ease, phase } from './motion';
import { useClock, usePageCounted } from './reveal';

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
  /** How it arrives when it is the page's counting number. Default: its own, from its value. */
  motion?: NumMotion;
}

export function Num({ spec, textStyle, delay = 0, duration = COUNT_MS, style, accessibilityLabel, motion }: NumProps) {
  const clock = useClock();
  const { value, final, fmt } = spec;
  const how = NUM_MOTIONS.indexOf(motion ?? numMotionFor(`${accessibilityLabel ?? ''}|${final}`));
  // Once per screen (`reveal.tsx` Page.counted): the first number on the page to play counts up,
  // every later one is set still. -1 until its block starts, then 1 (counts) or 0 (still).
  const counted = usePageCounted();
  const role = useSharedValue(counted ? -1 : 1);

  const animatedProps = useAnimatedProps(() => {
    const p = phase(clock.value, delay, duration);
    const e = ease(p);
    const done = role.value === 0 || countLanded(clock.value, delay, duration);
    // One of four arrivals (`pixelMotion.NUM_MOTIONS`): the count, a split flap scramble, typed
    // in, or ticking over in tenths. The frame index for the scramble is the clock in 40 ms steps,
    // so the digits flip at a readable rate rather than every display frame.
    const text = done
      ? final
      : how === 0
        ? formatWith(fmt, value * e)
        : how === 3
          ? formatWith(fmt, value * tickStep(e))
          : numFrame(how, final, e, Math.floor(clock.value / 40));
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });

  // Whether the count has landed, for what React renders. Never read off the clock during render
  // (Reanimated warns about that): a layout effect reads it before the first paint, and the
  // reaction keeps it in step with the UI thread from then on, a replayed block included.
  const [landed, setLanded] = useState(false);
  useLayoutEffect(() => {
    if (countLanded(clock.value, delay, duration)) setLanded(true);
  }, [clock, delay, duration]);
  useAnimatedReaction(
    () => countLanded(clock.value, delay, duration),
    (now, before) => {
      if (now !== before) runOnJS(setLanded)(now);
    },
    [delay, duration],
  );
  useAnimatedReaction(
    () => clock.value > 0,
    (started) => {
      if (!started || role.value !== -1 || !counted) return;
      if (counted.value === 0) {
        counted.value = 1;
        role.value = 1;
      } else {
        role.value = 0;
        runOnJS(setLanded)(true);
      }
    },
    [counted],
  );
  const startsAt = restingText(spec, landed);
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
