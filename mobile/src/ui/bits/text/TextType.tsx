/**
 * TextType: a line that types itself behind an amber caret, which then blinks three times and
 * goes. For the command a person will type on their Mac (onboarding's connect step, Pair), and
 * any line that is a machine talking. Once, 18 ms a character, no deleting and no loop unless
 * asked; given several lines with `loop`, it is react-bits' typewriter (type, pause, delete,
 * next). Reduce Motion: the whole line, no caret.
 *
 *   <TextType text="npx builda pair 4821" />
 *   <TextType text={['watching Claude Code', 'watching Codex']} loop role="meta" tone="dim" />
 *
 * Ported from react-bits `TextAnimations/TextType/TextType.tsx` by David Haz. react-bits is
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
 * What the port keeps: `text` as one string or several, `typingSpeed`, `initialDelay`,
 * `pauseDuration`, `deletingSpeed`, `loop`, `showCursor`, `cursorCharacter`,
 * `hideCursorWhileTyping`, `cursorBlinkDuration`, `textColors` (here `colors`),
 * `variableSpeed`, `onSentenceComplete`, and the timing, frame for frame (`typewriter.ts`).
 * What it changes: the doc's defaults (18 ms a character, one pass), a single line squeezed to
 * land inside 1.2 s, a caret that blinks three times and hides rather than forever (and does
 * not blink while typing, as a real caret does not), the rest of the line laid out in clear ink
 * so it breaks where the finished line will and nothing reflows, graphemes rather than UTF-16
 * units, and `startOnVisible` as the kit's `play`. `reverseMode` is not ported.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { mulberry32 } from '../../decrypt';
import { useInk, useTextLook, type PlayProps, type TextLookProps } from './shared';
import { TEXT_EFFECT_DONE_MS, TEXT_REDUCED_FADE, TYPE } from './spec';
import {
  caretGoneAt,
  caretVisible,
  fitTypingMs,
  typeFrames,
  typedText,
  untypedText,
  type TypeFrame,
} from './typewriter';
import { graphemes } from './segment';

export interface TextTypeProps extends TextLookProps, PlayProps {
  text: string | readonly string[];
  /** Per character. Default 18 (the doc). A single line is squeezed to land in `budgetMs`. */
  typingMs?: number;
  /** Per deletion, several lines only. Default 30 (react-bits). */
  deletingMs?: number;
  /** On a finished line before it is deleted. Default 2000 (react-bits). */
  pauseMs?: number;
  /** Before each line's first character (react-bits' `initialDelay`). Default 0. */
  startMs?: number;
  /** Delete the last line and start again. Default false. */
  loop?: boolean;
  /** react-bits' `variableSpeed`: each character between `min` and `max` ms. */
  variableSpeed?: { min: number; max: number };
  /** A fixed seed makes a variable speed repeatable (tests, screenshots). */
  seed?: number;
  /** Default true. */
  showCursor?: boolean;
  /** Default a bar. */
  cursorCharacter?: string;
  /** Default the accent: the amber caret. */
  cursorColor?: string;
  hideCursorWhileTyping?: boolean;
  /** One on and one off. Default 500. */
  blinkMs?: number;
  /** Blinks before the caret goes, once typing is done. Default 3; Infinity keeps it. */
  blinks?: number;
  /** Per line, cycling (react-bits' `textColors`). Default the ink. */
  colors?: readonly string[];
  /** A single line lands within this. Default 1200 (rule 7). */
  budgetMs?: number;
  onSentenceComplete?: (sentence: string, index: number) => void;
  numberOfLines?: number;
}

