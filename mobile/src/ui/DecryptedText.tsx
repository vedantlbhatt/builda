/**
 * A sequential decrypt, for exactly two places: the archetype reveal and the "most cryptic
 * prompt" card (DESIGN-DIRECTION 3.5). 40ms ticks from the start, charset `01{}[]<>/=+*`.
 * Reduce Motion shows the final text at once. Screen readers always get the final text.
 *
 * Ported from react-bits `TextAnimations/DecryptedText/DecryptedText.tsx` by David Haz, MIT
 * + Commons Clause (Copyright (c) 2026 David Haz; the full notice is in `digits.ts`; used
 * as part of this application, not redistributed). The frame logic is in `decrypt.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { TypeRole } from '../theme';
import { DECRYPT_CHARSET, decryptFrames, mulberry32 } from './decrypt';
import { DECRYPT_TICK_MS, useReduceMotion } from './motion';
import type { Tone } from './scheme';
import { T } from './Text';
import type { RoleWeight } from './typeStyle';

export interface DecryptedTextProps {
  text: string;
  /** Default `title`. The archetype name is `hero`. */
  role?: TypeRole;
  weight?: RoleWeight;
  tone?: Tone;
  /** Start when true. Plays once per mount; later changes to `text` just land. */
  play?: boolean;
  /** A fixed seed makes the scramble repeatable (tests, screenshots). */
  seed?: number;
  charset?: string;
  numberOfLines?: number;
  onEnd?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function DecryptedText({
  text,
  role = 'title',
  weight,
  tone = 'text',
  play = true,
  seed,
  charset = DECRYPT_CHARSET,
  numberOfLines,
  onEnd,
  style,
}: DecryptedTextProps) {
  const reduce = useReduceMotion();
  const frames = useMemo(
    () => decryptFrames(text, seed === undefined ? Math.random : mulberry32(seed), charset),
    [text, seed, charset],
  );
  const [frame, setFrame] = useState<number>(play && !reduce ? 0 : frames.length - 1);
  const played = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    if (!play) return;
    if (played.current || reduce) {
      setFrame(frames.length - 1);
      return;
    }
    played.current = true;
    let i = 0;
    setFrame(0);
    const id = setInterval(() => {
      i += 1;
      if (i >= frames.length - 1) {
        clearInterval(id);
        setFrame(frames.length - 1);
        onEndRef.current?.();
        return;
      }
      setFrame(i);
    }, DECRYPT_TICK_MS);
    return () => clearInterval(id);
  }, [play, reduce, frames]);

  const done = frame >= frames.length - 1;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={style}>
      {/* The final text holds the layout; the scramble is drawn over it, so nothing reflows. */}
      <T role={role} weight={weight} tone={tone} numberOfLines={numberOfLines} style={done ? null : styles.hidden}>
        {text}
      </T>
      {done ? null : (
        <T
          role={role}
          weight={weight}
          tone={tone}
          numberOfLines={numberOfLines}
          style={StyleSheet.absoluteFill}
          importantForAccessibility="no"
        >
          {frames[frame]}
        </T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
