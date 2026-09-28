/**
 * The star, in the app's own pixels: a 7 by 7 star of cells, filled in the project's hue when you
 * starred it, only its edge in the dim ink when you did not. Starring throws eight cells out from
 * its middle, which fly on the POP spring and are gone by the time they land: the one thing on the
 * screen that says it counted. Under Reduce Motion the star just fills.
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { GROUND } from '../insights/palette';
import { SPRING } from '../motion/springs';
import { useReduceMotion } from '../ui/motion';
import { edgeCell, STAR } from './model';

const BURST = 8;

export function PixelStar({ on, ink, cell = 3, onPress, label }: { on: boolean; ink: string; cell?: number; onPress?: () => void; label: string }) {
  const reduce = useReduceMotion();
  const burst = useSharedValue(0);
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current && !reduce) {
      burst.value = 0;
      burst.value = withSpring(1, SPRING.pop);
    }
    was.current = on;
  }, [on, reduce, burst]);
  const size = cell * 7;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label} hitSlop={12} disabled={!onPress}>
      <View style={{ width: size, height: size }}>
        {STAR.map((row, r) =>
          row.split('').map((ch, c) => {
            if (ch !== 'X') return null;
            const lit = on || edgeCell(r, c);
            if (!lit) return null;
            return <View key={`${r}.${c}`} style={{ position: 'absolute', left: c * cell, top: r * cell, width: cell, height: cell, backgroundColor: on ? ink : GROUND.dim }} />;
          }),
        )}
        {Array.from({ length: BURST }, (_, i) => (
          <Spark key={i} i={i} ink={ink} cell={cell} centre={size / 2} burst={burst} />
        ))}
      </View>
    </Pressable>
  );
}

function Spark({ i, ink, cell, centre, burst }: { i: number; ink: string; cell: number; centre: number; burst: SharedValue<number> }) {
  const a = (i / BURST) * Math.PI * 2 + Math.PI / BURST;
  const reach = centre * 1.9;
  const style = useAnimatedStyle(() => {
    const p = burst.value;
    // Out on the spring, fading as it goes: visible only while it travels.
    const alpha = p <= 0 || p >= 1 ? 0 : Math.sin(Math.min(1, p) * Math.PI);
    return { opacity: alpha, transform: [{ translateX: Math.cos(a) * reach * p }, { translateY: Math.sin(a) * reach * p }] };
  });
  return <Animated.View pointerEvents="none" style={[styles.spark, { left: centre - cell / 2, top: centre - cell / 2, width: cell, height: cell, backgroundColor: ink }, style]} />;
}

const styles = StyleSheet.create({ spark: { position: 'absolute' } });
