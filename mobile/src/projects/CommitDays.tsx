/**
 * A project's commits, day by day: one bar a day with a commit, as tall as its commits, the ones a
 * session of this project was running for in the agent's colour and the rest in yours, standing on
 * a hairline. Days with no commit are gaps, never bars of nothing (the block leaves them out, and
 * so does the drawing). The bars grow up from the line in the order the days came, with the page's
 * spring, when the block arrives; then they are still.
 *
 * A tap sparks where the finger lifted (react-bits ClickSpark, through its port in
 * `src/ui/bits/effects/ClickSpark.tsx`, which keeps David Haz's notice; the house style puts it on
 * commits) and says the day under it.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, useDerivedValue } from 'react-native-reanimated';

import { commas } from '../copy/numbers';
import { type, Words } from '../insights/kit';
import { phase, spring } from '../insights/motion';
import { DATA, GROUND } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { select } from '../ui';
import { ClickSpark, type ClickSparkHandle } from '../ui/bits/effects';
import type { HueProp } from '../ui/bits/effects/hue';
import { weekLabel } from './model';

const HEIGHT = 96;
const GROW_MS = 620;

function dayIndex(ymd: string): number {
  return Math.round(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000);
}

export function CommitDays({ days, width, spark, delay = 120 }: { days: readonly { day: string; assisted: number; alone: number }[]; width: number; spark: HueProp; delay?: number }) {
  const clock = useClock();
  const layout = useMemo(() => {
    if (!days.length) return null;
    const first = dayIndex(days[0]!.day);
    const last = dayIndex(days[days.length - 1]!.day);
    const span = Math.max(1, last - first + 1);
    const slot = width / span;
    const bar = Math.max(2, Math.min(10, slot - 2));
    const top = Math.max(1, ...days.map((d) => d.assisted + d.alone));
    const unit = (HEIGHT - 6) / top;
    return {
      bars: days.map((d, i) => {
        const x = (dayIndex(d.day) - first) * slot + (slot - bar) / 2;
        return { x, w: bar, a: d.assisted * unit, b: d.alone * unit, at: delay + (i / Math.max(1, days.length - 1)) * 700 };
      }),
      slot,
      first,
    };
  }, [days, width, delay]);

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        if (!layout) return;
        const base = Skia.Paint();
        base.setColor(Skia.Color(GROUND.border));
        canvas.drawRect(Skia.XYWHRect(0, HEIGHT - 1, width, 1), base);
        const agent = Skia.Paint();
        agent.setAntiAlias(true);
        agent.setColor(Skia.Color(DATA.agent));
        const you = Skia.Paint();
        you.setAntiAlias(true);
        you.setColor(Skia.Color(DATA.human));
        for (let i = 0; i < layout.bars.length; i++) {
          const b = layout.bars[i]!;
          const g = spring(phase(t, b.at, GROW_MS));
          if (g <= 0) continue;
          const ha = b.a * g;
          const hb = b.b * g;
          if (ha > 0) canvas.drawRect(Skia.XYWHRect(b.x, HEIGHT - 1 - ha, b.w, ha), agent);
          if (hb > 0) canvas.drawRect(Skia.XYWHRect(b.x, HEIGHT - 1 - ha - hb - (ha > 0 ? 1 : 0), b.w, hb), you);
        }
      },
      { width, height: HEIGHT },
    );
  }, [layout, width]);

  const [picked, setPicked] = useState<number | null>(null);
  const sparkRef = useRef<ClickSparkHandle>(null);
  const onPress = useCallback(
    (e: GestureResponderEvent) => {
      if (!layout) return;
      // Sparked from the press itself, where the finger lifted: the one press this chart answers.
      sparkRef.current?.spark(e.nativeEvent.locationX, e.nativeEvent.locationY);
      const at = Math.floor(e.nativeEvent.locationX / layout.slot) + layout.first;
      let best = -1;
      let dist = Number.POSITIVE_INFINITY;
      days.forEach((d, i) => {
        const k = Math.abs(dayIndex(d.day) - at);
        if (k < dist) {
          best = i;
          dist = k;
        }
      });
      select();
      setPicked(best >= 0 && dist <= 1 ? best : null);
    },
    [layout, days],
  );

  if (!layout) return null;
  const d = picked !== null ? days[picked] : null;
  const firstLabel = weekLabel(days[0]!.day);
  const lastLabel = weekLabel(days[days.length - 1]!.day);
  return (
    <View>
      <ClickSpark ref={sparkRef} hue={spark} sparkOnPress={false} count={10} radius={30}>
        <Pressable onPress={onPress} accessibilityRole="image" accessibilityLabel={`Commits on ${days.length} days, ${firstLabel} to ${lastLabel}`}>
          <Canvas style={{ width, height: HEIGHT }}>
            <Picture picture={picture} />
          </Canvas>
        </Pressable>
      </ClickSpark>
      <View style={styles.axis}>
        <Text allowFontScaling={false} style={styles.tick}>
          {firstLabel}
        </Text>
        {lastLabel !== firstLabel ? (
          <Text allowFontScaling={false} style={styles.tick}>
            {lastLabel}
          </Text>
        ) : null}
      </View>
      <View style={styles.said}>
        {d ? (
          <Animated.View key={d.day} entering={FadeIn.duration(160)}>
            <Words style={type.dim}>{`${weekLabel(d.day)}: ${commas(d.assisted + d.alone)} ${d.assisted + d.alone === 1 ? 'commit' : 'commits'}, ${commas(d.assisted)} with a session running.`}</Words>
          </Animated.View>
        ) : (
          <Words style={type.meta}>Tap a day for its commits.</Words>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tick: { fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
  said: { minHeight: 22, marginTop: 8 },
});
