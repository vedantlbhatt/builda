/**
 * SpotlightCard: a card that answers a finger with a soft pool of light in its own hue, under
 * the finger and following it. Press feedback for mission tiles and the You hero
 * (DESIGN-V2 4.3, row 16).
 *
 * Ported from react-bits `Components/SpotlightCard/SpotlightCard.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port:
 * - The light is not `radial-gradient(circle at x y, rgba(255,255,255,0.25), transparent 80%)`.
 *   Gradients are banned here and white at 25% over the warm card is a grey smudge. It is the
 *   three level dither of the card's hue at 3pt cells (`SPOTLIGHT_SKSL` in fills.ts): a pool of
 *   partner cells, densest under the finger, thinning to single cells at 120pt. Subtle by
 *   default (`SPOT.strength` 0.42 never reaches ink).
 * - Hover is a finger: a Gesture Handler `Manual` gesture tracks it on the UI thread without
 *   ever activating, so the card still scrolls with its list and a press inside it still lands.
 *   The light comes up in 120ms and goes in 240ms (react-bits fades over 500ms either way).
 * - `onPress` makes the card a button with the kit's press scale (0.97 over 120ms), so the
 *   common case is one component.
 *
 * Reduce Motion: no light; the press scale becomes the kit's opacity dip.
 */
import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, withTiming } from 'react-native-reanimated';

import { hue as hueOf, layout, type Hue, type HueName } from '../../../theme';
import { type HapticKind } from '../../haptics';
import { EASE, useReduceMotion } from '../../motion';
import { PressableScale } from '../../PressableScale';
import { useColors, useScheme } from '../../scheme';
import { SHAPE, type ShapeName } from '../../shape';
import type { SurfaceLevel } from '../../Surface';
import { SpotlightLayer } from './layers';
import { SPOT } from './spec';

export interface SpotlightCardProps {
  /** The light's hue: the tile's identity (a session's creature, the archetype). Default amber. */
  hue?: HueName;
  /** Points. Default 120. */
  radius?: number;
  /** The amount at the finger, 0 to 1. Default 0.42: partner cells only. */
  strength?: number;
  children?: ReactNode;
  /** Makes the card a button with the kit's press scale. */
  onPress?: () => void;
  onLongPress?: () => void;
  haptic?: HapticKind;
  disabled?: boolean;
  /** Default `card`. */
  level?: SurfaceLevel;
  /** A 1pt `border` outline. Default true. */
  hairline?: boolean;
  /** From the radius rule. Default `container` (18). */
  shape?: ShapeName;
  /** Default the tile padding, 14. */
  padding?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function SpotlightCard({
  hue = 'amber',
  radius = SPOT.radius,
  strength = SPOT.strength,
  children,
  onPress,
  onLongPress,
  haptic,
  disabled = false,
  level = 'card',
  hairline = true,
  shape = 'container',
  padding = layout.tilePad,
  accessibilityLabel,
  accessibilityHint,
  style,
}: SpotlightCardProps) {
  const c = useColors();
  const scheme = useScheme();
  const reduce = useReduceMotion();
  const tone: Hue = useMemo(() => hueOf(hue, scheme), [hue, scheme]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  }, []);

  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const amount = useSharedValue(0);
  const live = !reduce && !disabled;

  const gesture = useMemo(
    () =>
      Gesture.Manual()
        .enabled(live)
        .onTouchesDown((e) => {
          const t = e.allTouches[0];
          if (!t) return;
          ox.value = t.x;
          oy.value = t.y;
          amount.value = withTiming(strength, { duration: SPOT.inMs, easing: EASE });
        })
        .onTouchesMove((e) => {
          const t = e.allTouches[0];
          if (!t) return;
          ox.value = t.x;
          oy.value = t.y;
        })
        .onTouchesUp(() => {
          amount.value = withTiming(0, { duration: SPOT.outMs, easing: EASE });
        })
        .onTouchesCancelled(() => {
          amount.value = withTiming(0, { duration: SPOT.outMs, easing: EASE });
        })
        .onFinalize(() => {
          amount.value = withTiming(0, { duration: SPOT.outMs, easing: EASE });
        }),
    [live, ox, oy, amount, strength],
  );

  const r = SHAPE[shape];
  const face = (
    <View
      onLayout={onLayout}
      style={[
        { backgroundColor: c[level], borderRadius: r, borderCurve: 'continuous', overflow: 'hidden', padding },
        hairline ? { borderWidth: 1, borderColor: c.border } : null,
        onPress ? null : style,
      ]}
    >
      {live && size.w > 0 ? (
        // Absolute children start inside the border; the touch is measured from the outer
        // edge, so the layer steps back over the hairline to share its origin.
        <SpotlightLayer
          width={size.w}
          height={size.h}
          hue={tone}
          originX={ox}
          originY={oy}
          strength={amount}
          radius={radius}
          style={hairline ? { left: -1, top: -1 } : undefined}
        />
      ) : null}
      {children}
    </View>
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View collapsable={false} style={onPress ? style : undefined}>
        {onPress || onLongPress ? (
          <PressableScale
            onPress={onPress}
            onLongPress={onLongPress}
            haptic={haptic}
            disabled={disabled}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
          >
            {face}
          </PressableScale>
        ) : (
          face
        )}
      </Animated.View>
    </GestureDetector>
  );
}
