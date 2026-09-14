/**
 * "How it flowed", the Money page's middle chapter: a band in its own hue with the one number
 * that says where most of the dollars went, and under it on the ground the money Sankey
 * (`Sankey.tsx`), the sentence a tap reads, and what the report cannot join, said plainly.
 *
 * The presentation takes two things from the owner's finance references
 * (design-refs/awesome-ios-design-md/design-md/finance): Wise's fee breakdown, where the
 * conversion is a step you can see with its rate and the day it was read (here the rule where
 * tokens become dollars at list prices read on a stated day), and Monzo's breakdown in each
 * category's own colour with the amount beside it (here every model, project and ending in its
 * hue with its dollars counting up beside it).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Band, BandWords } from '../insights/Band';
import { BandFigure, figure, GUTTER, Kicker, type, Words } from '../insights/kit';
import { GROUND, ON_HUE, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { maskDollars } from '../you/numbers';
import { Sankey } from './Sankey';
import { layoutSankey, sentenceOf, type MoneyFlow } from './flow';

export const FLOW_TITLE = 'How it flowed';

// The flow's colours and its band's hue are decided with every other hue on the page, in
// `hues.ts` (pure, so the tests hold them); re-exported here where the screen has always found them.
export { flowHue, flowPaint, hueOfInk } from './hues';

export function FlowChapter({ flow, hue, index, width, masked }: { flow: MoneyFlow; hue: Hue; index: string; width: number; masked: boolean }) {
  const inner = width - GUTTER * 2;
  const layout = useMemo(() => layoutSankey(flow, inner), [flow, inner]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [flow]);
  const say = (s: string) => (masked ? maskDollars(s) : s);
  const reading = say(sentenceOf(flow, selected));
  const b = flow.band;

  return (
    <Section style={styles.chapter}>
      <Band hue={hue} index={index} title={FLOW_TITLE}>
        {b.figure ? (
          <BandFigure spec={b.figure} width={inner} max={112} min={60} delay={200} label={`${b.figureText} ${b.caption}`} />
        ) : (
          <BandWords delay={200}>
            <Text allowFontScaling={false} style={figure(72, ON_HUE)}>
              {b.figureText}
            </Text>
          </BandWords>
        )}
        <BandWords delay={360}>
          <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
            {b.caption}
          </Text>
        </BandWords>
        <BandWords delay={450}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
            {b.note}
          </Text>
        </BandWords>
      </Band>

      <Block style={styles.block}>
        <Kicker>every dollar, from token to commit</Kicker>
        <View style={[styles.heads, { width: inner }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {layout.columns.map((c) => (
            <Text
              key={c.column}
              allowFontScaling={false}
              style={[styles.head, c.align === 'right' ? { right: inner - c.x, textAlign: 'right' } : { left: c.x }]}
            >
              {c.title}
            </Text>
          ))}
          {layout.trunk ? (
            <Text allowFontScaling={false} style={[styles.head, styles.priced, { left: layout.trunk.x1 - 30 }]}>
              priced
            </Text>
          ) : null}
        </View>
        <Sankey flow={flow} layout={layout} masked={masked} selected={selected} onSelect={setSelected} />
        <View style={styles.reading} accessibilityLiveRegion="polite">
          <Animated.View key={selected ?? 'summary'} entering={FadeIn.duration(180)}>
            <Words style={type.lead}>{reading}</Words>
          </Animated.View>
        </View>
      </Block>

      <Block style={styles.block}>
        <View style={styles.notes}>
          {flow.notes.map((s) => (
            <Words key={s} style={type.meta}>
              {say(s)}
            </Words>
          ))}
        </View>
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  chapter: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  note: { marginTop: 6 },
  heads: { height: 18, marginBottom: 12 },
  head: { ...StyleSheet.flatten(type.label), position: 'absolute', top: 0, color: GROUND.dim },
  priced: { width: 60, textAlign: 'center', color: GROUND.faint },
  reading: { marginTop: 18, minHeight: 92 },
  notes: { gap: 8 },
});
