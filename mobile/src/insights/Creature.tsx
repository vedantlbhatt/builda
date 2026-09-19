/**
 * The builder's creature, drawn two ways: large, printing itself cell by cell onto its band (a
 * `PixelField`: each cell arrives in the creature's own order, then still), and small, as a flat
 * mark beside an archetype's rule or on a list row.
 *
 * The print is the creature's own (`motion/pixelMotion.ts`): the octopus might open from its
 * centre, the dog scan down, the whale land in blocks. It used to be one random order for every
 * creature on nine screens; the pixels were never the problem, the sameness was.
 *
 * The frames are the pack's own (`src/pixel/animals.ts`, frame 0, the rest pose); only the ink
 * is this page's, so the creature wears its hue from the colour sheet.
 */
import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

import { cellsPath } from '../motion/faceModel';
import { cellOrder, motionFor, type PixelMotion } from '../motion/pixelMotion';
import { ANIMAL_FRAMES, type Animal } from '../pixel/animals';
import { PixelField, type PixelCell } from './Pixels';

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
 * how long the whole print takes; `motion` overrides the creature's own order.
 */
export function CreaturePrint({
  animal,
  size,
  color,
  delay = 0,
  spread = 520,
  motion,
}: {
  animal: Animal;
  size: number;
  color: string;
  delay?: number;
  spread?: number;
  motion?: PixelMotion;
}) {
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const order = motion ?? motionFor(`creature:${animal}`);
  const cells: PixelCell[] = useMemo(
    () =>
      inked(animal).map(({ x, y }) => ({
        x: x * px,
        y: y * px,
        w: px,
        h: px,
        color,
        delay: delay + cellOrder(order, x, y, GRID, GRID, 7) * spread,
      })),
    [animal, px, color, delay, spread, order],
  );
  return <PixelField cells={cells} width={drawn} height={drawn} duration={90} grow={false} accessibilityLabel={`${animal}, your creature`} />;
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
