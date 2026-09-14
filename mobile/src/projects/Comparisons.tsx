/**
 * How the projects compare: each comparison as its title, its two numbers set as figures in the
 * two projects' own inks with their names under them, and the engine's sentence. A refusal is its
 * sentence and nothing else (no figures when there is no pair); two floors read "at least" over
 * each figure and say why no ratio is stated, in the engine's words (`PROJECT_COMPARISON_REFUSALS`).
 *
 * Laid out as Robinhood lays a position against the market (design-md/finance/robinhood: two
 * tabular values side by side, the colour bound to the thing it names, never decorative).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { figure, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { Block } from '../insights/reveal';
import { comparisonFigures, type ComparisonView } from './model';
import type { ReportProjectComparison } from '../generated/report';

export function ComparisonBlock({
  c,
  raw,
  hues,
  first = false,
}: {
  c: ComparisonView;
  raw: ReportProjectComparison | null;
  hues: Readonly<Record<string, HueName>>;
  first?: boolean;
}) {
  const f = comparisonFigures(c, raw);
  const pair = c.high && c.low && f.high && f.low;
  return (
    <Block style={[styles.block, first ? null : styles.rule]}>
      <Kicker>{c.title.charAt(0).toLowerCase() + c.title.slice(1)}</Kicker>
      {pair ? (
        <View style={styles.pair}>
          {[
            { side: c.high!, num: f.high! },
            { side: c.low!, num: f.low! },
          ].map(({ side, num }, i) => {
            const ink = SPECTRUM[hues[side.key] ?? 'tide'].ink;
            return (
              <View key={side.key + i} style={styles.side}>
                {f.floor ? (
                  <Text allowFontScaling={false} style={[type.meta, { color: ink }]}>
                    at least
                  </Text>
                ) : null}
                <Num spec={num} textStyle={figure(36, ink)} delay={60 + i * 140} />
                <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[type.meta, { color: GROUND.text }]}>
                  {side.label.text}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {c.answered ? <Words style={[type.body, styles.sentence]}>{c.sentence}</Words> : <Refusal>{c.sentence}</Refusal>}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { marginHorizontal: GUTTER, paddingTop: 20 },
  // The hairline runs the text's width, not the screen's: a rule between two lines of print.
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border, marginTop: 20 },
  pair: { flexDirection: 'row', gap: 24, marginBottom: 10 },
  side: { flex: 1, gap: 2 },
  sentence: { marginTop: 2 },
});
