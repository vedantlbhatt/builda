/**
 * A project's weeks in pixels, beside its name on its row: one column a week, as many cells as its
 * hours that week against its own busiest (`rows.weekCells`), in its hue, the latest week on the
 * right. Printed once, column by column from the left, each column rising from its foot (the
 * `rise` order, a level meter settling), as the row arrives. The chapters compare projects; a row
 * shows one project's rhythm, so its busiest week is always full height.
 */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useOptionalClock } from '../insights/reveal';
import { GROUND } from '../insights/palette';

/** A cell, in points: the band's (tokens.dither.cell). */
const CELL = 3;
/** One cell of ground between columns. */
const GAP = CELL;

export function WeekPixels({ cells, ink, tall = 6, delay = 320 }: { cells: readonly number[]; ink: string; tall?: number; delay?: number }) {
  const width = cells.length * (CELL * 2 + GAP) - GAP;
  const height = tall * CELL;
  if (!cells.length) return null;
  return (
    <View style={{ width, height }} accessible={false}>
      {cells.map((n, i) => (
        <Column key={i} x={i * (CELL * 2 + GAP)} n={n} tall={tall} ink={ink} delay={delay + i * 28} />
      ))}
    </View>
  );
}

function Column({ x, n, tall, ink, delay }: { x: number; n: number; tall: number; ink: string; delay: number }) {
  const clock = useOptionalClock();
  const cells = useMemo(() => Array.from({ length: tall }, (_, k) => k), [tall]);
  return (
    <View style={{ position: 'absolute', left: x, bottom: 0, width: CELL * 2, height: tall * CELL }}>
      {cells.map((k) => (
        <Cell key={k} k={k} lit={k < n} ink={ink} delay={delay + k * 40} clock={clock} />
      ))}
    </View>
  );
}

function Cell({ k, lit, ink, delay, clock }: { k: number; lit: boolean; ink: string; delay: number; clock: ReturnType<typeof useOptionalClock> }) {
  const style = useAnimatedStyle(() => ({ opacity: !lit ? 1 : !clock ? 1 : clock.value >= delay ? 1 : 0 }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 0, bottom: k * CELL, width: CELL * 2, height: CELL },
        // The foot cell of a week with no time is the raised ground, so the axis reads as a row of weeks.
        { backgroundColor: lit ? ink : k === 0 ? GROUND.raised : 'transparent' },
        style,
      ]}
    />
  );
}
