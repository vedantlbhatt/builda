/**
 * The frame every You page sits in, the analysis page's own (design-refs/HOUSE-STYLE.md): one
 * scroll view on the warm dark ground, the reveal clock (`RevealPage` > `Section` > `Block`) so
 * every number counts up and every chart draws on the first time it arrives, nothing playing
 * until the page is on screen and still, and the chapters mounted one at a time so the first
 * count is never starved of frames (`insights/RevealScroll.tsx`, one definition for both pages).
 *
 * A page pushed over the tabs wears the analysis page's header: the large title on the ground,
 * no rule, no tint. The You tab is a tab root and keeps the tab's own header.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, type ReactNode } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { GROUND } from '../insights/palette';
import { RevealPage, usePageReveal } from '../insights/reveal';
import { useChapterStages, useRevealScroll } from '../insights/RevealScroll';
import { useReduceMotion } from '../ui/motion';

export interface ChapterPageProps {
  /** The large title, for a page pushed over the tabs. Leave it out on a tab root. */
  title?: string;
  /** Chapters after the first, mounted one at a time once `ready`. */
  chapters: number;
  ready: boolean;
  refreshing: boolean;
  /** Null when there is nothing to refresh (signed out). */
  onRefresh: (() => void) | null;
  /** The page, given how many chapters after the first may mount. */
  children: (stage: number) => ReactNode;
}

export function ChapterPage({ title, chapters, ready, refreshing, onRefresh, children }: ChapterPageProps) {
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { stage, hurry } = useChapterStages(chapters, ready);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, hurry);

  // Dev builds only: `builder://you/money?at=1200` opens the page scrolled to that offset, so a
  // capture of a lower chapter can be taken on a simulator nobody is touching. Twice, because the
  // later chapters mount a moment after the first (the scroll itself hurries them in).
  const params = useLocalSearchParams<{ at?: string }>();
  const at = __DEV__ && typeof params.at === 'string' ? Number(params.at) : Number.NaN;
  useEffect(() => {
    if (!Number.isFinite(at) || !ready) return;
    const go = (animated: boolean) => scrollRef.current?.scrollTo({ y: at, animated });
    const first = setTimeout(() => go(true), 700);
    const again = setTimeout(() => go(false), 1700);
    return () => {
      clearTimeout(first);
      clearTimeout(again);
    };
  }, [at, ready, scrollRef]);
  return (
    <>
      {title ? (
        <Stack.Screen
          options={{
            title,
            headerLargeTitle: true,
            headerLargeTitleShadowVisible: false,
            headerShadowVisible: false,
            headerTransparent: false,
            headerBackground: undefined,
            headerStyle: { backgroundColor: GROUND.bg },
            headerLargeStyle: { backgroundColor: GROUND.bg },
            headerTintColor: GROUND.text,
            headerTitleStyle: { color: GROUND.text },
            headerLargeTitleStyle: { color: GROUND.text },
          }}
        />
      ) : null}
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GROUND.dim} /> : undefined}
      >
        <RevealPage page={page}>{children(stage)}</RevealPage>
      </Animated.ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: 120 },
});
