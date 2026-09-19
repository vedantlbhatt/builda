/**
 * The status wheel: a vertical list whose current row sits in the middle, bright and full size,
 * with its neighbours above and below, dimmer and smaller, like the face of a drum. The clip uses
 * it for an agent's steps; Builda uses it for anything that is a sequence you are partway
 * through (a drop being read, the sessions running now, a demo being cut).
 *
 * ONE shared value (the fractional index) drives every row's position, scale and opacity, so the
 * rows can never disagree about where the wheel is, and moving to the next step is one spring on
 * `WHEEL` rather than N animations that drift apart. The active row can shimmer.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { Shimmer } from './Shimmer';
import { SPRING } from './springs';

export interface WheelRow {
  key: string;
  text: string;
}

export function Wheel({
  rows,
  index,
  rowHeight = 22,
  visible = 3,
  width,
  textStyle,
  dim,
  bright,
  shimmer = true,
  align = 'left',
}: {
  rows: readonly WheelRow[];
  index: number;
  rowHeight?: number;
  visible?: number;
  width: number;
  textStyle?: TextStyle;
  dim: string;
  bright: string;
  shimmer?: boolean;
  align?: 'left' | 'center';
}) {
  const pos = useSharedValue(index);
  useEffect(() => {
    pos.value = withSpring(index, SPRING.wheel);
  }, [index, pos]);

  return (
    <View style={{ height: rowHeight * visible, width, overflow: 'hidden', justifyContent: 'center' }} pointerEvents="none">
      {rows.map((row, i) => (
        <Row
          key={row.key}
          row={row}
          i={i}
          pos={pos}
          rowHeight={rowHeight}
          width={width}
          textStyle={textStyle}
          dim={dim}
          bright={bright}
          active={i === index && shimmer}
          align={align}
        />
      ))}
    </View>
  );
}

function Row({
  row,
  i,
  pos,
  rowHeight,
  width,
  textStyle,
  dim,
  bright,
  active,
  align,
}: {
  row: WheelRow;
  i: number;
  pos: SharedValue<number>;
  rowHeight: number;
  width: number;
  textStyle?: TextStyle;
  dim: string;
  bright: string;
  active: boolean;
  align: 'left' | 'center';
}) {
  const style = useAnimatedStyle(() => {
    const d = i - pos.value;
    const ad = Math.abs(d);
    return {
      transform: [
        { translateY: d * rowHeight },
        // Measured off the clip: one row away is about 0.78 the size and a third as bright.
        { scale: interpolate(ad, [0, 1, 2], [1, 0.78, 0.66], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(ad, [0, 1, 2, 3], [1, 0.34, 0.14, 0], Extrapolation.CLAMP),
    };
  });
  return (
    <Animated.View style={[styles.row, { height: rowHeight, width, alignItems: align === 'left' ? 'flex-start' : 'center' }, style]}>
      <Shimmer text={row.text} style={textStyle} dim={active ? dim : bright} bright={bright} active={active} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, justifyContent: 'center', transformOrigin: 'left center' },
});
