/**
 * Burn forensics as a chapter (brief B1): where this sitting's tokens went. Its own band in its
 * own hue (ember, the burn, as on the analysis page; coral when the session itself is ember),
 * the tokens as the one big number counting up and the share that explains most of them; then
 * the costly stretches as a chart that grows and pulses once (`SpikeChart.tsx`), each stretch as
 * a split under it (Strava's splits table: the number, what drove it as separate meters, what it
 * produced), and the block's remaining numbers as lines of print.
 *
 * Every refusal is a sentence (`Refusal`), on the band when the whole block refused and on the
 * ground when only the stretches could not be named. Every word and number is `burnView.ts`'s and
 * `burnChart.ts`'s; nothing here decides one.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../insights/Band';
import { GrowBar } from '../insights/Bars';
import { BandFigure, figure, GUTTER, Kicker, Refusal, Swatch, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { GROUND, SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { CAUSE_HUE, burnBand, burnLedger, fillKey, type BurnChart, type SpikeRow } from './burnChart';
import type { BurnView } from './burnView';
import type { SessionBurn } from '../generated/contract';
import { barColor, SpikeChart } from './SpikeChart';

const TITLE = 'Where the tokens went';

export function BurnSection({ burn, view, chart, hue, width }: { burn: SessionBurn | null | undefined; view: BurnView; chart: BurnChart | null; hue: Hue; width: number }) {
  const inner = width - GUTTER * 2;

  if (view.kind !== 'ready' || !burn) {
    return (
      <Section style={styles.section}>
        <Band hue={hue} title={TITLE}>
          <BandWords delay={300}>
            <Refusal onHue>{view.kind === 'ready' ? 'No cost breakdown was sent with this session.' : view.sentence}</Refusal>
          </BandWords>
        </Band>
      </Section>
    );
  }

  const band = burnBand(burn);
  const ledger = burnLedger(view);
  const key = chart ? fillKey(chart.fills) : null;

  return (
    <Section style={styles.section}>
      <Band hue={hue} title={TITLE}>
        {band ? (
          <>
            <BandFigure spec={band.tokens} width={inner} max={112} min={56} delay={200} label={`${band.tokens.final} tokens`} />
            <BandWords delay={340}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                tokens
              </Text>
            </BandWords>
            {band.note ? (
              <BandWords delay={420}>
                <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.bandNote]}>
                  {band.note}
                </Text>
              </BandWords>
            ) : null}
          </>
        ) : null}
      </Band>

      {chart ? (
        <Block style={styles.block}>
          <Kicker>the costliest stretches, against a typical one</Kicker>
          <SpikeChart chart={chart} width={inner} />
          <View style={styles.legend}>
            {chart.legend.map((l) => (
              <View key={l.cause} style={styles.legendItem}>
                <Swatch color={SPECTRUM[CAUSE_HUE[l.cause]].ink} size={9} />
                <Text maxFontSizeMultiplier={1.4} style={type.meta}>
                  {l.label}
                </Text>
              </View>
            ))}
          </View>
          <Words style={[type.meta, styles.after]}>
            {[`The dashed line is burn's own bar: a stretch at ${chart.threshold} times the typical one is a spike.`, key].filter(Boolean).join(' ')}
          </Words>
        </Block>
      ) : view.spikesNote ? (
        <Block style={styles.block}>
          <Refusal>{view.spikesNote}</Refusal>
        </Block>
      ) : null}

      {chart ? chart.rows.map((r, i) => <Split key={r.key} row={r} first={i === 0} />) : null}
      {chart && view.overlapNote ? (
        <Block style={styles.tight}>
          <Words style={type.meta}>{view.overlapNote}</Words>
        </Block>
      ) : null}

      {ledger.length ? (
        <Block style={styles.block}>
          <Kicker>the rest of it</Kicker>
          {ledger.map((l, i) => (
            <View key={l.key} style={[styles.ledgerRow, i > 0 ? styles.hairTop : null]}>
              <View style={styles.ledgerLine}>
                {l.num ? (
                  <Num spec={l.num} textStyle={figure(40, hue.ink)} delay={60 + i * 180} />
                ) : (
                  <Text allowFontScaling={false} style={figure(40, hue.ink)}>
                    {l.shown}
                  </Text>
                )}
                <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.ledgerLabel]}>
                  {l.label}
                </Text>
              </View>
              {l.note ? <Words style={type.dim}>{l.note}</Words> : null}
            </View>
          ))}
          {view.ledgerNote ? <Words style={[type.meta, styles.after]}>{view.ledgerNote}</Words> : null}
        </Block>
      ) : null}
    </Section>
  );
}

/**
 * One costly stretch, as a split: its number in the hue of what drove it, how long it ran, each
 * cause as its own meter (they overlap, so they are never stacked), what it produced, and how it
 * compares.
 */
function Split({ row, first }: { row: SpikeRow; first: boolean }) {
  const color = barColor({ cause: row.cause, spike: true });
  return (
    <Block style={[styles.split, first ? styles.splitFirst : styles.hairTop]}>
      <View style={styles.splitHead}>
        <Text allowFontScaling={false} style={[type.mono, styles.index]}>
          {row.index}
        </Text>
        <View style={styles.splitWords}>
          <View style={styles.ledgerLine}>
            <Num spec={row.tokens} textStyle={figure(36, color)} delay={40} />
            <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.ledgerLabel]}>
              {row.label}
            </Text>
          </View>
          <View style={styles.meters}>
            {row.meters.map((m, i) => (
              <View key={m.cause} style={styles.meter}>
                <Words style={type.dim}>{m.text}</Words>
                <GrowBar frac={m.share} color={SPECTRUM[CAUSE_HUE[m.cause]].ink} height={6} delay={160 + i * 120} />
              </View>
            ))}
          </View>
          <Words style={[type.lead, styles.verdict]}>{row.verdict}</Words>
          <Words style={type.meta}>{row.meta}</Words>
        </View>
      </View>
    </Block>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  bandNote: { marginTop: 4 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  tight: { paddingHorizontal: GUTTER, marginTop: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  after: { marginTop: 12 },
  split: { marginHorizontal: GUTTER, paddingVertical: 18 },
  splitFirst: { marginTop: 18 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  splitHead: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  index: { width: 22, color: GROUND.faint, marginTop: 14 },
  splitWords: { flex: 1, gap: 6 },
  meters: { gap: 10, marginTop: 4 },
  meter: { gap: 6 },
  verdict: { marginTop: 6 },
  ledgerRow: { paddingVertical: 12, gap: 2 },
  ledgerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  ledgerLabel: { flexShrink: 1 },
});
