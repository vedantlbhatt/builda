/**
 * The ways out of the You tab, as the house style has navigation: bands and words, never rows
 * with chevrons. Three pages get a band in their own hue that prints itself, with the one real
 * number the page opens on counting up (your analysis, Wrapped, money); three get their name as
 * a big word in their hue with the number and a small drawing of what is inside (the five bars,
 * the collection, the stack's most used names). Hierarchy by size, not a stack of equal cards.
 *
 * Every door says why when it has no number, in a sentence, and still opens its page.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../insights/Band';
import { GrowBar } from '../insights/Bars';
import { BandFigure, figure, GUTTER, Refusal, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { SPECTRUM, type Hue, type HueName } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import type { DimensionPreview, Door } from './chapters';
import { DollarFigure, TermSquares, WordDoor } from './parts';

function doorLabel(d: Door, masked: boolean): string {
  if (!d.num) return `${d.title}. ${d.refusal ?? ''}`.trim();
  const said = d.digits && masked ? 'Dollar amount hidden' : `${d.num.final}${d.caption ? ` ${d.caption}` : ''}`;
  return `${d.title}. ${said}.`;
}

/** A door as a band: the page's name as the title, its number huge, what it counts beside it. */
export function DoorBand({ door, hue, index, width, masked }: { door: Door; hue: Hue; index?: string; width: number; masked: boolean }) {
  const inner = width - GUTTER * 2;
  // A short figure sits beside its words; a long one (a dollar amount) takes the line.
  const side = door.num !== null && door.digits === null && door.num.final.length <= 3;
  return (
    <Section style={styles.bandSection}>
      <Band hue={hue} index={index} title={door.title} href={door.href} accessibilityLabel={doorLabel(door, masked)}>
        {door.num ? (
          <>
            <View style={side ? styles.side : null}>
              {door.digits ? (
                <DollarFigure digits={door.digits} masked={masked} width={inner} max={100} min={56} delay={200} label={door.num.final} />
              ) : (
                <BandFigure spec={door.num} width={side ? inner * 0.4 : inner} max={side ? 104 : 96} min={48} delay={200} />
              )}
              {door.caption ? (
                <View style={side ? styles.sideWords : null}>
                  <BandWords delay={320}>
                    <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                      {door.caption}
                    </Text>
                  </BandWords>
                </View>
              ) : null}
            </View>
            {door.note ? (
              <BandWords delay={420}>
                <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
                  {door.note}
                </Text>
              </BandWords>
            ) : null}
          </>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>{door.refusal}</Refusal>
          </BandWords>
        )}
      </Band>
    </Section>
  );
}

/**
 * A door as a word on the ground: the name large in its hue with an arrow, the number counting up
 * in the same ink with what it counts, and a preview of the page drawn on under it.
 */
export function DoorWord({
  door,
  hue,
  width,
  dimensions,
  collection,
  categories,
}: {
  door: Door;
  hue: Hue;
  width: number;
  dimensions?: readonly DimensionPreview[];
  collection?: { found: number; catalog: number } | null;
  categories?: readonly { key: string; label: string; hue: HueName }[];
}) {
  const inner = width - GUTTER * 2;
  return (
    <Section style={styles.wordSection}>
      <Block style={styles.wordBlock}>
        <WordDoor title={door.title} hue={hue} href={door.href} label={doorLabel(door, false)}>
          {door.num ? (
            <View style={styles.wordLine}>
              <Num spec={door.num} textStyle={figure(44, hue.ink)} delay={120} />
              {door.caption ? (
                <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.wordCaption]}>
                  {door.caption}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.wordRefusal}>
              <Refusal>{door.refusal}</Refusal>
            </View>
          )}
          {dimensions && dimensions.length ? (
            <View style={styles.bars}>
              {dimensions.map((d, i) => (
                // Apple Fitness staggers its rings 80 ms apart; the five bars keep that step.
                <GrowBar key={d.key} frac={d.value / 100} color={SPECTRUM[d.hue as HueName].ink} height={8} delay={180 + i * 80} />
              ))}
            </View>
          ) : null}
          {collection && collection.catalog > 0 ? (
            <View style={styles.squares}>
              <TermSquares found={collection.found} catalog={collection.catalog} width={inner} hue={hue} delay={160} />
            </View>
          ) : null}
          {categories && categories.length ? (
            <Text maxFontSizeMultiplier={1.3} style={styles.categories}>
              {categories.map((c, i) => (
                <Text key={c.key} style={{ color: SPECTRUM[c.hue].ink }}>
                  {i > 0 ? '  ' : ''}
                  {c.label}
                </Text>
              ))}
            </Text>
          ) : null}
          {door.note ? <Words style={[type.meta, styles.wordNote]}>{door.note}</Words> : null}
        </WordDoor>
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  bandSection: { marginTop: 22 },
  side: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  sideWords: { flex: 1, paddingBottom: 12 },
  note: { marginTop: 8 },
  wordSection: { marginTop: 40 },
  wordBlock: { paddingHorizontal: GUTTER },
  wordLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, marginTop: 6 },
  wordCaption: { flexShrink: 1 },
  wordRefusal: { marginTop: 10 },
  bars: { marginTop: 14, gap: 8 },
  squares: { marginTop: 14 },
  wordNote: { marginTop: 10 },
  categories: { marginTop: 12, fontSize: 22, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4 },
});
