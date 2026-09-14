/**
 * The Wrapped grid: every card at once, small, each in its own hue: two columns, the fifteen
 * colour worlds at a glance (the owner's "why are all of them the same color", answered). Each
 * card is turned by the fixed tilt table (`deck.gridTilt`, never random, so two screenshots of
 * the deck are the same picture) and arrives on react-bits AnimatedContent: rising 12 points from
 * 0.95, its colour snapping in under 100 ms while it moves (a hue half faded over the ground is
 * brown), 40 ms after the one before, the whole deck in about half a second (Appllama's Yazio
 * study: objects "enter as separately staggered damped springs" over ~0.53 s). Once, when the
 * grid opens; a pulled refresh does not replay it. A tap opens that card in the story.
 *
 * Reduce Motion: the cards fade in at once over 150 ms (AnimatedContent's still).
 */
import React, { type ReactElement } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';

import { GROUND } from '../insights/palette';
import { layout, space, type Hue } from '../theme';
import { AnimatedContent } from '../ui/bits/effects/AnimatedContent';
import { PressableScale } from '../ui/PressableScale';
import { GRID_COLUMNS, gridTilt } from './deck';
import type { DeckItem } from './deckItems';
import { GRID_RATIO } from './story';
import { GridCard } from './WrappedCardView';

export interface DeckGridProps {
  items: readonly DeckItem[];
  hues: readonly Hue[];
  width: number;
  onOpen: (index: number) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}

/** 40 ms apart, all fifteen: the kit's step, without its cap of eight (the deck is one piece). */
const STEP = 40;

export function DeckGrid({ items, hues, width, onOpen, refreshControl }: DeckGridProps) {
  const cardWidth = Math.floor((width - layout.gutter * 2 - layout.tileGap * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const cardHeight = Math.round(cardWidth * GRID_RATIO);

  return (
    <ScrollView
      style={styles.scroll}
      // The screen's bottom bar holds the safe area and the hint ("Tap a card to open it.").
      contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space.sm, paddingBottom: space.section }}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      <View style={styles.grid}>
        {items.map((item, i) => {
          const hue = hues[i]!;
          return (
            <AnimatedContent key={item.card.id} index={i} step={STEP} cap={items.length} distance={12} scale={0.95} hue>
              <View style={{ transform: [{ rotate: `${gridTilt(i)}deg` }] }}>
                <PressableScale onPress={() => onOpen(i)} accessibilityLabel={item.face.label} accessibilityHint="Opens this card on its own">
                  <GridCard item={item} hue={hue} width={cardWidth} height={cardHeight} number={i + 1} />
                </PressableScale>
              </View>
            </AnimatedContent>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap },
});
