/**
 * The time lapse's scrubber: the session as TRACK_BINS bars of activity, each stacked by what
 * happened (changes in amber, failures in red, reads in the map's dim warm, the map's own
 * meanings), what has played in those colours and what has not in `border`, a bracket over the
 * knot and one over the burst, a tick under each spike, and the playhead.
 *
 * A finger drags it (Gesture Handler: a horizontal pan, so a vertical drag still scrolls the
 * page) or taps it to jump. Crossing a spike, the knot or the burst under the finger ticks
 * once (`selectionAsync`: a value passing a step); the playhead crossing them on its own never
 * does, because a haptic nobody's finger asked for is noise. VoiceOver: an adjustable that
 * steps a twentieth of the session.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { select, T, useColors } from '../ui';
import type { TrackBin } from './frames';

/**
 * The scrubber's height: a 15pt label line, the brackets under it (clear of the playhead's
 * square), 28pt of bars, the spike ticks.
 */
export const SCRUBBER_HEIGHT = 60;
const LABEL_Y = 0;
const BRACKET_Y = 20;
const BARS_TOP = 25;
const BARS_H = 27;
const TICK_Y = 55;

export interface Stretch {
  from: number;
  to: number;
}

export interface ScrubberProps {
  width: number;
  bins: readonly TrackBin[];
  /** Bar indices that are spikes. */
  spikes: readonly number[];
  /** Seconds the session covers. */
  span: number;
  playhead: SharedValue<number>;
  knot: Stretch | null;
  burst: Stretch | null;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  /** VoiceOver's value and its two steps. */
  valueText: string;
  onStep: (direction: 1 | -1) => void;
}

export function Scrubber({ width, bins, spikes, span, playhead, knot, burst, onScrubStart, onScrubEnd, valueText, onStep }: ScrubberProps) {
  const c = useColors();
  const n = bins.length;
  const barW = width / Math.max(1, n);
  // Each bar stacked from the bottom: changes, failures, reads, in whole points, the bar's
  // height its count against the busiest bar (at least 2pt, so a lone read still shows).
  const stacks = useMemo(() => {
    const max = Math.max(1, ...bins.map((b) => b.count));
    return bins.map((b) => {
      if (b.count === 0) return [0, 0, 0];
      const total = Math.max(2, Math.round((b.count / max) * BARS_H));
      const edit = Math.round((b.edits / b.count) * total);
      const fail = Math.min(total - edit, Math.round((b.fails / b.count) * total));
      return [edit, fail, total - edit - fail];
    });
  }, [bins]);
  const inks = [c.accent, c.data.del, c.graph[2]!];
  const unplayed = c.border;
  const text = c.text;
  const dim = c.textDim;
  const spikeX = useMemo(() => spikes.map((i) => (i + 0.5) * barW), [spikes, barW]);

  // The moments a finger crossing them should feel: every spike's middle, the knot's start
  // and the burst's start, in seconds.
  const marks = useMemo(() => {
    const out = spikes.map((i) => ((i + 0.5) / Math.max(1, n)) * span);
    if (knot) out.push(knot.from);
    if (burst) out.push(burst.from);
    return out.sort((a, b) => a - b);
  }, [spikes, n, span, knot, burst]);

  const { knotX, burstX } = useMemo(() => {
    const xOf = (t: number) => (span > 0 ? (t / span) * width : 0);
    const bracket = (s: Stretch | null) => (s ? [xOf(s.from), Math.max(xOf(s.to), xOf(s.from) + 2)] : null);
    return { knotX: bracket(knot), burstX: bracket(burst) };
  }, [knot, burst, span, width]);

  const picture = useDerivedValue(() => {
    const head = span > 0 ? Math.min(1, Math.max(0, playhead.value / span)) * width : 0;
    const colors = inks.map((h) => Skia.Color(h));
    const off = Skia.Color(unplayed);
    const on = Skia.Color(text);
    const tickColor = Skia.Color(dim);
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        for (let i = 0; i < stacks.length; i++) {
          const x = i * barW;
          const played = x + barW / 2 <= head;
          let bottom = BARS_TOP + BARS_H;
          for (let j = 0; j < 3; j++) {
            const h = stacks[i]![j]!;
            if (h === 0) continue;
            paint.setColor(played ? colors[j]! : off);
            canvas.drawRect(Skia.XYWHRect(x + 0.5, bottom - h, Math.max(1, barW - 1), h), paint);
            bottom -= h;
          }
        }
        paint.setColor(on);
        if (knotX) canvas.drawRect(Skia.XYWHRect(knotX[0]!, BRACKET_Y, knotX[1]! - knotX[0]!, 2), paint);
        if (burstX) canvas.drawRect(Skia.XYWHRect(burstX[0]!, BRACKET_Y, burstX[1]! - burstX[0]!, 2), paint);
        paint.setColor(tickColor);
        for (const x of spikeX) canvas.drawRect(Skia.XYWHRect(x - 1, TICK_Y, 2, 4), paint);
        // The playhead: a 2pt line through the bars, a 6pt square on top.
        paint.setColor(on);
        const px = Math.min(width - 1, Math.max(1, head));
        canvas.drawRect(Skia.XYWHRect(px - 1, BRACKET_Y - 1, 2, BARS_TOP + BARS_H - BRACKET_Y + 3), paint);
        canvas.drawRect(Skia.XYWHRect(px - 3, BRACKET_Y - 4, 6, 6), paint);
      },
      { width, height: SCRUBBER_HEIGHT },
    );
  }, [width, span, stacks, barW, knotX, burstX, spikeX]);

  // ---------------------------------------------------------------- the finger
  const seek = (x: number, feel: boolean) => {
    'worklet';
    const t = span > 0 ? (Math.min(width, Math.max(0, x)) / width) * span : 0;
    const was = playhead.value;
    if (feel && t !== was) {
      const lo = Math.min(was, t);
      const hi = Math.max(was, t);
      let crossed = false;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i]!;
        if (m > lo && m <= hi) crossed = true;
      }
      if (crossed) runOnJS(select)();
    }
    playhead.value = t;
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => {
      runOnJS(onScrubStart)();
      seek(e.x, true);
    })
    .onUpdate((e) => seek(e.x, true))
    .onFinalize((_e, success) => {
      if (success) runOnJS(onScrubEnd)();
    });
  const tap = Gesture.Tap()
    .maxDuration(400)
    .onEnd((e, success) => {
      if (!success) return;
      runOnJS(onScrubStart)();
      seek(e.x, false);
      runOnJS(onScrubEnd)();
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const label = (x: number, word: string, key: string) => (
    <T
      key={key}
      role="label"
      tone="dim"
      numberOfLines={1}
      style={{ position: 'absolute', top: LABEL_Y, left: Math.max(0, Math.min(width - 48, x)), width: 48 }}
    >
      {word}
    </T>
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Replay position"
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={{ width, height: SCRUBBER_HEIGHT }}
      >
        <Canvas style={{ width, height: SCRUBBER_HEIGHT }}>
          <Picture picture={picture} />
        </Canvas>
        {knotX ? label(knotX[0]!, 'stuck', 'knot') : null}
        {burstX && (!knotX || burstX[0]! - knotX[0]! > 52) ? label(burstX[0]!, 'burst', 'burst') : null}
      </View>
    </GestureDetector>
  );
}
