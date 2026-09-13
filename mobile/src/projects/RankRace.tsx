/**
 * THE RANK RACE: the projects re-ranking week by week, as a bump chart. One row per place, one
 * column per week, and each project a line in its hue through its place in every week it had
 * time with you there (`geometry.raceLayout`); a week with none breaks the line, because no time
 * is no place. When the block arrives the race is RUN: a reveal sweeps left to right over every
 * line at once, each line's head riding the sweep like a runner, the dots of each week popping in
 * as the sweep passes them, and when it reaches the right edge the latest week's order lands
 * beside the finish, each project's name in its own ink. Then it is still.
 *
 * Borrowed, with the numbers kept: every line is laid on a wider stroke of the ground colour, so
 * where two lines cross the one on top is cut clean out of the one beneath (the road halo under
 * Strava's route polyline, design-md/fitness/strava: "4pt stroke with a halo drawn beneath", here
 * in the ground's own colour because a hue at partial opacity over the warm ground reads brown);
 * the finish order with its place numbers is Spotify's top list (design-md/music/spotify, the
 * numbered track rows of a chart); the start of a line is a hollow dot and its latest week a
 * filled one, Strava's route start and end markers.
 */
import { Canvas, ClipOp, createPicture, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, type SkPath } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { type } from '../insights/kit';
import { ease, phase, spring } from '../insights/motion';
import { GROUND, SPECTRUM } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { Arrive } from '../you/parts';
import { raceLayout } from './geometry';
import { hoursWords, type RaceSummary, type WeeklyView } from './model';
import { tickIndexes } from './Rivers';

/** How long the race takes to run, left edge to right. */
export const RACE_MS = 1700;
const ROW_GAP = 48;
const PAD = 14;
/** The place numbers at the left, and the finish order at the right. */
const NUMERALS = 22;
const FINISH = 128;
const INTERSECT = ClipOp.Intersect;
const ROUND = StrokeCap.Round;
const ROUND_JOIN = StrokeJoin.Round;

// Worklet helpers first, each defined before the worklet that calls it.

/** One run of a line through its points, bumpX curves between weeks. */
function addRun(p: SkPath, xs: readonly number[], ys: readonly number[]): void {
  'worklet';
  p.moveTo(xs[0]!, ys[0]!);
  for (let i = 1; i < xs.length; i++) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    p.cubicTo(mx, ys[i - 1]!, mx, ys[i]!, xs[i]!, ys[i]!);
  }
}

/** The height of a bumpX segment from (x0, y0) to (x1, y1) where it crosses `x`: bisection on its parameter. */
function bumpYAt(x0: number, y0: number, x1: number, y1: number, x: number): number {
  'worklet';
  const mx = (x0 + x1) / 2;
  let lo = 0;
  let hi = 1;
  let t = 0.5;
  for (let i = 0; i < 22; i++) {
    t = (lo + hi) / 2;
    const u = 1 - t;
    const bx = u * u * u * x0 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x1;
    if (bx < x) lo = t;
    else hi = t;
  }
  const u = 1 - t;
  return u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1;
}

