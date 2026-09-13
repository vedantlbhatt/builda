import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GROUND } from '../src/insights/palette';
import { clampCard } from '../src/nav/rules';
import { hue as hueOf, layout, MONO_FAMILY, space, TAP_TARGET, type Hue } from '../src/theme';
import { useAccent } from '../src/theme/accent';
import { TiltedCard } from '../src/ui/bits/components/TiltedCard';
import { ClickSpark, type ClickSparkHandle } from '../src/ui/bits/effects/ClickSpark';
import { GlareHover } from '../src/ui/bits/effects/GlareHover';
import { PixelTransition } from '../src/ui/bits/effects/PixelTransition';
import { SHAPE } from '../src/ui/shape';
import { captionOf } from '../src/wrapped/caption';
import { CARD_ORDER } from '../src/wrapped/deck';
import { DeckGrid } from '../src/wrapped/DeckGrid';
import { deckItems, type DeckItem } from '../src/wrapped/deckItems';
import { DeckSkeleton } from '../src/wrapped/DeckSkeleton';
import { EmptyBand } from '../src/wrapped/EmptyBand';
import { ProgressRow } from '../src/wrapped/Progress';
import { SharePreview } from '../src/wrapped/SharePreview';
import { StoryStack } from '../src/wrapped/StoryStack';
import { EMPTY_COPY, OPEN_HOLD_MS, STORY_COPY, storyCardSize, storyHue } from '../src/wrapped/story';
import { forcedState, useWrappedDeck, type WrappedDeckState } from '../src/wrapped/useWrappedDeck';
import { StoryCard } from '../src/wrapped/WrappedCardView';
import type { Animal } from '../src/pixel/animals';

/**
 * Wrapped: the fifteen cards (brief section C) in the house style (design-refs/HOUSE-STYLE.md).
 * Each card is a full bleed band in its own hue, the question and the huge answer in dark ink,
 * one sentence, and the card's own data printed and breathing under them, with the builder's
 * creature where it fits. The story is the hero: the cards in a stack you throw through (the
 * Appllama card stack's tables, react-bits Stack's finger follow), the front card leaning toward
 * the finger (react-bits TiltedCard) with a sheen on press (GlareHover), sparks in the card's hue
 * on every advance (ClickSpark), and a thin row of segments over it. The grid is the whole deck
 * small, arriving card by card (AnimatedContent); switching between them runs react-bits
 * PixelTransition in the hue of the card you are going to. Presented full screen over the tabs
 * with its own Close (immersive content, the skill's navigation law 2).
 *
 * The chrome wears the builder's creature's hue (the theme); each card wears its own, and card
 * one, the builder, wears theirs.
 *
 * Links (src/nav/DEEPLINKS.md):
 *   builder://wrapped                 the story, on card 1
 *   builder://wrapped?card=7          the story, on card 7 (1 to 15, anything else is card 1)
 *   builder://wrapped?view=grid       the grid
 *   DEV ONLY, the sample deck, labelled as one:
 *   builder://wrapped?sample=1                      the story
 *   builder://wrapped?sample=1&view=grid            the grid
 *   builder://wrapped?sample=1&quotes=1&card=9      the quote cards answered (the switch on)
 *   builder://wrapped?sample=1&refused=1            every card refused, each as its sentence
 *   builder://wrapped?sample=1&stale=1              labelled as a saved copy
 *   builder://wrapped?sample=1&card=2&share=1       the share preview open on card 2
 *   builder://wrapped?sample=1&quotes=1&card=9&share=1   the share preview's quote warning
 *   builder://wrapped?sample=1&state=loading|signed_out|no_report|no_cards|error
 *
 * Every state is a screen: the skeleton while nothing is cached, a band with the creature and
 * one action when there is no report or no cards yet, the error with a retry, a saved copy
 * labelled as one when the server does not answer, and a refused card drawn as its refusal,
 * never a 0.
 */
