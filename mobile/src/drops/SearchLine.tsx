/**
 * The search line.
 *
 * WHAT THIS REPLACED. The board's search was the kit's `TextField`: a filled capsule. On a wall of
 * photographs a filled capsule is the one element that looks like it came from a settings screen,
 * and it is most of the way to the shape this app has a rule against — a soft fill with a label
 * inside it, all of one hue.
 *
 * So: no field. A word you type on a rule, which is what a search has looked like on paper for a
 * century, and the same 2pt rule the PILES / GRID words already stand on (`WordToggle`). The rule
 * is faint until you are using it, and the right end of the line reports what your words matched
 * rather than making you count the piles.
 *
 * It lives here and not in the screen because a screen file may not carry a literal radius
 * (`__tests__/screens.test.ts`), and a rule needs its cap.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { T } from '../ui/Text';
import { useColors } from '../ui/scheme';
import { roleStyle } from '../ui/typeStyle';

export interface SearchLineProps {
  value: string;
  onChangeText: (v: string) => void;
  /** How many drops the words matched, and out of how many. Null while the box is empty. */
  hits: { shown: number; total: number } | null;
}

export function SearchLine({ value, onChangeText, hits }: SearchLineProps) {
  const c = useColors();
  const [live, setLive] = useState(false);
  const warm = live || value.length > 0;

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Search your drops"
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setLive(true)}
          onBlur={() => setLive(false)}
          placeholder="what were you after"
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, roleStyle('body'), { color: c.text }]}
        />
        {hits ? (
          <Pressable hitSlop={10} onPress={() => onChangeText('')} accessibilityLabel="Clear search">
            <T role="mono" style={{ color: hits.shown ? c.textDim : c.accent }}>
              {hits.shown ? `${hits.shown} of ${hits.total}` : 'none'}
            </T>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: warm ? c.text : c.textFaint, opacity: warm ? 1 : 0.4 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 0 },
  rule: { height: 2, borderRadius: 1, borderCurve: 'continuous' },
});
