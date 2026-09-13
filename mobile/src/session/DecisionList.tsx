/**
 * The decision feed on one session (roadmap 2.5): the hard to undo things the agent did, a short
 * list in the engine's order. Open rows, not a card: a number in the mono face, the engine's
 * sentence at the row's weight and when it first happened under it, a hairline between. Which
 * package, file or command never left the machine, so no row names one. Nothing renders without
 * a row: an absent live state is not "no decisions".
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GUTTER, Kicker, type, Words } from '../insights/kit';
import { GROUND } from '../insights/palette';
import { Block } from '../insights/reveal';
import type { DecisionRow } from './decisions';
import { Arrive } from './parts';

export function DecisionList({ rows }: { rows: readonly DecisionRow[] }) {
  if (!rows.length) return null;
  return (
    <Block style={styles.block}>
      <Kicker>what it did that is hard to undo</Kicker>
      {rows.map((r, i) => (
        <Arrive key={r.key} delay={60 + i * 140}>
          <View style={[styles.row, i > 0 ? styles.hairTop : null]}>
            <Text allowFontScaling={false} style={[type.mono, styles.index]}>
              {String(i + 1).padStart(2, '0')}
            </Text>
            <View style={styles.words}>
              <Words style={type.lead}>{r.title}</Words>
              {r.meta ? <Words style={type.meta}>{r.meta}</Words> : null}
            </View>
          </View>
        </Arrive>
      ))}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  row: { flexDirection: 'row', gap: 14, paddingVertical: 12, alignItems: 'baseline' },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  index: { width: 22, color: GROUND.faint },
  words: { flex: 1, gap: 2 },
});
