/**
 * The Wrapped grid: every card at once, two columns 12pt apart, each turned by the fixed
 * tilt table so the deck reads as a scatter of real cards and two screenshots of it are the
 * same picture (DESIGN-DIRECTION 6). A tap opens that card in the story.
 *
 * A card's first reveal happens here if this is where it is first seen: its answer counts
 * up once it is mostly on screen, staggered 40ms a card across what arrives together.
 */
import React, { useCallback, useRef, useState, type ReactElement } from 'react';
import { FlatList, View, type RefreshControlProps, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { WrappedCard } from '../generated/report';
import { layout, space } from '../theme';
import { PressableScale, staggerDelay } from '../ui';
import { GRID_COLUMNS, gridTilt } from './deck';
import type { DeckItem } from './deckItems';
import { STORY_RATIO, WrappedCardView } from './WrappedCardView';

export interface DeckGridProps {
  items: readonly DeckItem[];
  /** The screen's width; the grid takes the gutter off each side. */
  width: number;
  onOpen: (index: number) => void;
  revealed: ReadonlySet<WrappedCard>;
  revealReady: boolean;
  onRevealed: (id: WrappedCard) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Above the first row: the stale line, the sample label. */
  header?: ReactElement | null;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

export function DeckGrid({ items, width, onOpen, revealed, revealReady, onRevealed, refreshControl, header }: DeckGridProps) {
  const insets = useSafeAreaInsets();
  const cardWidth = Math.floor((width - layout.gutter * 2 - layout.tileGap * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const cardHeight = Math.round(cardWidth * STORY_RATIO);

  // Which cards are on screen now, and the order they arrived in, for the stagger.
  const [visible, setVisible] = useState<ReadonlyMap<string, number>>(new Map());
  // A stable callback: FlatList refuses a changing onViewableItemsChanged.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = new Map<string, number>();
    viewableItems.forEach((v, i) => {
      if (v.isViewable && typeof v.key === 'string') next.set(v.key, i);
    });
    setVisible(next);
  }).current;

  const renderItem = useCallback(
    ({ item, index }: { item: DeckItem; index: number }) => {
      const id = item.card.id;
      const order = visible.get(id);
      const play = revealReady && order !== undefined && !revealed.has(id);
      return (
        <View style={{ transform: [{ rotate: `${gridTilt(index)}deg` }] }}>
          <PressableScale
            onPress={() => onOpen(index)}
            accessibilityLabel={item.face.label}
            accessibilityHint="Opens this card on its own"
          >
            <WrappedCardView
              card={item.card}
              face={item.face}
              sources={item.sources}
              width={cardWidth}
              height={cardHeight}
              variant="grid"
              play={play}
              pending={!revealReady || !revealed.has(id)}
              delay={staggerDelay(order ?? 0)}
              onRevealed={() => onRevealed(id)}
            />
          </PressableScale>
        </View>
      );
    },
    [visible, revealReady, revealed, onOpen, onRevealed, cardWidth, cardHeight],
  );

  return (
    <FlatList
      data={items as DeckItem[]}
      keyExtractor={(it) => it.card.id}
      numColumns={GRID_COLUMNS}
      renderItem={renderItem}
      extraData={[visible, revealed, revealReady]}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      columnWrapperStyle={{ gap: layout.tileGap }}
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.sm,
        paddingBottom: insets.bottom + space.section,
        gap: layout.tileGap,
      }}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={header ?? null}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    />
  );
}
