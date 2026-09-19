/**
 * A drop opening out of its own poster.
 *
 * The island's rule applied to content (docs/motion.md): the thing you touched grows into the
 * page, on the island's spring, and folds back into the same place when you close it. It is a
 * window, not a zoom: the page is laid out at full size from the first frame and the poster's
 * rectangle is the window onto it, growing to the screen. Because the page opens ON the post
 * (`DropSheet`: the frame fills the screen), what shows through the small window at the start is
 * the same picture the poster was, and the morph reads as the poster itself getting bigger.
 *
 * The sheet over the picture arrives late (0.34 to 0.84 of the morph), the same lag the island's
 * content has, so the picture leads and the words follow.
 *
 * A deep link still opens the `/drop/[id]` route; this is the in-tab path, where there is a poster
 * to grow out of.
 */
import { Image } from 'expo-image';
import React, { useCallback, useEffect } from 'react';
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { tokens } from '../../generated/tokens';
import { CONTENT_IN, SPRING } from '../../motion';
import { overlay } from '../../ui/overlay';
import { DropSheet } from '../DropSheet';
import type { DropRow, MoveRow } from '../types';
import { useBoard } from '../useBoard';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export function Opening({
  origin,
  initial,
  onClosed,
  onChanged,
}: {
  origin: Rect;
  /** What the wall had when it was tapped, so the first frame needs no request. */
  initial: { drop: DropRow; moves: MoveRow[] };
  onClosed: () => void;
  /** The wall should read again: a move was started or the drop archived. */
  onChanged: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const p = useSharedValue(0);
  // Its own board, because it lives above the tabs (`ui/overlay.tsx`) and a move it starts has to
  // be seen running here, not only on the wall underneath.
  const board = useBoard();
  const drop = board.drops.find((d) => d.id === initial.drop.id) ?? initial.drop;
  const moves = board.drops.length > 0 ? board.moves : initial.moves;
  const onStart = (ids: string[], adjustment: string | null, repoKeys: Record<string, string>) => {
    void board.start(drop.id, ids, adjustment, repoKeys).then(onChanged);
  };
  const onArchive = () => {
    void board.archive(drop.id).then(onChanged);
    close();
  };

  useEffect(() => {
    p.value = withSpring(1, SPRING.island);
  }, [p]);

  const close = useCallback(() => {
    p.value = withSpring(0, SPRING.snap, (done) => {
      if (done) runOnJS(onClosed)();
    });
  }, [p, onClosed]);

  // Esc in a browser window narrow enough for the phone layout closes it the same way
  // (`ui/overlay.tsx` dismiss).
  useEffect(() => overlay.onDismiss(close), [close]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const window = useAnimatedStyle(() => {
    const t = p.value;
    const x = origin.x + (0 - origin.x) * t;
    const y = origin.y + (0 - origin.y) * t;
    return {
      left: x,
      top: y,
      width: origin.w + (W - origin.w) * t,
      height: origin.h + (H - origin.h) * t,
      // The screen's own corners at the end, so the page does not arrive with square corners
      // and then snap round.
      borderRadius: interpolate(t, [0, 1], [origin.r, 0], Extrapolation.CLAMP),
    };
  });

  // The page stays where the SCREEN is while its window moves over it.
  const page = useAnimatedStyle(() => {
    const t = p.value;
    return {
      transform: [{ translateX: -(origin.x + (0 - origin.x) * t) }, { translateY: -(origin.y + (0 - origin.y) * t) }],
    };
  });

  const words = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, CONTENT_IN as unknown as number[], [0, 1], Extrapolation.CLAMP),
  }));

  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0, 1], Extrapolation.CLAMP) }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      <Animated.View style={[styles.window, window]}>
        <Animated.View style={[{ width: W, height: H }, page]}>
          {drop.thumbnail_url ? (
            <Image source={{ uri: drop.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <Animated.View style={[StyleSheet.absoluteFill, words]}>
            <DropSheet drop={drop} moves={moves} onStart={onStart} onArchive={onArchive} onClose={close} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: tokens.surface.bg.dark },
  window: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', backgroundColor: tokens.surface.card.dark },
});
