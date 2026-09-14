/**
 * The entrances: AnimatedContent (rise or slide into place), FadeContent (opacity only),
 * Rise (the design's name for AnimatedContent at its defaults), and Stagger (a list whose
 * items arrive 40ms apart, the ninth and after as a block). Section and list entrances
 * everywhere (DESIGN-V2 4.4 #24, rule 3): once, on first load, never on recycled rows or a
 * refresh (`appear={false}`), and again only when `trigger` changes (a Wrapped card arriving).
 *
 *   <Rise index={2}><Section label="burn" /></Rise>
 *   <FadeContent delay={120}><T role="meta" tone="dim">reading the transcript</T></FadeContent>
 *   <AnimatedContent scale={0.95} hue trigger={cardIndex}>{face}</AnimatedContent>
 *   <Stagger appear={!refreshing}>{rows}</Stagger>
 *
 * Ported from react-bits `Animations/AnimatedContent/AnimatedContent.tsx` and
 * `Animations/FadeContent/FadeContent.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
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
 * What changed in the port: GSAP timelines and ScrollTrigger become two Reanimated timings
 * on the kit's `EASE` (one for the move and scale, one for the opacity, so content in a hue
 * can snap its opacity in under 120ms while it still rises the full 300ms); the numbers are
 * the kit's (8pt, 300ms, a 40ms stagger capped at eight); the blur is gone; the disappear
 * option is gone (exits belong to whoever unmounts). The plan is computed in `entrance.ts`.
 *
 * Reduce Motion: nothing moves; the content fades in over 150ms, which is never skipped.
 */
import React, { Children, isValidElement, useEffect, useMemo, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EASE, useReduceMotion } from '../../motion';
import { entrancePlan, type EntranceOptions } from './entrance';

export interface AnimatedContentProps extends EntranceOptions {
  children?: ReactNode;
  /** false: the content is simply there (a refresh, a recycled row, a screen seen before). Default true. */
  appear?: boolean;
  /** Changing this plays the entrance again. */
  trigger?: number | string;
  /** When the content has arrived: the move and the fade both done. */
  onComplete?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AnimatedContent({ children, appear = true, trigger, onComplete, style, testID, ...options }: AnimatedContentProps) {
  const reduced = useReduceMotion();
  const plan = useMemo(
    () => entrancePlan(options, reduced),
    // The plan is read when the entrance starts; options are plain values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      reduced,
      options.index,
      options.delay,
      options.duration,
      options.distance,
      options.direction,
      options.reverse,
      options.initialOpacity,
      options.animateOpacity,
      options.scale,
      options.rotate,
      options.hue,
      options.step,
      options.cap,
    ],
  );
  const move = useSharedValue(appear ? 0 : 1);
  const fade = useSharedValue(appear ? 0 : 1);

  useEffect(() => {
    if (!appear) {
      move.value = 1;
      fade.value = 1;
      return;
    }
    move.value = 0;
    fade.value = 0;
    const done = onComplete
      ? (finished?: boolean) => {
          'worklet';
          if (finished) runOnJS(onComplete)();
        }
      : undefined;
    const moveLonger = plan.moveMs >= plan.fadeMs;
    // Never: under Reduce Motion the plan is already the 150ms fade, and Reanimated's own
    // switch would skip even that.
    move.value = withDelay(
      plan.delay,
      withTiming(1, { duration: plan.moveMs, easing: EASE, reduceMotion: ReduceMotion.Never }, moveLonger ? done : undefined),
    );
    fade.value = withDelay(
      plan.delay,
      withTiming(1, { duration: plan.fadeMs, easing: EASE, reduceMotion: ReduceMotion.Never }, moveLonger ? undefined : done),
    );
    // `trigger` replays; the plan in force is the one the entrance starts with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appear, trigger, reduced]);

  const from = plan.from;
  const animated = useAnimatedStyle(() => {
    const m = move.value;
    const back = 1 - m;
    return {
      opacity: from.opacity + (1 - from.opacity) * fade.value,
      transform: [
        { translateX: from.x * back },
        { translateY: from.y * back },
        { scale: from.scale + (1 - from.scale) * m },
        { rotate: `${from.rotate * back}deg` },
      ],
    };
  }, [from]);

  return (
    <Animated.View testID={testID} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}

/** The design's name for an entrance: AnimatedContent at the kit's defaults, 8pt over 300ms. */
export const Rise = AnimatedContent;

export type FadeContentProps = Omit<AnimatedContentProps, 'distance' | 'direction' | 'reverse' | 'scale' | 'rotate' | 'animateOpacity'>;

/** FadeContent: opacity only, 300ms on `EASE` (react-bits 1s power2), no blur. */
export function FadeContent(props: FadeContentProps) {
  return <AnimatedContent {...props} distance={0} />;
}

export interface StaggerProps extends Omit<AnimatedContentProps, 'index' | 'children' | 'testID'> {
  children?: ReactNode;
  /** Style for each item's wrapper (the list's own layout stays with the parent). */
  itemStyle?: StyleProp<ViewStyle>;
}

/**
 * Each child enters in turn: 40ms apart (`step`), the ninth and after with the eighth as a
 * block (`cap`), rising `distance` over `duration`. Wrap the list's first load only: a
 * recycled row or a pulled refresh passes `appear={false}` and is simply there.
 */
export function Stagger({ children, itemStyle, onComplete, ...options }: StaggerProps) {
  // `toArray` drops null, undefined and booleans, so a conditional row is never an empty slot.
  const items = Children.toArray(children);
  return (
    <>
      {items.map((child, i) => (
        <AnimatedContent
          key={isValidElement(child) && child.key !== null ? child.key : i}
          {...options}
          index={i}
          style={itemStyle}
          onComplete={i === items.length - 1 ? onComplete : undefined}
        >
          {child}
        </AnimatedContent>
      ))}
    </>
  );
}
