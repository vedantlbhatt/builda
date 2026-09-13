/**
 * A Wrapped card's dithered header, drawn: the field `art.ts` computes, one pixel per dither
 * cell, through the kit's one Bayer shader in amber (DESIGN-DIRECTION 6). Static: the
 * threshold drifts only on the archetype hero, never here.
 */
import React, { useMemo } from 'react';

import { Dither, fieldImage } from '../ui/Dither';
import { fitCells } from '../ui/dithering';
import { fieldOf, type ArtSpec } from './art';

export interface CardArtProps {
  spec: ArtSpec;
  width: number;
  height: number;
  /** The grain in points: 3 on a story card (whole device pixels at @2x and @3x), 2 in the grid. */
  cell: number;
  /** A refused card's header: its seeded field, thinned, so absence reads as absence. */
  faded?: boolean;
}

export function CardArt({ spec, width, height, cell, faded = false }: CardArtProps) {
  const box = fitCells(width, height, cell);
  // Rebuilt only when the spec or the cell count changes: the field is a few thousand cells,
  // and the image a few kilobytes, so a card that re-renders for its count up never redraws.
  const image = useMemo(() => fieldImage(fieldOf(spec, box.cols, box.rows, { faded })), [spec, box.cols, box.rows, faded]);
  return <Dither width={box.width} height={box.height} cell={cell} image={image} fit="fill" sampling="nearest" />;
}
