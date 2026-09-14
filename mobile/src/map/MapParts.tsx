/**
 * The frame both screens sit in, and every state that is not the map: loading, signed out,
 * missing, an error, a stale copy, and the refusals from the data. All of them sentences on the
 * warm ground (design-refs/HOUSE-STYLE.md 4: "Refusals are sentences, never 0 or --"), never a
 * mascot badge over a button; a refusal from the data still prints its band, so the page keeps
 * its shape and its colour whether or not there is a map to draw.
 *
 *   MapPage       the analysis page's frame: one scroll view on the warm ground, its header, the
 *                 reveal clock (`RevealPage` > `Section` > `Block`), nothing playing until the
 *                 page is on screen and still (`insights/RevealScroll.tsx`)
 *   MapLoading    a sentence, and the slots of a map drifting in rows while the answer comes:
 *                 react-bits GridMotion's rows (four, alternating direction, each on its own
 *                 inertia, 0.8 s plus 0.6, 0.4, 0.3 and 0.2 s on power3 out), still under Reduce
 *                 Motion
 *   MapRefusal    the band in the session's hue with the refusal set as its headline, the
 *                 sentence under it, and the one way on as words
 */
import { useNavigation, useRouter, Stack } from 'expo-router';
import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { SessionDetail } from '../data/api';
import { Band } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { GUTTER, Refusal, type, Words } from '../insights/kit';
import { GROUND, ON_HUE, type HueName } from '../insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import { useRevealScroll } from '../insights/RevealScroll';
import { copyText } from '../onboarding/clipboard';
import type { Animal } from '../pixel/animals';
import { DotGrid } from '../ui/bits/backgrounds';
import { snap } from '../ui/haptics';
import { useReduceMotion } from '../ui/motion';
import { BandHeadline, BandSentence, WordLink, type BandHue } from './MapWords';
import { LIVE_COMMAND, refusalCopy, type Refusal as RefusalKind } from './view';

// ------------------------------------------------------------------ the frame

const noop = () => {};

/** The page: a large title on the ground, the reveal clock, pull to refresh while it can. */
export function MapPage({ title, refreshing, onRefresh, children }: { title: string; refreshing: boolean; onRefresh: (() => void) | null; children: ReactNode }) {
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, noop);
  return (
    <>
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
        <RevealPage page={page}>{children}</RevealPage>
      </Animated.ScrollView>
    </>
  );
}

/** A chapter of words on the ground, in the page gutter. */
export function WordsSection({ children, top = 22 }: { children: ReactNode; top?: number }) {
  return (
    <Section style={[styles.words, { marginTop: top }]}>
      <Block>{children}</Block>
    </Section>
  );
}

// ------------------------------------------------------------------ loading

/** GridMotion's per row inertia: 0.8 s plus these, each row on its own. */
const ROW_INERTIA = [0.6, 0.4, 0.3, 0.2] as const;
const SLOT = 10;
const SLOT_GAP = 6;

function DriftRow({ index, width, still }: { index: number; width: number; still: boolean }) {
  const x = useSharedValue(0);
  const dir = index % 2 === 0 ? 1 : -1;
  const reach = (SLOT + SLOT_GAP) * 2;
  useEffect(() => {
    if (still) {
      x.value = 0;
      return;
    }
    const ms = (0.8 + ROW_INERTIA[index % ROW_INERTIA.length]!) * 1600;
    const easing = Easing.out(Easing.cubic);
    x.value = withDelay(
      index * 90,
      withRepeat(withSequence(withTiming(reach * dir, { duration: ms, easing }), withTiming(-reach * dir, { duration: ms, easing })), -1, false),
    );
    return () => cancelAnimation(x);
  }, [still, index, dir, reach, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const count = Math.ceil(width / (SLOT + SLOT_GAP)) + 8;
  return (
    <Animated.View style={[styles.driftRow, { marginLeft: -reach * 2 }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.slot} />
      ))}
    </Animated.View>
  );
}

/** A sentence, and the empty slots of a map drifting while the answer is on its way. */
export function MapLoading({ sentence }: { sentence: string }) {
  const { width } = useWindowDimensions();
  const still = useReduceMotion();
  return (
    <Section style={styles.loading}>
      <Block style={styles.words}>
        <Words style={type.dim}>{sentence}</Words>
      </Block>
      <Block>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.drift}>
          {[0, 1, 2, 3].map((i) => (
            <DriftRow key={i} index={i} width={width} still={still} />
          ))}
        </View>
      </Block>
    </Section>
  );
}

// ------------------------------------------------------------------ the account and the network

export function MapSignedOut({ what, onSignIn, accent }: { what: string; onSignIn: () => void; accent: string }) {
  return (
    <WordsSection>
      <Words style={type.body}>{`Sign in to see this ${what}. Your sessions come from your Mac, and only you can read them.`}</Words>
      <WordLink title="Sign in" color={accent} onPress={onSignIn} />
    </WordsSection>
  );
}

