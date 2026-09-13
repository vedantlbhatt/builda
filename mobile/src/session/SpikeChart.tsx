/**
 * The costly stretches as bars (`burnChart.ts` decides every value): a typical stretch first, one
 * unit tall in the neutral ink, then each costly stretch at its multiple in the hue of its
 * dominant cause, beside the dashed line burn draws its own bar at. The bars grow from the floor
 * one after another on the page's spring (a hair of give), and each costly one pulses ONCE as it
 * lands, then everything is still.
 *
 * Borrowed, concretely:
 *   - The pulse is Strava's first view pulse on an achievement (design-md/fitness/strava:
 *     "a subtle 600ms scale 1.0 to 1.1 to 1.0 pulse when first viewed") and Apple Fitness's ring
 *     that "pulses once" when it closes (design-md/fitness/apple-fitness). 600 ms, 7% here: a bar
 *     is taller than a medal and a larger pulse reads as a wobble.
 *   - Strava's splits table (a tiny bar inline with each split, scaled to its value) is the
 *     shape of the rows under this chart (`BurnSection.tsx`).
 *
 * The fill says what the stretch produced: solid when it wrote or committed something, an outline
 * when it ran something its transcript cannot show, dotted in 1 bit cells of the dither's 3 pt
 * grain when nothing was written. No gradient and no hue at partial opacity (DESIGN-V2 1.3).
 *
 * One Skia picture from the block's clock. Every function the worklet calls is a worklet
 * (`phase`, `spring`, `Math`); positions and delays are computed on the JS side.
 */
