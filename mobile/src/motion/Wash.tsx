/**
 * A state painted INTO the black: a gradient from one edge, never a tinted rectangle
 * (docs/motion.md rule 8). The clip's four: warm from the top on arrival, red rising from the
 * bottom on an error, green across on success, pink into violet on a summary.
 *
 * It fades between colours on its own (400 ms, the clip's red wash), so a surface changing state
 * does not have to know what it was before.
 */
import React, { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';


export type WashFrom = 'top' | 'bottom' | 'left' | 'right';

const VECTORS: Record<WashFrom, { x1: string; y1: string; x2: string; y2: string }> = {
  top: { x1: '0', y1: '0', x2: '0', y2: '1' },
  bottom: { x1: '0', y1: '1', x2: '0', y2: '0' },
  left: { x1: '0', y1: '0', x2: '1', y2: '0.35' },
  right: { x1: '1', y1: '0', x2: '0', y2: '0.35' },
};

export function Wash({
  color,
  from = 'bottom',
  strength = 0.34,
  to,
}: {
  /** Null clears the wash. */
  color: string | null;
  from?: WashFrom;
  strength?: number;
  /** A second colour at the far edge (the summary wash's violet), faint. */
  to?: string;
}) {
  const [shown, setShown] = useState(color);
  const o = useSharedValue(color ? 1 : 0);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    if (color) {
      setShown(color);
      o.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
    } else {
      o.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) });
    }
  }, [color, o]);

  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  if (!shown) return null;
  const v = VECTORS[from];
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, anim]}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`w${uid}`} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
              {/* Hex plus stopOpacity, never an rgba() stop: react-native-svg paints an rgba stop
                  colour at full strength on iOS, which drew the first wash as a solid block. */}
              <Stop offset="0" stopColor={shown} stopOpacity={strength} />
              <Stop offset="0.7" stopColor={to ?? shown} stopOpacity={to ? strength * 0.45 : 0.02} />
              <Stop offset="1" stopColor={to ?? shown} stopOpacity={to ? strength * 0.6 : 0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#w${uid})`} />
        </Svg>
      </View>
    </Animated.View>
  );
}