export default function WrappedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const params = useLocalSearchParams<{
    card?: string;
    view?: string;
    sample?: string;
    quotes?: string;
    refused?: string;
    stale?: string;
    state?: string;
    share?: string;
  }>();
  const sample = __DEV__ && params.sample === '1';
  const deck = useWrappedDeck({
    sample,
    sampleQuotes: sample && params.quotes === '1',
    sampleRefused: sample && params.refused === '1',
    sampleState: sample ? forcedState(params.state) : null,
    sampleStale: sample && params.stale === '1',
  });

  const items = useMemo(
    () => (deck.wrapped ? deckItems(deck.wrapped, deck.quotes, deck.quotesState, deck.sources) : []),
    [deck.wrapped, deck.quotes, deck.quotesState, deck.sources],
  );
  const hues = useMemo(() => items.map((it) => storyHue(it.card.id, accent.name)), [items, accent.name]);
  const theme = useMemo(() => hueOf(accent.name), [accent.name]);

  // `?card=N` names the Nth question; the deck may be shorter (a card nobody can draw is
  // left out), so N is found by its id, and a missing one opens on the first card.
  const wanted = CARD_ORDER[clampCard(params.card) - 1];
  const found = Math.max(0, items.findIndex((it) => it.card.id === wanted));
  const [picked, setPicked] = useState<number | null>(null);
  const start = Math.min(picked ?? found, Math.max(0, items.length - 1));
  const [front, setFront] = useState<number | null>(null);
  const shown = Math.min(front ?? start, Math.max(0, items.length - 1));

  const [mode, setMode] = useState<'story' | 'grid'>(params.view === 'grid' ? 'grid' : 'story');
  const [switchHue, setSwitchHue] = useState<Hue | null>(null);
  const [sharing, setSharing] = useState<number | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onBody = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && Math.abs(b.w - width) < 0.5 && Math.abs(b.h - height) < 0.5 ? b : { w: width, h: height }));
  }, []);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.dismissTo('/you');
  }, [router]);

  // The deck, its first reveal set, and the builder's hue all read: a band never paints in a
  // hue it is about to change, and nothing counts up that has counted up before.
  const ready = deck.status === 'ready' && items.length > 0 && accent.ready && deck.revealReady;

  // DEV: open straight onto the share preview.
  const sharedOnce = useRef(false);
  useEffect(() => {
    if (!ready || !sample || params.share !== '1' || sharedOnce.current) return;
    sharedOnce.current = true;
    setSharing(start);
  }, [ready, sample, params.share, start]);

  const toGrid = () => {
    setSwitchHue(hues[shown] ?? theme);
    setMode('grid');
  };
  const openCard = (i: number) => {
    setSwitchHue(hues[i] ?? theme);
    setPicked(i);
    setFront(i);
    setMode('story');
  };

  const body = !box ? null : !ready ? (
    <Waiting
      deck={deck}
      hasItems={items.length > 0}
      box={box}
      hue={theme}
      animal={accent.animal}
      accentReady={accent.ready}
      onRetry={() => void deck.refresh()}
      router={router}
    />
  ) : (
    <PixelTransition
      active={mode === 'story'}
      hue={switchHue ?? hues[shown] ?? theme}
      first={
        <View style={{ width: box.w, height: box.h }}>
          <DeckGrid
            items={items}
            hues={hues}
            width={box.w}
            onOpen={openCard}
            refreshControl={
              deck.sample ? undefined : (
                <RefreshControl refreshing={deck.refreshing} onRefresh={() => void deck.refresh()} tintColor={GROUND.dim} />
              )
            }
          />
        </View>
      }
      second={
        <Story
          // A new deck is a new stack; an advance is not (`initial` is read once, at mount).
          key={`${deck.meta?.generatedAt ?? 'deck'}:${items.length}`}
          items={items}
          hues={hues}
          animal={accent.animal}
          initial={start}
          box={box}
          deck={deck}
          onFront={(i) => {
            setFront(i);
            setPicked(i);
          }}
        />
      }
    />
  );

  return (
    <View style={styles.screen}>
      {/* Over the body, on the ground: the fanned cards' corners tuck under the bars. Both bars
          keep one height in every state, so the stack's box never changes under it. */}
      <View style={[styles.chrome, { paddingTop: insets.top + space.sm, paddingHorizontal: layout.gutter }]}>
        <View style={styles.progressSlot}>
          {ready && mode === 'story' ? <ProgressRow count={items.length} front={shown} ink={(hues[shown] ?? theme).ink} /> : null}
        </View>
        <TopBar
          caption={captionOf(deck.meta, deck.stale, deck.sample)}
          mode={ready ? mode : null}
          onToggle={() => (mode === 'story' ? toGrid() : openCard(shown))}
          onClose={close}
        />
      </View>

      <View style={styles.body} onLayout={onBody}>
        {body}
      </View>

      <View style={[styles.chrome, styles.bottom, { paddingBottom: insets.bottom + space.sm }]}>
        <View style={styles.bottomRow}>
        {ready && mode === 'story' ? (
          <>
            <ClickSpark hue={hues[shown] ?? theme}>
              <Pressable
                onPress={() => setSharing(shown)}
                accessibilityRole="button"
                accessibilityLabel={STORY_COPY.shareTitle}
                style={({ pressed }) => [styles.share, { opacity: pressed ? 0.6 : 1 }]}
              >
                <SymbolView name="square.and.arrow.up" tintColor={accent.ink} weight="semibold" size={18} />
                <Text maxFontSizeMultiplier={1.3} style={[styles.shareText, { color: accent.text }]}>
                  {STORY_COPY.share}
                </Text>
              </Pressable>
            </ClickSpark>
            <Text allowFontScaling={false} style={styles.count} accessibilityElementsHidden importantForAccessibility="no">
              {`${shown + 1} of ${items.length}`}
            </Text>
          </>
        ) : ready ? (
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.hint}>
            {STORY_COPY.gridHint}
          </Text>
        ) : null}
        </View>
      </View>

      {sharing !== null && items[sharing] ? (
        <SharePreview
          item={items[sharing]!}
          hue={hues[sharing] ?? theme}
          animal={accent.animal}
          number={sharing + 1}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </View>
  );
}

