/**
 * SplitText: a line that arrives a character or a word at a time, each unit rising into place.
 * By characters for a greeting ("Hi. I'm Bit."), by words for a sentence (a Wrapped question,
 * the archetype's rule, the done step's line). Once per arrival; a new `replayKey` plays it
 * again. Reduce Motion: the whole line fades in over 150 ms.
 *
 *   <SplitText text="Hi. I'm Bit." textStyle={HEADLINE} accessibilityRole="header" />
 *   <SplitText text="How long are your prompts?" by="words" role="row" hue={cardHue(id, a).name} />
 *
 * Ported from react-bits `TextAnimations/SplitText/SplitText.tsx` by David Haz. react-bits is
 * MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence
 * asks, and the port is used as part of this application only; it is not to be redistributed
 * as a component.
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
 * What changed in the port: GSAP SplitText and ScrollTrigger become the settled text laid out
 * once and a Reanimated clock (`shared.tsx`); react-bits' `from {opacity 0, y 40}` over 1.25 s
 * at 50 ms becomes the doc's numbers (characters: 10 pt over 360 ms, 24 ms apart; words: 6 pt,
 * opacity in 120 ms, 60 ms apart) on `EASE`; the stagger squeezes so the line lands inside
 * 1.2 s; `staggerFrom` comes from RotatingText; text in a hue snaps its opacity (`ink.ts`).
 * `lines` splitting is not ported: a line is a layout fact here, not a unit.
 */
import React, { useMemo } from 'react';
import { Text, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useReduceMotion } from '../../motion';
import { ease, localProgress } from './curve';
import { fadeFor } from './ink';
import { unitCount, type SplitBy } from './segment';
import {
  EffectShell,
  LineRows,
  useEffectClock,
  useInk,
  useKerning,
  useLaidLines,
  useTextLook,
  useUnitCount,
  type PlayProps,
  type TextLook,
  type TextLookProps,
} from './shared';
import { SPLIT, SPLIT_WORDS, TEXT_EFFECT_DONE_MS } from './spec';
import { unitWindows, type StaggerFrom } from './stagger';

export interface SplitTextProps extends TextLookProps, PlayProps {
  text: string;
  /** Default `chars`. `words` for a sentence. */
  by?: SplitBy;
  /** Per unit, before the fit. Default 24 (chars) or 60 (words). */
  staggerMs?: number;
  /** One unit's rise. Default 360 (chars) or 300 (words). */
  durationMs?: number;
  /** How far below its place a unit starts. Default 10 (chars) or 6 (words). */
  risePt?: number;
  /** Default `first`: reading order. */
  staggerFrom?: StaggerFrom;
  /** The whole line lands within this. Default 1200 (rule 7). */
  budgetMs?: number;
  numberOfLines?: number;
}

export function SplitText(props: SplitTextProps) {
  const {
    text,
    by = 'chars',
    staggerMs,
    durationMs,
    risePt,
    staggerFrom = 'first',
    budgetMs = TEXT_EFFECT_DONE_MS,
    play = true,
    delay = 0,
    replayKey,
    onEnd,
    numberOfLines,
    style,
    accessibilityRole,
  } = props;
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'title');
  const ink = useInk(props);
  const lines = useLaidLines(text);
  const count = useUnitCount(lines, by);
  const empty = useMemo(() => unitCount(text, by) === 0, [text, by]);

  const words = by === 'words';
  const unitMs = durationMs ?? (words ? SPLIT_WORDS.riseMs : SPLIT.charMs);
  const rise = risePt ?? (words ? SPLIT_WORDS.risePt : SPLIT.risePt);
  // Characters fade on the curve with their rise (react-bits tweens both together); words snap
  // their opacity in 120 ms (the doc), and so does any unit in a hue.
  const fadeMs = words ? fadeFor(ink.identity, SPLIT_WORDS.fadeMs) : ink.identity ? fadeFor(true, unitMs) : null;

  const plan = useMemo(
    () =>
      unitWindows(count, {
        unitMs,
        staggerMs: staggerMs ?? (words ? SPLIT_WORDS.staggerMs : SPLIT.staggerMs),
        from: staggerFrom,
        budgetMs,
      }),
    [count, unitMs, staggerMs, words, staggerFrom, budgetMs],
  );

  const kerning = useKerning(lines, by === 'chars', look);
  const { clock, fade, settled } = useEffectClock({
    play,
    ready: lines.lines !== null && count > 0 && kerning.ready,
    totalMs: plan.totalMs,
    delay,
    replayKey,
    reduce,
    onEnd,
  });

  const textStyle = useMemo(() => [look.font, { color: ink.color }], [look.font, ink.color]);

  return (
    <EffectShell
      text={text}
      font={look.font}
      color={ink.color}
      scaling={look.scaling}
      settled={settled || empty}
      fade={fade}
      lines={lines}
      numberOfLines={numberOfLines}
      style={style}
      accessibilityRole={accessibilityRole}
      probes={kerning.probes}
      overlay={
        <LineRows
          lines={lines}
          by={by}
          offsets={kerning.offsets}
          renderSpace={(t, key) => (
            <Text key={key} {...look.scaling} style={textStyle}>
              {t}
            </Text>
          )}
          renderUnit={(u, key) => {
            const w = plan.windows[u.index];
            return (
              <SplitUnit
                key={key}
                text={u.text}
                clock={clock}
                start={w?.start ?? 0}
                duration={w?.duration ?? unitMs}
                fadeMs={fadeMs}
                rise={rise}
                textStyle={textStyle}
                scaling={look.scaling}
              />
            );
          }}
        />
      }
    />
  );
}

function SplitUnit({
  text,
  clock,
  start,
  duration,
  fadeMs,
  rise,
  textStyle,
  scaling,
}: {
  text: string;
  clock: SharedValue<number>;
  start: number;
  duration: number;
  fadeMs: number | null;
  rise: number;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const move = useAnimatedStyle(() => {
    const e = ease(localProgress(clock.value, start, duration));
    const opacity = fadeMs === null ? e : localProgress(clock.value, start, fadeMs);
    return { opacity, transform: [{ translateY: (1 - e) * rise }] };
  });
  return (
    <Animated.View style={move}>
      <Text {...scaling} style={textStyle}>
        {text}
      </Text>
    </Animated.View>
  );
}
