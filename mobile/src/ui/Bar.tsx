import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from './scheme';
import { SHAPE } from './shape';

export interface BarProps {
  /** 0 to 1. Clamped; not a number draws an empty track, never a full one. */
  progress: number;
  /**
   * The least fill a non-zero value shows, as a fraction, so the smallest share in a ranked
   * list is still a mark rather than nothing. Default 0.
   */
  min?: number;
  /** Default 6. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A horizontal meter: an amber capsule on a `border` track. Progress and shares are the
 * places amber is spent (DESIGN-DIRECTION 3.1), so the fill is always the accent; a second
 * hue here would be a colour that means nothing. Flat, no gradient, no glow.
 */
export function Bar({ progress, min = 0, height = 6, style }: BarProps) {
  const c = useColors();
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const shown = p > 0 ? Math.max(min, p) : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height, borderRadius: SHAPE.action, borderCurve: 'continuous', backgroundColor: c.border, overflow: 'hidden' },
        style,
      ]}
    >
      <View
        style={{
          width: `${shown * 100}%`,
          height,
          borderRadius: SHAPE.action,
          borderCurve: 'continuous',
          backgroundColor: c.accent,
        }}
      />
    </View>
  );
}
