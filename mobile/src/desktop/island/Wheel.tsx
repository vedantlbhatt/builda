/**
 * The status wheel (docs/motion.md 7): a short list where the current line is full ink and a
 * light passes across it, and the lines around it are smaller and dimmer. The rows arrive one
 * after another (`STAGGER_MS`) on the WHEEL spring; they never leave one by one.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';

import { roleStyle } from '../../ui/typeStyle';
import { SHIMMER_MS, STAGGER_MS, WHEEL, springConfig } from './motion';
import { DIM, FAINT, INK, withAlpha } from './palette';

export interface WheelRow {
  key: string;
  text: string;
  corner: string | null;
  ink: string;
}

export function Wheel({ rows, index }: { rows: WheelRow[]; index: number }) {
  return (
    <View style={styles.wheel}>
      {rows.map((r, i) => (
        <Line key={r.key} row={r} i={i} active={i === index} past={i < index} />
      ))}
    </View>
  );
}

function Line({ row, i, active, past }: { row: WheelRow; i: number; active: boolean; past: boolean }) {
  const t = useSharedValue(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(i * STAGGER_MS, withSpring(1, springConfig(WHEEL)));
  }, [i, t]);
  useEffect(() => {
    if (!active) return;
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.inOut(Easing.quad) }), -1);
  }, [active, sweep]);
  const arrive = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: 6 * (1 - t.value) }] }));
  const light = useAnimatedStyle(() => ({ left: `${-30 + sweep.value * 130}%` as unknown as number, opacity: active ? 1 : 0 }));
  return (
    <Animated.View style={[styles.line, arrive]}>
      <View style={[styles.mark, { backgroundColor: active ? row.ink : past ? withAlpha(row.ink, 0.5) : withAlpha(FAINT, 0.6) }]} />
      <View style={styles.textBox}>
        <Text numberOfLines={1} style={[active ? styles.active : styles.rest, { color: active ? INK : past ? DIM : FAINT }]}>
          {row.text}
        </Text>
        <Animated.View pointerEvents="none" style={[styles.light, light]} />
      </View>
      {row.corner ? <Text style={[styles.corner, { color: FAINT }]}>{row.corner}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wheel: { gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  mark: { width: 6, height: 6, borderRadius: 3, borderCurve: 'continuous' },
  textBox: { flex: 1, minWidth: 0, overflow: 'hidden' },
  active: { ...roleStyle('row') },
  rest: { ...roleStyle('meta') },
  corner: { ...roleStyle('mono') },
  light: { position: 'absolute', top: 0, bottom: 0, width: '30%', backgroundColor: withAlpha(INK, 0.08) },
});
