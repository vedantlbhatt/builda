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
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

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
}

export function StackView({
  spot,
  drops,
  busy,
  onOpen,
  dim = false,
  cardScale = 1,
  arriving = false,
}: StackViewProps) {
  const c = useColors();
  const raw = stackSize(spot.size);
  const box = { width: raw.width * cardScale, height: raw.height * cardScale };
  const ids = drops.map((d) => d.id);
  const cards = seats(spot, ids, cardScale);
  const hidden = spot.size - cards.length;

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[
        styles.root,
        {
          left: spot.x - spot.width / 2,
          top: spot.y - spot.height / 2,
          width: spot.width,
          height: spot.height,
          opacity: dim ? 0.25 : 1,
        },
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${spot.label || 'drops'}, ${spot.size}`}
        onPress={() => {
          select();
          onOpen(spot.cluster);
        }}
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
      </Pressable>
    </Animated.View>
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
