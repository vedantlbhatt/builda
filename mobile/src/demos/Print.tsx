/**
 * One still of a demo as a print: the picture, fetched with the bearer the local stack needs
 * (`useDemo.ts`), kept in memory and on disk under the file's id (so a presigned url that changes
 * every fifteen minutes is still one picture, and a door, the pile and the gallery share one
 * download), and DECODED AT THE SIZE IT IS SHOWN: on a door's print and a card of the pile
 * (`cover`), `enforceEarlyResizing` has the decoder produce the print's own pixels, 222 by 480 for
 * a door's print at 3x, rather than the 1206 by 2622 still the Mac published. The gallery's picture
 * (`contain`, most of the screen) is decoded whole and then brought down to its frame, the path the
 * simulator showed sharp. The bytes on the wire are the published file, the only one the server keeps.
 *
 * A print can ARRIVE: it waits in the hue it will print over (the band's, or the project's in the
 * gallery), the picture loads unseen under that cover, and once both the moment and the picture are
 * ready the cells of react-bits PixelTransition (through its port in
 * `src/ui/bits/effects/PixelTransition.tsx`, which keeps David Haz's notice) switch it over,
 * square by square. The picture is ONE image, mounted once: both sides of the transition are the
 * same view with the same image in it, and only the cover leaves.
 *
 * FOUND IN REVIEW (2026-09-14): the first version put a hidden copy of the picture under the cover
 * to load it and a second one after the swap, so every door's top print was mounted twice and
 * decoded at full size, twice.
 *
 * A picture that was not recorded from the running app says so on its lower edge, in a few plain
 * words on the ground's own dark (`mark`, `model.sourceMark`): never a picture of the repository
 * passing for the app running.
 */
import { Image } from 'expo-image';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import { GROUND, type HueName } from '../insights/palette';
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
  /** Where it came from, in a few words, when it was not recorded (`GalleryEntry.mark`). */
  mark?: string | null;
  /** Said once, when the picture could not be read (the caller may fetch new sources). */
  onError?: () => void;
  onArrived?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Print({ id, src, width, height, fit = 'cover', arrive, hue, wait, grid = 8, mark, onError, onArrived, style, accessibilityLabel }: PrintProps) {
  const [loaded, setLoaded] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);
  // The source is handed over only once the image view has its own frame. FOUND ON THE SIMULATOR
  // (2026-09-14): early resizing reads the view's bounds when the load starts, and a view React
  // Native had recycled from a door's print still had the print's 74 by 160 points, so a gallery
  // still was decoded at a third of its size and shown soft. After layout the bounds are its own.
  const [sized, setSized] = useState(false);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const l = e.nativeEvent.layout;
    if (Math.round(l.width) === Math.round(width) && Math.round(l.height) === Math.round(height)) setSized(true);
  }, [width, height]);
  const picture = (
    <Image
      key="picture"
      onLayout={onLayout}
      source={src && sized ? { uri: src.uri, headers: src.headers, cacheKey: `demo-${id}` } : undefined}
      recyclingKey={id}
      style={{ width, height }}
      contentFit={fit}
      cachePolicy="memory-disk"
      allowDownscaling
      enforceEarlyResizing={fit === 'cover'}
      transition={0}
      onLoad={onLoad}
      onError={onError}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
  const edge = mark ? (
    <View key="mark" style={styles.mark} pointerEvents="none">
      <Text allowFontScaling={false} numberOfLines={1} style={styles.markText}>
        {mark}
      </Text>
    </View>
  ) : null;
  if (arrive === undefined) {
    return (
      <View style={[{ width, height }, style]}>
        {picture}
        {edge}
      </View>
    );
  }
  // One view on both sides of the transition, the same image first in it: React keeps the image
  // mounted across the swap, and only the cover goes.
  const side = (covered: boolean) => (
    <View key="print" style={{ width, height }}>
      {picture}
      {covered ? <View key="cover" style={[StyleSheet.absoluteFill, { backgroundColor: wait }]} pointerEvents="none" /> : edge}
    </View>
  );
  return <PixelTransition style={[{ width, height }, style]} active={arrive && loaded} hue={hue} grid={grid} onComplete={onArrived} first={side(true)} second={side(false)} />;
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: GROUND.bg },
  markText: { fontSize: 10, lineHeight: 13, fontWeight: '600', color: GROUND.text },
});
