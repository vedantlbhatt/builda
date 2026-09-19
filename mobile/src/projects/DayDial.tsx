/**
 * When in the day a project is built, on a 24 hour dial with midnight at the top (the sleep clock
 * people already read): the hour ticks come in round it, the night window (10pm to 4am, the span
 * the report's `night_share` counts over) sweeps in as an arc when the project's night share was
 * sent, the peak hour lands as a brighter wedge, and a hand swings from midnight round to it. The
 * analysis page's `DayClock` drawn for one project, with two differences:
 *
 *   - FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2 `11-project-1-03`, `12-project-2-03`): the
 *     project page drew the dial with the night window switched off, so a project with 47% of its
 *     time between 10pm and 4am showed a lone wedge at 10am and nothing at night. The window is
 *     drawn whenever the share is known, and the share is said beside the dial.
 *   - it runs on its own drawing clock (`drawClock.ts`): it starts when it is on screen, lands,
 *     and from then on is one still picture recorded once, never re-recorded a frame.
 */
import { Canvas, createPicture, PaintStyle, Picture, Skia, StrokeCap, type SkCanvas } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useDerivedValue } from 'react-native-reanimated';

import { ease, phase, spring } from '../insights/motion';
import { GROUND } from '../insights/palette';
import { useDrawClock } from './drawClock';

const DEG = Math.PI / 180;
/** The night window, as the report counts it: 10pm to 4am. */
const NIGHT_FROM_HOUR = 22;
const NIGHT_HOURS = 6;
const TICKS_MS = 700;
const NIGHT_AT = 250;
const NIGHT_MS = 800;
const SWING_AT = 350;
const SWING_MS = 950;
const WEDGE_AT = 1250;
const WEDGE_MS = 500;
/** Read once, so the UI thread gets numbers. */
const BUTT = StrokeCap.Butt;
const ROUND = StrokeCap.Round;
const STROKE = PaintStyle.Stroke;
const FILL = PaintStyle.Fill;

// Worklet helpers, defined before every worklet that calls them.

/** Degrees clockwise from 12 o'clock, as Skia's arc angles (which start at 3 o'clock). */
function fromTop(deg: number): number {
  'worklet';
  return deg - 90;
}

/** The dial at clock `t`, `delay` ms in. */
function drawDial(canvas: SkCanvas, t: number, size: number, delay: number, peakHour: number, night: boolean, ink: string, partner: string): void {
  'worklet';
  const c = size / 2;
  const outer = c - 30;
  const band = outer - 20;
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(STROKE);
  p.setStrokeCap(BUTT);
  // The hour ticks come in round the dial.
  const ticks = ease(phase(t, delay, TICKS_MS));
  p.setColor(Skia.Color(GROUND.faint));
  for (let h = 0; h < 24; h++) {
    if (h / 24 > ticks) break;
    const a = (h * 15 - 90) * DEG;
    const long = h % 6 === 0;
    p.setStrokeWidth(long ? 2 : 1);
    const r0 = outer - (long ? 9 : 5);
    canvas.drawLine(c + Math.cos(a) * r0, c + Math.sin(a) * r0, c + Math.cos(a) * outer, c + Math.sin(a) * outer, p);
  }
  const oval = Skia.XYWHRect(c - band, c - band, band * 2, band * 2);
  p.setColor(Skia.Color(GROUND.border));
  p.setStrokeWidth(12);
  canvas.drawArc(oval, 0, 360 * ticks, false, p);
  if (night) {
    const s = ease(phase(t, delay + NIGHT_AT, NIGHT_MS));
    if (s > 0) {
      p.setColor(Skia.Color(partner));
      p.setStrokeWidth(12);
      canvas.drawArc(oval, fromTop(NIGHT_FROM_HOUR * 15), NIGHT_HOURS * 15 * s, false, p);
    }
  }
  if (peakHour >= 0) {
    const swing = ease(phase(t, delay + SWING_AT, SWING_MS));
    if (swing > 0.98) {
      p.setColor(Skia.Color(ink));
      p.setStrokeWidth(20);
      const w = spring(phase(t, delay + WEDGE_AT, WEDGE_MS));
      canvas.drawArc(oval, fromTop(peakHour * 15 + 7.5 - 7.5 * w), 15 * w, false, p);
    }
    if (swing > 0) {
      const a = ((peakHour + 0.5) * 15 * swing - 90) * DEG;
      p.setColor(Skia.Color(GROUND.text));
      p.setStrokeWidth(2.5);
      p.setStrokeCap(ROUND);
      canvas.drawLine(c, c, c + Math.cos(a) * (band - 18), c + Math.sin(a) * (band - 18), p);
      const dot = Skia.Paint();
      dot.setAntiAlias(true);
      dot.setStyle(FILL);
      dot.setColor(Skia.Color(GROUND.text));
      canvas.drawCircle(c, c, 4, dot);
    }
  }
}

export function DayDial({ size, peakHour, night, ink, partner, delay = 60 }: { size: number; peakHour: number | null; night: boolean; ink: string; partner: string; delay?: number }) {
  const peak = peakHour ?? -1;
  const total = delay + WEDGE_AT + WEDGE_MS;
  const { clock, box, landed } = useDrawClock(total);
  const moving = useDerivedValue(() => {
    const t = clock.value;
    return createPicture((canvas) => drawDial(canvas, t, size, delay, peak, night, ink, partner), { width: size, height: size });
  }, [size, delay, peak, night, ink, partner]);
  // Recorded once, on this thread, the moment the dial has landed: nothing is drawn a frame after.
  const still = useMemo(
    () => (landed ? createPicture((canvas) => drawDial(canvas, total, size, delay, peak, night, ink, partner), { width: size, height: size }) : null),
    [landed, total, size, delay, peak, night, ink, partner],
  );
  const c = size / 2;
  const label = (s: string, x: number, y: number) => (
    <Text key={s} allowFontScaling={false} style={[styles.dialLabel, { left: x - 22, top: y - 7 }]}>
      {s}
    </Text>
  );
  return (
    <Animated.View ref={box} collapsable={false} style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Picture picture={still ?? moving} />
      </Canvas>
      {label('12am', c, 12)}
      {label('6am', size - 14, c)}
      {label('12pm', c, size - 12)}
      {label('6pm', 14, c)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dialLabel: { position: 'absolute', width: 44, textAlign: 'center', fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
});
