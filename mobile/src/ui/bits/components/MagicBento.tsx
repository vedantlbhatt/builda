/**
 * MagicBento: a bento grid of tiles that share one light. A finger on the grid lights every
 * tile near it in that tile's own hue, and the tile under it leans gently toward it.
 *
 * Where it goes: DESIGN-V2 4.5 cut MagicBento from the You page (seven tiles there is the card
 * soup DESIGN-DIRECTION 9 bans; that page is a hero, a Stat row and rows). It is here for a
 * surface where the tile IS the unit, as mission control's tiles and the Wrapped grid are, and
 * a few big tiles say more than rows would (a Wrapped summary, a stack overview).
 *
 * Ported from react-bits `Components/MagicBento/MagicBento.tsx` by David Haz.
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
 * - Kept: the global spotlight's proximity rule (a tile is fully lit when the pointer is within
 *   half the radius of its edge, unlit past three quarters, linear between), the tilt toward
 *   the pointer, the magnetism (0.05 of the offset, off by default here), and the bento itself.
 * - The light is the three level dither of each tile's hue (`SPOTLIGHT_SKSL`), not a purple
 *   radial gradient in `mix-blend-mode: screen`; the border glow, the floating star particles
 *   and the click ripple are gone (glow borders, sparkles and gradients are the banned look).
 * - The layout is computed (`bentoLayout`: columns, spans, rows, dense), not four hard coded
 *   `nth-child` rules for a desktop, so the light and the hit test know every tile's rectangle
 *   without measuring anything.
 * - Hover is a finger on the grid (a `Manual` gesture that never takes the scroll); the tilt is
 *   5 degrees (react-bits 10), springs on `SNAP`, and the tile under the finger presses to 0.97.
 *
 * Reduce Motion: no light, no tilt, no press scale; the tile under the finger dips its opacity
 * as the kit's press does, and a tap still lands on it.
 */
