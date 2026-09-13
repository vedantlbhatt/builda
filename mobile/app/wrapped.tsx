import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clampCard } from '../src/nav/rules';
import { PixelBadge } from '../src/pixel/PixelBadge';
import { layout, space, TAP_TARGET } from '../src/theme';
import { Button, SymbolIcon, T, useColors } from '../src/ui';
import { T as Durations } from '../src/ui/motion';
import { captionOf } from '../src/wrapped/caption';
import { CARD_ORDER } from '../src/wrapped/deck';
import { DeckGrid } from '../src/wrapped/DeckGrid';
import { deckItems, type DeckItem } from '../src/wrapped/deckItems';
import { DeckSkeleton } from '../src/wrapped/DeckSkeleton';
import { SharePreview } from '../src/wrapped/SharePreview';
import { StoryStack } from '../src/wrapped/StoryStack';
import { useWrappedDeck, type DeckMeta, type WrappedDeckState } from '../src/wrapped/useWrappedDeck';
import { STORY_RATIO, WrappedCardView } from '../src/wrapped/WrappedCardView';

/**
 * Wrapped: the fifteen cards (brief section C), as a story you throw through one card at a
 * time, or as the whole deck in a tilted grid. Presented full screen over the tabs with its
 * own Close (immersive content, the skill's navigation law 2).
 *
 * Links (src/nav/DEEPLINKS.md):
 *   builder://wrapped                 the story, on card 1
 *   builder://wrapped?card=7          the story, on card 7 (1 to 15, anything else is card 1)
 *   builder://wrapped?view=grid       the grid
 *   builder://wrapped?sample=1        DEV ONLY: the sample deck, labelled as one
 *   builder://wrapped?sample=1&quotes=1  DEV ONLY: the sample with its three quotes shown
 *
 * Every state is a screen: the skeleton while nothing is cached, Bit and one action when
 * there is no report or no cards yet, the error with a retry, a saved copy labelled as one
 * when the server does not answer, and a refused card drawn as its refusal, never a 0.
 */
export default function WrappedScreen() {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ card?: string; view?: string; sample?: string; quotes?: string }>();
  const sample = __DEV__ && params.sample === '1';
  const deck = useWrappedDeck({ sample, sampleQuotes: sample && params.quotes === '1' });

  const items = useMemo(
    () => (deck.wrapped ? deckItems(deck.wrapped, deck.quotes, deck.quotesState, deck.sources) : []),
    [deck.wrapped, deck.quotes, deck.quotesState, deck.sources],
  );

  // `?card=N` names the Nth question; the deck may be shorter (a card nobody can draw is
  // left out), so N is found by its id, and a missing one opens on the first card.
  const wanted = CARD_ORDER[clampCard(params.card) - 1];
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.min(Math.max(0, picked ?? items.findIndex((it) => it.card.id === wanted)), Math.max(0, items.length - 1));

  const [mode, setMode] = useState<'story' | 'grid'>(params.view === 'grid' ? 'grid' : 'story');
  const [sharing, setSharing] = useState<DeckItem | null>(null);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/you');
  }, [router]);

  const ready = deck.status === 'ready' && items.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <TopBar
        meta={deck.meta}
        stale={deck.stale}
        sample={deck.sample}
        mode={ready ? mode : null}
        onToggle={() => setMode((m) => (m === 'story' ? 'grid' : 'story'))}
        onClose={close}
      />

      {!ready ? (
        <Waiting deck={deck} width={width} onRetry={() => void deck.refresh()} router={router} />
      ) : mode === 'story' ? (
        <Animated.View key="story" entering={FadeIn.duration(Durations.std)} style={{ flex: 1 }}>
          <Story
            items={items}
            index={index}
            deck={deck}
            onFront={setPicked}
            onShare={(i) => setSharing(items[i] ?? null)}
          />
        </Animated.View>
      ) : (
        <Animated.View key="grid" entering={FadeIn.duration(Durations.std)} style={{ flex: 1 }}>
          <DeckGrid
            items={items}
            width={width}
            revealed={deck.revealed}
            revealReady={deck.revealReady}
            onRevealed={deck.markRevealed}
            onOpen={(i) => {
              setPicked(i);
              setMode('story');
            }}
            refreshControl={
              deck.sample ? undefined : (
                <RefreshControl refreshing={deck.refreshing} onRefresh={() => void deck.refresh()} tintColor={c.accent} />
              )
            }
          />
        </Animated.View>
      )}

      {sharing ? <SharePreview item={sharing} onClose={() => setSharing(null)} /> : null}
    </View>
  );
}

// ─── the bar ────────────────────────────────────────────────────────────────────────────

function TopBar({
  meta,
  stale,
  sample,
  mode,
  onToggle,
  onClose,
}: {
  meta: DeckMeta | null;
  stale: boolean;
  sample: boolean;
  /** Null while there is no deck to switch views of. */
  mode: 'story' | 'grid' | null;
  onToggle: () => void;
  onClose: () => void;
}) {
  const caption = captionOf(meta, stale, sample);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.xs,
        paddingLeft: layout.gutter,
        paddingRight: space.xs,
        paddingTop: space.sm,
        paddingBottom: space.sm,
      }}
    >
      <View style={{ flex: 1, gap: space.xs, paddingTop: space.sm }}>
        <T role="title" accessibilityRole="header">
          Wrapped
        </T>
        {caption ? (
          <T role="meta" tone="dim" numberOfLines={2}>
            {caption}
          </T>
        ) : null}
      </View>
      {mode !== null ? (
        <BarIcon
          name={mode === 'story' ? 'square.grid.2x2' : 'rectangle.stack'}
          label={mode === 'story' ? 'Show every card' : 'Show one card at a time'}
          onPress={onToggle}
        />
      ) : null}
      <BarIcon name="xmark" label="Close" onPress={onClose} />
    </View>
  );
}

