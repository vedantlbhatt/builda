import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { capital, count, n } from '../../src/copy/numbers';
import { Band, BandWords } from '../../src/insights/Band';
import { GrowBar } from '../../src/insights/Bars';
import { BandFigure, figure, GUTTER, Kicker, Refusal, Swatch, type, Words } from '../../src/insights/kit';
import { Num } from '../../src/insights/Num';
import { DIMENSION_HUE, ON_HUE, SPECTRUM, type Hue } from '../../src/insights/palette';
import { PixelField, type PixelCell } from '../../src/insights/Pixels';
import { Block, Section } from '../../src/insights/reveal';
import { HeroSection } from '../../src/insights/sections/Hero';
import { useAccent } from '../../src/theme/accent';
import { ChapterPage } from '../../src/you/ChapterPage';
import { ANALYSE_COMMAND, dimensionsPage, doorHues, isRefused, type DimensionsPage } from '../../src/you/chapters';
import { dimensionLabel } from '../../src/you/dimensions';
import { useBuilderProfile } from '../../src/you/hooks';
import { ChapterSkeleton, CommandLine, ErrorChapter, SignedOutChapter, StaleLine } from '../../src/you/parts';

/**
 * Dimensions, as two chapters:
 *
 *   01 five dimensions   a band in this page's hue (the one its door wears on the You tab) with
 *                        the highest of the five counting up, then all five as bars in their five
 *                        hues that grow in 80 ms apart (Apple Fitness staggers its rings by 80),
 *                        each with its trend in words. No radar: five bars are read at a glance,
 *                        a radar's area means nothing and its shape moves with the order of its
 *                        axes. With no analysed sessions the refusal carries the band: the count
 *                        so far against the count needed, said and drawn as squares.
 *   02 your type         the analysis page's own "Your type" chapter, in the builder's hue: the
 *                        type huge, the rule's number, the creature printed, the rules against
 *                        their bars. Then the rules the server could not score, and why.
 *
 * Two different questions on one page, said apart: the dimensions are the model's reading of
 * each session, averaged by the server; the type is a rule over measured numbers.
 */
