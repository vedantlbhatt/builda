/**
 * Two words, and a rule under the one showing.
 *
 * The board's shape switch (PILES / GRID) and the sheet's (RECIPE / TO DO). Not a segmented
 * control, not two chips: a chip here would be a pale fill of a hue with a border of the same hue
 * and a label of the same hue, which is the shape this app has a rule against, and it would say
 * nothing the word does not.
 *
 * It lives here rather than in the screen because a screen file may not carry a literal radius
 * (`__tests__/screens.test.ts`): radii are the kit's, and this one is a hairline's cap.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';

export interface WordToggleProps {
  word: string;
  on: boolean;
  onPress: () => void;
  /** The rule's colour when it is the one showing. Defaults to the reader's ink. */
  ink?: string;
}

export function WordToggle({ word, on, onPress, ink }: WordToggleProps) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={word}
      hitSlop={8}
      onPress={() => {
        select();
        onPress();
      }}
    >
      <T role="label" style={{ color: on ? c.text : c.textFaint, letterSpacing: 1.4 }}>
        {word}
      </T>
      <View style={[styles.rule, { backgroundColor: on ? ink ?? c.text : 'transparent' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rule: { height: 2, borderRadius: 1, borderCurve: 'continuous', marginTop: 5 },
});
