/**
 * The page's round and traced marks, drawn with Skia from the block's clock: the day clock, the
 * cost donut, the two test rings and the before and now slopes. Arcs sweep from 12 o'clock,
 * lines trace from their first point to their last (a path's `end` going 0 to 1), and then they
 * stand still. Nothing here invents a point the data does not carry: the clock marks the two
 * hours it was sent, a slope has two ends because a trend has two windows.
 */
import { Canvas, Circle, createPicture, Group, Line, Path, PaintStyle, Picture, Skia, StrokeCap, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { DRAW_MS, ease, phase, spring } from './motion';
import { GROUND } from './palette';
import { useClock } from './reveal';

const DEG = Math.PI / 180;

/** Clockwise degrees from 12 o'clock, as Skia's arc angles (which start at 3 o'clock). */
function skiaAngle(fromTop: number): number {
  'worklet';
  return fromTop - 90;
}

// ------------------------------------------------------------------ the day clock

export interface DayClockProps {
  size: number;
  /** 0 to 23, or null when the server sent none. */
  peakHour: number | null;
  /** Whether to draw the 10pm to 4am window (only when a night share was sent). */
  night: boolean;
  ink: string;
  partner: string;
  delay?: number;
}

/**
 * A 24 hour dial, midnight at the top, like the sleep clock people already read. The night
 * window (22:00 to 04:00, the rule `night_share` counts over) sweeps in as an arc, the peak hour
 * as a brighter wedge, and a hand swings from midnight round to it.
 */
export function DayClock({ size, peakHour, night, ink, partner, delay = 0 }: DayClockProps) {
  const clock = useClock();
  const c = size / 2;
  const outer = c - 30;
  const band = outer - 20;
  const faint = GROUND.faint;
  const text = GROUND.text;

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        const p = Skia.Paint();
        p.setAntiAlias(true);
        p.setStyle(PaintStyle.Stroke);
        p.setStrokeCap(StrokeCap.Butt);
        // The hour ticks come in round the dial.
        const ticks = ease(phase(t, delay, 700));
        p.setColor(Skia.Color(faint));
        for (let h = 0; h < 24; h++) {
          if (h / 24 > ticks) break;
          const a = (h * 15 - 90) * DEG;
          const long = h % 6 === 0;
          p.setStrokeWidth(long ? 2 : 1);
          const r0 = outer - (long ? 9 : 5);
          canvas.drawLine(c + Math.cos(a) * r0, c + Math.sin(a) * r0, c + Math.cos(a) * outer, c + Math.sin(a) * outer, p);
        }
        const oval = Skia.XYWHRect(c - band, c - band, band * 2, band * 2);
        // The track.
        p.setColor(Skia.Color(GROUND.border));
        p.setStrokeWidth(12);
        canvas.drawArc(oval, 0, 360 * ticks, false, p);
        if (night) {
          const s = ease(phase(t, delay + 250, 800));
          if (s > 0) {
            p.setColor(Skia.Color(partner));
            p.setStrokeWidth(12);
            canvas.drawArc(oval, skiaAngle(22 * 15), 90 * s, false, p);
          }
        }
        if (peakHour !== null) {
          const swing = ease(phase(t, delay + 350, 950));
          const target = (peakHour + 0.5) * 15;
          const at = target * swing;
          if (swing > 0.98) {
            p.setColor(Skia.Color(ink));
            p.setStrokeWidth(20);
            const w = spring(phase(t, delay + 1250, 500));
            canvas.drawArc(oval, skiaAngle(peakHour * 15 + 7.5 - 7.5 * w), 15 * w, false, p);
          }
          if (swing > 0) {
            const a = (at - 90) * DEG;
            p.setColor(Skia.Color(text));
            p.setStrokeWidth(2.5);
            p.setStrokeCap(StrokeCap.Round);
            canvas.drawLine(c, c, c + Math.cos(a) * (band - 18), c + Math.sin(a) * (band - 18), p);
            const dot = Skia.Paint();
            dot.setAntiAlias(true);
            dot.setColor(Skia.Color(text));
            canvas.drawCircle(c, c, 4, dot);
          }
        }
      },
      { width: size, height: size },
    );
  }, [size, peakHour, night, ink, partner, delay]);

  const label = (s: string, x: number, y: number) => (
    <Text key={s} allowFontScaling={false} style={[styles.dialLabel, { left: x - 22, top: y - 7 }]}>
      {s}
    </Text>
  );

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
      {label('12am', c, 12)}
      {label('6am', size - 14, c)}
      {label('12pm', c, size - 12)}
      {label('6pm', 14, c)}
    </View>
  );
}

// ------------------------------------------------------------------ the donut

export interface Slice {
  key: string;
  value: number;
  color: string;
}

/** Parts of a whole round a ring, sweeping from 12 o'clock in order, a small gap between. */
export function Donut({ slices, size, stroke = 22, delay = 0 }: { slices: readonly Slice[]; size: number; stroke?: number; delay?: number }) {
  const clock = useClock();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const parts = useMemo(() => {
    let at = 0;
    return slices
      .filter((s) => s.value > 0)
      .map((s) => {
        const sweep = total > 0 ? (s.value / total) * 360 : 0;
        const part = { color: s.color, start: at, sweep };
        at += sweep;
        return part;
      });
  }, [slices, total]);
  const r = (size - stroke) / 2;
  const gap = parts.length > 1 ? 1.6 : 0;

  const picture = useDerivedValue(() => {
    const p = ease(phase(clock.value, delay, 1100));
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(stroke);
        const oval = Skia.XYWHRect(stroke / 2, stroke / 2, r * 2, r * 2);
        paint.setColor(Skia.Color(GROUND.border));
        canvas.drawArc(oval, 0, 360, false, paint);
        const reach = 360 * p;
        for (let i = 0; i < parts.length; i++) {
          const s = parts[i]!;
          if (reach <= s.start) break;
          const drawn = Math.min(s.sweep, reach - s.start) - gap;
          if (drawn <= 0.1) continue;
          paint.setColor(Skia.Color(s.color));
          canvas.drawArc(oval, skiaAngle(s.start + gap / 2), drawn, false, paint);
        }
      },
      { width: size, height: size },
    );
  }, [parts, size, stroke, r, gap, delay]);

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

