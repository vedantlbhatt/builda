import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SessionAnalysis } from '../generated/analysis';
import { Band, BandWords } from '../insights/Band';
import { GrowBar } from '../insights/Bars';
import { numSpec } from '../insights/format';
import { figure, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { DIMENSION_HUE, GROUND, ON_HUE, SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { READING_HEADLINE } from '../session/type';
import { analysisFooter, labelize, pct, SENSITIVE_WARNING } from './format';

/**
 * The model-written reading of a session, as a chapter of the session page in the house style
 * (design-refs/HOUSE-STYLE.md): its own band in its own hue with the model's headline set large
 * in dark ink and the outcome and the type beside it, then the reading on the warm ground, one
 * idea to a line, and the five dimensions as bars in their five hues that grow to their scores
 * while the scores count up.
 *
 * SHORT ON PURPOSE (spec/analysis.v1.json, docs/analysis.md). The reading is a headline, at
 * most two sentences and up to three highlights; the corpus numbers people actually want
 * (planning ratio, steer rate, velocity, archetype) are COMPUTED and live on the profile, not
 * here. Every part is skipped when the model left it empty: the spec's honesty rule says a
 * field the model could not ground is empty, never guessed, and an empty part would turn that
 * silence into a claim. Nothing here is computed; this only lays out what the analysis says.
 */

/**
 * How long a cheer lasts beside a shipped headline. The reading on this page no longer cheers
 * (the session's creature is printed on the hero band, and a page prints one creature); the
 * recap sheet still does, on the same beat.
 */
export const CELEBRATION_MS = 3000;

export function AnalysisView({
  analysis: a,
  hue,
  width,
  still = false,
}: {
  analysis: SessionAnalysis;
  hue: Hue;
  width: number;
  /**
   * A running session's checkpoint reading: said as one, since the session it reads is not done.
   */
  still?: boolean;
}) {
  const inner = width - GUTTER * 2;
  const highlights = a.highlights ?? [];
  const dimensions = a.dimensions ?? [];
  const moves = a.decision_patterns ?? [];
  const growth = a.growth_edge ?? [];
  const tags = a.tags ?? [];
  const style = a.build_style;
  const prompting = a.prompting;
  const styleRows = style
    ? ([
        ['planning', style.planning],
        ['iteration', style.iteration],
        ['steering', style.steering],
        ['verification', style.verification],
        ['scope', style.scope_control],
      ] as const)
    : [];

  return (
    <Section style={styles.section}>
      <Band hue={hue} title={still ? 'The reading so far' : 'The reading'}>
        {a.headline ? (
          <BandWords delay={260}>
            <Words style={[READING_HEADLINE, styles.onHue]}>{a.headline}</Words>
          </BandWords>
        ) : null}
        {a.outcome || a.archetype ? (
          <BandWords delay={360}>
            <View style={styles.pairs}>
              {a.outcome ? (
                <View>
                  <Words style={type.bandCaption}>{labelize(a.outcome)}</Words>
                  <Words style={type.bandNote}>outcome</Words>
                </View>
              ) : null}
              {a.archetype ? (
                <View>
                  <Words style={type.bandCaption}>{labelize(a.archetype)}</Words>
                  <Words style={type.bandNote}>how it read you</Words>
                </View>
              ) : null}
            </View>
          </BandWords>
        ) : null}
        {!a.headline && !a.outcome && !a.archetype ? (
          <BandWords delay={300}>
            <Refusal onHue>The model wrote no headline for this session.</Refusal>
          </BandWords>
        ) : null}
      </Band>

      {a.summary || highlights.length ? (
        <Block style={styles.block}>
          {a.summary ? <Words style={type.body}>{a.summary}</Words> : null}
          {highlights.length ? (
            <View style={styles.list}>
              {highlights.map((h, i) => (
                <View key={i} style={[styles.item, i > 0 ? styles.hairTop : null]}>
                  <Words style={[type.mono, styles.index]}>{String(i + 1).padStart(2, '0')}</Words>
                  <Words style={[type.body, styles.fill]}>{h}</Words>
                </View>
              ))}
            </View>
          ) : null}
        </Block>
      ) : null}

      {dimensions.length ? (
        <Block style={styles.block}>
          <Kicker>the five dimensions, this session</Kicker>
          <View style={styles.dims}>
            {dimensions.map((d, i) => {
              const ink = SPECTRUM[DIMENSION_HUE[d.dimension]].ink;
              const score = Math.round(Math.min(100, Math.max(0, d.score)));
              return (
                <View key={d.dimension} style={styles.dim}>
                  <View style={styles.dimHead}>
                    <Words style={[type.lead, styles.fill]}>{labelize(d.dimension)}</Words>
                    <Num spec={numSpec(score, String(score))} textStyle={figure(28, ink)} delay={80 + i * 140} />
                  </View>
                  <GrowBar frac={score / 100} color={ink} height={8} delay={80 + i * 140} />
                  {d.rationale ? <Words style={type.meta}>{d.rationale}</Words> : null}
                </View>
              );
            })}
          </View>
        </Block>
      ) : null}

      {styleRows.length ? (
        <Block style={styles.block}>
          <Kicker>how it was built</Kicker>
          {styleRows.map(([k, v], i) => (
            <View key={k} style={[styles.pair, i > 0 ? styles.hairTop : null]}>
              <Words style={[type.dim, styles.pairKey]}>{k}</Words>
              <Words style={[type.lead, styles.fill]}>{labelize(v)}</Words>
            </View>
          ))}
          {style?.architecture_note ? <Words style={[type.meta, styles.after]}>{style.architecture_note}</Words> : null}
        </Block>
      ) : null}

      {prompting ? (
        <Block style={styles.block}>
          <Kicker>prompting</Kicker>
          <View style={styles.dimHead}>
            <Words style={[type.lead, styles.fill]}>specificity</Words>
            <Num spec={numSpec(Math.round(prompting.specificity), String(Math.round(prompting.specificity)))} textStyle={figure(28, hue.ink)} delay={80} />
          </View>
          <GrowBar frac={Math.min(1, Math.max(0, prompting.specificity / 100))} color={hue.ink} height={8} delay={80} />
          <View style={styles.list}>
            <Line value={pct(prompting.correction_share)} label="of your prompts corrected course" ink={hue.ink} delay={220} />
            <Line value={pct(prompting.question_share)} label="asked rather than directed" ink={hue.ink} delay={340} />
          </View>
          <Words style={[type.dim, styles.after]}>{`The tone read as ${labelize(prompting.tone)}.`}</Words>
          {prompting.note ? <Words style={[type.meta, styles.after]}>{prompting.note}</Words> : null}
        </Block>
      ) : null}

      {moves.length ? (
        <Block style={styles.block}>
          <Kicker>your moves</Kicker>
          {moves.map((m, i) => (
            <View key={`${m.pattern}${i}`} style={[styles.move, i > 0 ? styles.hairTop : null]}>
              <Words style={type.lead}>{m.pattern}</Words>
              {m.prompt_excerpt ? <Quote text={m.prompt_excerpt} /> : null}
              {m.effect ? <Words style={type.meta}>{m.effect}</Words> : null}
            </View>
          ))}
        </Block>
      ) : null}

      {growth.length ? (
        <Block style={styles.block}>
          <Kicker>try next</Kicker>
          {growth.map((g, i) => (
            <View key={i} style={[styles.item, i > 0 ? styles.hairTop : null]}>
              <Words style={[type.mono, styles.index]}>{String(i + 1).padStart(2, '0')}</Words>
              <Words style={[type.body, styles.fill]}>{g}</Words>
            </View>
          ))}
        </Block>
      ) : null}

      <Block style={styles.block}>
        {tags.length ? <Words style={[type.dim, styles.tags]}>{tags.join('  ·  ')}</Words> : null}
        <Words style={type.meta}>{analysisFooter(a)}</Words>
        {a.contains_sensitive ? (
          <View style={styles.after}>
            <Refusal>{SENSITIVE_WARNING}</Refusal>
          </View>
        ) : null}
      </Block>
    </Section>
  );
}

/** A share from the reading as a line of print: the figure in the chapter's ink, what it counts. */
function Line({ value, label, ink, delay }: { value: string; label: string; ink: string; delay: number }) {
  return (
    <View style={styles.lineRow}>
      <Num spec={numSpec(0, value)} textStyle={figure(28, ink)} delay={delay} />
      <Words style={[type.lead, styles.fill]}>{label}</Words>
    </View>
  );
}

/**
 * A prompt, verbatim: a 2 pt rule in the hairline colour and the words in quotes. The rule is
 * neutral on purpose; a hue would spend identity on punctuation.
 */
export function Quote({ text, lines }: { text: string; lines?: number }) {
  return (
    <View style={styles.quote}>
      <Words style={[type.meta, styles.italic]} lines={lines}>{`“${text}”`}</Words>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  onHue: { color: ON_HUE },
  pairs: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 28, rowGap: 8, marginTop: 14 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  list: { marginTop: 12 },
  item: { flexDirection: 'row', gap: 14, paddingVertical: 10, alignItems: 'baseline' },
  index: { width: 22, color: GROUND.faint },
  fill: { flex: 1 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  dims: { gap: 18 },
  dim: { gap: 6 },
  dimHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  pair: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'baseline' },
  pairKey: { width: 104 },
  after: { marginTop: 10 },
  lineRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 6 },
  move: { paddingVertical: 12, gap: 6 },
  tags: { marginBottom: 10 },
  quote: { borderLeftWidth: 2, borderLeftColor: GROUND.border, paddingLeft: 8 },
  italic: { fontStyle: 'italic' },
});
