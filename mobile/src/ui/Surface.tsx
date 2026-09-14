import React from 'react';
import { View, type ViewProps } from 'react-native';

import { floatShadow, layout } from '../theme';
import { useColors } from './scheme';
import { SHAPE, type ShapeName } from './shape';

export type SurfaceLevel = 'bg' | 'card' | 'raised';

export interface SurfaceProps extends ViewProps {
  /** bg, then card, then raised: depth on dark is a one-step lift plus a hairline. */
  level?: SurfaceLevel;
  /** A 1pt `border` outline. Default true for card and raised, false for bg. */
  hairline?: boolean;
  /** From the radius rule. Default `container` (18). */
  shape?: ShapeName;
  /** Inner padding. Default the tile padding (14); 0 for a list of edge-to-edge rows. */
  padding?: number;
  /**
   * Floats over content (a dragged card, a toast): the one shadow token. Nothing in the
   * scroll flow floats. A floating surface does not clip, so the shadow can show.
   */
  floating?: boolean;
}

/**
 * A level of the surface stack. Flat by default: no shadow, no gradient, a 1pt hairline.
 * Clips its children to its corners so a row's press highlight follows the curve.
 */
export function Surface({
  level = 'card',
  hairline,
  shape = 'container',
  padding = layout.tilePad,
  floating = false,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const c = useColors();
  const outlined = hairline ?? level !== 'bg';
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: c[level],
          borderRadius: SHAPE[shape],
          borderCurve: 'continuous',
          padding,
          overflow: floating ? 'visible' : 'hidden',
        },
        outlined ? { borderWidth: 1, borderColor: c.border } : null,
        floating ? { boxShadow: floatShadow } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}
