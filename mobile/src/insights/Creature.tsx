/**
 * The builder's creature, drawn two ways: large, printing itself pixel by pixel onto its band
 * (a `PixelField`, each cell arriving in a random order, then still: one creature per screen,
 * and this one does not idle), and small, as a flat mark beside an archetype's rule.
 *
 * The frames are the pack's own (`src/pixel/animals.ts`, frame 0, the rest pose); only the ink
 * is this page's, so the creature wears its hue from the colour sheet.
 */
import React, { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';

import { ANIMAL_FRAMES, type Animal } from '../pixel/animals';
import { cellHash, PixelField, type PixelCell } from './Pixels';

const GRID = 16;

function inked(animal: Animal): { x: number; y: number }[] {
  const frame = ANIMAL_FRAMES[animal]?.[0] ?? [];
  const out: { x: number; y: number }[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.push({ x, y });
  });
  return out;
}

/** Large, on a band. `size` snaps down to whole points per cell so pixels stay square. */
export function CreaturePrint({ animal, size, color, delay = 0, spread = 520 }: { animal: Animal; size: number; color: string; delay?: number; spread?: number }) {
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const cells: PixelCell[] = useMemo(
    () =>
      inked(animal).map(({ x, y }) => ({
        x: x * px,
        y: y * px,
        w: px,
        h: px,
        color,
        // Random order, a little biased to the top, like the band it sits on.
        delay: delay + (cellHash(x, y, 7) * 0.7 + (y / GRID) * 0.3) * spread,
      })),
    [animal, px, color, delay, spread],
  );
  return <PixelField cells={cells} width={drawn} height={drawn} duration={90} grow={false} accessibilityLabel={`${animal}, your creature`} />;
}

/** Small and still, beside a rule: whole pixels at 16, 20 or 24 points. */
export function CreatureMark({ animal, size = 16, color }: { animal: Animal; size?: number; color: string }) {
  const cells = useMemo(() => inked(animal), [animal]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cells.map((c) => (
        <Rect key={`${c.x}.${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} fill={color} />
      ))}
    </Svg>
  );
}
