/**
 * What each call sent, a bar per call or per few calls (`callsView.ts` decides every value): the
 * conversation re-read from the cache in tide at the bottom, what was new in amber on it, the reply
 * in ember on top (`callsView.PART_HUE`, chosen against burn's chart above), over hairline
 * gridlines labelled in tokens a call. A bar of several calls stands as high as ONE of them sent on
 * average (`CallBar.each`), so the axis means the same thing on every bar. A call that came back to
 * an expired cache is the tall amber bar, and a mark over it says how long it was away: its words
 * at the top, a dotted leader in the neutral ink and a caret whose tip stops short of the bar
 * (`callsView.markShape`), so the mark is never read as the bar's height.
 *
 * It DRAWS ON when it comes on screen: the bars rise from the floor left to right on the page's
 * spring, a bar every few milliseconds, as if the session were being replayed call by call. Then
 * it is still. The clock is the drawing's own (`projects/drawClock.ts`, the Money chart's rule):
 * it starts only when the chart itself is on screen, lands at once if the chart is scrolled away
 * mid draw, and the moment it lands one picture recorded on the JavaScript thread replaces the
 * moving one, so a chart at rest records nothing a frame. FOUND IN REVIEW twice on 2026-09-13:
 * charts that read their block's clock re-recorded every frame long after they had landed.
 *
 * A finger scrubs it (Gesture Handler: a horizontal pan, so a vertical drag still scrolls the page)
 * or taps a bar; a hairline follows the finger on the UI thread and the section's readout says what
 * that bar sent (Robinhood's scrub line, design-md/finance/robinhood: "a thin vertical line follows
 * the finger ... the hero value updates to that point"). Crossing a marked bar ticks once
 * (`select`), the time lapse scrubber's rule. The bar in hand is the section's shared value, and
 * VoiceOver's adjustable is the section's too, so nothing this component is given changes while a
 * finger moves. FOUND IN REVIEW (2026-09-13): the readout came in as VoiceOver's value, changed on
 * every bar crossed, re-rendered the chart through its memo and rebuilt both gestures mid pan.
 *
 * A part that is not zero is never drawn as nothing (`insights/Bars`' rule): new and reply keep a
 * one point cap, drawn on the true stack, so a reply of 300 tokens on a 250,000 token bar is seen.
 */
import { Canvas, createPicture, DashPathEffect, Path, Picture, Rect, Skia, type SkCanvas } from '@shopify/react-native-skia';
import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, runOnJS, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { phase, spring } from '../insights/motion';
import { GROUND, SPECTRUM } from '../insights/palette';
import { useDrawClock } from '../projects/drawClock';
import { select } from '../ui/haptics';
import { CARET_W, PART_HUE, markShape, placeMarkLabels, type CallBar, type RewriteMark } from './callsView';
import { AXIS } from './type';

/** Room at the left for the gridline labels, over the bars for the marks, under them for the axis. */
const LEFT = 38;
const RIGHT = 6;
const TOP = 22;
const PLOT = 200;
const UNDER = 22;
/** When the first bar starts, the longest the stagger may take, and each bar's own rise. */
const START_MS = 60;
const SWEEP_MS = 1100;
const BAR_MS = 560;
/** The smallest a part that is not zero is drawn, in points. */
const MIN_PART = 1;

const READ = SPECTRUM[PART_HUE.read].ink;
const FRESH = SPECTRUM[PART_HUE.fresh].ink;
const REPLY = SPECTRUM[PART_HUE.reply].ink;

/** One bar as plain numbers for the UI thread: where it stands and its three heights, in points. */
type Laid = { x: number; w: number; read: number; fresh: number; reply: number; at: number };

/** A mark over a bar, laid out: its words when they fit. The leader and caret are in `markPaths`. */
type MarkAt = { call: number; label: string; words: { left: number; align: 'left' | 'center' | 'right' } | null };
/** The box a mark's words are set in: "46h 34m away" at the axis size is about 76 points. */
const MARK_W = 88;
/** Where a mark's leader starts: under its words (`styles.mark`, top 2, 14 points of line). */
const MARK_WORDS_END = 18;
/** The leader's dots: one point on, two off, so it reads as a line of dots and never as a bar. */
const LEADER_DOTS = [1, 2];

/** A bar's height as drawn, its one point caps included. */
function drawnHeight(b: Laid): number {
  const fresh = b.fresh === 0 ? 0 : Math.max(MIN_PART, b.fresh);
  const reply = b.reply === 0 ? 0 : Math.max(MIN_PART, b.reply);
  return b.read + fresh + reply;
}

// Worklet helpers come first: a worklet can only call a worklet defined before it (two crashes on
// 2026-09-13, `projects/Swarm.tsx`).

