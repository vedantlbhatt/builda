import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from './scheme';

export interface HairlineProps {
  /** Leading inset in points, so a separator starts under the text, the iOS way. */
  inset?: number;
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** One device pixel in `border`. Row separators and dividers; never a card outline. */
export function Hairline({ inset = 0, vertical = false, style }: HairlineProps) {
  const c = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        vertical
          ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' }
          : { height: StyleSheet.hairlineWidth, marginLeft: inset },
        { backgroundColor: c.border },
        style,
      ]}
    />
  );
}