// ─── the bar ────────────────────────────────────────────────────────────────────────────

function TopBar({
  caption,
  mode,
  onToggle,
  onClose,
}: {
  caption: string | null;
  /** Null while there is no deck to switch views of. */
  mode: 'story' | 'grid' | null;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.bar}>
      <View style={styles.barWords}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          {STORY_COPY.title}
        </Text>
        {/* Two lines kept for it in every state: what the numbers rest on is never cut. */}
        <View style={styles.captionSlot}>
          {caption ? (
            <Text allowFontScaling={false} numberOfLines={2} style={styles.caption}>
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
      {mode !== null ? (
        <BarIcon
          name={mode === 'story' ? 'square.grid.2x2' : 'rectangle.stack'}
          label={mode === 'story' ? STORY_COPY.everyCard : STORY_COPY.oneAtATime}
          onPress={onToggle}
        />
      ) : null}
      <BarIcon name="xmark" label={STORY_COPY.close} onPress={onClose} />
    </View>
  );
}

/** A bar button: an SF Symbol in bone, the 44pt tap floor, opacity on press. */
function BarIcon({ name, label, onPress }: { name: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.5 : 1 }]}
    >
      <SymbolView name={name} tintColor={GROUND.text} weight="semibold" size={18} />
    </Pressable>
  );
}

// ─── the story ──────────────────────────────────────────────────────────────────────────

