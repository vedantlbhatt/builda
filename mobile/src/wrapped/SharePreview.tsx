/**
 * Share one card: the export itself, at its real 4:5 shape, then the system share sheet.
 *
 * The preview is the capture (what you see is the 1080 by 1350 image): the story card's share
 * size, still, with the wordmark in its corner. It sits in react-bits TiltedCard, so it leans
 * toward the finger with GlareHover's stepped band sweeping across it, the way a printed card
 * catches the light (DESIGN-V2 4.3: "the Wrapped share preview wears it"). The primary action is
 * in the builder's hue (the theme is their creature's colour) and ClickSpark bursts from it in
 * the CARD's hue: the one commitment on this screen.
 *
 * The image is `shareItem(item)`, never the story's face: a quote is owner only, and the
 * contract and PRIVACY.md say it is never in a share. A card that quotes the owner in the
 * story shares its counts only answer instead. FOUND IN THE ADVERSARIAL REVIEW (2026-09-13):
 * the preview drew the story card, quote and all, under a warning that the image would carry
 * it, which is the promise broken with a sentence beside it.
 *
 * Reduce Motion: no lean, no sheen, no sparks; the sheet arrives with the kit's fade.
 */
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GROUND } from '../insights/palette';
import { AccentButton } from '../nav/chrome';
import type { Animal } from '../pixel/animals';
import { layout, space, TAP_TARGET, type Hue } from '../theme';
import { TiltedCard } from '../ui/bits/components/TiltedCard';
import { ClickSpark } from '../ui/bits/effects/ClickSpark';
import { commit } from '../ui/haptics';
import { exitMs, timing, T as Durations } from '../ui/motion';
import { shareItem, type DeckItem } from './deckItems';
import { shareCardImage, SHARE_PIXELS } from './share';
import { SHARE_RATIO, STORY_COPY } from './story';
import { StoryCard } from './WrappedCardView';

export const SHARE_FAILED = 'The image could not be made. Try again.';
export const SHARE_UNAVAILABLE = 'This phone has no share sheet to hand the image to.';

/** Drawn at the export's width in points on a phone wide enough (360 at @3x is 1080). */
const PREFERRED_WIDTH = SHARE_PIXELS.w / 3;
/**
 * Everything on the preview that is not the card: the title row, the line a failed share says,
 * the action, the cancel line and the gaps between (44 + 40 + 52 + 44 + 4 x 16, rounded up).
 */
const CHROME_HEIGHT = 256;

export function SharePreview({ item, hue, animal, number, onClose }: { item: DeckItem; hue: Hue; animal: Animal; number: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The export's width where it fits, narrower on a short phone so the actions stay on it.
  const room = height - insets.top - insets.bottom - CHROME_HEIGHT;
  const cardWidth = Math.floor(Math.min(PREFERRED_WIDTH, width - layout.gutter * 2, room / SHARE_RATIO));
  const cardHeight = Math.round(cardWidth * SHARE_RATIO);
  const shot = useRef<View>(null);
  // What leaves the phone: the card with no quote on it, whatever the story shows.
  const shared = useMemo(() => shareItem(item), [item]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, timing(Durations.enter));
  }, [shown]);
  const enter = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * space.md }] }));

  const leave = exitMs(Durations.enter);
  const close = () => {
    shown.value = withTiming(0, timing(leave));
    setTimeout(onClose, leave);
  };

  const share = async () => {
    commit();
    setBusy(true);
    setProblem(null);
    const outcome = await shareCardImage(shot, shared.face.question);
    setBusy(false);
    if (outcome === 'failed') setProblem(SHARE_FAILED);
    else if (outcome === 'unavailable') setProblem(SHARE_UNAVAILABLE);
    else close();
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.sheet, enter]} accessibilityViewIsModal onAccessibilityEscape={close}>
      <View style={{ flex: 1, paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.md, paddingHorizontal: layout.gutter, gap: space.md }}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.title}>
            {STORY_COPY.shareTitle}
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={STORY_COPY.close}
            hitSlop={space.sm}
            style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.5 : 1 }]}
          >
            <SymbolView name="xmark" tintColor={GROUND.text} weight="semibold" size={18} />
          </Pressable>
        </View>

        <View style={styles.stage}>
          <TiltedCard width={cardWidth} height={cardHeight} glare floating accessibilityLabel={shared.face.label}>
            <View ref={shot} collapsable={false} style={{ width: cardWidth, height: cardHeight }}>
              <StoryCard item={shared} hue={hue} animal={animal} width={cardWidth} height={cardHeight} variant="share" number={number} />
            </View>
          </TiltedCard>
        </View>

        <View style={{ gap: space.sm }}>
          {problem !== null ? (
            <Text maxFontSizeMultiplier={1.6} style={styles.meta} accessibilityLiveRegion="polite">
              {problem}
            </Text>
          ) : null}
          <ClickSpark hue={hue}>
            <AccentButton label={STORY_COPY.shareAction} size="large" block onPress={share} busy={busy} busyLabel={STORY_COPY.shareBusy} />
          </ClickSpark>
          <Pressable onPress={close} accessibilityRole="button" style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.5 : 1 }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.cancelText}>
              {STORY_COPY.cancel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Over everything on the Wrapped screen, its bars included.
  sheet: { backgroundColor: GROUND.bg, zIndex: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.tile },
  title: { flex: 1, fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.3, color: GROUND.text },
  icon: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 13, lineHeight: 18, color: GROUND.dim },
  cancel: { minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: GROUND.dim },
});