export function RankRace({ view, summary, width, delay = 80 }: { view: WeeklyView; summary: RaceSummary; width: number; delay?: number }) {
  const clock = useClock();
  const chart = Math.max(120, width - NUMERALS - FINISH);
  const layout = useMemo(() => raceLayout(view.series.map((s) => ({ key: s.key, ranks: s.ranks })), chart, ROW_GAP, PAD), [view, chart]);
  const height = layout.rows.length ? PAD * 2 + (layout.rows.length - 1) * ROW_GAP : 0;

  // Plain arrays for the UI thread.
  const lines = useMemo(
    () =>
      layout.lines.map((l) => {
        const s = view.series.find((x) => x.key === l.key)!;
        return { ink: SPECTRUM[s.hue].ink, runs: l.runs.map((r) => ({ xs: r.points.map((p) => p.x), ys: r.points.map((p) => p.y) })) };
      }),
    [layout, view],
  );
  const rows = layout.rows;

  const picture = useDerivedValue(() => {
    const t = clock.value;
    const sweep = ease(phase(t, delay, RACE_MS));
    const edge = sweep * chart;
    return createPicture(
      (canvas) => {
        const guide = Skia.Paint();
        guide.setAntiAlias(true);
        guide.setStyle(PaintStyle.Stroke);
        guide.setStrokeWidth(1);
        guide.setColor(Skia.Color(GROUND.border));
        for (let r = 0; r < rows.length; r++) canvas.drawLine(0, rows[r]!, chart, rows[r]!, guide);
        if (sweep <= 0) return;

        const halo = Skia.Paint();
        halo.setAntiAlias(true);
        halo.setStyle(PaintStyle.Stroke);
        halo.setStrokeWidth(11);
        halo.setStrokeCap(ROUND);
        halo.setStrokeJoin(ROUND_JOIN);
        halo.setColor(Skia.Color(GROUND.bg));
        const ink = Skia.Paint();
        ink.setAntiAlias(true);
        ink.setStyle(PaintStyle.Stroke);
        ink.setStrokeWidth(4);
        ink.setStrokeCap(ROUND);
        ink.setStrokeJoin(ROUND_JOIN);
        const dot = Skia.Paint();
        dot.setAntiAlias(true);
        const ground = Skia.Paint();
        ground.setAntiAlias(true);
        ground.setColor(Skia.Color(GROUND.bg));

        canvas.save();
        canvas.clipRect(Skia.XYWHRect(-8, -8, edge + 8, rows.length * ROW_GAP + PAD * 2 + 16), INTERSECT, true);
        for (let i = lines.length - 1; i >= 0; i--) {
          const L = lines[i]!;
          ink.setColor(Skia.Color(L.ink));
          for (let k = 0; k < L.runs.length; k++) {
            const run = L.runs[k]!;
            if (run.xs.length > 1) {
              const p = Skia.Path.Make();
              addRun(p, run.xs, run.ys);
              canvas.drawPath(p, halo);
              canvas.drawPath(p, ink);
            }
          }
        }
        canvas.restore();

        // The dots: each week's pops as the sweep passes it; a run's first is hollow, its last filled.
        for (let i = lines.length - 1; i >= 0; i--) {
          const L = lines[i]!;
          dot.setColor(Skia.Color(L.ink));
          for (let k = 0; k < L.runs.length; k++) {
            const run = L.runs[k]!;
            for (let j = 0; j < run.xs.length; j++) {
              const x = run.xs[j]!;
              const pop = spring(Math.min(1, Math.max(0, (edge - x + 6) / 40)));
              if (pop <= 0) continue;
              const first = j === 0 && run.xs.length > 1;
              const r = (j === run.xs.length - 1 ? 6 : 4.5) * pop;
              canvas.drawCircle(x, run.ys[j]!, r, dot);
              if (first) canvas.drawCircle(x, run.ys[j]!, Math.max(0, r - 2.2), ground);
            }
          }
        }

        // The runners: while the race is on, each line's head rides the sweep.
        if (sweep < 1) {
          for (let i = 0; i < lines.length; i++) {
            const L = lines[i]!;
            dot.setColor(Skia.Color(L.ink));
            for (let k = 0; k < L.runs.length; k++) {
              const run = L.runs[k]!;
              const n = run.xs.length;
              if (n < 2 || edge <= run.xs[0]! || edge >= run.xs[n - 1]!) continue;
              let j = 1;
              while (j < n - 1 && run.xs[j]! < edge) j++;
              const y = bumpYAt(run.xs[j - 1]!, run.ys[j - 1]!, run.xs[j]!, run.ys[j]!, edge);
              canvas.drawCircle(edge, y, 7, dot);
              canvas.drawCircle(edge, y, 2.5, ground);
            }
          }
        }
      },
      { width: chart, height },
    );
  }, [lines, rows, chart, height, delay]);

  if (!rows.length) return null;
  // Five dates need about 56 points each; a narrower race says its ends and its middle.
  const all = tickIndexes(view.weeks.length);
  const ticks = all.length > 1 && chart / (all.length - 1) < 58 ? [...new Set([0, Math.floor((view.weeks.length - 1) / 2), view.weeks.length - 1])] : all;
  const finishAt = delay + RACE_MS - 120;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary.lines.join(' ')}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: NUMERALS, height }}>
          {rows.map((y, i) => (
            <Text key={i} allowFontScaling={false} style={[styles.place, { top: y - 8 }]}>
              {i + 1}
            </Text>
          ))}
        </View>
        <Canvas style={{ width: chart, height }}>
          <Picture picture={picture} />
        </Canvas>
        <View style={{ width: FINISH, height }}>
          {summary.order.map((o, i) => {
            const y = rows[o.rank - 1];
            if (y === undefined) return null;
            return (
              <Arrive key={o.key} delay={finishAt + i * 90} style={[styles.finish, { top: y - 23 }]}>
                <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={[styles.finishName, { color: SPECTRUM[o.hue].ink }]}>
                  {o.label.text}
                </Text>
                <Text allowFontScaling={false} numberOfLines={1} style={type.meta}>
                  {hoursWords(o.seconds)}
                </Text>
              </Arrive>
            );
          })}
        </View>
      </View>
      <View style={{ height: 20, marginLeft: NUMERALS, width: chart }}>
        {ticks.map((i) => {
          const x = layout.xs[i] ?? chart / 2;
          const w = 56;
          const left = Math.min(chart - w, Math.max(0, x - w / 2));
          return (
            <Text key={i} allowFontScaling={false} style={[styles.tick, { left, width: w, textAlign: left <= 0 ? 'left' : left >= chart - w ? 'right' : 'center' }]}>
              {view.weeks[i]!.label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: 0, width: 16, textAlign: 'left', fontSize: 13, fontWeight: '700', color: GROUND.faint, fontVariant: ['tabular-nums'] },
  finish: { position: 'absolute', left: 10, right: 0, height: 46, justifyContent: 'center' },
  finishName: { fontSize: 14, lineHeight: 16, fontWeight: '700', letterSpacing: -0.2 },
  tick: { position: 'absolute', top: 4, fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
});