export default function DimensionsScreen() {
  const { width } = useWindowDimensions();
  const { load, refresh, refreshing } = useBuilderProfile();
  const accent = useAccent();
  const data = load.kind === 'ready' ? load.data : null;
  const page = useMemo(() => (data ? dimensionsPage(data) : null), [data]);
  const hue = SPECTRUM[doorHues(accent.name).dimensions];

  return (
    <ChapterPage title="Dimensions" chapters={1} ready={page !== null && accent.ready} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
      {(stage) => (
        <>
          <View style={styles.lead}>
            {load.kind === 'signedOut' ? <SignedOutChapter what="dimensions" /> : null}
            {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
            {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
          </View>

          {load.kind === 'loading' ? <ChapterSkeleton /> : null}

          {page ? (
            <>
              <FiveChapter body={page.body} hue={hue} width={width} />
              {stage >= 1 ? (
                <>
                  <HeroSection hero={page.hero} animal={accent.animal} hue={accent} width={width} index="02" ledger={false} style={styles.chapter} />
                  {page.unscored.length ? (
                    <Section style={styles.after}>
                      <Block style={styles.block}>
                        <Kicker>not scored here</Kicker>
                        {page.unscored.map((u) => (
                          <View key={u.key} style={styles.unscored}>
                            <Words style={type.lead}>{u.name}</Words>
                            <Words style={type.dim}>{u.reason}</Words>
                          </View>
                        ))}
                      </Block>
                    </Section>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

function FiveChapter({ body, hue, width }: { body: DimensionsPage['body']; hue: Hue; width: number }) {
  const inner = width - GUTTER * 2;
  if (isRefused(body)) {
    return (
      <Section>
        <Band hue={hue} index="01" title="Five dimensions">
          <BandWords delay={260}>
            <Text maxFontSizeMultiplier={1.3} style={styles.waiting}>
              {waitingOn(body.analysed, body.needed)}
            </Text>
          </BandWords>
          <View style={styles.squares}>
            <Pending analysed={body.analysed} needed={body.needed} />
          </View>
          <BandWords delay={380}>
            <Refusal onHue>{body.refusal}</Refusal>
          </BandWords>
        </Band>
        <Block style={styles.block}>
          <Kicker>what each session will be read for</Kicker>
          <View style={styles.key}>
            {(Object.keys(DIMENSION_HUE) as (keyof typeof DIMENSION_HUE)[]).map((d) => (
              <View key={d} style={styles.keyItem}>
                <Swatch color={SPECTRUM[DIMENSION_HUE[d]].ink} hollow size={12} />
                <Text maxFontSizeMultiplier={1.4} style={[type.lead, { color: SPECTRUM[DIMENSION_HUE[d]].ink }]}>
                  {capital(dimensionLabel(d))}
                </Text>
              </View>
            ))}
          </View>
          <Words style={[type.dim, styles.caption]}>Each one is scored out of 100 by the model that read the session, then averaged here.</Words>
        </Block>
        <Block style={styles.block}>
          <Words style={type.dim}>Run this on your Mac, and this page fills in:</Words>
          <CommandLine command={ANALYSE_COMMAND} color={hue.ink} />
        </Block>
      </Section>
    );
  }
  const top = body.top;
  return (
    <Section>
      <Band hue={hue} index="01" title="Five dimensions">
        <View style={styles.side}>
          <BandFigure spec={top.mean} width={inner * 0.4} max={112} min={56} delay={200} label={`${top.mean.final} of 100, ${top.label}`} />
          <View style={styles.sideWords}>
            <BandWords delay={320}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {`${top.label}, the highest of ${n(body.rows.length)}, out of 100`}
              </Text>
            </BandWords>
          </View>
        </View>
        <BandWords delay={420}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
            {`${capital(top.trend)}, over ${n(top.sessions)} analysed ${top.sessions === 1 ? 'session' : 'sessions'}.`}
          </Text>
        </BandWords>
      </Band>
      <Block style={styles.block}>
        <Kicker>each out of 100</Kicker>
        <View style={styles.rows}>
          {body.rows.map((r, i) => {
            const h = SPECTRUM[r.hue];
            return (
              <View key={r.key} style={styles.row} accessible accessibilityLabel={`${r.label}, ${r.mean.final} of 100, ${r.trend}`}>
                <View style={styles.rowHead}>
                  <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.rowLabel]}>
                    {capital(r.label)}
                  </Text>
                  <Text allowFontScaling={false} style={type.meta}>
                    {r.trend}
                  </Text>
                  <Num spec={r.mean} textStyle={figure(30, h.ink)} delay={120 + i * 80} />
                </View>
                <GrowBar frac={r.value / 100} color={h.ink} height={12} delay={120 + i * 80} />
              </View>
            );
          })}
        </View>
        <Words style={[type.meta, styles.caption]}>{body.basis}</Words>
        {body.archetypeLine ? <Words style={[type.meta, styles.caption]}>{body.archetypeLine}</Words> : null}
      </Block>
    </Section>
  );
}

/** "Waiting on 3 analysed sessions.", "Waiting on 1 more analysed session.": the count still needed, never a zero. */
function waitingOn(analysed: number, needed: number): string {
  const left = Math.max(1, needed - analysed);
  return analysed > 0 ? `Waiting on ${count(left, 'more analysed session')}.` : `Waiting on ${count(left, 'analysed session')}.`;
}

/** The analysed sessions so far against the floor, one square each: filled for analysed, open for still to come. */
function Pending({ analysed, needed }: { analysed: number; needed: number }) {
  const count = Math.min(Math.max(needed, analysed), 20);
  const size = 26;
  const gap = 8;
  const cells: PixelCell[] = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: i * (size + gap),
        y: 0,
        w: size,
        h: size,
        color: ON_HUE,
        outline: i >= analysed,
        delay: 260 + i * 110,
      })),
    [count, analysed],
  );
  return <PixelField cells={cells} width={count * size + (count - 1) * gap} height={size} duration={240} accessibilityLabel={`${analysed} of ${needed} analysed sessions`} />;
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 18, gap: 10 },
  chapter: { marginTop: 56 },
  after: { marginTop: 4 },
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  caption: { marginTop: 12 },
  note: { marginTop: 8 },
  side: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  sideWords: { flex: 1, paddingBottom: 14 },
  waiting: { fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.9, color: ON_HUE },
  squares: { marginTop: 10, marginBottom: 14 },
  key: { gap: 12 },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rows: { gap: 20 },
  row: { gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  rowLabel: { flex: 1 },
  unscored: { paddingVertical: 8, gap: 2 },
});
