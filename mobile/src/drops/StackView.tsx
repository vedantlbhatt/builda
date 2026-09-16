/**
 * One cluster, as a fanned pile of its own cards.
 *
 * A board of forty drops is eight piles, not forty dots. The top card is square on and carries
 * the title; the ones behind it lean and peek, so you can see there are more without reading
 * them. Tapping the pile opens it (`Board.tsx` puts the open one over the wall), which is the
 * only thing a pile does.
 *
 * The word above it is the cluster's own, from the drops' own vocabulary (`cluster.ts`), and the
 * count beside it is how many are in the pile. Both in the warm grey: the colour on this board is
 * the hairline on each card's edge and nothing else.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { stackSize } from './card';
import { DropCard } from './CardView';
import { LABEL_H, seats, type StackSpot } from './layout';
import type { DropRow, MoveRow } from './types';

export interface StackViewProps {
  spot: StackSpot;
  drops: DropRow[];
  busy: Set<string>;
  onOpen: (cluster: number) => void;
  dim?: boolean;
  /** One number for the whole board, so no two piles draw cards at different sizes. */
  cardScale?: number;
  /**
   * The cards are in the air right now (`Board.Arrival` is drawing them), so the pile holds their
   * seats open and draws nothing in them. The word and the count stay: the pile is the thing being
   * arrived INTO, so it has to be there to arrive into.
   */
  arriving?: boolean;
  /** A pile has been picked up and dropped somewhere else on the wall. */
  onMove?: (from: number, to: { x: number; y: number }) => void;
  /** Something is being dragged right now, so the wall must not scroll under it. */
  onHold?: (holding: boolean) => void;
}

export function StackView({
  spot,
  drops,
  busy,
  onOpen,
  dim = false,
  cardScale = 1,
  arriving = false,
  onMove,
  onHold,
}: StackViewProps) {
  const c = useColors();
  const openPile = React.useCallback(() => {
    select();
    onOpen(spot.cluster);
  }, [onOpen, spot.cluster]);
  const raw = stackSize(spot.size);
  const box = { width: raw.width * cardScale, height: raw.height * cardScale };
  const ids = drops.map((d) => d.id);
  const cards = seats(spot, ids, cardScale);
  const hidden = spot.size - cards.length;

  /**
   * THE WALL IS YOURS TO ARRANGE.
   *
   * Press and hold a pile and it comes up under your thumb; everything else springs out of the way
   * and closes back up behind it. The clustering decides what goes with what, and that is the part
   * a machine is better at; where each pile LIVES on your wall is the part you are better at, and
   * before this there was no way to say so.
   *
   * Long press rather than a straight pan, because the pile's other gesture is a tap that opens
   * it, and a wall you cannot scroll past without dragging something is worse than one you cannot
   * rearrange at all.
   */
  const lift = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const homeX = spot.x - spot.width / 2;
  const homeY = spot.y - spot.height / 2;
  const x = useSharedValue(homeX);
  const y = useSharedValue(homeY);

  /**
   * The spring is what makes a reflow read as the wall making room rather than as a redraw.
   *
   * Unguarded, on purpose. It used to skip while `lift` was above zero, which sounds right and is
   * exactly backwards: the frame a pile is dropped is the frame the wall reorders, and `lift` is
   * still springing down through 0.4 then. The effect bailed, its dependencies never changed
   * again, and the pile you had just moved sprang back to where it started. What the finger moves
   * is `dx`/`dy`; `x`/`y` are the slot, and the slot is always allowed to travel.
   */
  useEffect(() => {
    x.value = withSpring(homeX, { damping: 19, stiffness: 190 });
    y.value = withSpring(homeY, { damping: 19, stiffness: 190 });
  }, [homeX, homeY, x, y]);

  /**
   * ONE GESTURE, not a Pressable inside a detector.
   *
   * A `Pressable` is React Native's responder system and the drag is gesture handler's, and the
   * two do not negotiate: the Pressable claimed the touch and the long press never fired, so the
   * pile simply would not come up. Tap and drag are declared together here and the library
   * arbitrates between them, which is what it is for.
   */
  const drag = Gesture.Pan()
    .activateAfterLongPress(220)
    .enabled(!!onMove && !dim)
    .onStart(() => {
      lift.value = withSpring(1, { damping: 16, stiffness: 220 });
      if (onHold) runOnJS(onHold)(true);
    })
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
    })
    /**
     * `onFinalize`, not `onEnd`.
     *
     * `onEnd` runs only when a gesture ends cleanly, and this one is inside a scroller that can
     * take the touch back at the last moment. The pile would lift, follow the finger the whole way
     * and then spring home having told nobody where it had been put — the drag looked perfect and
     * did nothing. This runs however the gesture finishes, and a pile that was never picked up
     * (`lift` still zero) is a scroll, not a move.
     */
    .onFinalize(() => {
      const held = lift.value > 0;
      const dropped = { x: spot.x + dx.value, y: spot.y + dy.value };
      dx.value = withSpring(0, { damping: 20, stiffness: 200 });
      dy.value = withSpring(0, { damping: 20, stiffness: 200 });
      lift.value = withSpring(0, { damping: 18, stiffness: 220 });
      if (held && onMove) runOnJS(onMove)(spot.cluster, dropped);
      if (onHold) runOnJS(onHold)(false);
    });

  const open = Gesture.Tap()
    .maxDuration(400)
    .enabled(!dim)
    .onEnd((_e, ok) => {
      if (ok) runOnJS(openPile)();
    });

  const both = Gesture.Exclusive(drag, open);

  const moved = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: 1 + lift.value * 0.07 },
    ],
    zIndex: lift.value > 0.01 ? 50 : 1,
  }));

  return (
    <GestureDetector gesture={both}>
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[
        styles.root,
        {
          width: spot.width,
          height: spot.height,
          opacity: dim ? 0.25 : 1,
        },
        moved,
      ]}
      pointerEvents={dim ? 'none' : 'auto'}
    >
      <View style={styles.label}>
        <T role="label" numberOfLines={1} style={{ color: c.textDim, letterSpacing: 1.3 }}>
          {spot.label ? spot.label.toUpperCase() : ' '}
        </T>
        {spot.size > 1 ? (
          <T role="mono" style={{ color: c.textFaint }}>
            {String(spot.size)}
          </T>
        ) : null}
      </View>

      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${spot.label || 'drops'}, ${spot.size}`}
        onAccessibilityTap={openPile}
        style={[styles.pile, { width: box.width, height: box.height }]}
      >
        {cards.map((p) => {
          const drop = drops[p.index];
          if (!drop) return null;
          return (
            <View
              key={drop.id}
              style={[
                styles.card,
                {
                  left: p.left,
                  top: p.top,
                  width: p.width,
                  height: p.height,
                  opacity: arriving ? 0 : 1,
                  transform: [{ rotate: `${p.rotate}deg` }],
                  zIndex: 10 - p.depth,
                },
              ]}
            >
              <DropCard
                drop={drop}
                busy={busy.has(drop.id)}
                dim={p.depth === 0 ? 1 : 0.9 - p.depth * 0.12}
                words={p.depth === 0}
                scale={cardScale}
              />
            </View>
          );
        })}
        {hidden > 0 ? (
          <View style={[styles.more, { backgroundColor: c.raised, borderColor: c.border }]}>
            <T role="mono" style={{ color: c.textDim }}>{`+${hidden}`}</T>
          </View>
        ) : null}
      </View>
    </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute' },
  label: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    height: 22,
    paddingHorizontal: 4,
  },
  pile: { alignSelf: 'center' },
  card: { position: 'absolute' },
  more: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    zIndex: 20,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
