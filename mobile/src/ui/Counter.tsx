/**
 * Rolling digits for LIVE numbers (files touched, lines, cost in mission control and the
 * live bar). Live numbers never count up; each place rolls to its new digit on a `SNAP`
 * spring, the short way round.
 *
 * Ported from react-bits `Components/Counter/Counter.tsx` by David Haz.
 * react-bits is MIT + Commons Clause, Copyright (c) 2026 David Haz. Permission is granted
 * to use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, provided the copyright notice and this permission
 * notice are included; the Commons Clause forbids selling, sublicensing or redistributing
 * the components themselves, alone, in a bundle, or as a ported version. THE SOFTWARE IS
 * PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. The full notice and what changed in the
 * port are in `digits.ts`.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import type { TypeRole } from '../theme';
import { digitOffset, placesFor, valueAtPlace, type PlaceOptions } from './digits';
import { formatCount } from './format';
import { SNAP } from './motion';
import { toneColor, useColors, type Tone } from './scheme';
import { roleScaling, roleStyle, type RoleWeight } from './typeStyle';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface CounterProps extends PlaceOptions {
  value: number;
  /** Default `row` (15/600). The live bar's elapsed count is `headline`. */
  role?: TypeRole;
  weight?: RoleWeight;
  tone?: Tone;
  /** Fixed text before and after: "+", "$", " files". These do not roll. */
  prefix?: string;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
}

export function Counter({
  value,
  decimals = 0,
  grouping = true,
  minDigits = 1,
  role = 'row',
  weight,
  tone = 'text',
  prefix = '',
  suffix = '',
  style,
}: CounterProps) {
  const c = useColors();
  const text = [roleStyle(role, weight), { color: toneColor(c, tone) }];
  const scaling = roleScaling(role);
  const height = roleStyle(role).lineHeight;
  const places = placesFor(value, { decimals, grouping, minDigits });
  const label = formatCount(value, decimals, grouping, prefix, suffix);

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.row, style]}>
      {prefix ? (
        <Text {...scaling} style={text}>
          {prefix}
        </Text>
      ) : null}
      {places.map((place, i) =>
        typeof place === 'number' ? (
          <Column key={`p${place}`} place={place} value={value} height={height} textStyle={text} scaling={scaling} />
        ) : (
          <Text key={`s${i}`} {...scaling} style={text}>
            {place}
          </Text>
        ),
      )}
      {suffix ? (
        <Text {...scaling} style={text}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

interface ColumnProps {
  place: number;
  value: number;
  height: number;
  textStyle: React.ComponentProps<typeof Text>['style'];
  scaling: ReturnType<typeof roleScaling>;
}

/** One place: ten numerals stacked on one shared value, clipped to one line. */
function Column({ place, value, height, textStyle, scaling }: ColumnProps) {
  const target = valueAtPlace(value, place);
  const latest = useSharedValue(target);
  // Spring only on a real change. A column mounts at rest, and a spring from a value to
  // itself would drive ten mappers every frame for 400ms to move nothing.
  const settled = useRef(target);
  useEffect(() => {
    if (settled.current === target) return;
    settled.current = target;
    latest.value = withSpring(target, { ...SNAP, reduceMotion: ReduceMotion.System });
  }, [latest, target]);
  return (
    <View style={[styles.column, { height }]}>
      {/* Sizes the column to one tabular numeral; never seen. */}
      <Text {...scaling} style={[textStyle, styles.sizer]}>
        0
      </Text>
      {DIGITS.map((d) => (
        <Numeral key={d} digit={d} latest={latest} height={height} textStyle={textStyle} scaling={scaling} />
      ))}
    </View>
  );
}

function Numeral({
  digit,
  latest,
  height,
  textStyle,
  scaling,
}: {
  digit: number;
  latest: SharedValue<number>;
  height: number;
  textStyle: ColumnProps['textStyle'];
  scaling: ColumnProps['scaling'];
}) {
  const move = useAnimatedStyle(() => ({ transform: [{ translateY: digitOffset(digit, latest.value, height) }] }));
  // The transform rides on a View, not on the Text. MEASURED on this build (RN 0.79, Fabric,
  // Reanimated 3.17): an Animated.Text's FIRST-render animated transform never reaches the
  // native view (later updates do), so a column that had not rolled yet drew all ten
  // numerals on top of each other. An Animated.View with the same style is applied at mount.
  return (
    <Animated.View style={[styles.numeral, { height }, move]}>
      <Text {...scaling} style={[textStyle, styles.center]}>
        {digit}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { overflow: 'hidden' },
  sizer: { opacity: 0 },
  numeral: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: { textAlign: 'center' },
});
