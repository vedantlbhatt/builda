/**
 * LogoLoop: a row of marks drifting sideways forever, and HarnessLoop, the seven harness
 * glyphs each in its own hue. A finger on the row slows it to a stop; letting go brings it
 * back. It is ambient motion, so DESIGN-V2 rule 2 applies to whoever places it: at most one
 * ambient motion per screen, never behind text being read, and never beside a field. It
 * pauses by itself when its screen is not focused or the app is in the background; pass
 * `paused` when it has scrolled away.
 *
 *   <HarnessLoop />
 *   <LogoLoop items={[{ key: 'a', node: <Mark />, label: 'A' }]} speed={24} />
 *
 * Ported from react-bits `Animations/LogoLoop/LogoLoop.tsx` (and its CSS) by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
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
 * What changed in the port: `requestAnimationFrame` writing `style.transform` becomes a
 * Reanimated frame callback on the UI thread, switched off (not idling) whenever the loop may
 * not run; hover becomes a finger (`pauseOnHover` is `pauseOnPress`, `hoverSpeed` is
 * `pressSpeed`); the track snaps to whole device pixels so pixel glyphs never shimmer;
 * horizontal only (a vertical marquee has no place on a phone screen); no edge fade (two
 * gradients) and no scale on hover. The numbers are the original's, and the speed is v2's
 * `AMBIENT` share of it (36pt/s). The arithmetic is in `marquee.ts`.
 *
 * Reduce Motion: the row stands still and wraps onto as many lines as it needs, so every
 * mark is whole and nothing is cut off at an edge.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PixelRatio, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { HarnessGlyph } from '../../../pixel/HarnessGlyph';
import { HARNESS_MARKS, snapGlyphSize, type GlyphSize } from '../../../pixel/harness';
import { harnessHue, space } from '../../../theme';
import { useReduceMotion } from '../../motion';
import { useScheme } from '../../scheme';
import { T } from '../../Text';
import { copiesNeeded, loopVelocity, snapToPixel, stepLoop, type LoopDirection } from './marquee';
import { useEffectActive, useTouchObserver } from './runtime';
import { EFFECTS } from './spec';

const L = EFFECTS.loop;

export interface LoopItem {
  key: string;
  node: ReactNode;
  /** What VoiceOver reads for this mark. The loop reads them all once, in order. */
  label?: string;
}

export interface LogoLoopProps {
  items: readonly LoopItem[];
  /** Points a second. Default 36. Negative runs the other way. */
  speed?: number;
  /** Default `left`: the row travels toward the left. */
  direction?: LoopDirection;
  /** Between marks, and after the last one, in points. Default 32. */
  gap?: number;
  /** The strip's height. Default the tallest mark's. */
  height?: number;
  /** A finger on the row slows it to `pressSpeed`. Default true. */
  pauseOnPress?: boolean;
  /** Default 0: a stop. */
  pressSpeed?: number;
  /** Hold the row where it is: it has scrolled away, or something else on screen is moving. */
  paused?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function LogoLoop({
  items,
  speed = L.speed,
  direction = 'left',
  gap = L.gapPt,
  height,
  pauseOnPress = true,
  pressSpeed = 0,
  paused = false,
  accessibilityLabel,
  style,
}: LogoLoopProps) {
  const reduced = useReduceMotion();
  const canRun = useEffectActive(paused) && !reduced;
  const ratio = PixelRatio.get();

  const [container, setContainer] = useState(0);
  const [sequence, setSequence] = useState(0);
  const seq = useSharedValue(0);
  const offset = useSharedValue(0);
  const velocity = useSharedValue(0);
  const held = useSharedValue(false);
  const target = loopVelocity(speed, direction);
  const targetSV = useSharedValue(target);
  const pressSV = useSharedValue(pressSpeed);
  useEffect(() => {
    targetSV.value = target;
    pressSV.value = pressSpeed;
  }, [target, pressSpeed, targetSV, pressSV]);

  const onContainer = useCallback((e: LayoutChangeEvent) => setContainer(e.nativeEvent.layout.width), []);
  const onSequence = useCallback(
    (e: LayoutChangeEvent) => {
      const w = Math.ceil(e.nativeEvent.layout.width);
      seq.value = w;
      setSequence(w);
    },
    [seq],
  );

  const tick = useFrameCallback((frame) => {
    'worklet';
    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    const goal = held.value ? pressSV.value : targetSV.value;
    const next = stepLoop(offset.value, velocity.value, goal, dt, L.smoothTau, seq.value);
    offset.value = next[0];
    velocity.value = next[1];
  }, false);

  const run = canRun && sequence > 0;
  useEffect(() => {
    tick.setActive(run);
  }, [run, tick]);

  const gesture = useTouchObserver(
    {
      onDown: () => {
        'worklet';
        held.value = true;
      },
      onUp: () => {
        'worklet';
        held.value = false;
      },
      onCancel: () => {
        'worklet';
        held.value = false;
      },
    },
    pauseOnPress && run,
    [],
  );

  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -snapToPixel(offset.value, ratio) }] }), [ratio]);

  const label = accessibilityLabel ?? items.map((i) => i.label).filter(Boolean).join(', ');
  const copies = copiesNeeded(container, sequence, L.minCopies, L.headroom);
  const row = useCallback(
    (copy: number) => (
      <View
        key={`copy-${copy}`}
        onLayout={copy === 0 ? onSequence : undefined}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {items.map((item) => (
          <View key={`${copy}-${item.key}`} style={{ marginRight: gap }}>
            {item.node}
          </View>
        ))}
      </View>
    ),
    [items, gap, onSequence],
  );

  if (reduced) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }, style]}>
        {items.map((item) => (
          <View key={item.key} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {item.node}
          </View>
        ))}
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        onLayout={onContainer}
        style={[{ overflow: 'hidden', height }, style]}
      >
        <Animated.View style={[{ flexDirection: 'row', alignSelf: 'flex-start' }, track]}>
          {Array.from({ length: copies }, (_, i) => row(i))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export interface HarnessLoopProps extends Omit<LogoLoopProps, 'items'> {
  /** 16, 32, 48 or 64pt: whole points per cell. Default 32. */
  size?: GlyphSize;
  /** Each glyph's name beside it, in `textDim`. Default false: the glyphs alone. */
  names?: boolean;
}

/**
 * The seven harness marks, each in its hue (`harnessHue`), drifting. The harness is the
 * object here, so each glyph wears its own colour (DESIGN-V2 2.4).
 */
export function HarnessLoop({ size = L.glyphPt as GlyphSize, names = false, ...rest }: HarnessLoopProps) {
  const scheme = useScheme();
  const pt = snapGlyphSize(size);
  const items = useMemo<LoopItem[]>(
    () =>
      HARNESS_MARKS.map((mark) => ({
        key: mark.id,
        label: mark.name,
        node: (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <HarnessGlyph harness={mark.harnesses[0]!} size={pt} color={harnessHue(mark.id, scheme)?.ink} />
            {names ? (
              <T role="row" tone="dim" numberOfLines={1}>
                {mark.name}
              </T>
            ) : null}
          </View>
        ),
      })),
    [pt, names, scheme],
  );
  return <LogoLoop items={items} height={pt} accessibilityLabel={rest.accessibilityLabel ?? HARNESS_MARKS.map((m) => m.name).join(', ')} {...rest} />;
}
