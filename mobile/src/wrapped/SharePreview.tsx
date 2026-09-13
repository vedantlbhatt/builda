/**
 * Share one card: the export itself, at its real 4:5 shape, then the system share sheet.
 *
 * The preview is the capture (what you see is the 1080 by 1350 image), and it is where a
 * quote card warns: a card showing the owner's own prompt says so, in words, before the
 * image can leave (DESIGN-DIRECTION 6; quotes are owner only everywhere else in the app).
 *
 * Share cards keep the dark palette in either scheme, so a shared image looks the same on
 * every phone it lands on (DESIGN-DIRECTION 3.2).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space, TAP_TARGET } from '../theme';
import { Button, SchemeProvider, SymbolIcon, T, commit, useColors } from '../ui';
import { exitMs, timing, T as Durations } from '../ui/motion';
import type { DeckItem } from './deckItems';
import { shareCardImage, SHARE_PIXELS } from './share';
import { SHARE_RATIO, WrappedCardView } from './WrappedCardView';

export const QUOTE_WARNING = 'This card shows your own prompt, word for word. Anyone you send the image to can read it.';
export const SHARE_FAILED = 'The image could not be made. Try again.';
export const SHARE_UNAVAILABLE = 'This phone has no share sheet to hand the image to.';

/** Drawn at the export's width in points on a phone wide enough (360 at @3x is 1080). */
const PREFERRED_WIDTH = SHARE_PIXELS.w / 3;
/**
 * Everything on the preview that is not the card: the title row, the warning, the two
 * buttons and the gaps between (44 + 34 + 52 + 44 + 4 x 16, rounded up).
 */
const CHROME_HEIGHT = 250;

export function SharePreview({ item, onClose }: { item: DeckItem; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The export's width where it fits, narrower on a short phone so the actions stay on it.
  const room = height - insets.top - insets.bottom - CHROME_HEIGHT;
  const cardWidth = Math.floor(Math.min(PREFERRED_WIDTH, width - layout.gutter * 2, room / SHARE_RATIO));
  const cardHeight = Math.round(cardWidth * SHARE_RATIO);
  const shot = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, timing(Durations.enter));
  }, [shown]);
  const enter = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * space.md }] }));

  const close = () => {
    shown.value = withTiming(0, timing(exitMs(Durations.enter)));
    setTimeout(onClose, exitMs(Durations.enter));
  };

  const share = async () => {
    commit();
    setBusy(true);
    setProblem(null);
    const outcome = await shareCardImage(shot, item.face.question);
    setBusy(false);
    if (outcome === 'failed') setProblem(SHARE_FAILED);
    else if (outcome === 'unavailable') setProblem(SHARE_UNAVAILABLE);
    else close();
  };

  const withQuote = item.face.quote !== null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, enter]}
      accessibilityViewIsModal
      onAccessibilityEscape={close}
    >
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + space.sm,
          paddingBottom: insets.bottom + space.md,
          paddingHorizontal: layout.gutter,
          gap: space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
          <T role="title" accessibilityRole="header" style={{ flex: 1 }}>
            Share this card
          </T>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={space.sm}
            style={({ pressed }) => ({ width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}
          >
            <SymbolIcon name="xmark" weight="semibold" tone="text" />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <SchemeProvider scheme="dark">
            <View ref={shot} collapsable={false} style={{ width: cardWidth, height: cardHeight }}>
              <WrappedCardView
                card={item.card}
                face={item.face}
                sources={item.sources}
                width={cardWidth}
                height={cardHeight}
                variant="share"
                play={false}
              />
            </View>
          </SchemeProvider>
        </View>

        <View style={{ gap: space.sm }}>
          {withQuote ? (
            <T role="meta" tone="dim">
              {QUOTE_WARNING}
            </T>
          ) : null}
          {problem !== null ? (
            <T role="meta" tone="dim" accessibilityLiveRegion="polite">
              {problem}
            </T>
          ) : null}
          <Button label="Share image" onPress={share} busy={busy} busyLabel="Making the image" />
          <Button label="Cancel" kind="secondary" onPress={close} />
        </View>
      </View>
    </Animated.View>
  );
}
