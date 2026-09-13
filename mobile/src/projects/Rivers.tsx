/**
 * PROJECT RIVERS: where the hours with you there went, week by week, as a streamgraph. Each
 * project is a river in its own hue (`model.projectHues`), as wide each week as its hours, the
 * widest in the middle and the rest stacked outside it (`geometry.streamLayout`, Byron and
 * Wattenberg's inside out silhouette). When the block arrives the rivers flow in from the left
 * edge, one after another, as if the week by week were being drawn, and then stand still.
 *
 * A tap on a river holds it: the others fall back to their partner tone (never the ink at a lower
 * opacity, which reads brown over the warm ground), a hairline marks the week under the finger,
 * and the line under the chart names the project and its hours that week. The scrub line and the
 * value following the finger are Robinhood's portfolio chart (design-md/finance/robinhood: "a thin
 * vertical line follows the finger ... the hero value updates to that point"), and the chart runs
 * edge to edge as theirs does ("Charts: full-bleed, extend to edges, no margin"). The legend rows
 * carry a small bar inline with their hours, Strava's splits table (design-md/fitness/strava:
 * "a tiny horizontal bar inline with the time, scaling proportionally"), and a row is also a way
 * to hold its river, for a finger or for VoiceOver.
 */
import { Canvas, ClipOp, createPicture, PaintStyle, Picture, Skia, type SkPath } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { GrowBar } from '../insights/Bars';
import { GUTTER, type, Words } from '../insights/kit';
import { ease, phase } from '../insights/motion';
import { GROUND, SPECTRUM } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { select } from '../ui';
import { streamAt, streamLayout, type StreamLayout } from './geometry';
import { hoursWords, riverLine, riversLine, type WeeklyView } from './model';

/** How long one river takes to flow across the width, and the step between one river and the next. */
export const FLOW_MS = 1500;
const STEP_MS = 140;
const HEIGHT = 208;
/** Read once, so the UI thread gets a number. */
const INTERSECT = ClipOp.Intersect;

// Worklet helpers come first: a worklet can only call a helper that is a worklet itself and was
// defined before it (FOUND TWICE ON 2026-09-13, two crashes).

/** One river as a closed path: its top edge left to right, its bottom edge back, bumpX curves between weeks. */
function addRiver(p: SkPath, xs: readonly number[], top: readonly number[], bottom: readonly number[]): void {
  'worklet';
  const k = xs.length;
  if (k < 2) return;
  p.moveTo(xs[0]!, top[0]!);
  for (let i = 1; i < k; i++) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    p.cubicTo(mx, top[i - 1]!, mx, top[i]!, xs[i]!, top[i]!);
  }
  p.lineTo(xs[k - 1]!, bottom[k - 1]!);
  for (let i = k - 1; i > 0; i--) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    p.cubicTo(mx, bottom[i]!, mx, bottom[i - 1]!, xs[i - 1]!, bottom[i - 1]!);
  }
  p.close();
}

/** A layout with one week drawn as a band across the width: one column is not a river. */
function drawable(layout: StreamLayout, width: number): StreamLayout {
  if (layout.xs.length !== 1) return layout;
  return {
    ...layout,
    xs: [0, width],
    streams: layout.streams.map((s) => ({ key: s.key, top: [s.top[0]!, s.top[0]!], bottom: [s.bottom[0]!, s.bottom[0]!] })),
  };
}