export function MapMissing({ onBack, accent }: { onBack: () => void; accent: string }) {
  return (
    <WordsSection>
      <Words style={type.body}>This session is not here. It may have been deleted, or its repository taken out of Builda.</Words>
      <WordLink title="Back to your sessions" color={accent} onPress={onBack} />
    </WordsSection>
  );
}

export function MapError({ message, onRetry, accent }: { message: string; onRetry: () => void; accent: string }) {
  return (
    <WordsSection>
      <Refusal>{message}</Refusal>
      <WordLink title="Try again" color={accent} icon="arrow.clockwise" onPress={onRetry} />
    </WordsSection>
  );
}

/** One quiet line at the top: this is the saved copy, and why. */
export function StaleNote({ text }: { text: string }) {
  return (
    <Section style={[styles.words, styles.stale]}>
      <Block>
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.6} style={type.meta}>
          {text}
        </Text>
      </Block>
    </Section>
  );
}

/** The built in sample says it is one, in the voice every other line on the page uses. */
export const SAMPLE_NOTE = 'A sample session. Yours draw here while one runs.';

// ------------------------------------------------------------------ refusals from the data

/**
 * Back to the session this screen was opened from, or onto it when the screen was opened by a
 * link: back when the session is right under this screen, else this screen is replaced by the
 * session (it had nothing to show, so there is nothing to come back to).
 */
export function useOpenSession(id: string, variant: string | undefined): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  return useCallback(() => {
    const state = navigation.getState();
    const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    if (below?.name === 'session/[id]' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: '/session/[id]', params: variant ? { id, variant } : { id } });
  }, [navigation, router, id, variant]);
}

/** How long "Copied" stays before the link says what it does again. */
const COPIED_MS = 2000;

/**
 * A refusal from the data: the band still prints in the session's hue with the refusal as its
 * headline and the sentence under it, then the one way on (open the session, copy the command
 * that sends the live state, or try again). A session that has touched nothing yet shows the sea
 * the islands will rise from.
 */
export function MapRefusal({
  kind,
  screen,
  session,
  now,
  onSession,
  onRetry,
  hue,
  animal,
  title,
  width,
  accent,
}: {
  kind: RefusalKind;
  screen: 'map' | 'timelapse';
  session: SessionDetail;
  now: number;
  onSession: () => void;
  onRetry: () => void;
  hue: BandHue & { name: HueName };
  animal: Animal;
  title: string;
  width: number;
  accent: string;
}) {
  const copy = refusalCopy(kind, screen, session, now);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const inner = width - 40;
  const creature = Math.min(96, Math.floor((inner * 0.26) / 16) * 16);
  return (
    <>
      <Section>
        <Band hue={hue} title={title}>
          <BandHeadline>{copy.title}</BandHeadline>
          <View style={styles.bandRow}>
            <View style={styles.bandWords}>
              <BandSentence text={copy.text} delay={420} />
            </View>
            <CreaturePrint animal={animal} size={creature} color={ON_HUE} delay={220} />
          </View>
        </Band>
      </Section>
      {kind === 'empty' ? (
        <Section>
          <Block enter={false}>
            <DotGrid width={width} height={200} hue={hue.name} develop interactive />
          </Block>
        </Section>
      ) : null}
      <WordsSection top={kind === 'empty' ? 8 : 22}>
        {copy.action === 'copy' ? (
          <>
            <Text selectable style={type.mono}>
              {LIVE_COMMAND}
            </Text>
            <WordLink
              title={copied ? 'Copied' : 'Copy the command'}
              line="Run it on your Mac, then pull down here."
              icon="doc.on.doc"
              color={accent}
              onPress={() => {
                if (!copyText(LIVE_COMMAND)) return;
                snap();
                setCopied(true);
              }}
            />
          </>
        ) : copy.action === 'retry' ? (
          <WordLink title="Try again" icon="arrow.clockwise" color={accent} onPress={onRetry} />
        ) : (
          <WordLink title="Open the session" color={accent} onPress={onSession} />
        )}
      </WordsSection>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: 120 },
  words: { paddingHorizontal: GUTTER },
  stale: { paddingTop: 4, paddingBottom: 12 },
  loading: { paddingTop: 4, gap: 22 },
  drift: { gap: SLOT_GAP + 4, overflow: 'hidden', paddingVertical: 8 },
  driftRow: { flexDirection: 'row', gap: SLOT_GAP },
  slot: { width: SLOT, height: SLOT, borderWidth: 1, borderColor: GROUND.border },
  bandRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  bandWords: { flex: 1, paddingBottom: 4 },
});
