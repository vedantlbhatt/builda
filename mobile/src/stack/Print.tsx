/**
 * A band's marks, printed: every thing in the chapter's category set in a row on its band, the
 * ones a session used in the band's dark ink, the ones only a manifest names in the band's
 * partner tone, receding. They PRINT like the band under them and the creature on the hero: a
 * cover of the band's own colour, in the band's 3 pt cells, switches off cell by cell in a random
 * order biased top to bottom (react-bits PixelTransition's rule, `cellHash`, David Haz, MIT +
 * Commons Clause; the notice is in `src/ui/digits.ts`), mark after mark. Then the marks stand
 * whole and crisp: a logo is never left in pixels, because altering a brand's mark is the one
 * thing every brand's guidelines forbid, and the print is only its arrival.
 *
 * The handover, cells first and the real mark after, is appllama's Speak welcome screen
 * (top-welcome-screens `speak-learn.tsx` builds its mark procedurally and hands over to the real
 * artwork in a 67 ms swap; the pattern only, that repository is GPL).
 *
 * The cover is drawn only once the band has printed (its last cells land by 560 ms), over the
 * band's flat solid area, so a cell of cover is indistinguishable from the band until it goes.
 * Under Reduce Motion the block's clock is already at its end: the marks are simply there.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { ON_HUE, type Hue } from '../insights/palette';
import { cellHash } from '../insights/Pixels';
import { useClock } from '../insights/reveal';
import { wrapMarks } from './layout';
import { MarkView } from './Mark';
import type { StackThing } from './model';

/** One cell of the cover: the band's dither cell (tokens.dither.cell). */
const CELL = 3;
/** When the first mark starts to print: after the band's own print (560 ms) has landed. */
export const PRINT_AT = 640;
/** How long one mark's cells take to switch off, and the step from one mark to the next. */
const SPREAD = 440;
const STEP = 55;

export function PrintedMarks({
  things,
  used,
  hue,
  width,
  size = 30,
  gap = 14,
  start = PRINT_AT,
}: {
  things: readonly StackThing[];
  /** The first `used` things are a session's; the rest are only named. */
  used: number;
  hue: Hue;
  width: number;
  size?: number;
  gap?: number;
  start?: number;
}) {
  const clock = useClock();
  const { slots, height } = useMemo(() => wrapMarks(things.length, size, gap, width), [things.length, size, gap, width]);
  const cover = useMemo(() => {
    const per = Math.ceil(size / CELL);
    const xs: number[] = [];
    const ys: number[] = [];
    const at: number[] = [];
    slots.forEach((s, i) => {
      for (let cy = 0; cy < per; cy++) {
        for (let cx = 0; cx < per; cx++) {
          xs.push(s.x + cx * CELL);
          ys.push(s.y + cy * CELL);
          at.push(start + i * STEP + (cellHash(cx, cy, i + 11) * 0.7 + (cy / per) * 0.3) * SPREAD);
        }
      }
    });
    return { xs, ys, at, end: at.length ? Math.max(...at) : start };
  }, [slots, size, start]);

  const ink = hue.ink;
  const shown = useAnimatedStyle(() => ({ opacity: clock.value >= start - 30 ? 1 : 0 }));
  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        if (t < start - 60 || t > cover.end) return;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(ink));
        const { xs, ys, at } = cover;
        for (let i = 0; i < at.length; i++) {
          if (t < at[i]!) canvas.drawRect(Skia.XYWHRect(xs[i]!, ys[i]!, CELL, CELL), paint);
        }
      },
      { width, height },
    );
  }, [cover, ink, width, height, start]);

  if (!things.length) return null;
  return (
    <View style={[styles.row, { width, height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, shown]}>
        {things.map((t, i) => (
          <View key={t.id} style={[styles.slot, { left: slots[i]!.x, top: slots[i]!.y }]}>
            <MarkView mark={t.mark} size={size} color={i < used ? ON_HUE : hue.partner} />
          </View>
        ))}
      </Animated.View>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 18 },
  slot: { position: 'absolute' },
});