/** A bar button: an SF Symbol, the 44pt tap floor, opacity on press (the skill's bar rule). */
function BarIcon({ name, label, onPress }: { name: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: TAP_TARGET,
        height: TAP_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <SymbolIcon name={name} weight="semibold" tone="text" />
    </Pressable>
  );
}

// ─── the story ──────────────────────────────────────────────────────────────────────────

/** Room round the story card for the cards fanned behind it (their corners reach ~38pt). */
const FAN_MARGIN = space.section;

function storyCardSize(box: { w: number; h: number }): { width: number; height: number } {
  const width = Math.floor(Math.min(box.w - FAN_MARGIN * 2, (box.h - space.lg) / STORY_RATIO));
  return { width, height: Math.round(width * STORY_RATIO) };
}

function Story({
  items,
  index,
  deck,
  onFront,
  onShare,
}: {
  items: readonly DeckItem[];
  index: number;
  deck: WrappedDeckState;
  onFront: (i: number) => void;
  onShare: (i: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [front, setFront] = useState(index);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 0.5 || Math.abs(box.h - height) > 0.5) setBox({ w: width, h: height });
  };
  const size = box ? storyCardSize(box) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} onLayout={onLayout}>
        {box && size ? (
          <StoryStack
            count={items.length}
            initial={index}
            boxWidth={box.w}
            boxHeight={box.h}
            width={size.width}
            height={size.height}
            onFrontChange={(i) => {
              setFront(i);
              onFront(i);
            }}
            labelFor={(i) => items[i]?.face.label ?? ''}
            renderCard={(i, slot) => {
              const it = items[i];
              if (!it) return null;
              const id = it.card.id;
              return (
                <WrappedCardView
                  card={it.card}
                  face={it.face}
                  sources={it.sources}
                  width={size.width}
                  height={size.height}
                  variant="story"
                  play={deck.revealReady && slot.front && !deck.revealed.has(id)}
                  pending={!deck.revealReady || !deck.revealed.has(id)}
                  onRevealed={() => deck.markRevealed(id)}
                  contentStyle={slot.contentStyle}
                />
              );
            }}
          />
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: layout.gutter,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
        }}
      >
        <T role="meta" tone="dim" accessibilityElementsHidden>
          {`${front + 1} of ${items.length}`}
        </T>
        <Button kind="secondary" size="compact" block={false} label="Share" onPress={() => onShare(front)} />
      </View>
    </View>
  );
}

// ─── every state that is not a deck ─────────────────────────────────────────────────────

function Waiting({
  deck,
  width,
  onRetry,
  router,
}: {
  deck: WrappedDeckState;
  width: number;
  onRetry: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  if (deck.status === 'loading') {
    // Nothing cached yet: the stack's own shape, and Bit reading.
    const size = box ? storyCardSize(box) : null;
    return (
      <View style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (!box || box.w !== w || box.h !== h) setBox({ w, h });
          }}
        >
          {box && size ? <DeckSkeleton boxWidth={box.w} boxHeight={box.h} width={size.width} height={size.height} /> : null}
        </View>
        <PixelBadge state="thinking" size={48} text="Reading your cards…" style={{ paddingBottom: insets.bottom + space.sm }} />
      </View>
    );
  }

  // A report whose every card the copy layer declined to draw is, on screen, a report with
  // no cards in it: never a skeleton that waits for nothing.
  const status = deck.status === 'ready' ? 'no_cards' : deck.status;
  const empty = EMPTY[status];
  // The api layer's own words for a failed request ("Builda is not reachable right now.").
  const text = status === 'error' ? (deck.error ?? empty.text) : empty.text;
  const action =
    status === 'signed_out'
      ? () => router.dismissTo('/settings')
      : status === 'no_report'
        ? () => router.dismissTo('/pair')
        : onRetry;

  return (
    <View style={{ flex: 1, paddingHorizontal: layout.gutter, paddingTop: space.xl, gap: space.lg, maxWidth: width }}>
      <PixelBadge state={empty.creature} size={64} title={empty.title} text={text} style={{ padding: 0 }} />
      <Button label={empty.action} onPress={action} busy={deck.refreshing} busyLabel="Checking" />
    </View>
  );
}

/** Bit, two lines and the one action that fills the screen (DESIGN-DIRECTION 9). */
const EMPTY = {
  signed_out: {
    creature: 'idle',
    title: 'Sign in to see your cards.',
    text: 'Your Mac works them out from the sessions you finish and sends them with its report.',
    action: 'Open Settings',
  },
  no_report: {
    creature: 'sleeping',
    title: 'No report from your Mac yet.',
    text: 'The cards are worked out on your Mac from your transcripts and arrive with its next report. If no Mac is connected to this account yet, start there.',
    action: 'Connect your Mac',
  },
  no_cards: {
    creature: 'idle',
    title: 'This report has no cards in it.',
    text: 'Your Mac sent it from a version of capture that does not work the cards out. They arrive with a report from a newer one.',
    action: 'Check again',
  },
  error: {
    creature: 'sleeping',
    title: 'Could not load your cards.',
    text: 'Builda is not reachable right now.',
    action: 'Try again',
  },
} as const;
