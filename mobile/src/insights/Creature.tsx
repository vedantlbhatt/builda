/**
 * The builder's creature, drawn two ways: large, arriving on its band, and small, as a flat mark
 * beside an archetype's rule.
 *
 * WHAT CHANGED (docs/motion.md, the pixel diet). The large one used to PRINT itself, each cell
 * arriving in a random order, on nine screens, the same half second of pixels every time a page
 * opened. The pixel art stays (it is the identity); the pixel-by-pixel print does not. It arrives
 * the way everything arrives now: whole, growing from 0.86 on the island spring (`springAt`, read
 * off its block's clock) and hanging a few points down into place, a beat after its band.
 *
 * The frames are the pack's own (`src/pixel/animals.ts`, frame 0, the rest pose); only the ink
 * is this page's, so the creature wears its hue from the colour sheet.
 */
import React, { useMemo } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { cellsPath } from '../motion/faceModel';
import { springAt } from '../motion/spec';
import { ANIMAL_FRAMES, type Animal } from '../pixel/animals';
import { useClock, useReducedSV } from './reveal';

const GRID = 16;

function inked(animal: Animal): { x: number; y: number }[] {
  const frame = ANIMAL_FRAMES[animal]?.[0] ?? [];
  const out: { x: number; y: number }[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.push({ x, y });
  });
  return out;
}

/**
 * Large, on a band. `size` snaps down to whole points per cell so pixels stay square. `spread` is
 * kept for the callers that still pass it (it was the print's length) and no longer read.
 */
export function CreaturePrint({ animal, size, color, delay = 0 }: { animal: Animal; size: number; color: string; delay?: number; spread?: number }) {
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const clock = useClock();
  const reduced = useReducedSV();
  const arrive = useAnimatedStyle(() => {
    if (reduced.value) return { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] };
    const p = springAt(clock.value - delay);
    return {
      opacity: Math.min(1, Math.max(0, (clock.value - delay) / 120)),
      transform: [{ scale: 0.86 + 0.14 * p }, { translateY: (1 - p) * -6 }],
    };
  });
  return (
    <Animated.View style={[{ width: drawn, height: drawn }, arrive]} accessible accessibilityLabel={`${animal}, your creature`}>
      <CreatureMark animal={animal} size={drawn} color={color} />
    </Animated.View>
  );
}

/**
 * Small and still, beside a rule or on a list row: whole pixels at 16, 20 or 24 points. One path,
 * not a rectangle per cell: the Sessions list draws one of these per row, and ninety native views
 * a row is what a scroll pays for (`motion/Face.tsx` has the measurement that found it).
 */
export function CreatureMark({ animal, size = 16, color }: { animal: Animal; size?: number; color: string }) {
  const d = useMemo(() => cellsPath(inked(animal)), [animal]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={d} fill={color} />
    </Svg>
  );
}
