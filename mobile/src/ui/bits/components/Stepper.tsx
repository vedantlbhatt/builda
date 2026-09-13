/**
 * Stepper: where a person is in a flow of steps. Onboarding's four bars (DESIGN-V2 3.2 and 4.3,
 * row 18: the next bar fills as the push lands, done bars amber, the rest `border`), or
 * react-bits' own look: circles joined by connectors, a dot on the current step and a check
 * that draws itself on the finished ones.
 *
 * Ported from react-bits `Components/Stepper/Stepper.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port:
 * - Indicators only. react-bits' Stepper also slides the step content and draws Back and
 *   Continue; on a phone the native push moves the content and the screen owns its button,
 *   so a second slide on top of the push would read as a glitch (DESIGN-V2 rule 8).
 * - The fills are the kit's `SNAP` spring (react-bits 0.3s and 0.4s tweens), in amber, the
 *   colour of progress (react-bits' `#5227FF` violet is exactly the AI house style the brief
 *   bans). The check draws on `EASE` 0.1s in over 0.3s, react-bits' numbers.
 * - `position`, a shared value in steps, lets the bars follow a transition continuously
 *   (onboarding's `chromeAt`): the next bar fills as the push carries the page.
 *
 * Reduce Motion: every fill lands at once; the check is simply there.
 */
import React, { useEffect } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { hitSlopToReach, space } from '../../../theme';
import { select } from '../../haptics';
import { EASE, SNAP, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { SHAPE } from '../../shape';
import { T } from '../../Text';
import { barFill, CHECK_LENGTH, CHECK_PATH, connectorFill, stepLabel, stepStatus } from './lists';
import { STEPPER } from './spec';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface StepperProps {
  steps: number;
  /** The current step, 0 based. */
  current: number;
  /** The flow's position in steps, for bars that follow a transition. Overrides `current` for the fill. */
  position?: SharedValue<number>;
  /** `bars` (onboarding, default) or `circles` (react-bits' look). */
  variant?: 'bars' | 'circles';
  /** Circles only: a tap on a step's circle. Omit and the circles are not buttons. */
  onStepPress?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}

export function Stepper({ steps, current, position, variant = 'bars', onStepPress, style }: StepperProps) {
  const reduce = useReduceMotion();
  const n = Math.max(1, Math.floor(steps));
  const at = Math.min(n - 1, Math.max(0, Math.floor(current)));
  // One animated position: the caller's, or ours springing to `current`.
  const own = useSharedValue(at);
  useEffect(() => {
    own.value = reduce ? at : withSpring(at, SNAP);
  }, [at, reduce, own]);
  const pos = position ?? own;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={stepLabel(at, n)}
      accessibilityValue={{ min: 1, max: n, now: at + 1 }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: variant === 'bars' ? space.sm : 0 }, style]}
    >
      {Array.from({ length: n }, (_, i) =>
        variant === 'bars' ? (
          <Bar key={i} index={i} position={pos} />
        ) : (
          <React.Fragment key={i}>
            <Circle index={i} current={at} reduce={reduce} onPress={onStepPress} />
            {i < n - 1 ? <Connector index={i} position={pos} /> : null}
          </React.Fragment>
        ),
      )}
    </View>
  );
}

function Bar({ index, position }: { index: number; position: SharedValue<number> }) {
  const c = useColors();
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: barFill(index, position.value) }] }));
  return (
    <View style={{ flex: 1, height: STEPPER.barHeight, borderRadius: SHAPE.action, borderCurve: 'continuous', backgroundColor: c.border, overflow: 'hidden' }}>
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, backgroundColor: c.accent, transformOrigin: 'left' },
          fill,
        ]}
      />
    </View>
  );
}

function Connector({ index, position }: { index: number; position: SharedValue<number> }) {
  const c = useColors();
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: connectorFill(index, position.value) }] }));
  return (
    <View
      style={{
        flex: 1,
        height: STEPPER.connector,
        marginHorizontal: space.sm,
        borderRadius: SHAPE.action,
        borderCurve: 'continuous',
        backgroundColor: c.border,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, backgroundColor: c.accent, transformOrigin: 'left' },
          fill,
        ]}
      />
    </View>
  );
}

function Circle({ index, current, reduce, onPress }: { index: number; current: number; reduce: boolean; onPress?: (i: number) => void }) {
  const c = useColors();
  const status = stepStatus(index, current);
  const filled = status !== 'upcoming';
  const body = (
    <View
      style={{
        width: STEPPER.circle,
        height: STEPPER.circle,
        borderRadius: SHAPE.action,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? c.accent : c.raised,
      }}
    >
      {status === 'complete' ? (
        <Check color={c.onAccent} reduce={reduce} />
      ) : status === 'active' ? (
        <View style={{ width: STEPPER.dot, height: STEPPER.dot, borderRadius: SHAPE.action, borderCurve: 'continuous', backgroundColor: c.onAccent }} />
      ) : (
        <T role="label" tone="dim">
          {String(index + 1)}
        </T>
      )}
    </View>
  );
  if (!onPress || index === current) return body;
  return (
    <Pressable
      onPress={() => {
        select();
        onPress(index);
      }}
      hitSlop={hitSlopToReach(STEPPER.circle)}
      accessibilityRole="button"
      accessibilityLabel={`Go to step ${index + 1}`}
    >
      {body}
    </Pressable>
  );
}

/** react-bits' check, drawn once on `EASE`: 0.1s in, over 0.3s. */
function Check({ color, reduce }: { color: string; reduce: boolean }) {
  const drawn = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      drawn.value = 1;
      return;
    }
    drawn.value = withDelay(STEPPER.checkDelayMs, withTiming(1, { duration: STEPPER.checkMs, easing: EASE, reduceMotion: ReduceMotion.Never }));
  }, [reduce, drawn]);
  const offset = useDerivedValue(() => CHECK_LENGTH * (1 - drawn.value));
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const size = STEPPER.circle * 0.6;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedPath
        d={CHECK_PATH}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]}
        animatedProps={props}
      />
    </Svg>
  );
}
