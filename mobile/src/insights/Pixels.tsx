/**
 * The page's drawn marks that are made of cells: the contribution grid, the agents as squares,
 * the glossary's collection, the builder's creature. One Skia `Picture` per field, recorded on
 * the UI thread from the block's clock, so a field of a few hundred cells draws on in a wave at
 * the cost of one derived value, and records nothing once the clock stops.
 *
 * Each cell carries its own delay: a diagonal wave for the grid, reading order for the squares,
 * a random order for the creature (react-bits PixelTransition's rule, `hash(cell) < progress`,
 * by David Haz, MIT + Commons Clause; the notice is in `src/ui/digits.ts`; used as part of this
 * application, not redistributed). A cell arrives from a third of its size to whole over
 * `duration`, on the page's curve, and then is still: pixels at rest are whole pixels.
 */
import { Canvas, createPicture, PaintStyle, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { ease, phase } from './motion';
import { useClock } from './reveal';

export interface PixelCell {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Drawn as a hairline square, not a fill: a day before the record began. */
  outline?: boolean;
  /** A ring just outside the cell: today. */
  ring?: string;
  /** When this cell starts arriving, in ms of the block's clock. */
  delay: number;
}

export interface PixelFieldProps {
  cells: readonly PixelCell[];
  width: number;
  height: number;
  /** How long one cell takes to arrive. */
  duration?: number;
  /** Grow from a third of the size (default) or only fade (the creature's hard pixels). */
  grow?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function PixelField({ cells, width, height, duration = 420, grow = true, accessibilityLabel, style }: PixelFieldProps) {
  const clock = useClock();

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        const fill = Skia.Paint();
        fill.setAntiAlias(true);
        const line = Skia.Paint();
        line.setAntiAlias(true);
        line.setStyle(PaintStyle.Stroke);
        line.setStrokeWidth(1);
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i]!;
          const p = ease(phase(t, c.delay, duration));
          if (p <= 0) continue;
          // A cell's colour snaps in (under a third of its arrival) and its size does the rest:
          // a hue at partial opacity over the warm ground reads as brown (DESIGN-V2 1.3).
          const a = Math.min(1, p * 3.5);
          const k = grow ? 0.34 + 0.66 * p : 1;
          const w = c.w * k;
          const h = c.h * k;
          const x = c.x + (c.w - w) / 2;
          const y = c.y + (c.h - h) / 2;
          if (c.outline) {
            line.setColor(Skia.Color(c.color));
            line.setAlphaf(a);
            canvas.drawRect(Skia.XYWHRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1)), line);
          } else {
            fill.setColor(Skia.Color(c.color));
            fill.setAlphaf(a);
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
          }
          if (c.ring && p >= 1) {
            line.setColor(Skia.Color(c.ring));
            line.setAlphaf(1);
            line.setStrokeWidth(1.5);
            canvas.drawRect(Skia.XYWHRect(c.x - 2.25, c.y - 2.25, c.w + 4.5, c.h + 4.5), line);
            line.setStrokeWidth(1);
          }
        }
      },
      { width, height },
    );
  }, [cells, width, height, duration, grow]);

  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel !== undefined ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[{ width, height }, style]}
    >
      <Canvas style={{ width, height }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

/** A stable pseudo random 0..1 for a cell, the same on every render (PixelTransition's order). */
export function cellHash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * A count drawn as that many squares in a row, on a band: eleven days straight is eleven marks.
 * They arrive one after another while the number beside them counts, so the last square lands
 * with the last digit. Nothing is drawn past `cap`: a count that large is only the number.
 */
export function CountMarks({ n, width, color, delay = 200, duration = 950, cap = 40 }: { n: number; width: number; color: string; delay?: number; duration?: number; cap?: number }) {
  const count = Math.max(0, Math.floor(n));
  const perRow = Math.min(count, 20);
  const gap = 4;
  const size = perRow > 0 ? Math.max(6, Math.min(16, Math.floor((width - gap * (perRow - 1)) / perRow))) : 0;
  const cells: PixelCell[] = useMemo(() => {
    const out: PixelCell[] = [];
    if (count <= 0 || count > cap) return out;
    for (let i = 0; i < count; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      // Mark i arrives when the eased count reaches i + 1, so marks and digits agree.
      const at = (i + 1) / count;
      out.push({ x: col * (size + gap), y: row * (size + gap), w: size, h: size, color, delay: delay + inverseEase(at) * duration * 0.96 });
    }
    return out;
  }, [count, cap, perRow, size, color, delay, duration]);
  if (!cells.length) return null;
  const rows = Math.ceil(count / perRow);
  return <PixelField cells={cells} width={perRow * size + (perRow - 1) * gap} height={rows * size + (rows - 1) * gap} duration={160} />;
}

/** Where on the count's curve a mark belongs: the time at which the eased count reaches `y`. */
function inverseEase(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