function Story({
  items,
  hues,
  animal,
  initial,
  box,
  deck,
  onFront,
}: {
  items: readonly DeckItem[];
  hues: readonly Hue[];
  animal: Animal;
  initial: number;
  box: { w: number; h: number };
  deck: WrappedDeckState;
  onFront: (i: number) => void;
}) {
  const size = storyCardSize(box);
  const left = (box.w - size.width) / 2;
  const top = (box.h - size.height) / 2;

  // Nothing plays under the modal's slide or the grid's cells: the first card arms a beat later.
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHeld(false), OPEN_HOLD_MS);
    return () => clearTimeout(t);
  }, []);

  const frontRef = useRef(initial);
  // Where the finger moved the deck on, in the card's points: the next card's ripple starts there.
  const finger = useRef<{ x: number; y: number } | null>(null);
  // One burst per advance, in the hue of the card that was thrown: set, rendered, then fired.
  const spark = useRef<ClickSparkHandle>(null);
  const [burst, setBurst] = useState<{ n: number; x: number; y: number; hue: Hue } | null>(null);
  useEffect(() => {
    if (burst) spark.current?.spark(burst.x, burst.y);
  }, [burst]);
  const sparkHue = burst?.hue ?? hues[initial]!;

  return (
    <ClickSpark ref={spark} sparkOnPress={false} hue={{ ...sparkHue, ink: sparkHue.partner }} style={{ width: box.w, height: box.h }}>
      <StoryStack
        count={items.length}
        initial={initial}
        boxWidth={box.w}
        boxHeight={box.h}
        width={size.width}
        height={size.height}
        onFrontChange={(i) => {
          frontRef.current = i;
          onFront(i);
        }}
        labelFor={(i) => items[i]?.face.label ?? ''}
        onAdvance={(x, y) => {
          finger.current = { x: x - left, y: y - top };
          const thrown = hues[frontRef.current] ?? sparkHue;
          setBurst((b) => ({ n: (b?.n ?? 0) + 1, x, y, hue: thrown }));
        }}
        renderCard={(i, slot) => {
          const it = items[i];
          const hue = hues[i];
          if (!it || !hue) return null;
          const id = it.card.id;
          return (
            <TiltedCard width={size.width} height={size.height} lean={slot.front} accessibilityLabel={it.face.label}>
              <GlareHover radius={SHAPE.wrapped} disabled={!slot.front}>
                <StoryCard
                  item={it}
                  hue={hue}
                  animal={animal}
                  width={size.width}
                  height={size.height}
                  variant="story"
                  number={i + 1}
                  front={slot.front && !held}
                  revealed={deck.revealed.has(id)}
                  onPlayed={() => deck.markRevealed(id)}
                  ripple={slot.front ? finger.current : null}
                  contentStyle={slot.contentStyle}
                />
              </GlareHover>
            </TiltedCard>
          );
        }}
      />
    </ClickSpark>
  );
}

// ─── every state that is not a deck ─────────────────────────────────────────────────────

function Waiting({
  deck,
  hasItems,
  box,
  hue,
  animal,
  accentReady,
  onRetry,
  router,
}: {
  deck: WrappedDeckState;
  /** The deck has cards to draw: only the hue or the reveal set is a read away. */
  hasItems: boolean;
  box: { w: number; h: number };
  hue: Hue;
  animal: Animal;
  accentReady: boolean;
  onRetry: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const size = storyCardSize(box);
  const place = { width: box.w, height: box.h, alignItems: 'center' as const, justifyContent: 'center' as const };

  // Nothing cached yet (or the hue and the reveal set are a read away): the card's shape, flat.
  if (deck.status === 'loading' || (deck.status === 'ready' && hasItems) || !accentReady) {
    return (
      <View style={place}>
        <DeckSkeleton width={size.width} height={size.height} />
      </View>
    );
  }

  // A report whose every card the copy layer declined to draw is, on screen, a report with
  // no cards in it: never a skeleton that waits for nothing.
  const status = deck.status === 'ready' ? 'no_cards' : deck.status;
  const copy = EMPTY_COPY[status];
  // The api layer's own words for a failed request ("Builda is not reachable right now.").
  const text = status === 'error' ? (deck.error ?? copy.text) : copy.text;
  const action =
    status === 'signed_out' ? () => router.dismissTo('/settings') : status === 'no_report' ? () => router.dismissTo('/pair') : onRetry;

  return (
    <View style={place}>
      <EmptyBand
        width={size.width}
        height={size.height}
        hue={hue}
        animal={animal}
        title={copy.title}
        text={text}
        action={copy.action}
        onAction={action}
        busy={deck.refreshing}
        busyLabel={STORY_COPY.checking}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: GROUND.bg },
  chrome: { zIndex: 2, backgroundColor: GROUND.bg },
  progressSlot: { height: 3 },
  captionSlot: { height: 36 },
  hint: { fontSize: 13, lineHeight: 18, color: GROUND.dim },
  body: { flex: 1, zIndex: 1 },
  bar: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, paddingTop: space.xs, marginRight: -space.sm },
  barWords: { flex: 1, gap: 2, paddingTop: space.sm },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4, color: GROUND.text },
  caption: { fontSize: 13, lineHeight: 18, color: GROUND.dim },
  icon: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  bottom: { paddingHorizontal: layout.gutter, paddingTop: space.sm },
  bottomRow: { height: TAP_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  share: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP_TARGET, paddingRight: space.sm },
  shareText: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  count: { fontFamily: MONO_FAMILY, fontSize: 13, fontWeight: '600', color: GROUND.dim, fontVariant: ['tabular-nums'] },
});
