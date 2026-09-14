/**
 * 07, you against you: the move the report leads with as the big number, then every trend as a
 * small slope from the window before to the window now, traced on as it arrives, each saying in
 * words whether the move is the way you want it, where the metric has a direction at all.
 *
 * 08, quality: the share of test runs that were already green as one ring (green, then red),
 * and the time back to green as a stopwatch that sweeps to the median.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { commas } from '../../copy/numbers';
import { Band, BandWords } from '../Band';
import { PassRing, Slope, StopwatchRing } from '../Charts';
import { BandFigure, figure, GUTTER, Kicker, Refusal, Swatch, type, Words } from '../kit';
import { isRefused, type QualityModel, type TrendModel, type TrendsModel } from '../model';
import { Num } from '../Num';
import { DATA, GROUND, ON_HUE, SPECTRUM } from '../palette';
import { Block, Section } from '../reveal';

const TRENDS = SPECTRUM.cobalt;
const QUALITY = SPECTRUM.coral;

/** The trend the headline sentence is about, when the sentence names one. */
function headlineTrend(m: TrendsModel): TrendModel | null {
  const h = m.headline?.toLowerCase() ?? '';
  if (!h) return null;
  return m.trends.find((t) => t.move && h.startsWith(t.label.toLowerCase())) ?? null;
}

export function TrendsSection({ trends, width }: { trends: TrendsModel; width: number }) {
  const inner = width - GUTTER * 2;
  const lead = headlineTrend(trends);
  const cellW = Math.floor((inner - 18) / 2);
  const rows: TrendModel[][] = [];
  for (let i = 0; i < trends.trends.length; i += 2) rows.push(trends.trends.slice(i, i + 2));
  return (
    <Section style={styles.section}>
      <Band hue={TRENDS} index="07" title="You against you">
        {trends.refusal && !trends.trends.length ? (
          <BandWords delay={300}>
            <Refusal onHue>{trends.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            {lead?.move ? <BandFigure spec={lead.move} width={inner} max={84} delay={200} /> : null}
            {trends.headline ? (
              <BandWords delay={360}>
                <Text maxFontSizeMultiplier={1.3} style={lead ? type.bandCaption : styles.headline}>
                  {trends.headline}
                </Text>
              </BandWords>
            ) : null}
          </>
        )}
      </Band>

      {rows.map((row, r) => (
        <Block key={row.map((t) => t.key).join('.')} style={[styles.block, r === 0 ? null : styles.rowGap]}>
          <View style={styles.row}>
            {row.map((t, i) => (
              <TrendCell key={t.key} t={t} width={cellW} delay={i * 140} />
            ))}
          </View>
        </Block>
      ))}

      {trends.basis ? (
        <Block style={styles.block}>
          <Words style={type.meta}>{trends.basis}</Words>
        </Block>
      ) : null}
    </Section>
  );
}

function TrendCell({ t, width, delay }: { t: TrendModel; width: number; delay: number }) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={[type.meta, styles.cellLabel]}>
        {t.label}
      </Text>
      {t.move ? (
        <Num spec={t.move} textStyle={figure(26, TRENDS.ink)} delay={delay + 120} />
      ) : (
        <Text allowFontScaling={false} style={[figure(26, GROUND.dim)]}>
          steady
        </Text>
      )}
      <Slope before={t.before} now={t.now} width={width} height={46} ink={t.move ? TRENDS.ink : GROUND.dim} delay={delay + 60} />
      <Text allowFontScaling={false} style={[type.meta, { fontVariant: ['tabular-nums'] }]}>
        {`${t.beforeText} then ${t.nowText}`}
      </Text>
      {t.verdict ? (
        <Text maxFontSizeMultiplier={1.3} style={[type.meta, { color: t.good ? DATA.add : GROUND.text, fontWeight: '600' }]}>
          {t.verdict}
        </Text>
      ) : null}
      {t.note ? (
        <Text maxFontSizeMultiplier={1.3} style={type.meta}>
          {t.note}
        </Text>
      ) : null}
    </View>
  );
}

export function QualitySection({ quality, width }: { quality: QualityModel; width: number }) {
  const inner = width - GUTTER * 2;
  const g = quality.green;
  const r = quality.recovery;
  return (
    <Section style={styles.section}>
      <Band hue={QUALITY} index="08" title="Quality">
        {isRefused(g) ? (
          <BandWords delay={300}>
            <Refusal onHue>{g.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <BandFigure spec={g.rate} width={inner * 0.6} max={104} delay={200} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                of test runs were already green
              </Text>
            </BandWords>
            <BandWords delay={440}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                {g.runs}
              </Text>
            </BandWords>
          </>
        )}
      </Band>

      {!isRefused(g) ? (
        <Block style={styles.block}>
          <Kicker>every test run</Kicker>
          <View style={styles.ringRow}>
            <PassRing passed={g.passed} failed={g.failed} size={Math.min(150, Math.floor(inner * 0.42))} pass={DATA.add} fail={DATA.del} delay={60} />
            <View style={{ flex: 1, gap: 10 }}>
              <View style={styles.legendLine}>
                <Swatch color={DATA.add} />
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {`${commas(g.passed)} green, nothing failed after`}
                </Text>
              </View>
              <View style={styles.legendLine}>
                <Swatch color={DATA.del} />
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {`${commas(g.failed)} an error followed`}
                </Text>
              </View>
            </View>
          </View>
          <Words style={[type.meta, styles.caption]}>{g.sentence}</Words>
        </Block>
      ) : null}

      {r ? (
        <Block style={styles.block}>
          <Kicker>back to green</Kicker>
          {isRefused(r) ? (
            <Refusal>{r.refusal}</Refusal>
          ) : (
            <View style={styles.ringRow}>
              <View>
                <StopwatchRing seconds={r.medianSeconds} dial={r.dial} size={124} ink={QUALITY.ink} delay={60} />
                <View style={styles.ringCenter}>
                  <Num spec={r.median} textStyle={figure(26, GROUND.text)} delay={60} duration={1000} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Words style={type.lead}>the median time back to green</Words>
                {r.tries ? <Words style={type.dim}>{r.tries}</Words> : null}
                <Words style={type.dim}>{r.worst}</Words>
                <Words style={type.meta}>{`${r.n} The ring is one ${r.dial}.`}</Words>
              </View>
            </View>
          )}
        </Block>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  rowGap: { marginTop: 22 },
  caption: { marginTop: 12 },
  headline: { fontSize: 26, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5, color: ON_HUE },
  row: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  cell: { gap: 4 },
  cellLabel: { color: GROUND.text, minHeight: 36 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