export function TextType(props: TextTypeProps) {
  const {
    text,
    typingMs = TYPE.charMs,
    deletingMs = TYPE.deleteMs,
    pauseMs = TYPE.pauseMs,
    startMs = 0,
    loop = false,
    variableSpeed,
    seed,
    showCursor = true,
    cursorCharacter = '|',
    cursorColor,
    hideCursorWhileTyping = false,
    blinkMs = TYPE.blinkMs,
    blinks = TYPE.blinks,
    colors,
    budgetMs = TEXT_EFFECT_DONE_MS,
    play = true,
    delay = 0,
    replayKey,
    onEnd,
    onSentenceComplete,
    numberOfLines,
    style,
    accessibilityRole = 'text',
  } = props;
  const c = useColors();
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'mono');
  const ink = useInk(props);
  const caretInk = cursorColor ?? c.accent;

  const texts = useMemo(() => (typeof text === 'string' ? [text] : [...text]), [text]);
  const textsKey = texts.join('\u001f');
  const single = texts.length === 1 && !loop;
  const perChar = single ? fitTypingMs(graphemes(texts[0] ?? '').length, typingMs, budgetMs, startMs) : typingMs;
  const plan = useMemo(
    () =>
      typeFrames(texts, {
        typingMs: perChar,
        deletingMs,
        pauseMs,
        startMs,
        loop,
        variableSpeed,
        rng: seed === undefined ? Math.random : mulberry32(seed),
      }),
    // `texts` is keyed by its content, so a parent passing a new array of the same lines does not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textsKey, perChar, deletingMs, pauseMs, startMs, loop, variableSpeed?.min, variableSpeed?.max, seed],
  );

  const last = plan.frames[plan.frames.length - 1]!;
  const [frame, setFrame] = useState<TypeFrame>(() => (reduce ? last : plan.frames[0]!));
  /** When typing last stopped (ms, `Date.now`), for the caret's blinks. Null while typing. */
  const [idleSince, setIdleSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onSentenceRef = useRef(onSentenceComplete);
  onSentenceRef.current = onSentenceComplete;
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const played = useRef<{ key: string | number | undefined; plan: typeof plan } | null>(null);

  // The typewriter: one timer at a time, each set for the next frame's moment measured from the
  // start, so a slow frame never pushes the rest of the line later. A new `replayKey`, or new
  // lines, type again; anything else leaves a finished line alone.
  useEffect(() => {
    if (reduce) {
      setFrame(plan.frames[plan.frames.length - 1]!);
      setIdleSince(null);
      return;
    }
    if (!play) return;
    if (played.current && played.current.key === replayKey && played.current.plan === plan) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = Date.now() + delay;
    const frames = plan.frames;
    const cycle = plan.cycleMs;
    let i = 0;
    let offset = 0;
    setFrame(frames[0]!);
    setIdleSince(null);
    const step = () => {
      if (cancelled) return;
      const f = frames[i]!;
      setFrame(f);
      const prev = frames[i - 1];
      if (prev && prev.deleting && f.typed === 0) onSentenceRef.current?.(textsRef.current[f.index] ?? '', f.index);
      const next = frames[i + 1];
      setIdleSince(!f.deleting && (!next || next.deleting) ? Date.now() : null);
      if (!next) {
        if (cycle !== null) {
          // Loop: the first line again, one cycle later.
          offset += cycle;
          i = 1;
          timer = setTimeout(step, Math.max(0, t0 + offset + (frames[1]?.at ?? 0) - Date.now()));
          return;
        }
        played.current = { key: replayKey, plan };
        onEndRef.current?.();
        return;
      }
      i += 1;
      timer = setTimeout(step, Math.max(0, t0 + offset + next.at - Date.now()));
    };
    timer = setTimeout(step, Math.max(0, t0 + (frames[0]?.at ?? 0) - Date.now()));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reduce, play, replayKey, plan, delay]);

  // The caret's blinks, once typing stops: a render per beat, and none once it has gone.
  useEffect(() => {
    if (idleSince === null || !showCursor || reduce) return;
    const gone = caretGoneAt(blinkMs, blinks);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now() - idleSince;
      setNow(t);
      if (t >= gone) return;
      timer = setTimeout(tick, blinkMs - (t % blinkMs) + 1);
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [idleSince, showCursor, reduce, blinkMs, blinks]);

  // Under Reduce Motion the finished line fades in once, like every entrance.
  const fade = useSharedValue(reduce && play ? 0 : 1);
  useEffect(() => {
    if (!reduce) {
      fade.value = 1;
      return;
    }
    if (!play) return;
    fade.value = withTiming(1, { duration: TEXT_REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never });
    onEndRef.current?.();
  }, [reduce, play, fade]);
  const whole = useAnimatedStyle(() => ({ opacity: fade.value }));

  const typing = idleSince === null;
  const caretOn =
    showCursor && play && !reduce && (typing ? !(hideCursorWhileTyping && frame.typed > 0) : caretVisible(now, blinkMs, blinks));
  const lineColor = colors && colors.length > 0 ? (colors[frame.index % colors.length] ?? ink.color) : ink.color;
  const typed = typedText(texts, frame);
  const rest = untypedText(texts, frame);
  const longest = useMemo(() => texts.reduce((a, b) => (graphemes(b).length > graphemes(a).length ? b : a), ''), [texts]);
  const shown = reduce ? (texts[texts.length - 1] ?? '') : typed;

  return (
    <Animated.View accessible accessibilityRole={accessibilityRole} accessibilityLabel={texts[frame.index] ?? ''} style={[style, whole]}>
      <View>
        {/* The longest line in clear ink holds the size, so nothing around it moves. */}
        <Text {...look.scaling} numberOfLines={numberOfLines} importantForAccessibility="no" style={[look.font, { color: 'transparent' }]}>
          {longest}
          {showCursor ? cursorCharacter : ''}
        </Text>
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0 }} importantForAccessibility="no-hide-descendants">
          <Text {...look.scaling} numberOfLines={numberOfLines} style={[look.font, { color: lineColor }]}>
            {shown}
            {showCursor ? <Text style={{ color: caretOn ? caretInk : 'transparent' }}>{cursorCharacter}</Text> : null}
            {reduce ? null : <Text style={{ color: 'transparent' }}>{rest}</Text>}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}
