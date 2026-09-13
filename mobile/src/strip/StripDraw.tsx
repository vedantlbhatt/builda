/**
 * The session strip, drawn on: the floor traces from the left like a route being drawn, each bar
 * rises out of it as the trace passes (a damped spring, a hair of give), your prompts and commits
 * drop into their lane just behind the front, and then it is still. The same rectangles as the
 * still strip (`layout.ts`), so the drawing and the card can never disagree about the shape.
 *
 * Borrowed, concretely:
 *   - Strava's activity page leads with the route, and the route is a line that is drawn
 *     (design-refs/awesome-ios-design-md/design-md/fitness/strava: the polyline is the headline
 *     of every screen). A session's route is its strip, so it is traced left to right.
 *   - Appllama's 25 loaders, `braille-flipwave`: its cells arrive on a wave whose delays are
 *     "deliberately irregular so the final seat feels made". Each bar here arrives when the
 *     trace reaches it, plus a stable hash of up to 90 ms, so the strip reads printed rather than
 *     wiped. Pattern and numbers only: that repository is GPL and no code came from it.
 *
 * One Skia picture recorded on the UI thread from one clock (the page's block clock, or the row's
 * own), so a strip of a few hundred bars costs one derived value and records nothing once still.
 * Every function the worklet calls is a worklet (`ease`, `phase`, `spring`); the jitter is
 * computed on the JS side, once, into the plan.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';

import { ease, phase, spring } from '../insights/motion';
import { cellHash } from '../insights/Pixels';
import { type Scheme } from '../theme';
import { type Mark } from './decode';
import { CORNER, layoutStrip } from './layout';

/** How long one bar takes to rise. */
const GROW_MS = 420;
/** The most a bar's arrival is shifted off the trace (the flipwave's irregular seat). */
const JITTER_MS = 90;
/** How far behind the trace your marks land. */
const MARK_LAG_MS = 140;
const MARK_MS = 260;

export interface StripDrawProps {
  cols: string;
  marks?: readonly Mark[];
  spanMs?: number;
  preset: 'mini' | 'hero';
  width: number;
  /** The clock this strip reads, in ms: a page block's (`useClock`) or its own (`useOwnClock`). */
  clock: SharedValue<number>;
  /** When the trace starts on that clock. */
  delay?: number;
  /** How long the trace takes to cross. */
  sweepMs?: number;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
}

/** When a strip with these timings is still, on its clock. */
export function stripDoneAt(delay: number, sweepMs: number): number {
  return delay + sweepMs + JITTER_MS + MARK_LAG_MS + GROW_MS + 60;
}

interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
  at: number;
}

export function StripDraw({ cols, marks = [], spanMs = 0, preset, width, clock, delay = 0, sweepMs = 900, scheme = 'dark', style }: StripDrawProps) {
  const layout = useMemo(() => layoutStrip(cols, marks, spanMs, preset, scheme, width), [cols, marks, spanMs, preset, scheme, width]);
  const height = layout.height;

  const plan = useMemo(() => {
    const across = Math.max(1, width);
    const bars: Bar[] = layout.rects.map((r, i) => ({
      x: r.x,
      y: r.y,
      w: r.w + 0.5,
      h: r.h,
      color: r.fill,
      alpha: r.opacity,
      at: delay + (r.x / across) * sweepMs + cellHash(i, 3, 17) * JITTER_MS,
    }));
    const ticks: Bar[] = layout.marks.map((m, i) => ({
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      color: m.fill,
      alpha: 1,
      at: delay + (m.x / across) * sweepMs + MARK_LAG_MS + cellHash(i, 5, 23) * 60,
    }));
    const f = layout.floor;
    const floor = f ? { y: f.y, h: f.h, color: f.fill } : null;
    return { bars, ticks, floor };
  }, [layout, delay, sweepMs, width]);

  const picture = useDerivedValue(() => {
    const t = clock.value;
    const { bars, ticks, floor } = plan;
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        if (floor) {
          const f = ease(phase(t, delay, sweepMs));
          if (f > 0) {
            paint.setColor(Skia.Color(floor.color));
            canvas.drawRect(Skia.XYWHRect(0, floor.y, width * f, floor.h), paint);
          }
        }
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i]!;
          const k = spring(phase(t, b.at, GROW_MS));
          if (k <= 0) continue;
          const h = b.h * k;
          paint.setColor(Skia.Color(b.color));
          paint.setAlphaf(b.alpha);
          canvas.drawRect(Skia.XYWHRect(b.x, b.y + b.h - h, b.w, h), paint);
        }
        for (let i = 0; i < ticks.length; i++) {
          const m = ticks[i]!;
          const k = ease(phase(t, m.at, MARK_MS));
          if (k <= 0) continue;
          paint.setColor(Skia.Color(m.color));
          paint.setAlphaf(1);
          canvas.drawRect(Skia.XYWHRect(m.x, m.y, m.w, m.h * k), paint);
        }
      },
      { width, height },
    );
  }, [plan, width, height, delay, sweepMs]);

  return (
    <View
      style={[{ width, height, borderRadius: CORNER[preset], borderCurve: 'continuous', overflow: 'hidden' }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={layout.label}
    >
      <Canvas style={{ width, height }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

/**
 * A clock of its own, for a strip outside a reveal page (a row in the Sessions list): runs from 0
 * to `endMs` once, on mount, when `run`; otherwise it is already at the end, so the strip is
 * drawn at rest and never plays (a row scrolled to long after the list arrived, Reduce Motion).
 */
export function useOwnClock(endMs: number, run: boolean): SharedValue<number> {
  const clock = useSharedValue(run ? 0 : endMs);
  useEffect(() => {
    if (!run) {
      clock.value = endMs;
      return;
    }
    clock.value = 0;
    clock.value = withDelay(40, withTiming(endMs, { duration: endMs, easing: Easing.linear }));
    // The resting state never depends on the timing finishing (the reveal clock's rule): a
    // timing cancelled under it, the app sent to the background mid trace, would leave a strip
    // half drawn. By this time it is at rest whatever happened.
    const land = setTimeout(() => {
      if (clock.value < endMs) clock.value = endMs;
    }, endMs + 400);
    return () => clearTimeout(land);
    // Once per mount: a re-render never starts the trace again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return clock;
}
