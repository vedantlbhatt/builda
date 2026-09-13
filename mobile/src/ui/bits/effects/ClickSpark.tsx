/**
 * ClickSpark: a burst of sparks from the point a finger lifted, in the pressed thing's hue.
 * For commitments only (DESIGN-V2 3 rule 4): "That's me", pairing success, Export, Share, and
 * a commit landing while you watch. Never on Continue, which would fire four times a flow.
 *
 *   <ClickSpark>
 *     <Button label="Share" haptic="commit" onPress={share} />
 *   </ClickSpark>
 *   <ClickSpark hue={cardHue(id, archetype)} playKey={revealCount}>{card}</ClickSpark>
 *   <SparkBurst x={commitX} y={stripMid} hue={creatureHue(crew)} playKey={commits} />
 *
 * Ported from react-bits `Animations/ClickSpark/ClickSpark.tsx` by David Haz.
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
 * What changed in the port: the original runs a 2D canvas `requestAnimationFrame` loop for
 * its whole life and sparks on every click. Here one shared progress value drives one Skia
 * path on the UI thread for 400ms and nothing draws otherwise; the canvas mounts on the
 * first touch, not before. The press is watched, never taken (`useTouchObserver`): the
 * wrapped Button keeps its own press and haptic, and a drag or a scroll that starts on it does
 * not spark. The geometry and the arithmetic are in `spark.ts`; the numbers are in `spec.ts`.
 *
 * Reduce Motion: no sparks at all (DESIGN-V2 3 rule 9). The action it decorates already has
 * its haptic, and a spark never adds one of its own (rule 10).
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { ReduceMotion, runOnJS, runOnUI, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { EASE, useReduceMotion } from '../../motion';
import { useScheme } from '../../scheme';
import { inkOf, type HueProp } from './hue';
import { useTouchObserver } from './runtime';
import { inBox, isTap, sparkPixel, sparkReach, sparkSegment, sparkVisible, type SparkShape, type SparkVariant } from './spark';
import { EFFECTS } from './spec';

const S = EFFECTS.spark;

export interface SparkOptions {
  /** The hue of the thing pressed. Default amber, the action colour. */
  hue?: HueProp;
  /** `ray`: the original's shrinking segments at the grain's weight (default). `pixel`: squares of the grain. */
  variant?: SparkVariant;
  /** Sparks in a burst. Default 8. */
  count?: number;
  /** Ray stroke, or a pixel spark's side, in points. Default 3 (the dither cell). */
  size?: number;
  /** A ray's length at launch, in points. Default 9. */
  length?: number;
  /** How far the sparks fly, in points. Default 24. */
  radius?: number;
  /** react-bits `extraScale`: multiplies the flight. Default 1. */
  extraScale?: number;
  /** One burst, in ms. Default 400, on the kit's `EASE`. */
  duration?: number;
}

export interface ClickSparkProps extends SparkOptions {
  children?: ReactNode;
  /** Spark when the wrapped element is pressed. Default true; false leaves `playKey` and the ref. */
  sparkOnPress?: boolean;
  disabled?: boolean;
  /**
   * Changing this sparks once with no touch (a card revealed, a commit landing), at `at` in the
   * element's points, or its centre. The value it mounts with does not spark.
   */
  playKey?: number | string;
  at?: { x: number; y: number };
  style?: StyleProp<ViewStyle>;
}

export interface ClickSparkHandle {
  /** One burst at (`x`, `y`) in the element's points, or at its centre. */
  spark(x?: number, y?: number): void;
}

interface Burst {
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  progress: SharedValue<number>;
  reduced: SharedValue<boolean>;
}

/** The burst's state on the UI thread, and the worklet that starts one. */
function useBurst(duration: number, reduced: boolean) {
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const progress = useSharedValue(0);
  const reducedSV = useSharedValue(reduced);
  useEffect(() => {
    reducedSV.value = reduced;
  }, [reduced, reducedSV]);
  const fire = useCallback(
    (x: number, y: number) => {
      'worklet';
      if (reducedSV.value) return;
      ox.value = x;
      oy.value = y;
      progress.value = 0;
      // Never: Reduce Motion is handled above from the live setting.
      progress.value = withTiming(1, { duration, easing: EASE, reduceMotion: ReduceMotion.Never });
    },
    [duration, ox, oy, progress, reducedSV],
  );
  const burst: Burst = { ox, oy, progress, reduced: reducedSV };
  return { burst, fire };
}

/** The canvas a burst draws on: `reach` points of margin round a `width` by `height` box. */
function SparkCanvas({
  burst,
  shape,
  variant,
  color,
  width,
  height,
  reach,
}: {
  burst: Burst;
  shape: SparkShape;
  variant: SparkVariant;
  color: string;
  width: number;
  height: number;
  reach: number;
}) {
  const { ox, oy, progress } = burst;
  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const e = progress.value;
    if (!sparkVisible(e)) return p;
    const cx = ox.value + reach;
    const cy = oy.value + reach;
    for (let i = 0; i < shape.count; i++) {
      if (variant === 'pixel') {
        const q = sparkPixel(i, e, shape);
        const side = q[2];
        if (side > 0) p.addRect(Skia.XYWHRect(cx + q[0] - side / 2, cy + q[1] - side / 2, side, side));
      } else {
        const s = sparkSegment(i, e, shape);
        p.moveTo(cx + s[0], cy + s[1]);
        p.lineTo(cx + s[2], cy + s[3]);
      }
    }
    return p;
  });
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: -reach, top: -reach, width: width + 2 * reach, height: height + 2 * reach }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Path
          path={path}
          color={color}
          style={variant === 'pixel' ? 'fill' : 'stroke'}
          strokeWidth={shape.sizePt}
          strokeCap="butt"
        />
      </Canvas>
    </View>
  );
}

