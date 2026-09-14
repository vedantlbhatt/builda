import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ON_HUE } from '../insights/palette';
import { useAccent } from '../theme/accent';
import { useReduceMotion } from '../ui/motion';
import { SymbolIcon } from '../ui/Symbol';
import { chromeAt } from './chromeProgress';
import { BACK } from './copy';
import {
  CHROME_HEIGHT,
  chromeBack,
  chromeBars,
  chromeFill,
  GUTTER,
  PROGRESS,
  PROGRESS_STEPS,
  progressFor,
  showsBack,
  type FlowStep,
} from './flow';

/**
 * The back button is 44pt square with the chevron centred in it. The chevron's DRAWN left
 * edge sits on the 20pt gutter, the same edge as every line of text under it: at 20pt the
 * glyph is about 12pt wide, so its edge is 6pt left of the box's centre.
 */
const BACK_BOX = 44;
const BACK_GLYPH = 20;
const BACK_GLYPH_HALF_WIDTH = 6;
const BACK_LEFT = GUTTER + BACK_GLYPH_HALF_WIDTH - BACK_BOX / 2;

/**
 * The flow's chrome, drawn once above the stack so it stays put while the steps push under it:
 * a back chevron on every step that has one, and the progress bars on the steps they count.
 *
 * Every step opens on a band that runs under this row, so the chrome is printed in the band's
 * dark ink: the chevron in ink, each bar a track in the builder's partner tone (the dither's
 * middle tone of the band's own hue) filled with ink from its left edge. It reads the accent, so
 * on the creature step the track changes with the creature in the middle, as the band does.
 *
 * The bars are react-bits Stepper's, as the kit ports them (`barFill`, here `chromeFill`), drawn
 * from one number, `chromeAt` (where the flow stands, in steps), which the step frames move with
 * their own native transitions (`StepFrame`). So a bar fills across the push that brings its
 * step in, empties across a pop, and follows a finger on the back swipe, giving the bar back
 * when the swipe is abandoned.
 *
 * `step` is the route React knows: it decides what the chevron does and what VoiceOver hears.
 */
export function OnboardingChrome({ step }: { step: FlowStep | null }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReduceMotion();
  const accent = useAccent();
  const progress = step ? progressFor(step) : null;
  const back = step !== null && showsBack(step);

  const backStyle = useAnimatedStyle(() => ({ opacity: chromeBack(chromeAt.value) }));
  const barsStyle = useAnimatedStyle(() => ({ opacity: chromeBars(chromeAt.value) ? 1 : 0 }));

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: insets.top, height: CHROME_HEIGHT, flexDirection: 'row', alignItems: 'center' }}
    >
      <Animated.View
        style={[{ position: 'absolute', left: BACK_LEFT, top: 0 }, backStyle]}
        pointerEvents={back ? 'auto' : 'none'}
        accessibilityElementsHidden={!back}
        importantForAccessibility={back ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel={BACK}
          hitSlop={4}
          style={({ pressed }) => ({
            width: BACK_BOX,
            height: BACK_BOX,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <SymbolIcon name="chevron.left" size={BACK_GLYPH} weight="bold" tone="onAccent" />
        </Pressable>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: BACK_LEFT + BACK_BOX + 4, top: 0, height: CHROME_HEIGHT, justifyContent: 'center' }, barsStyle]}
        accessible={progress !== null}
        accessibilityElementsHidden={progress === null}
        importantForAccessibility={progress !== null ? 'auto' : 'no-hide-descendants'}
        accessibilityRole="progressbar"
        accessibilityLabel={progress ? `step ${progress.filled} of ${progress.total}` : undefined}
        accessibilityValue={progress ? { min: 0, max: progress.total, now: progress.filled } : undefined}
      >
        <View style={{ flexDirection: 'row', gap: PROGRESS.gap }}>
          {PROGRESS_STEPS.map((s, i) => (
            <Bar key={s} index={i} reduced={reduced} track={accent.partner} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * One bar, 27 x 3.7pt, radius 2: the partner track, with the ink growing from its left edge as
 * the flow passes it. Under Reduce Motion it is filled or not, switched at half way.
 */
function Bar({ index, reduced, track }: { index: number; reduced: boolean; track: string }) {
  const fill = useAnimatedStyle(() => {
    const f = chromeFill(chromeAt.value, index);
    return reduced ? { opacity: f >= 0.5 ? 1 : 0, transform: [{ scaleX: 1 }] } : { opacity: 1, transform: [{ scaleX: f }] };
  });
  return (
    <View
      style={{
        width: PROGRESS.width,
        height: PROGRESS.height,
        borderRadius: PROGRESS.radius,
        borderCurve: 'continuous',
        backgroundColor: track,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: PROGRESS.width,
            backgroundColor: ON_HUE,
            transformOrigin: 'left',
          },
          fill,
        ]}
      />
    </View>
  );
}
