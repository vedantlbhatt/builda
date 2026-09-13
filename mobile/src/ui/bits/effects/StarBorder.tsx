/**
 * StarBorder: a comet that runs the edge of the one tile that needs you, three laps, then
 * the edge stays lit (DESIGN-V2 3.2, "the top needs you tile"). One on screen at a time: a
 * second StarBorder waits with the still outline until the first leaves.
 *
 *   <StarBorder radius={SHAPE.container} playKey={needsYouSince}>
 *     <MissionTile ... />
 *   </StarBorder>
 *
 * Ported from react-bits `Animations/StarBorder/StarBorder.tsx` (and its CSS) by David Haz.
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
 * What changed in the port: the original's two radial gradient glows sliding forever along
 * the top and bottom become one comet on the tile's own continuous corner outline, walked by
 * trimming a two lap path (so it crosses the start in one piece), 6s a lap as the original's
 * `speed`, three laps, then a still 1.5pt outline. The head is solid; the tail thins in three
 * flat steps, each a dash of stroke-sized cells, so it fades by cells and never by opacity
 * (a hue at partial opacity over the warm ground is brown). No gradient, no blur. The
 * geometry is in `comet.ts`, the numbers in `spec.ts`.
 *
 * Paused (the screen is not focused, the app is in the background, or `paused`): the comet
 * holds where it is and picks up from there. Reduce Motion: the still outline from the start.
 */
import { Canvas, DashPathEffect, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, ReduceMotion, cancelAnimation, runOnJS, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { useReduceMotion } from '../../motion';
import { useScheme } from '../../scheme';
import { SHAPE } from '../../shape';
import { cometPart, cometStage, newStageId, strokeOutline, tailDash, type PathCmd } from './comet';
import { inkOf, type HueProp } from './hue';
import { useEffectActive } from './runtime';
import { EFFECTS } from './spec';

const C = EFFECTS.comet;

export interface StarBorderProps {
  children?: ReactNode;
  /** The wrapped tile's corner radius, so the comet sits on its edge. Default 18 (a container). */
  radius?: number;
  /** Default amber: on a live surface amber means "needs you" and nothing else. */
  hue?: HueProp;
  /** Stroke in points. Default 1.5. */
  thickness?: number;
  /** false draws the still outline and no comet. Default true. */
  active?: boolean;
  /** Changing this runs the three laps again (the tile needs you again, for something new). */
  playKey?: number | string;
  /** Laps before the edge settles. Default 3. */
  laps?: number;
  /** One lap, in ms. Default 6000 (react-bits `speed`). */
  lapMs?: number;
  /** The comet's length, as a share of the perimeter. Default 0.24. */
  length?: number;
  /** Tail steps behind the solid head: each one's share of cells inked. Default 0.75, 0.5, 0.25. */
  tail?: readonly number[];
  /** Hold the comet where it is: the tile is off screen or scrolled away. */
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
}

function toSkPath(cmds: readonly PathCmd[]): SkPath {
  const p = Skia.Path.Make();
  for (const c of cmds) {
    if (c[0] === 'M') p.moveTo(c[1], c[2]);
    else if (c[0] === 'L') p.lineTo(c[1], c[2]);
    else if (c[0] === 'C') p.cubicTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else p.close();
  }
  return p;
}

export function StarBorder({
  children,
  radius = SHAPE.container,
  hue,
  thickness = C.strokePt,
  active = true,
  playKey,
  laps = C.laps,
  lapMs = C.lapMs,
  length = C.length,
  tail = C.tail,
  paused = false,
  style,
}: StarBorderProps) {
  const reduced = useReduceMotion();
  const scheme = useScheme();
  const color = inkOf(hue, scheme);
  const onScreen = useEffectActive(paused);

  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  // The run: laps still to go. A new playKey starts a fresh one, even mid run (`run` is in
  // the walk's deps, so a restart is a new timing and not a cancelled one).
  const [running, setRunning] = useState(true);
  const [run, setRun] = useState(0);
  const head = useSharedValue(0);
  const lastKey = useRef(playKey);
  useEffect(() => {
    if (playKey === lastKey.current) return;
    lastKey.current = playKey;
    cancelAnimation(head);
    head.value = 0;
    setRunning(true);
    setRun((r) => r + 1);
  }, [playKey, head]);

  // One comet on screen: claim the stage while this one wants to run.
  const id = useRef(0);
  if (id.current === 0) id.current = newStageId();
  const wantsStage = active && running && !reduced;
  useEffect(() => {
    if (!wantsStage) return;
    const me = id.current;
    cometStage.claim(me);
    return () => cometStage.release(me);
  }, [wantsStage]);
  const owns = useSyncExternalStore(
    cometStage.subscribe,
    () => cometStage.owner() === id.current,
    () => false,
  );

  const runs = wantsStage && owns && box !== null;
  const moving = runs && onScreen;
  useEffect(() => {
    if (!moving) {
      cancelAnimation(head);
      return;
    }
    const left = Math.max(0, laps - head.value);
    if (left <= 0) {
      setRunning(false);
      return;
    }
    head.value = withTiming(
      laps,
      // Linear: a comet keeps its pace round the corners. Never: Reduce Motion never gets here.
      { duration: left * lapMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never },
      (finished) => {
        if (finished) runOnJS(setRunning)(false);
      },
    );
  }, [moving, run, laps, lapMs, head]);

  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  const outline = useMemo(() => toSkPath(strokeOutline(w, h, radius, thickness, 1)), [w, h, radius, thickness]);
  const track = useMemo(() => toSkPath(strokeOutline(w, h, radius, thickness, 2)), [w, h, radius, thickness]);
  const pieces = tail.length + 1;

  return (
    <View style={style} onLayout={onLayout}>
      {children}
      {box ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            {runs ? (
              Array.from({ length: pieces }, (_, k) => (
                <CometPiece
                  key={k}
                  track={track}
                  head={head}
                  length={length}
                  pieces={pieces}
                  k={k}
                  density={k === 0 ? 1 : (tail[k - 1] ?? 1)}
                  color={color}
                  thickness={thickness}
                />
              ))
            ) : (
              <Path path={outline} style="stroke" strokeWidth={thickness} color={color} />
            )}
          </Canvas>
        </View>
      ) : null}
    </View>
  );
}

function CometPiece({
  track,
  head,
  length,
  pieces,
  k,
  density,
  color,
  thickness,
}: {
  track: SkPath;
  head: SharedValue<number>;
  length: number;
  pieces: number;
  k: number;
  density: number;
  color: string;
  thickness: number;
}) {
  const start = useDerivedValue(() => cometPart(head.value, length, pieces, k)[0]);
  const end = useDerivedValue(() => cometPart(head.value, length, pieces, k)[1]);
  const dash = tailDash(density, thickness);
  return (
    <Path path={track} start={start} end={end} style="stroke" strokeWidth={thickness} strokeCap="butt" color={color}>
      {dash ? <DashPathEffect intervals={dash} /> : null}
    </Path>
  );
}