import React, { useCallback, useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { hue as hueOf, layout, type HueName } from '../../../theme';
import { haptics, type HapticKind } from '../../haptics';
import { EASE, exitMs, PRESS_SCALE, SNAP, T, useReduceMotion } from '../../motion';
import { useColors, useScheme } from '../../scheme';
import { SHAPE } from '../../shape';
import type { SurfaceLevel } from '../../Surface';
import { bentoGlow, bentoLayout, hitTest, magnetOffset, tiltAt, type Rect } from './geometry';
import { SpotlightLayer } from './layers';
import { BENTO, SPOT } from './spec';

export interface BentoItem {
  key: string;
  /** The tile's identity, and the colour of its light. Default amber. */
  hue?: HueName;
  /** Columns it spans. Default 1. */
  span?: number;
  /** Rows it spans. Default 1. */
  rows?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}

export interface MagicBentoProps {
  items: readonly BentoItem[];
  /** The grid's width: inside the screen's gutter. */
  width: number;
  /** Default 2. */
  columns?: number;
  /** One row's height. Default 120. */
  rowHeight?: number;
  /** Default 12, the tile gap. */
  gap?: number;
  /** The shared light. Default on. */
  spotlight?: boolean;
  /** Points. Default 160 (react-bits 300px). */
  spotlightRadius?: number;
  /** The light's amount at the finger. Default SpotlightCard's. */
  strength?: number;
  /** The tile under the finger leans toward it. Default on. */
  tilt?: boolean;
  /** The tile under the finger leans 5% of the way to it (react-bits `enableMagnetism`). Default off. */
  magnetism?: boolean;
  /** Default `card`. */
  level?: SurfaceLevel;
  /** Default the tile padding, 14. */
  padding?: number;
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle>;
}

export function MagicBento({
  items,
  width,
  columns = BENTO.columns,
  rowHeight = BENTO.rowHeight,
  gap = layout.tileGap,
  spotlight = true,
  spotlightRadius = BENTO.spotlightRadius,
  strength = SPOT.strength,
  tilt = true,
  magnetism = false,
  level = 'card',
  padding = layout.tilePad,
  haptic,
  style,
}: MagicBentoProps) {
  const reduce = useReduceMotion();
  const { rects, height } = useMemo(() => bentoLayout(items, width, columns, gap, rowHeight), [items, width, columns, gap, rowHeight]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const held = useSharedValue(0);
  const under = useSharedValue(-1);
  const live = !reduce;

  const press = useCallback(
    (i: number) => {
      const item = items[i];
      if (!item?.onPress) return;
      if (haptic) haptics[haptic]();
      item.onPress();
    },
    [items, haptic],
  );

  const gesture = useMemo(() => {
    const release = () => {
      'worklet';
      held.value = withTiming(0, { duration: SPOT.outMs, easing: EASE });
      under.value = -1;
    };
    // Tracked under Reduce Motion too: the tile under the finger still answers it (an opacity
    // dip), only the light and the lean stay off.
    const track = Gesture.Manual()
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (!t) return;
        tx.value = t.x;
        ty.value = t.y;
        under.value = hitTest(rects, t.x, t.y);
        held.value = withTiming(1, { duration: SPOT.inMs, easing: EASE });
      })
      .onTouchesMove((e) => {
        const t = e.allTouches[0];
        if (!t) return;
        tx.value = t.x;
        ty.value = t.y;
        const i = hitTest(rects, t.x, t.y);
        if (i !== under.value) under.value = i;
      })
      .onTouchesUp(() => release())
      .onTouchesCancelled(() => release())
      .onFinalize(() => release());
    const tap = Gesture.Tap()
      .maxDuration(600)
      .onEnd((e, ok) => {
        if (ok) runOnJS(press)(hitTest(rects, e.x, e.y));
      });
    return Gesture.Simultaneous(track, tap);
  }, [live, rects, tx, ty, held, under, press]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[{ width, height }, style]}>
        {items.map((item, i) => {
          const r = rects[i];
          if (!r) return null;
          return (
            <BentoTile
              key={item.key}
              index={i}
              rect={r}
              item={item}
              tx={tx}
              ty={ty}
              held={held}
              under={under}
              live={live}
              spotlight={spotlight}
              radius={spotlightRadius}
              strength={strength}
              tilt={tilt}
              magnetism={magnetism}
              level={level}
              padding={padding}
              onActivate={item.onPress ? () => press(i) : undefined}
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

function BentoTile({
  index,
  rect,
  item,
  tx,
  ty,
  held,
  under,
  live,
  spotlight,
  radius,
  strength,
  tilt,
  magnetism,
  level,
  padding,
  onActivate,
}: {
  index: number;
  rect: Rect;
  item: BentoItem;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  held: SharedValue<number>;
  under: SharedValue<number>;
  live: boolean;
  spotlight: boolean;
  radius: number;
  strength: number;
  tilt: boolean;
  magnetism: boolean;
  level: SurfaceLevel;
  padding: number;
  onActivate?: () => void;
}) {
  const c = useColors();
  const scheme = useScheme();
  const tone = useMemo(() => hueOf(item.hue ?? 'amber', scheme), [item.hue, scheme]);

  // The shared light, seen from this tile: the finger in its own coordinates, and how near.
  const ox = useDerivedValue(() => tx.value - rect.x);
  const oy = useDerivedValue(() => ty.value - rect.y);
  const lit = useDerivedValue(() => held.value * bentoGlow(tx.value, ty.value, rect, radius) * strength);

  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const mx = useSharedValue(0);
  const my = useSharedValue(0);
  const pressed = useSharedValue(0);
  const aimed = useSharedValue(0);

  useAnimatedReaction(
    () => ({ on: under.value === index && held.value > 0, x: tx.value, y: ty.value }),
    (now) => {
      if (now.on) {
        aimed.value = 1;
        const lx = now.x - rect.x;
        const ly = now.y - rect.y;
        if (tilt && live) {
          const t = tiltAt(lx, ly, rect.w, rect.h, BENTO.tiltDeg);
          rx.value = withSpring(t.rotateX, SNAP);
          ry.value = withSpring(t.rotateY, SNAP);
        }
        if (magnetism && live) {
          const m = magnetOffset(now.x, now.y, rect);
          mx.value = withSpring(m.x, SNAP);
          my.value = withSpring(m.y, SNAP);
        }
        if (pressed.value < 1) pressed.value = withTiming(1, { duration: T.press, easing: EASE });
        return;
      }
      if (aimed.value === 0) return;
      aimed.value = 0;
      rx.value = withSpring(0, SNAP);
      ry.value = withSpring(0, SNAP);
      mx.value = withSpring(0, SNAP);
      my.value = withSpring(0, SNAP);
      pressed.value = withTiming(0, { duration: exitMs(T.press), easing: EASE });
    },
    [index, rect, tilt, magnetism, live],
  );

  const lean = useAnimatedStyle(() => ({
    opacity: live ? 1 : 1 - 0.3 * pressed.value,
    transform: [
      { perspective: 1000 },
      { translateX: mx.value },
      { translateY: my.value },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
      { scale: live ? 1 - (1 - PRESS_SCALE) * pressed.value : 1 },
    ],
  }));

  const r = SHAPE.container;
  return (
    <Animated.View
      accessible={onActivate !== undefined || item.accessibilityLabel !== undefined}
      accessibilityRole={onActivate ? 'button' : undefined}
      accessibilityLabel={item.accessibilityLabel}
      onAccessibilityTap={onActivate}
      style={[{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }, lean]}
    >
      <View
        style={{
          width: rect.w,
          height: rect.h,
          backgroundColor: c[level],
          borderRadius: r,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: c.border,
          overflow: 'hidden',
          padding,
        }}
      >
        {live && spotlight ? (
          <SpotlightLayer width={rect.w} height={rect.h} hue={tone} originX={ox} originY={oy} strength={lit} radius={radius} style={{ left: -1, top: -1 }} />
        ) : null}
        {item.children}
      </View>
    </Animated.View>
  );
}
