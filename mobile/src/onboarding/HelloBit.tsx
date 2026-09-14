import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';

import { cellHash, PixelField, type PixelCell } from '../insights/Pixels';
import { useClock } from '../insights/reveal';
import { EYES, GRID } from '../pixel/frames';
import { SPRITES } from '../pixel/sprites';
import { useReduceMotion } from '../ui/motion';
import { HELLO_BLINK, HELLO_PRINT, HELLO_PRINT_MS } from './flow';

/**
 * Bit on hello's band: the resting pose, printed in the band's dark ink a cell at a time in a
 * random order a little biased to the top, the way the analysis page prints the builder's
 * creature on its band (`insights/Creature.tsx`), and then still. Once it has printed it blinks
 * twice (duolingo's welcome: once as it arrives, once more while the person reads).
 *
 * A blink is the family's (`src/pixel/motion.ts`): the eye holes filled on one frame, held for
 * 120ms, opened on one frame. The pixels never fade. Reduce Motion: Bit is simply there, and
 * does not blink.
 *
 * It reads its block's clock (`insights/reveal.tsx`), so it must sit on a step's band.
 */
export function HelloBit({ size, color }: { size: number; color: string }) {
  const reduced = useReduceMotion();
  const clock = useClock();
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const [printed, setPrinted] = useState(false);
  const [closed, setClosed] = useState(false);

  const cells: PixelCell[] = useMemo(() => {
    const frame = SPRITES.idle[0]!;
    const out: PixelCell[] = [];
    frame.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '.') continue;
        out.push({
          x: x * px,
          y: y * px,
          w: px,
          h: px,
          color,
          delay: HELLO_PRINT.fromMs + (cellHash(x, y, 5) * 0.7 + (y / GRID) * 0.3) * HELLO_PRINT.spreadMs,
        });
      }
    });
    return out;
  }, [px, color]);

  const land = useCallback(() => setPrinted(true), []);
  useAnimatedReaction(
    () => clock.value >= HELLO_PRINT_MS,
    (done, was) => {
      if (done && !was) runOnJS(land)();
    },
    [land],
  );

  useEffect(() => {
    if (reduced || !printed) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const at of HELLO_BLINK.atMs) {
      timers.push(setTimeout(() => setClosed(true), at));
      timers.push(setTimeout(() => setClosed(false), at + HELLO_BLINK.closedMs));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [reduced, printed]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: drawn, height: drawn }}>
        <PixelField cells={cells} width={drawn} height={drawn} duration={HELLO_PRINT.cellMs} grow={false} />
        {/* The lids: the cells of both eye holes filled with the body's ink, switched on for a blink. */}
        {EYES.map(([x, y]) => (
          <View
            key={`${x}.${y}`}
            style={{ position: 'absolute', left: x * px, top: y * px, width: px, height: px, backgroundColor: color, opacity: closed ? 1 : 0 }}
          />
        ))}
      </View>
    </View>
  );
}
