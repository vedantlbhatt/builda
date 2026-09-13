import { Canvas, DashPathEffect, RoundedRect } from '@shopify/react-native-skia';
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from './scheme';
import { DASH_INSET, DASH_INTERVALS, DASHED_FRAME_RADIUS } from './shape';

export interface DashedFrameProps {
  /** Distance from the card's edge. Default 8. */
  inset?: number;
  /** Default concentric with a 28pt card at the inset (20 at 8). */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Wrapped card's 1pt dashed outline, 4 on 4 off, in `border`. Drawn with Skia's
 * DashPathEffect because RN's `borderStyle: 'dashed'` spaces its dashes unevenly on iOS.
 * Sits over its parent (absolute fill, no touches) and measures itself.
 *
 * The rect is inset a further half point so the 1pt stroke covers whole device pixels
 * instead of straddling two.
 */
export function DashedFrame({ inset = DASH_INSET, radius, style }: DashedFrameProps) {
  const c = useColors();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height });
  };
  const r = radius ?? DASHED_FRAME_RADIUS;
  return (
    <View pointerEvents="none" onLayout={onLayout} style={[StyleSheet.absoluteFill, style]}>
      {box ? (
        <Canvas style={{ width: box.w, height: box.h }}>
          <RoundedRect
            x={inset + 0.5}
            y={inset + 0.5}
            width={Math.max(0, box.w - 2 * inset - 1)}
            height={Math.max(0, box.h - 2 * inset - 1)}
            r={r}
            style="stroke"
            strokeWidth={1}
            color={c.border}
          >
            <DashPathEffect intervals={[...DASH_INTERVALS]} />
          </RoundedRect>
        </Canvas>
      ) : null}
    </View>
  );
}
