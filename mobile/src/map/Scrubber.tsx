/**
 * The time lapse's scrubber: the session as TRACK_BINS bars of activity on the warm ground, each
 * stacked by what happened (changes in the dim grey, failures in the one red, reads in the faint
 * grey: `paint.SCRUB_INK`, neutrals, because every hue on the map above is a kind of file, the
 * builder's own is the band and the play key, and the stuck files have theirs), what has played in
 * those colours and what has not in `border`, a bracket over the knot in the stuck files' hue and
 * one over the burst in white, a tick under each spike, and the playhead.
 *
 * It draws on when its block arrives: the bars grow from the baseline left to right on the
 * page's spring, a bar every 8 ms, then stand still; the playhead and the brackets land last.
 *
 * A finger drags it (Gesture Handler: a horizontal pan, so a vertical drag still scrolls the
 * page) or taps it to jump. Crossing a spike, the knot or the burst under the finger ticks
 * once (`selectionAsync`: a value passing a step); the playhead crossing them on its own never
 * does, because a haptic nobody's finger asked for is noise. VoiceOver: an adjustable that
 * steps a twentieth of the session.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { type } from '../insights/kit';
import { ease, phase, spring } from '../insights/motion';
import { DATA, GROUND } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { select } from '../ui/haptics';
import type { TrackBin } from './frames';
import { SCRUB_INK } from './paint';

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
/** When the bars start growing on the block's clock, how far apart, and how long each takes. */
const BARS_AT = 200;
const BAR_STEP = 8;
const BAR_MS = 520;

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
  /** The stuck files' ink (`paint.stuckHue`): the bracket over the knot and its word. */
  stuck: string;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  /** VoiceOver's value and its two steps. */
  valueText: string;
  onStep: (direction: 1 | -1) => void;
}

export function Scrubber({ width, bins, spikes, span, playhead, knot, burst, stuck, onScrubStart, onScrubEnd, valueText, onStep }: ScrubberProps) {
  const clock = useClock();
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
  const inks = useMemo(() => [SCRUB_INK.change, DATA.del, SCRUB_INK.read], []);
  const unplayed = GROUND.border;
  const text = GROUND.text;
  const dim = GROUND.dim;
  const spikeX = useMemo(() => spikes.map((i) => (i + 0.5) * barW), [spikes, barW]);
  const landed = BARS_AT + n * BAR_STEP + BAR_MS;

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
    const t = clock.value;
    const head = span > 0 ? Math.min(1, Math.max(0, playhead.value / span)) * width : 0;
    const colors = inks.map((h) => Skia.Color(h));
    const off = Skia.Color(unplayed);
    const on = Skia.Color(text);
    const tickColor = Skia.Color(dim);
    const knotColor = Skia.Color(stuck);
    const last = ease(phase(t, landed - 200, 300));
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        for (let i = 0; i < stacks.length; i++) {
          const grow = spring(phase(t, BARS_AT + i * BAR_STEP, BAR_MS));
          if (grow <= 0) continue;
          const x = i * barW;
          const played = x + barW / 2 <= head;
          let bottom = BARS_TOP + BARS_H;
          for (let j = 0; j < 3; j++) {
            const h = stacks[i]![j]! * grow;
            if (h <= 0) continue;
            paint.setColor(played ? colors[j]! : off);
            canvas.drawRect(Skia.XYWHRect(x + 0.5, bottom - h, Math.max(1, barW - 1), h), paint);
            bottom -= h;
          }
        }
        if (last <= 0) return;
        paint.setColor(knotColor);
        if (knotX) canvas.drawRect(Skia.XYWHRect(knotX[0]!, BRACKET_Y, (knotX[1]! - knotX[0]!) * last, 2), paint);
        paint.setColor(on);
        if (burstX) canvas.drawRect(Skia.XYWHRect(burstX[0]!, BRACKET_Y, (burstX[1]! - burstX[0]!) * last, 2), paint);
        paint.setColor(tickColor);
        for (const x of spikeX) canvas.drawRect(Skia.XYWHRect(x - 1, TICK_Y + 4 * (1 - last), 2, 4 * last), paint);
        // The playhead: a 2pt line through the bars, a 6pt square on top.
        paint.setColor(on);
        const px = Math.min(width - 1, Math.max(1, head));
        const tall = (BARS_TOP + BARS_H - BRACKET_Y + 3) * last;
        canvas.drawRect(Skia.XYWHRect(px - 1, BARS_TOP + BARS_H + 2 - tall, 2, tall), paint);
        canvas.drawRect(Skia.XYWHRect(px - 3, BRACKET_Y - 4, 6, 6 * last), paint);
      },
      { width, height: SCRUBBER_HEIGHT },
    );
  }, [width, span, stacks, barW, knotX, burstX, spikeX, inks, landed, stuck]);

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

  const label = (x: number, word: string, key: string, color?: string) => (
    <Text
      key={key}
      allowFontScaling={false}
      numberOfLines={1}
      style={[type.label, styles.label, { left: Math.max(0, Math.min(width - 48, x)) }, color ? { color } : null]}
    >
      {word}
    </Text>
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
        {knotX ? label(knotX[0]!, 'stuck', 'knot', stuck) : null}
        {burstX && (!knotX || burstX[0]! - knotX[0]! > 52) ? label(burstX[0]!, 'burst', 'burst') : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', top: LABEL_Y, width: 48 },
});
