/**
 * A sentence arriving a word at a time, `WORD_MS` apart, each word rising 5 points on `POP`. The
 * clip's summary panel. Slow enough to read as speech and fast enough that nobody waits: a
 * twelve word sentence is fully there in 0.6 s.
 *
 * Only for a sentence that is NEWS (a session shipped, a drop was read). A sentence you have
 * already seen is set still; re-animating it on every render is the count-up problem again.
 */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { useReduceMotion } from '../ui/motion';
import { WORD_MS } from './spec';
import { SPRING } from './springs';

export function Words({
  text,
  style,
  play = true,
  delay = 0,
  containerStyle,
}: {
  text: string;
  style?: TextStyle | TextStyle[];
  play?: boolean;
  delay?: number;
  containerStyle?: ViewStyle;
}) {
  const reduced = useReduceMotion();
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  if (reduced) {
    return <Text style={style}>{text}</Text>;
  }
  return (
    <View style={[styles.wrap, containerStyle]} accessible accessibilityLabel={text}>
      {words.map((w, i) => (
        <Word key={`${i}.${w}`} text={w} i={i} play={play} delay={delay} style={style} last={i === words.length - 1} />
      ))}
    </View>
  );
}

function Word({ text, i, play, delay, style, last }: { text: string; i: number; play: boolean; delay: number; style?: TextStyle | TextStyle[]; last: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = play ? withDelay(delay + i * WORD_MS, withSpring(1, SPRING.pop)) : 0;
  }, [play, i, delay, p]);
  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, p.value)),
    transform: [{ translateY: interpolate(p.value, [0, 1], [5, 0]) }],
  }));
  return (
    <Animated.View style={anim}>
      <Text style={style} importantForAccessibility="no" accessibilityElementsHidden>
        {last ? text : `${text} `}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
});
