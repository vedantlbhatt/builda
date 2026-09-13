import React, { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { type Scheme } from '../theme';
import { type Mark } from './decode';
import { CORNER, layoutStrip, type Preset } from './layout';

export type { Preset } from './layout';

interface Props {
  /** base64, exactly 1024 bytes. */
  cols: string;
  marks?: Mark[];
  spanMs?: number;
  preset?: Preset;
  scheme?: Scheme;
  width: number;
  style?: ViewStyle;
}

/**
 * The session timeline strip, on the phone, still (the card, the feed, the recap sheet). The
 * session page and the Sessions list draw the same layout on as it arrives (`StripDraw.tsx`).
 *
 * Renders from the same 1024-byte array and the same ordinals as the SwiftUI version,
 * with the same nearest-neighbour resample. `__tests__/strip.test.ts` and
 * `StripGoldenTests.swift` assert both decoders agree on the same fixtures, because a
 * class-ordinal swap produces a strip that is plausible, non-empty and completely wrong.
 *
 * Marks are drawn ON TOP and are never resampled away. A typed prompt occupies seconds of
 * a session that may run for hours, so at any render width its column is dominated by the
 * agent run that follows it; without the overlay the human disappears from their own
 * timeline. Where each mark goes is `layout.ts`, one function for every drawing.
 */
export function TimelineStrip({ cols, marks = [], spanMs = 0, preset = 'row', scheme = 'dark', width, style }: Props) {
  const { rects, marks: markRects, floor, height, label } = useMemo(
    () => layoutStrip(cols, marks, spanMs, preset, scheme, width),
    [cols, marks, spanMs, preset, scheme, width],
  );
  const bars = preset === 'hero' || preset === 'mini';

  return (
    <View
      style={[{ width, height, borderRadius: CORNER[preset], borderCurve: 'continuous', overflow: 'hidden' }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Svg width={width} height={height}>
        {rects.map((r, i) => (
          <Rect key={`c${i}`} x={r.x} y={r.y} width={r.w + 0.5} height={r.h} rx={bars ? 1 : 0} fill={r.fill} opacity={r.opacity} />
        ))}
        {markRects.map((m, i) => (
          <Rect key={`m${i}`} x={m.x} y={m.y} width={m.w} height={m.h} rx={1} fill={m.fill} />
        ))}
        {floor ? <Rect x={floor.x} y={floor.y} width={floor.w} height={floor.h} fill={floor.fill} /> : null}
      </Svg>
    </View>
  );
}
