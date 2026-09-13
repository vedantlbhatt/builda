import { useFocusEffect } from 'expo-router';
import React, { useCallback, type ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { Easing, ReduceMotion, useAnimatedReaction, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useReanimatedTransitionProgress } from 'react-native-screens/reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '../theme';
import { chromeAt } from './chromeProgress';
import { CHROME_HEIGHT, chromeIndex, GUTTER, PROGRESS, type FlowStep } from './flow';

const c = colors('dark');

/**
 * One onboarding step's frame: room for the chrome row (drawn by the layout, above the stack),
 * the step's column on the 20pt gutter, and the actions pinned to the bottom.
 *
 * `keyboard`: the actions ride the keyboard, frame for frame with the system's own curve
 * (react-native-keyboard-controller, never a listener and a guessed duration). Closed they sit
 * above the home indicator; open they sit 12pt above the keys.
 *   - A step that does not scroll (the name step: one field at the top) moves the actions
 *     with a transform on the keyboard's height, and nothing else moves. It reads the
 *     provider's Reanimated values on the UI thread, not `KeyboardStickyView`'s Animated
 *     ones: a step mounted while the keyboard is still moving (the creature step, arriving as
 *     the name step's keyboard goes down) must start where the keyboard IS, and a native
 *     driven Animated value attached mid-flight started from closed instead.
 *   - A step that scrolls (connect: a code field over a hook setup) must not let the actions
 *     ride up OVER its column: the frame grows a spacer under the actions as tall as the
 *     keyboard, so the column above shrinks and scrolls, and nothing is ever drawn on top of
 *     anything else.
 *
 * `scroll`: the column scrolls when it can overflow (a small phone, Dynamic Type). The actions
 * stay outside the scroll view, so Continue never scrolls away.
 *
 * `step`: which step this is, for the chrome above the stack. The frame reports its own
 * native transition (react-native-screens' progress, on the UI thread) as the flow's position,
 * so the bars fill with a push and empty with a pop, and follow a finger on the back swipe,
 * giving the bar back if the swipe is abandoned.
 */
export function StepFrame({
  step,
  children,
  actions,
  keyboard = false,
  scroll = true,
  contentStyle,
}: {
  step: FlowStep;
  children: ReactNode;
  actions?: ReactNode;
  keyboard?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const top = insets.top + CHROME_HEIGHT + space.md;
  const column: ViewStyle = { paddingHorizontal: GUTTER, paddingTop: top, paddingBottom: space.lg, gap: space.sm };
  // Open, the keyboard already covers the home indicator: give back the inset and keep 12pt.
  const lift = insets.bottom + space.sm - space.tile;

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
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[column, { flexGrow: 1 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ChromeTracker index={chromeIndex(step)} />
      {body}
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
 * An arrival with no transition to report (under hello's pixel cells, a deep link) walks the
 * chrome there over the bar's own 267ms instead.
 */
function ChromeTracker({ index }: { index: number }) {
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
