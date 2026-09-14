/**
 * A Wrapped card's dithered header, drawn: the field `art.ts` computes, one pixel per dither
 * cell, through the kit's one Bayer shader, in the card's own hue.
 *
 * The owner's 2026-09-13 override retired the one amber header: each card wears its hue
 * (`ArtSpec.hue`, `cardHue`) in DESIGN-V2 1.4's three levels, paper, the hue's partner and the
 * hue's ink. The levels are drawn as two one level layers of the kit's `Dither` (`toneLayers`:
 * the partner layer, then the ink layer over it, both on transparent paper), which is the three
 * level recipe cell for cell. Static: nothing here moves.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { HueName, Scheme } from '../theme';
import { Dither, fieldImage } from '../ui/Dither';
import { fitCells } from '../ui/dithering';
import { useScheme } from '../ui/scheme';
import { artTones, fieldOf, toneLayers, type ArtSpec } from './art';

export interface CardArtProps {
  spec: ArtSpec;
  width: number;
  height: number;
  /** The grain in points: 3 on a story card (whole device pixels at @2x and @3x), 2 in the grid. */
  cell: number;
  /** A refused card's header: its seeded field, thinned to the partner level, so absence reads as absence. */
  faded?: boolean;
  /** The card's hue. Default: the one `artFor` chose for this card (`spec.hue`), amber if none. */
  hue?: HueName;
  /**
   * Default: the kit's `SchemeProvider`. On light the ink is the hue's 3:1 mark tone and the
   * partner its light partner; a share card is dark in both appearances, so it passes `dark`.
   */
  scheme?: Scheme;
}

export function CardArt({ spec, width, height, cell, faded = false, hue, scheme }: CardArtProps) {
  const contextScheme = useScheme();
  const tones = artTones(hue ?? spec.hue ?? 'amber', scheme ?? contextScheme);
  const box = fitCells(width, height, cell);
  // Rebuilt only when the spec or the cell count changes: the field is a few thousand cells,
  // and each image a few kilobytes, so a card that re-renders for its count up never redraws.
  const images = useMemo(() => {
    const layers = toneLayers(fieldOf(spec, box.cols, box.rows, { faded }));
    return { partner: fieldImage(layers.partner), ink: fieldImage(layers.ink) };
  }, [spec, box.cols, box.rows, faded]);
  return (
    <View style={{ width: box.width, height: box.height }}>
      <Dither width={box.width} height={box.height} cell={cell} image={images.partner} ink={tones.partner} fit="fill" sampling="nearest" />
      <Dither
        width={box.width}
        height={box.height}
        cell={cell}
        image={images.ink}
        ink={tones.ink}
        fit="fill"
        sampling="nearest"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
