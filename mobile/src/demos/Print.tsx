/**
 * One still of a demo as a print: the picture, decoded at the size it is shown (expo-image
 * downscales to its box and keeps it in memory and on disk under the file's id, so a presigned
 * url that changes every fifteen minutes is still one picture), fetched with the bearer the
 * local stack needs (`useDemo.ts`).
 *
 * A print can ARRIVE: it waits in the hue it will print over (the band's, or the project's in the
 * gallery), the picture loads unseen under it, and once both the moment and the picture are
 * ready the cells of react-bits PixelTransition (through its port in
 * `src/ui/bits/effects/PixelTransition.tsx`, which keeps David Haz's notice) switch it over,
 * square by square. It arrives once and then it is a still picture, costing nothing a frame.
 * Under Reduce Motion the port fades it in over 150 ms instead.
 */
import { Image } from 'expo-image';
import React, { useCallback, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import type { HueName } from '../insights/palette';
import { PixelTransition } from '../ui/bits/effects';

export interface PrintProps {
  id: string;
  src: MediaSourceRef | undefined;
  width: number;
  height: number;
  /** Contain shows the whole picture (the gallery); cover fills the print (a stack, a fan). */
  fit?: 'cover' | 'contain';
  /**
   * Undefined: the picture shows as soon as it loads. A boolean: the print waits in `wait` (a
   * colour) until this is true and the picture has loaded, then arrives through the cells.
   */
  arrive?: boolean;
  /** The hue the cells are drawn in, and the colour the print waits in. */
  hue?: HueName;
  wait?: string;
  /** Cells across the print as it arrives. Default 8: a door's print is small. */
  grid?: number;
  /** Said once, when the picture could not be read (the caller may fetch new sources). */
  onError?: () => void;
  onArrived?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Print({ id, src, width, height, fit = 'cover', arrive, hue, wait, grid = 8, onError, onArrived, style, accessibilityLabel }: PrintProps) {
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);
  const picture = (
    <Image
      source={src ? { uri: src.uri, headers: src.headers, cacheKey: `demo-${id}` } : undefined}
      recyclingKey={id}
      style={{ width, height }}
      contentFit={fit}
      cachePolicy="memory-disk"
      allowDownscaling
      transition={0}
      onLoad={onLoad}
      onError={onError}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
  if (arrive === undefined) return <View style={[{ width, height }, style]}>{picture}</View>;
  return (
    <PixelTransition
      style={[{ width, height }, style]}
      active={arrive && loaded}
      hue={hue}
      grid={grid}
      onComplete={onArrived}
      first={
        <View style={{ width, height, backgroundColor: wait }}>
          {/* The picture loads here unseen, so the print never uncovers an empty frame. */}
          <View style={{ position: 'absolute', opacity: 0 }} pointerEvents="none">
            {picture}
          </View>
        </View>
      }
      second={picture}
    />
  );
}
