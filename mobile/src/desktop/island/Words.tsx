/**
 * A sentence said a word at a time (`WORD_MS` apart), the shipped beat's summary. Words fade up
 * in place; the line never reflows while it is being said, because every word is laid out from
 * the start and only its opacity moves.
 */
import React, { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { WORD_MS } from './motion';

export function Words({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const words = text.split(/\s+/).filter(Boolean);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= words.length ? n : n + 1)), WORD_MS);
    return () => clearInterval(t);
  }, [text, words.length]);
  return (
    <Text numberOfLines={2} style={style} accessibilityLabel={text}>
      {words.map((w, i) => (
        <Text key={`${i}${w}`} style={{ opacity: i < shown ? 1 : 0 }}>
          {i === 0 ? w : ` ${w}`}
        </Text>
      ))}
    </Text>
  );
}
