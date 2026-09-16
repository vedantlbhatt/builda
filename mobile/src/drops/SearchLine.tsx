/**
 * The search line.
 *
 * WHAT THIS REPLACED. The board's search was the kit's `TextField` at its default skin: a filled
 * capsule. On a wall of photographs a filled capsule is the one element that looks like it came
 * from a settings screen, and it is most of the way to the shape this app has a rule against — a
 * soft fill with a label inside it, all of one hue.
 *
 * So: no box. A word you type on a rule, which is what a search has looked like on paper for a
 * century, and the same 2pt rule the PILES / GRID words already stand on (`WordToggle`). The rule
 * is faint until you are using it, and the right end of the line reports what your words matched
 * rather than making you count the piles.
 *
 * IT IS STILL THE KIT'S FIELD, with its skin turned off, and that is not a detail.
 *
 * The first version of this file was a bare `TextInput` with `roleStyle('body')` spread into its
 * style. That spread carries `lineHeight`, and `TextField` leaves `lineHeight` off on purpose —
 * its own comment says why, that a single line iOS `TextInput` sits its text low in the box with
 * one. On RN 0.79 it is worse than low: the first keystroke aborted the process inside
 * `BaseTextInputShadowNode::measureContent`, in the text layout manager's attributed string cache
 * (`Builda-2026-09-16-092639.ips`, reproduced on demand). A component the app has already learned
 * from is not a thing to hand roll around; it is a thing to restyle.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useColors } from '../ui/scheme';

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
        <TextField
          accessibilityLabel="Search your drops"
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setLive(true)}
          onBlur={() => setLive(false)}
          placeholder="what were you after"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {hits ? (
          <Pressable hitSlop={10} onPress={() => onChangeText('')} accessibilityLabel="Clear search">
            <T role="mono" style={{ color: hits.shown ? c.textDim : c.accent }}>
              {hits.shown ? `${hits.shown} of ${hits.total}` : 'none'}
            </T>
          </Pressable>
        ) : null}
      </View>
      <View
        style={[styles.rule, { backgroundColor: warm ? c.text : c.textFaint, opacity: warm ? 1 : 0.4 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The kit's field with its box taken off: no fill, no inset. Its corner radius is left alone
  // rather than zeroed, because a radius on a transparent fill draws nothing.
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    minHeight: 34,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  rule: { height: 2, borderRadius: 1, borderCurve: 'continuous' },
});
