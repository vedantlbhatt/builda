import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useColors } from './scheme';
import { WINDOW_DOT } from './shape';

/**
 * Three 6pt window dots, 8pt apart, in `textFaint`: window chrome on a Wrapped card, never
 * traffic-light colours. Drawn as true circles (a continuous corner on a 6pt square is a
 * squircle, which reads wrong at this size).
 */
export function Dots({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const { size, gap, count } = WINDOW_DOT;
  const width = count * size + (count - 1) * gap;
  return (
    <Svg width={width} height={size} style={style} accessibilityElementsHidden>
      {Array.from({ length: count }, (_, i) => (
        <Circle key={i} cx={size / 2 + i * (size + gap)} cy={size / 2} r={size / 2} fill={c.textFaint} />
      ))}
    </Svg>
  );
}