function useShape(o: SparkOptions): SparkShape {
  const count = o.count ?? S.count;
  const sizePt = o.size ?? S.sizePt;
  const lengthPt = o.length ?? S.lengthPt;
  const radiusPt = o.radius ?? S.radiusPt;
  const extraScale = o.extraScale ?? 1;
  return useMemo(() => ({ count, sizePt, lengthPt, radiusPt, extraScale }), [count, sizePt, lengthPt, radiusPt, extraScale]);
}

/**
 * Sparks from the point a finger lifted off the wrapped element, if it was a press (it
 * stayed within 10pt and was not taken by a scroll). The sparks fly past the element's edge,
 * so give it room: a parent that clips (`overflow: 'hidden'`, a `Surface`) cuts them.
 */
export const ClickSpark = forwardRef<ClickSparkHandle, ClickSparkProps>(function ClickSpark(props, ref) {
  const { children, variant = 'ray', sparkOnPress = true, disabled = false, playKey, at, style, hue } = props;
  const duration = props.duration ?? S.ms;
  const reduced = useReduceMotion();
  const scheme = useScheme();
  const color = inkOf(hue, scheme);
  const shape = useShape(props);
  const reach = sparkReach(shape);
  const { burst, fire } = useBurst(duration, reduced);

  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // The canvas mounts on the first touch (or at once, for a caller that sparks by key).
  const [armed, setArmed] = useState(playKey !== undefined);
  const armedSV = useSharedValue(playKey !== undefined);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const down = useSharedValue(false);
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const slop = EFFECTS.tapSlopPt;

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      w.value = width;
      h.value = height;
      setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
    },
    [w, h],
  );

  const gesture = useTouchObserver(
    {
      onDown: (x, y) => {
        'worklet';
        down.value = true;
        downX.value = x;
        downY.value = y;
        if (!armedSV.value) {
          armedSV.value = true;
          runOnJS(setArmed)(true);
        }
      },
      onUp: (x, y) => {
        'worklet';
        if (!down.value) return;
        down.value = false;
        if (isTap(downX.value, downY.value, x, y, slop) && inBox(x, y, w.value, h.value, slop)) fire(x, y);
      },
      onCancel: () => {
        'worklet';
        down.value = false;
      },
    },
    sparkOnPress && !disabled && !reduced,
    [fire, slop],
  );

  const sparkAt = useCallback(
    (x?: number, y?: number) => {
      if (reduced || disabled) return;
      const go = () => runOnUI(fire)(x ?? (box?.w ?? 0) / 2, y ?? (box?.h ?? 0) / 2);
      if (armedSV.value) {
        go();
      } else {
        armedSV.value = true;
        setArmed(true);
        // Once the canvas has mounted, so the first frame of the burst is drawn.
        requestAnimationFrame(go);
      }
    },
    [armedSV, box, disabled, fire, reduced],
  );
  useImperativeHandle(ref, () => ({ spark: sparkAt }), [sparkAt]);

  const mountedKey = useRef(playKey);
  useEffect(() => {
    if (playKey === undefined || playKey === mountedKey.current) return;
    mountedKey.current = playKey;
    sparkAt(at?.x, at?.y);
    // `at` is read when the key changes; a new `at` alone does not spark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} onLayout={onLayout} style={style}>
        {children}
        {armed && box && !reduced ? (
          <SparkCanvas burst={burst} shape={shape} variant={variant} color={color} width={box.w} height={box.h} reach={reach} />
        ) : null}
      </View>
    </GestureDetector>
  );
});

export interface SparkBurstProps extends SparkOptions {
  /** The burst's centre, in the parent's points. */
  x: number;
  y: number;
  /** Changing this plays one burst. The value it mounts with does not. */
  playKey: number | string;
}

/**
 * One burst at a point with no element under it: a commit landing on the running session's
 * strip (DESIGN-V2 3.2, session detail), in the session's hue. Absolutely positioned; put it
 * in the view whose points `x` and `y` are in. Draws nothing between bursts.
 */
export function SparkBurst({ x, y, playKey, variant = 'ray', hue, ...options }: SparkBurstProps) {
  const duration = options.duration ?? S.ms;
  const reduced = useReduceMotion();
  const scheme = useScheme();
  const color = inkOf(hue, scheme);
  const shape = useShape(options);
  const reach = sparkReach(shape);
  const { burst, fire } = useBurst(duration, reduced);
  const mountedKey = useRef(playKey);
  useEffect(() => {
    if (playKey === mountedKey.current) return;
    mountedKey.current = playKey;
    if (!reduced) runOnUI(fire)(0, 0);
  }, [playKey, fire, reduced]);
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: 0, height: 0 }}>
      <SparkCanvas burst={burst} shape={shape} variant={variant} color={color} width={0} height={0} reach={reach} />
    </View>
  );
}
