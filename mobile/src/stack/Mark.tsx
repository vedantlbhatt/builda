/**
 * One thing's mark, drawn at a size in a colour: its logo as a vector path on the 24 unit grid
 * Simple Icons draws on (the same way `HarnessLogo` draws the owner's tool marks), or its
 * monogram, two or three letters inside a hairline square, for a thing with no honest logo.
 *
 * Vectors, so a mark is sharp at every size, and one fill, so a mark takes whatever colour the
 * surface it sits on asks for: the brand's own on the ground, dark ink printed on a band, grey
 * where it is only named.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { StackMark } from './marks';

/** The monogram's letters against the square it sits in: two letters fill more of it than three. */
function monogramSize(text: string, size: number): number {
  return Math.round(size * (text.length <= 2 ? 0.44 : 0.33));
}

export const MarkView = memo(function MarkView({ mark, size, color }: { mark: StackMark | null; size: number; color: string }) {
  if (!mark) return null;
  if (mark.kind === 'logo') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Path d={mark.path} fill={color} />
      </Svg>
    );
  }
  const font = monogramSize(mark.text, size);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.square,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.22),
          borderColor: color,
          borderWidth: size >= 40 ? 2 : 1.5,
        },
      ]}
    >
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.letters, { color, fontSize: font, lineHeight: Math.round(font * 1.1), letterSpacing: -font * 0.04 }]}>
        {mark.text}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  square: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  letters: { fontWeight: '800', fontVariant: ['tabular-nums'] },
});
