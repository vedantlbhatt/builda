/**
 * The loading state, shaped like the result: the story card as a flat block of the ground's
 * raised grey, its number, question, answer and art as quieter blocks where they will be, and
 * the line under it saying what is happening. Static: no shimmer (the slop list), no hue it
 * has not earned yet (the card's colour arrives with the card).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GROUND } from '../insights/palette';
import { SHAPE } from '../ui/shape';
import { CARD_TYPE, STORY_COPY } from './story';

function Bar({ width, height }: { width: number | `${number}%`; height: number }) {
  return <View style={{ width, height, borderRadius: SHAPE.mark, borderCurve: 'continuous', backgroundColor: GROUND.card }} />;
}

export function DeckSkeleton({ width, height }: { width: number; height: number }) {
  const ty = CARD_TYPE.story;
  return (
    <View accessibilityLabel={STORY_COPY.reading} accessible style={{ width, height }}>
      <View style={[styles.card, { width, height, padding: ty.pad }]}>
        <View style={{ gap: ty.gap }}>
          <Bar width={22} height={ty.index} />
          <Bar width="78%" height={ty.questionLine} />
          <Bar width="46%" height={Math.round(ty.heroMax * 0.62)} />
          <Bar width="64%" height={ty.tailLine} />
        </View>
        <View style={styles.art}>
          <Text maxFontSizeMultiplier={1.4} style={styles.reading}>
            {STORY_COPY.reading}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: GROUND.raised, borderRadius: SHAPE.wrapped, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'space-between' },
  art: {
    height: '32%',
    borderRadius: SHAPE.inner,
    borderCurve: 'continuous',
    backgroundColor: GROUND.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reading: { fontSize: 13, lineHeight: 18, color: GROUND.dim },
});