import { Canvas, createPicture, PaintStyle, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { DRAW_MS, phase, spring } from '../insights/motion';
import { GROUND, SPECTRUM } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { CAUSE_HUE, type BurnChart, type ChartBar } from './burnChart';
import { AXIS, BAR_TOP } from './type';

/** Room over the tallest bar for its number. */
const TOP = 30;
const PLOT = 150;
/** Room under the floor for two lines of label. */
const UNDER = 34;
/** The gap between one bar starting and the next. */
const STEP_MS = 150;
/** The one pulse a costly stretch gets as it lands. */
const PULSE_MS = 600;
const PULSE = 0.07;
/** The dither's grain (tokens.dither.cell): whole device pixels at @2x and @3x. */
const CELL = 3;

export function barColor(bar: Pick<ChartBar, 'cause' | 'spike'>): string {
  if (!bar.spike || !bar.cause) return GROUND.dim;
  return SPECTRUM[CAUSE_HUE[bar.cause]].ink;
}

interface Placed {
  x: number;
  w: number;
  h: number;
  color: string;
  fill: 0 | 1 | 2;
  spike: boolean;
  at: number;
}

export function SpikeChart({ chart, width, delay = 60 }: { chart: BurnChart; width: number; delay?: number }) {
  const clock = useClock();
  const n = chart.bars.length;
  const slot = width / Math.max(1, n);
  const barW = Math.min(56, Math.floor(slot * 0.56));
  const base = TOP + PLOT;
  const yOf = (m: number) => base - (Math.max(0, m) / chart.max) * PLOT;
  const thresholdY = Math.round(yOf(chart.threshold)) + 0.5;

  const placed: Placed[] = useMemo(
    () =>
      chart.bars.map((b, i) => ({
        x: i * slot + (slot - barW) / 2,
        w: barW,
        // A typical stretch next to a 34x one is a sliver; it keeps two points so it is seen.
        h: Math.max(2, (b.multiple / chart.max) * PLOT),
        color: barColor(b),
        fill: b.fill === 'solid' ? 0 : b.fill === 'hollow' ? 1 : 2,
        spike: b.spike,
        at: delay + i * STEP_MS,
      })),
    [chart, slot, barW, delay],
  );

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        const line = Skia.Paint();
        line.setAntiAlias(true);
        line.setStyle(PaintStyle.Stroke);
        // The floor, and burn's own bar as a dashed rule: dashes drawn as short segments.
        line.setColor(Skia.Color(GROUND.border));
        line.setStrokeWidth(1);
        canvas.drawLine(0, base + 0.5, width, base + 0.5, line);
        line.setColor(Skia.Color(GROUND.faint));
        for (let x = 0; x < width; x += 8) canvas.drawLine(x, thresholdY, Math.min(width, x + 4), thresholdY, line);

        const fill = Skia.Paint();
        fill.setAntiAlias(false);
        const stroke = Skia.Paint();
        stroke.setAntiAlias(true);
        stroke.setStyle(PaintStyle.Stroke);
        stroke.setStrokeWidth(1.5);
        for (let i = 0; i < placed.length; i++) {
          const b = placed[i]!;
          const k = spring(phase(t, b.at, DRAW_MS));
          if (k <= 0) continue;
          let s = 1;
          if (b.spike) {
            const p = phase(t, b.at + DRAW_MS, PULSE_MS);
            if (p > 0 && p < 1) s = 1 + PULSE * Math.sin(Math.PI * p);
          }
          const h = b.h * k * s;
          const w = b.w * s;
          const x = b.x - (w - b.w) / 2;
          const y = base - h;
          fill.setColor(Skia.Color(b.color));
          stroke.setColor(Skia.Color(b.color));
          if (b.fill === 0) {
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
          } else if (b.fill === 1) {
            canvas.drawRect(Skia.XYWHRect(x + 0.75, y + 0.75, Math.max(0, w - 1.5), Math.max(0, h - 0.75)), stroke);
          } else {
            // Dotted: a 1 bit checker of whole cells from the floor up, as much as has grown.
            const cols = Math.floor(w / CELL);
            const rows = Math.floor(h / CELL);
            const left = x + (w - cols * CELL) / 2;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                if ((r + c) % 2 === 0) canvas.drawRect(Skia.XYWHRect(left + c * CELL, base - (r + 1) * CELL, CELL, CELL), fill);
              }
            }
          }
        }
      },
      { width, height: base + 1 },
    );
  }, [placed, width, base, thresholdY]);

  return (
    <View style={{ width, height: base + UNDER }} accessible accessibilityRole="image" accessibilityLabel={describe(chart)}>
      <Canvas style={{ width, height: base + 1 }}>
        <Picture picture={picture} />
      </Canvas>
      {/* The dashed line's value at its right end, in the margin past the last bar; what it means is
          said in the key line under the chart, where it cannot sit on a bar's number. */}
      <Text allowFontScaling={false} style={[AXIS, styles.threshold, { top: thresholdY - 7, color: GROUND.faint }]}>
        {`${chart.threshold}×`}
      </Text>
      {chart.bars.map((b, i) => {
        const p = placed[i]!;
        return (
          <React.Fragment key={b.key}>
            <BarTop text={b.top} color={p.color} left={i * slot} width={slot} top={Math.max(0, base - p.h - 24)} at={p.at + DRAW_MS * 0.55} />
            <Text allowFontScaling={false} numberOfLines={2} style={[AXIS, styles.under, { left: i * slot, width: slot, top: base + 6, color: GROUND.dim }]}>
              {b.under}
            </Text>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** A bar's number, snapping in as its bar lands (a hue never lingers half transparent). */
function BarTop({ text, color, left, width, top, at }: { text: string; color: string; left: number; width: number; top: number; at: number }) {
  const clock = useClock();
  const a = useAnimatedStyle(() => ({ opacity: phase(clock.value, at, 110) }));
  return (
    <Animated.View style={[styles.top, { left, width, top }, a]}>
      <Text allowFontScaling={false} style={[BAR_TOP, { color, textAlign: 'center' }]}>
        {text}
      </Text>
    </Animated.View>
  );
}

function describe(chart: BurnChart): string {
  const spikes = chart.bars.filter((b) => b.spike).map((b) => `${b.top.replace('×', ' times')} a typical stretch, ${b.under}`);
  return `The costliest stretches against a typical one: ${spikes.join('; ')}.`;
}

const styles = StyleSheet.create({
  threshold: { position: 'absolute', right: 0, textAlign: 'right', backgroundColor: GROUND.bg, paddingLeft: 2 },
  under: { position: 'absolute', textAlign: 'center' },
  top: { position: 'absolute' },
});