/** The chart at clock `t`: the gridlines, then every bar grown as far as its own start says. */
function drawCalls(canvas: SkCanvas, t: number, laid: readonly Laid[], grid: readonly number[], left: number, right: number, floor: number): void {
  'worklet';
  const line = Skia.Paint();
  line.setAntiAlias(false);
  line.setColor(Skia.Color(GROUND.border));
  for (let i = 0; i < grid.length; i++) canvas.drawRect(Skia.XYWHRect(left, grid[i]!, right - left, 1), line);
  canvas.drawRect(Skia.XYWHRect(left, floor, right - left, 1), line);
  const read = Skia.Paint();
  read.setAntiAlias(false);
  read.setColor(Skia.Color(READ));
  const fresh = Skia.Paint();
  fresh.setAntiAlias(false);
  fresh.setColor(Skia.Color(FRESH));
  const reply = Skia.Paint();
  reply.setAntiAlias(false);
  reply.setColor(Skia.Color(REPLY));
  for (let i = 0; i < laid.length; i++) {
    const b = laid[i]!;
    const k = spring(phase(t, b.at, BAR_MS));
    if (k <= 0) continue;
    let y = floor;
    if (b.read > 0) {
      y -= b.read * k;
      canvas.drawRect(Skia.XYWHRect(b.x, y, b.w, b.read * k), read);
    }
    if (b.fresh > 0) {
      const h = Math.max(MIN_PART, b.fresh * k);
      y -= h;
      canvas.drawRect(Skia.XYWHRect(b.x, y, b.w, h), fresh);
    }
    if (b.reply > 0) {
      const h = Math.max(MIN_PART, b.reply * k);
      y -= h;
      canvas.drawRect(Skia.XYWHRect(b.x, y, b.w, h), reply);
    }
  }
}

export interface CallsChartProps {
  bars: readonly CallBar[];
  /** The tallest bar, in tokens a call. */
  max: number;
  ticks: readonly { value: number; label: string }[];
  axis: readonly { index: number; label: string }[];
  marks: readonly RewriteMark[];
  width: number;
  /** The bar in hand: the section's, which VoiceOver steps and a growing session puts back. */
  at: SharedValue<number>;
  /** The bar a finger is on, told once each time it changes. */
  onIndex: (i: number) => void;
}

