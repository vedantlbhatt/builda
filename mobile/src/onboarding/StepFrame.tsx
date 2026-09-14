import { useFocusEffect } from 'expo-router';
import React, { useCallback, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedTransitionProgress } from 'react-native-screens/reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RevealPage, Section } from '../insights/reveal';
import { colors, space } from '../theme';
import { useAccent } from '../theme/accent';
import { chromeAt } from './chromeProgress';
import { CHROME_HEIGHT, chromeIndex, GUTTER, PROGRESS, type FlowStep } from './flow';
import { useStepPage } from './stepPage';

const c = colors('dark');

/** Where a band's words start: under the status bar and the chrome row, with a little air. */
export function useBandInset(): number {
  const insets = useSafeAreaInsets();
  return insets.top + CHROME_HEIGHT + space.sm;
}

/**
 * One onboarding step's frame, in the house style: a chapter. It opens on the step's band
 * (`band`, a `StepBand`, full bleed from the top of the screen, under the chrome the layout draws
 * above the stack), then the warm dark ground carries the step's column on the 20pt gutter, and
 * the actions are pinned to the bottom.
 *
 * The whole step is one reveal page (`stepPage.ts`), armed when `ready`: the band prints itself,
 * its figure counts up and its words fade up on the analysis page's clock.
 *
 * `keyboard`: the actions ride the keyboard, frame for frame with the system's own curve
 * (react-native-keyboard-controller, never a listener and a guessed duration). Closed they sit
 * above the home indicator; open they sit 12pt above the keys.
 *   - A step that does not scroll (the name step: the name is the band) moves the actions with a
 *     transform on the keyboard's height, and nothing else moves. It reads the provider's
 *     Reanimated values on the UI thread, so a step mounted while the keyboard is still moving
 *     (the creature step, arriving as the name step's keyboard goes down) starts where the
 *     keyboard IS.
 *   - A step that scrolls (connect: a code field over a hook setup) must not let the actions
 *     ride up OVER its column: the frame grows a spacer under the actions as tall as the
 *     keyboard, so the column above shrinks and scrolls, and nothing is drawn on anything else.
 *
 * `scroll`: the band and the column scroll together when they can overflow (a small phone,
 * Dynamic Type). The actions stay outside the scroll view, so Continue never scrolls away, and
 * the column ends `space.lg` above them. Once the page has moved, a shelf in the band's hue
 * stands under the status bar and the chrome, so the band's words go under it and are never
 * printed over the chevron and the bars (FOUND IN THE FINAL CAPTURE, 2026-09-13: scrolled, "what
 * you build with" ran through both). At rest it is not there: the band itself is that colour.
 *
 * `step`: which step this is, for the chrome above the stack. The frame reports its own native
 * transition (react-native-screens' progress, on the UI thread) as the flow's position, so the
 * bars fill with a push and empty with a pop, and follow a finger on the back swipe.
 */
export function StepFrame({
  step,
  band,
  children,
  actions,
  keyboard = false,
  scroll = true,
  ready = true,
  contentStyle,
}: {
  step: FlowStep;
  band: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  keyboard?: boolean;
  scroll?: boolean;
  /** Arm the reveal (the band's print, the counts). Default at once. */
  ready?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const page = useStepPage(ready);
  const column: ViewStyle = { paddingHorizontal: GUTTER, paddingBottom: space.lg, gap: space.sm };
  const scrolled = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrolled.value = e.contentOffset.y;
  });
  const shelfStyle = useAnimatedStyle(() => ({ opacity: scrolled.value > 0.5 ? 1 : 0 }));
  // Open, the keyboard already covers the home indicator: give back the inset and keep 12pt.
  const lift = insets.bottom + space.sm - space.tile;
  const hasColumn = children !== undefined && children !== null && children !== false;

  const footer = actions ? (
    <View
      style={{
        paddingHorizontal: GUTTER,
        paddingTop: space.sm,
        paddingBottom: insets.bottom + space.sm,
        gap: space.xs,
        backgroundColor: c.bg,
      }}
    >
      {actions}
    </View>
  ) : null;

  const body = scroll ? (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      // The band runs to the top edge; a pull past it would show the ground above the band.
      bounces={false}
    >
      <Section style={{ flexGrow: 1 }}>
        {band}
        {hasColumn ? <View style={[column, contentStyle]}>{children}</View> : null}
      </Section>
    </Animated.ScrollView>
  ) : (
    <Section style={{ flex: 1 }}>
      {band}
      {hasColumn ? <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View> : null}
    </Section>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ChromeTracker index={chromeIndex(step)} />
      <RevealPage page={page}>{body}</RevealPage>
      {scroll ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + CHROME_HEIGHT, backgroundColor: accent.ink }, shelfStyle]}
        />
      ) : null}
      {footer && keyboard && !scroll ? <KeyboardRide lift={lift}>{footer}</KeyboardRide> : footer}
      {keyboard && scroll ? <KeyboardSpacer lift={lift} /> : null}
    </View>
  );
}

const PAGE_EASE = Easing.inOut(Easing.cubic);

/**
 * Reports this step's transition as the flow's position. A push reports from the page coming
 * in (the one before it plus the progress), a pop from the page going out (itself less the
 * progress); the other page of each pair is ignored, so exactly one writer moves the chrome.
 * An arrival with no transition to report (under hello's pixel cover, a deep link) walks the
 * chrome there over the bar's own 267ms instead.
 *
 * Every step renders one: `StepFrame` does it for the steps it frames, and the finale, which
 * draws its own stage, renders it itself. FOUND IN THE FINAL CAPTURE (2026-09-13): the finale had
 * none, so the chrome stayed at notify's place, the chevron and the five bars drawn on the finale
 * with "this is you" printed over them, where the flow says neither exists (`showsBack`,
 * `chromeBars`).
 */
export function ChromeTracker({ index }: { index: number }) {
  const { progress, closing, goingForward } = useReanimatedTransitionProgress();
  useAnimatedReaction(
    () => [progress.value, closing.value, goingForward.value] as const,
    ([p, isClosing, forward], prev) => {
      if (prev === null) return;
      if (forward === 1 && isClosing === 0) chromeAt.value = index - 1 + p;
      else if (forward === 0 && isClosing === 1) chromeAt.value = index - p;
    },
    [index],
  );
  useFocusEffect(
    useCallback(() => {
      if (Math.abs(chromeAt.value - index) < 0.001) return;
      chromeAt.value = withTiming(index, { duration: PROGRESS.pageMs, easing: PAGE_EASE, reduceMotion: ReduceMotion.Never });
    }, [index]),
  );
  return null;
}

/** Moves its children with the keyboard: up by its height, less `lift` once it is open. */
function KeyboardRide({ lift, children }: { lift: number; children: ReactNode }) {
  const { height, progress } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: height.value + progress.value * lift }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** As tall as the keyboard, less what the actions' own bottom padding already gives. */
function KeyboardSpacer({ lift }: { lift: number }) {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.max(0, -height.value - lift) }));
  return <Animated.View style={style} />;
}
