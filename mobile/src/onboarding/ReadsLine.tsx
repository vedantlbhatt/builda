import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { HarnessLogo } from '../pixel/HarnessLogo';
import { HARNESS_MARKS } from '../pixel/harness';
import { BlurText } from '../ui/bits/text/BlurText';
import { useReduceMotion } from '../ui/motion';
import { T } from '../ui/Text';
import { HELLO, listOf } from './copy';
import { LINE_CYCLE } from './flow';

/**
 * The mark beside the name. 32pt: a whole-cell size for Aider's pixel glyph, which `HarnessLogo`
 * snaps up to 32 from anything between 17 and 32, so a smaller slot would not hold it.
 */
const LOGO = 32;
/** BlurText's two keyframe steps and its stagger, so a one or two word name lands in liquid glass's 560ms. */
const STEP_MS = 240;
const STAGGER_MS = 80;

/**
 * The line under hello's headline: "from" and then each tool Builda reads, one at a time, with
 * the owner's own mark for it (`HarnessLogo`; Aider keeps its pixel glyph), in the band's ink.
 *
 * The cadence is liquid glass's third line (appllama-liquid-glass-screens, docs/MOTION_SPEC.md,
 * "The copy"): each name comes into focus left to right in 560ms (react-bits BlurText, the kit's
 * port, its ghost copies closing in as the words sharpen), holds 1950ms, leaves in 400ms with its
 * opacity on `easeInQuad` and no travel, and the next comes 460ms later. It goes round the seven.
 *
 * Reduce Motion: nothing turns over; the line names them all at once.
 */
export function ReadsLine({ color, play }: { color: string; play: boolean }) {
  const reduced = useReduceMotion();
  const [i, setI] = useState(0);
  const shown = useSharedValue(1);

  useEffect(() => {
    if (!play || reduced) return;
    const leave = setTimeout(() => {
      shown.value = withTiming(0, { duration: LINE_CYCLE.outMs, easing: Easing.in(Easing.quad), reduceMotion: ReduceMotion.Never });
    }, LINE_CYCLE.inMs + LINE_CYCLE.holdMs);
    const next = setTimeout(
      () => {
        shown.value = 1;
        setI((x) => (x + 1) % HARNESS_MARKS.length);
      },
      LINE_CYCLE.inMs + LINE_CYCLE.holdMs + LINE_CYCLE.outMs + LINE_CYCLE.gapMs,
    );
    return () => {
      clearTimeout(leave);
      clearTimeout(next);
    };
  }, [play, reduced, i, shown]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  if (reduced) {
    return (
      <T role="title" style={{ color }}>
        {`${HELLO.from} ${listOf(HARNESS_MARKS.map((m) => m.name))}`}
      </T>
    );
  }

  const mark = HARNESS_MARKS[i]!;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: LOGO }}>
      <T role="title" style={{ color }}>
        {HELLO.from}
      </T>
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, fade]}>
        {play ? <HarnessLogo key={mark.id} harness={mark.harnesses[0]!} size={LOGO} color={color} /> : null}
        <BlurText
          text={mark.name}
          role="title"
          color={color}
          play={play}
          replayKey={i}
          stepMs={STEP_MS}
          staggerMs={STAGGER_MS}
          budgetMs={LINE_CYCLE.inMs}
        />
      </Animated.View>
    </View>
  );
}