function CallsChartInner({ bars, max, ticks, axis, marks, width, at, onIndex }: CallsChartProps) {
  const n = bars.length;
  const right = width - RIGHT;
  const slot = (right - LEFT) / Math.max(1, n);
  const floor = TOP + PLOT;
  const top = max * 1.04;
  const scale = PLOT / top;
  const step = n > 1 ? Math.min(12, SWEEP_MS / (n - 1)) : 0;
  const total = START_MS + step * Math.max(0, n - 1) + BAR_MS;

  const laid: Laid[] = useMemo(
    () =>
      bars.map((b, i) => {
        const w = slot >= 3 ? slot - 1 : Math.max(0.75, slot * 0.72);
        return { x: LEFT + i * slot + (slot - w) / 2, w, read: b.each.read * scale, fresh: b.each.fresh * scale, reply: b.each.reply * scale, at: START_MS + i * step };
      }),
    [bars, slot, scale, step],
  );
  const grid = useMemo(() => ticks.map((t) => Math.round(floor - t.value * scale)), [ticks, floor, scale]);
  const height = floor + 1;
  const { marksAt, leaders, carets } = useMemo(() => {
    const centre = (i: number) => {
      const bar = laid[i];
      return bar ? bar.x + bar.w / 2 : LEFT;
    };
    // The largest rewrite's words first; any that would sit on words already placed keeps its
    // leader and caret, so every expired cache is still marked.
    const words = placeMarkLabels(marks, centre, LEFT, right, MARK_W);
    const out: MarkAt[] = [];
    // One path of dots and one of carets for every mark: two nodes however many marks there are.
    const dots = Skia.Path.Make();
    const tips = Skia.Path.Make();
    for (const m of marks) {
      const bar = laid[m.index];
      if (!bar) continue;
      const x = centre(m.index);
      // A mark whose words gave way to a larger one keeps its caret and draws no leader to nothing.
      const peak = floor - drawnHeight(bar);
      const shape = markShape(words.has(m.call) ? MARK_WORDS_END : peak, peak);
      if (shape.leader) {
        dots.moveTo(x, shape.leader[0]);
        dots.lineTo(x, shape.leader[1]);
      }
      tips.moveTo(x - CARET_W / 2, shape.caret.top);
      tips.lineTo(x + CARET_W / 2, shape.caret.top);
      tips.lineTo(x, shape.caret.tip);
      tips.close();
      out.push({ call: m.call, label: m.label, words: words.get(m.call) ?? null });
    }
    return { marksAt: out, leaders: dots, carets: tips };
  }, [marks, laid, floor, right]);

  const { clock, box, landed } = useDrawClock(total);
  const moving = useDerivedValue(() => {
    const t = clock.value;
    return createPicture((canvas) => drawCalls(canvas, t, laid, grid, LEFT, right, floor), { width, height });
  }, [laid, grid, right, floor, width, height]);
  // Recorded once, on this thread, the moment the bars have landed: nothing is drawn a frame after.
  const still = useMemo(
    () => (landed ? createPicture((canvas) => drawCalls(canvas, total, laid, grid, LEFT, right, floor), { width, height }) : null),
    [landed, laid, grid, right, floor, width, height, total],
  );

  // The scrub line, on its own: a finger never re-records the bars. Held inside the bars whatever
  // `at` says, since a live session's bars can change under it.
  const cursorX = useDerivedValue(() => LEFT + (Math.min(n - 1, Math.max(0, at.value)) + 0.5) * slot - 0.5, [slot, n]);
  const marked = useMemo(() => marks.map((m) => m.index), [marks]);
  // Built once per layout, never per bar crossed: a gesture rebuilt mid pan is re-attached mid pan.
  const gesture = useMemo(() => {
    const pick = (x: number, feel: boolean) => {
      'worklet';
      const i = Math.min(n - 1, Math.max(0, Math.floor((x - LEFT) / slot)));
      const was = at.value;
      if (i === was) return;
      if (feel) {
        const lo = Math.min(was, i);
        const hi = Math.max(was, i);
        let crossed = false;
        for (let k = 0; k < marked.length; k++) if (marked[k]! > lo && marked[k]! <= hi) crossed = true;
        if (marked.includes(i)) crossed = true;
        if (crossed) runOnJS(select)();
      }
      at.value = i;
      runOnJS(onIndex)(i);
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart((e) => pick(e.x, true))
      .onUpdate((e) => pick(e.x, true));
    const tap = Gesture.Tap()
      .maxDuration(400)
      .onEnd((e, success) => {
        if (success) pick(e.x, false);
      });
    return Gesture.Exclusive(pan, tap);
  }, [n, slot, marked, at, onIndex]);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <Animated.View ref={box} collapsable={false} style={{ width, height: height + UNDER }}>
          <Canvas style={{ width, height }}>
            <Picture picture={still ?? moving} />
            {landed ? <Rect x={cursorX} y={TOP - 4} width={1} height={PLOT + 4} color={GROUND.text} /> : null}
          </Canvas>
          {ticks.map((t, i) => (
            <Text key={t.value} allowFontScaling={false} style={[AXIS, styles.tick, { top: grid[i]! - 7, width: LEFT - 6 }]}>
              {t.label}
            </Text>
          ))}
          {axis.map((a) => {
            const w = 64;
            const x = LEFT + (a.index + 0.5) * slot;
            const leftPx = Math.max(LEFT - 4, Math.min(width - w, x - w / 2));
            const align = a.index === 0 ? 'left' : a.index === n - 1 ? 'right' : 'center';
            const l = align === 'left' ? LEFT : align === 'right' ? width - w - RIGHT : leftPx;
            return (
              <Text key={a.index} allowFontScaling={false} style={[AXIS, styles.axis, { left: l, width: w, top: floor + 6, textAlign: align }]}>
                {a.label}
              </Text>
            );
          })}
          {landed && marksAt.length ? (
            <Animated.View entering={FadeIn.duration(220)} pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Canvas style={{ width, height }}>
                <Path path={leaders} style="stroke" strokeWidth={1} color={GROUND.dim}>
                  <DashPathEffect intervals={LEADER_DOTS} />
                </Path>
                <Path path={carets} color={FRESH} />
              </Canvas>
              {marksAt.map((m) =>
                m.words ? (
                  <Text key={m.call} allowFontScaling={false} numberOfLines={1} style={[AXIS, styles.mark, { left: m.words.left, width: MARK_W, textAlign: m.words.align }]}>
                    {m.label}
                  </Text>
                ) : null,
              )}
            </Animated.View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Memoised: the section re-renders on every bar crossed for its readout, and the bars must not. */
export const CallsChart = memo(CallsChartInner);

const styles = StyleSheet.create({
  tick: { position: 'absolute', left: 0, textAlign: 'right', color: GROUND.faint },
  axis: { position: 'absolute', color: GROUND.dim },
  mark: { position: 'absolute', top: 2, color: FRESH },
});
