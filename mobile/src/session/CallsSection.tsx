/**
 * "Tokens, call by call" as a chapter (the owner's question, 2026-09-13: "make a graph showing
 * token usage in a session, I'm confused how 99% is spent reading the cache"). Its own band with
 * the one big number, how many calls the session made, in cobalt, or orchid when the session
 * itself is cobalt (`crew.sessionHues`): never one of the bars' three hues (tide, amber, ember,
 * `callsView.PART_HUE`) and never burn's ember or coral, the chapter above. Then on the ground, in
 * the order the one off page told the story from one RideGT session: the chart, with a readout a
 * finger scrubs (`CallsChart.tsx`); the call that came back to an expired cache, in words; the
 * same tokens counted in tokens and at API list prices, as two bars of three parts; and why
 * re-reading dominates, in two or three plain sentences.
 *
 * Every refusal is a sentence (`Refusal`), on the band, never a chart of zeros. Every word and
 * number is `callsView.ts`'s; nothing here decides one. The bar in hand lives here (`at`, and the
 * index the readout says): VoiceOver's adjustable wraps the chart, so the chart is given nothing
 * that changes while a finger moves, and a live session that grows a bar puts the readout back on
 * its newest one.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { Band, BandWords } from '../insights/Band';
import { StackBar } from '../insights/Bars';
import { numSpec } from '../insights/format';
import { BandFigure, GUTTER, Kicker, Refusal, Swatch, type } from '../insights/kit';
import { GROUND, SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { commas } from '../copy/numbers';
import type { SessionDetail } from '../data/api';
import { CallsChart } from './CallsChart';
import { CALLS_TITLE, PART_HUE, clampIndex, readout, type CallPart, type CallsView } from './callsView';

/** A part's ink, as the chart draws it. */
const ink = (part: CallPart): string => SPECTRUM[PART_HUE[part]].ink;

/** VoiceOver steps the chart a bar at a time. */
const ADJUST = [{ name: 'increment' }, { name: 'decrement' }] as const;

/**
 * A paragraph that never loses its last line. FOUND ON THE SIMULATOR (2026-09-13): the rewrite
 * sentence, four lines of 23 points, was framed 91.99975 points tall after pixel rounding (the
 * paragraphs beside it came out whole), iOS will not lay out a line that does not fit, and the
 * sentence ran out on its third line: "and 118,884 toke", then nothing. Moving it out of its row
 * changed nothing, and `onTextLayout` reports the three lines drawn, not the four measured. So
 * each paragraph here takes its own first frame, rounded, plus one point as a floor, once per text.
 */
function Paragraph({ children, style }: { children: string; style: StyleProp<TextStyle> }) {
  const [floor, setFloor] = useState<{ text: string; h: number } | null>(null);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height) + 1;
      setFloor((f) => (f && f.text === children ? f : { text: children, h }));
    },
    [children],
  );
  const min = floor && floor.text === children ? floor.h : null;
  return (
    <Text maxFontSizeMultiplier={1.6} onLayout={onLayout} style={[style, min ? { minHeight: min } : null]}>
      {children}
    </Text>
  );
}

export function CallsSection({ session, view, hue, width }: { session: Pick<SessionDetail, 'harness'>; view: CallsView; hue: Hue; width: number }) {
  const inner = width - GUTTER * 2;
  if (view.kind !== 'ready') {
    return (
      <Section style={styles.section}>
        <Band hue={hue} title={CALLS_TITLE}>
          <BandWords delay={300}>
            <Refusal onHue>{view.sentence}</Refusal>
          </BandWords>
        </Band>
      </Section>
    );
  }
  return <Ready view={view} harness={session.harness} hue={hue} width={width} inner={inner} />;
}