// ------------------------------------------------------------------ rings

/**
 * Test runs as one ring: green for runs that were already green, red for runs an error followed,
 * in that order from 12 o'clock. Two data hues, and nothing else coloured.
 */
export function PassRing({ passed, failed, size, stroke = 16, pass, fail, delay = 0 }: { passed: number; failed: number; size: number; stroke?: number; pass: string; fail: string; delay?: number }) {
  const clock = useClock();
  const total = passed + failed;
  const r = (size - stroke) / 2;
  const picture = useDerivedValue(() => {
    const p = ease(phase(clock.value, delay, 1100));
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(stroke);
        const oval = Skia.XYWHRect(stroke / 2, stroke / 2, r * 2, r * 2);
        paint.setColor(Skia.Color(GROUND.border));
        canvas.drawArc(oval, 0, 360, false, paint);
        if (total <= 0) return;
        const green = (passed / total) * 360;
        const reach = 360 * p;
        const g = Math.min(green, reach);
        const gap = failed > 0 && passed > 0 ? 1.6 : 0;
        if (g - gap > 0) {
          paint.setColor(Skia.Color(pass));
          canvas.drawArc(oval, skiaAngle(gap / 2), g - gap, false, paint);
        }
        if (reach > green && failed > 0) {
          paint.setColor(Skia.Color(fail));
          const rd = Math.min(360 - green, reach - green) - gap;
          if (rd > 0) canvas.drawArc(oval, skiaAngle(green + gap / 2), rd, false, paint);
        }
      },
      { width: size, height: size },
    );
  }, [passed, failed, total, size, stroke, r, pass, fail, delay]);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

/**
 * A stopwatch: the ring is one minute, or one hour, or one day, whichever is the smallest that
 * holds the value, with its ticks, and the arc sweeps to the value like a second hand.
 */
export function StopwatchRing({ seconds, dial, size, ink, delay = 0 }: { seconds: number; dial: 'minute' | 'hour' | 'day'; size: number; ink: string; delay?: number }) {
  const clock = useClock();
  const span = dial === 'minute' ? 60 : dial === 'hour' ? 3600 : 86400;
  const ticks = dial === 'day' ? 24 : 12;
  const frac = Math.min(1, Math.max(0, seconds / span));
  const stroke = 10;
  const r = (size - stroke) / 2 - 8;
  const c = size / 2;
  const picture = useDerivedValue(() => {
    const t = clock.value;
    const p = ease(phase(t, delay, 1000));
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(PaintStyle.Stroke);
        paint.setColor(Skia.Color(GROUND.faint));
        paint.setStrokeWidth(1.5);
        for (let i = 0; i < ticks; i++) {
          const a = ((i * 360) / ticks - 90) * DEG;
          canvas.drawLine(c + Math.cos(a) * (r + 8), c + Math.sin(a) * (r + 8), c + Math.cos(a) * (r + 12), c + Math.sin(a) * (r + 12), paint);
        }
        const oval = Skia.XYWHRect(c - r, c - r, r * 2, r * 2);
        paint.setColor(Skia.Color(GROUND.border));
        paint.setStrokeWidth(stroke);
        canvas.drawArc(oval, 0, 360, false, paint);
        if (frac > 0 && p > 0) {
          paint.setColor(Skia.Color(ink));
          paint.setStrokeCap(StrokeCap.Round);
          canvas.drawArc(oval, -90, Math.max(0.5, 360 * frac * p), false, paint);
        }
      },
      { width: size, height: size },
    );
  }, [frac, ticks, size, r, c, ink, delay]);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

// ------------------------------------------------------------------ before and now

/**
 * A trend as a slope: before on the left, now on the right, both measured from zero so a small
 * move looks small. The line traces from before to now; the now point arrives when it does.
 */
export function Slope({ before, now, width, height, ink, delay = 0 }: { before: number; now: number; width: number; height: number; ink: string; delay?: number }) {
  const clock = useClock();
  const top = Math.max(before, now, 1e-9);
  const pad = 6;
  const y = (v: number) => height - pad - (Math.max(0, v) / top) * (height - pad * 2);
  const x0 = pad;
  const x1 = width - pad;
  const y0 = y(before);
  const y1 = y(now);
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
    return p;
  }, [x0, y0, x1, y1]);
  const end = useDerivedValue(() => ease(phase(clock.value, delay, DRAW_MS)));
  const nowR = useDerivedValue(() => 4.5 * spring(phase(clock.value, delay + DRAW_MS * 0.8, 500)));
  const beforeR = useDerivedValue(() => 3.5 * ease(phase(clock.value, delay, 250)));
  return (
    <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width, height }}>
        <Line p1={vec(0, height - pad)} p2={vec(width, height - pad)} color={GROUND.border} strokeWidth={1} />
        <Group>
          <Path path={path} style="stroke" strokeWidth={2.5} strokeCap="round" color={ink} start={0} end={end} />
          <Circle cx={x0} cy={y0} r={beforeR} color={GROUND.dim} />
          <Circle cx={x1} cy={y1} r={nowR} color={ink} />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  dialLabel: {
    position: 'absolute',
    width: 44,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: GROUND.faint,
    fontVariant: ['tabular-nums'],
  },
});