export function Rivers({ view, width, delay = 80 }: { view: WeeklyView; width: number; delay?: number }) {
  const clock = useClock();
  const layout = useMemo(() => streamLayout(view.series.map((s) => ({ key: s.key, values: s.attended })), width, HEIGHT, 0), [view, width]);
  const shape = useMemo(() => drawable(layout, width), [layout, width]);
  const byKey = useMemo(() => new Map(view.series.map((s, i) => [s.key, { s, i }])), [view]);

  // Plain arrays for the UI thread: the order drawn, each river's colours and when it starts.
  const rivers = useMemo(
    () =>
      shape.streams.map((st) => {
        const hit = byKey.get(st.key)!;
        const hue = SPECTRUM[hit.s.hue];
        return { top: st.top, bottom: st.bottom, ink: hue.ink, partner: hue.partner, start: delay + hit.i * STEP_MS };
      }),
    [shape, byKey, delay],
  );
  const xs = shape.xs;

  const [held, setHeld] = useState<{ key: string | null; week: number }>({ key: null, week: -1 });
  const heldIndex = useSharedValue(-1);
  const heldX = useSharedValue(-1);
  useEffect(() => {
    heldIndex.value = held.key ? shape.streams.findIndex((s) => s.key === held.key) : -1;
    heldX.value = held.key && held.week >= 0 ? (layout.xs.length === 1 ? width / 2 : (layout.xs[held.week] ?? -1)) : -1;
  }, [held, shape, layout, width, heldIndex, heldX]);

  const picture = useDerivedValue(() => {
    const t = clock.value;
    const hi = heldIndex.value;
    const hx = heldX.value;
    return createPicture(
      (canvas) => {
        const fill = Skia.Paint();
        fill.setAntiAlias(true);
        const seam = Skia.Paint();
        seam.setAntiAlias(true);
        seam.setStyle(PaintStyle.Stroke);
        seam.setStrokeWidth(1.5);
        seam.setColor(Skia.Color(GROUND.bg));
        for (let i = 0; i < rivers.length; i++) {
          const r = rivers[i]!;
          const flow = ease(phase(t, r.start, FLOW_MS));
          if (flow <= 0) continue;
          const p = Skia.Path.Make();
          addRiver(p, xs, r.top, r.bottom);
          canvas.save();
          canvas.clipRect(Skia.XYWHRect(0, 0, width * flow, HEIGHT), INTERSECT, true);
          fill.setColor(Skia.Color(hi >= 0 && hi !== i ? r.partner : r.ink));
          canvas.drawPath(p, fill);
          canvas.drawPath(p, seam);
          canvas.restore();
        }
        if (hi >= 0 && hx >= 0) {
          const line = Skia.Paint();
          line.setAntiAlias(true);
          line.setStyle(PaintStyle.Stroke);
          line.setStrokeWidth(1);
          line.setColor(Skia.Color(GROUND.text));
          canvas.drawLine(hx, 0, hx, HEIGHT, line);
        }
      },
      { width, height: HEIGHT },
    );
  }, [rivers, xs, width]);

  const onPress = useCallback(
    (e: GestureResponderEvent) => {
      const hit = streamAt(layout, e.nativeEvent.locationX, e.nativeEvent.locationY);
      select();
      setHeld((h) => (!hit.key || (h.key === hit.key && h.week === hit.week) ? { key: null, week: -1 } : { key: hit.key, week: hit.week }));
    },
    [layout],
  );
  const hold = useCallback(
    (key: string) => {
      select();
      const s = byKey.get(key)?.s;
      // The legend holds a river at its fullest week.
      const week = s ? s.attended.indexOf(Math.max(...s.attended)) : -1;
      setHeld((h) => (h.key === key ? { key: null, week: -1 } : { key, week }));
    },
    [byKey],
  );

  const line = held.key ? riverLine(view, held.key, held.week) : riversLine(view);
  const most = Math.max(1, ...view.series.map((s) => s.totalSeconds));
  const ticks = tickIndexes(view.weeks.length);

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="image"
        accessibilityLabel={riversLine(view) ?? 'Your projects, week by week'}
        style={{ width, height: HEIGHT, marginLeft: -GUTTER }}
      >
        <Canvas style={{ width, height: HEIGHT }}>
          <Picture picture={picture} />
        </Canvas>
      </Pressable>
      <View style={[styles.axis, { width, marginLeft: -GUTTER }]}>
        {ticks.map((i) => {
          const x = layout.xs.length === 1 ? width / 2 : layout.xs[i]!;
          const w = 64;
          const left = Math.min(width - GUTTER - w, Math.max(GUTTER, x - w / 2));
          const align = left <= GUTTER ? 'left' : left >= width - GUTTER - w ? 'right' : 'center';
          return (
            <Text key={i} allowFontScaling={false} style={[styles.tick, { left, width: w, textAlign: align }]}>
              {view.weeks[i]!.label}
            </Text>
          );
        })}
      </View>
      <View style={styles.line}>
        {line ? (
          <Animated.View key={line} entering={FadeIn.duration(180)}>
            <Words style={type.body}>{line}</Words>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.legend}>
        {view.series.map((s, i) => {
          const hue = SPECTRUM[s.hue];
          const on = held.key === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => hold(s.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${s.label.text}, ${hoursWords(s.totalSeconds)} with you there over these weeks`}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={[styles.swatch, { backgroundColor: hue.ink }]} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.rowHead}>
                  <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[type.lead, styles.name, on ? { color: hue.ink } : null]}>
                    {s.label.text}
                  </Text>
                  <Text allowFontScaling={false} style={[type.meta, styles.hours]}>
                    {hoursWords(s.totalSeconds)}
                  </Text>
                </View>
                <GrowBar frac={s.totalSeconds / most} color={hue.ink} height={4} delay={delay + FLOW_MS * 0.6 + i * 90} track={false} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Which weeks get a date under the chart: all of them up to five, else five spread evenly (Strava's pace chart: five ticks). */
export function tickIndexes(k: number): number[] {
  if (k <= 5) return Array.from({ length: k }, (_, i) => i);
  return [...new Set([0, Math.round((k - 1) / 4), Math.round((k - 1) / 2), Math.round((3 * (k - 1)) / 4), k - 1])];
}

const styles = StyleSheet.create({
  axis: { height: 22, marginTop: 6 },
  tick: { position: 'absolute', top: 0, fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
  line: { minHeight: 48, marginTop: 10 },
  legend: { marginTop: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GROUND.border,
  },
  swatch: { width: 12, height: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  name: { flex: 1 },
  hours: { fontVariant: ['tabular-nums'], color: GROUND.text },
});