function Ready({ view, harness, hue, width, inner }: { view: Extract<CallsView, { kind: 'ready' }>; harness: string; hue: Hue; width: number; inner: number }) {
  const n = view.bars.length;
  const [index, setIndex] = useState(view.initial);
  const at = useSharedValue(view.initial);
  // A live session that grows a bar, or is binned afresh, puts the readout back on its newest bar.
  // FOUND IN REVIEW (2026-09-13): the bar in hand was set once, so a growing session's readout
  // stayed on an old bar, and a rebinned one could point past the end.
  const [count, setCount] = useState(n);
  if (count !== n) {
    setCount(n);
    setIndex(view.initial);
  }
  useEffect(() => {
    at.value = view.initial;
  }, [at, n, view.initial]);
  const onIndex = useCallback((i: number) => setIndex(i), []);
  const onAction = useCallback(
    (e: AccessibilityActionEvent) => {
      const i = clampIndex(at.value + (e.nativeEvent.actionName === 'increment' ? 1 : -1), n);
      at.value = i;
      setIndex(i);
    },
    [at, n],
  );
  const bar = view.bars[clampIndex(index, n)]!;
  const said = readout(bar, harness);
  const figure = useMemo(() => numSpec(view.calls, commas(view.calls)), [view.calls]);

  return (
    <Section style={styles.section}>
      <Band hue={hue} title={CALLS_TITLE}>
        <BandFigure spec={figure} width={inner} max={112} min={56} delay={200} label={`${figure.final} calls to the model`} />
        <BandWords delay={340}>
          <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
            calls to the model
          </Text>
        </BandWords>
        <BandWords delay={420}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.bandNote]}>
            Each one sent the whole conversation so far.
          </Text>
        </BandWords>
      </Band>

      {/* The rewrite sentence is a paragraph under its label, never the flexing child of a row:
          FOUND ON THE SIMULATOR (2026-09-13), beside a swatch in a row it was framed four lines
          tall and drawn wider than its frame, so it read "118,884 toke" and lost its last line. */}
      <Block style={styles.block}>
        <Kicker>{`what each call sent, ${view.eachBar}`}</Kicker>
        <View style={styles.legend}>
          {view.legend.map((l) => (
            <View key={l.part} style={styles.legendItem}>
              <Swatch color={ink(l.part)} size={9} />
              <Text maxFontSizeMultiplier={1.4} style={type.meta}>
                {l.label}
              </Text>
            </View>
          ))}
        </View>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="What each call to the model sent, by call"
          accessibilityValue={{ text: said }}
          accessibilityActions={ADJUST}
          onAccessibilityAction={onAction}
          style={styles.chart}
        >
          <CallsChart bars={view.bars} max={view.max} ticks={view.ticks} axis={view.axis} marks={view.marks} width={width} at={at} onIndex={onIndex} />
        </View>
        {/* One paragraph whose words change, never a view remounted per bar crossed. */}
        <View style={styles.readout} accessibilityLiveRegion="polite">
          <Paragraph style={[type.lead, styles.readoutText]}>{said}</Paragraph>
        </View>
        {view.rewrite ? (
          <View style={styles.rewrite}>
            <View style={styles.rewriteHead}>
              <Swatch color={ink('fresh')} size={9} />
              <Text maxFontSizeMultiplier={1.4} style={[type.label, { color: ink('fresh') }]}>
                back to an expired cache
              </Text>
            </View>
            <Paragraph style={type.body}>{view.rewrite}</Paragraph>
          </View>
        ) : null}
      </Block>

      <Block style={styles.block}>
        <Kicker>counted in tokens, and at list prices</Kicker>
        {view.shares.map((s, i) => (
          <View key={s.key} style={[styles.share, i > 0 ? styles.shareNext : null]}>
            <View style={styles.shareHead}>
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                {s.label}
              </Text>
              <Text allowFontScaling={false} style={[type.lead, styles.shareTotal]}>
                {s.total}
              </Text>
            </View>
            <StackBar segments={s.segments.map((g) => ({ key: g.part, value: g.value, color: ink(g.part) }))} height={18} delay={80 + i * 260} />
            <View style={styles.parts}>
              {s.segments.map((g) => (
                <Text key={g.part} maxFontSizeMultiplier={1.4} style={[type.meta, { color: ink(g.part) }]}>
                  {g.text}
                </Text>
              ))}
            </View>
          </View>
        ))}
        {view.priceNote ? (
          <View style={styles.after}>
            <Refusal>{view.priceNote}</Refusal>
          </View>
        ) : null}
        {view.totalNote ? (
          <View style={styles.after}>
            <Paragraph style={type.meta}>{view.totalNote}</Paragraph>
          </View>
        ) : null}
        {view.priceBasis ? (
          <View style={styles.after}>
            <Paragraph style={type.meta}>{view.priceBasis}</Paragraph>
          </View>
        ) : null}
      </Block>

      <Block style={styles.block}>
        <Kicker>why the re-read is most of it</Kicker>
        <View style={styles.explain}>
          {view.explain.map((line) => (
            <Paragraph key={line} style={type.body}>
              {line}
            </Paragraph>
          ))}
        </View>
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  bandNote: { marginTop: 4 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  // Both gutters: the chart is the page's full width, and a touch lands only inside its parent.
  // FOUND ON THE SIMULATOR (2026-09-13): with the left gutter alone the wrapper stopped 20 points
  // short of the chart, so the last bars of a 220 call chart could not be tapped.
  chart: { marginHorizontal: -GUTTER },
  readout: { minHeight: 72, marginTop: 6 },
  readoutText: { fontVariant: ['tabular-nums'] },
  rewrite: { marginTop: 14, gap: 6 },
  rewriteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  share: { gap: 8 },
  shareNext: { marginTop: 22 },
  shareHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  shareTotal: { fontVariant: ['tabular-nums'], color: GROUND.text },
  parts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  after: { marginTop: 14 },
  explain: { gap: 12 },
});
