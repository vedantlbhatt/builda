/**
 * 01, your type: the archetype's name set large on a band in the builder's creature's hue, the
 * creature printing itself beside the rule that won, that rule's number against its bar, the
 * runners up as lines that grow to their scores past or short of the same tick, and the three
 * headline numbers as lines of print.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Animal } from '../../pixel/animals';
import { Band, BandWords } from '../Band';
import { RuleTrack } from '../Bars';
import { CreatureMark, CreaturePrint } from '../Creature';
import { BandFigure, GUTTER, Kicker, Ledger, type, Words } from '../kit';
import type { HeroModel } from '../model';
import { GROUND, ON_HUE, SPECTRUM, type Hue } from '../palette';
import { Block, Section } from '../reveal';

export function HeroSection({ hero, animal, hue, width }: { hero: HeroModel; animal: Animal; hue: Hue; width: number }) {
  const inner = width - GUTTER * 2;
  const creature = Math.min(128, Math.floor(inner * 0.36 / 16) * 16);
  const nameSize = hero.name.length > 14 ? 50 : 56;
  return (
    <Section>
      <Band hue={hue} index="01" title="Your type">
        <BandWords delay={260}>
          <Text allowFontScaling={false} style={[styles.name, { fontSize: nameSize, lineHeight: Math.round(nameSize * 1.02) }]}>
            {hero.name}
          </Text>
        </BandWords>
        <View style={styles.ruleRow}>
          <View style={styles.ruleWords}>
            {hero.ruleNum ? (
              <>
                {hero.ruleFloor ? (
                  <BandWords delay={320}>
                    <Text style={type.bandNote}>at least</Text>
                  </BandWords>
                ) : null}
                <BandFigure spec={hero.ruleNum} width={inner - creature - 12} max={64} min={40} delay={380} />
                {hero.ruleUnit ? (
                  <BandWords delay={420}>
                    <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                      {hero.ruleUnit}
                    </Text>
                  </BandWords>
                ) : null}
                {hero.ruleBar ? (
                  <BandWords delay={480}>
                    <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                      {hero.ruleBar}
                    </Text>
                  </BandWords>
                ) : null}
              </>
            ) : hero.sentence ? (
              <BandWords delay={320}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                  {hero.sentence}
                </Text>
              </BandWords>
            ) : null}
          </View>
          <CreaturePrint animal={animal} size={creature} color={ON_HUE} delay={200} />
        </View>
        {hero.ruleNum && hero.confidence ? (
          <BandWords delay={520}>
            <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.bandSentence]}>
              {hero.confidence}
            </Text>
          </BandWords>
        ) : null}
      </Band>

      {hero.bars.length > 0 ? (
        <Block style={styles.block}>
          <Kicker>the rules, against their bars</Kicker>
          <View style={{ gap: 18 }}>
            {hero.bars.map((b, i) => {
              const h = SPECTRUM[b.hue];
              return (
                <View key={b.key} style={{ gap: 6 }}>
                  <View style={styles.barHead}>
                    <CreatureMark animal={b.animal} size={16} color={h.ink} />
                    <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1, color: b.winner ? GROUND.text : GROUND.dim }]}>
                      {b.display}
                    </Text>
                    {b.bar ? (
                      <Text allowFontScaling={false} style={[type.meta, { fontVariant: ['tabular-nums'] }]}>
                        {`bar ${b.bar}`}
                      </Text>
                    ) : null}
                  </View>
                  <RuleTrack score={b.score} color={h.ink} height={b.winner ? 12 : 6} delay={120 + i * 160} tick={GROUND.text} />
                  <Words style={type.meta}>{b.said}</Words>
                </View>
              );
            })}
          </View>
          {hero.barNote ? <Words style={[type.meta, styles.after]}>{hero.barNote}</Words> : null}
          {hero.ruleNum && hero.sentence ? <Words style={[type.body, styles.after]}>{hero.sentence}</Words> : null}
          {hero.source || (!hero.ruleNum && hero.confidence) ? (
            <Words style={[type.meta, styles.after]}>{[hero.ruleNum ? null : hero.confidence, hero.source].filter(Boolean).join(' ')}</Words>
          ) : null}
          {hero.narrativeLine ? <Words style={[type.body, styles.after]}>{hero.narrativeLine}</Words> : null}
        </Block>
      ) : null}

      {hero.ledger.length > 0 ? (
        <Block style={styles.block}>
          <Kicker>in all</Kicker>
          <Ledger items={hero.ledger} color={hue.ink} size={48} delay={80} />
          {hero.ledgerNote ? <Words style={[type.meta, styles.after]}>{hero.ledgerNote}</Words> : null}
        </Block>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  name: { fontWeight: '800', letterSpacing: -1.6, color: ON_HUE },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14, gap: 12 },
  ruleWords: { flex: 1, paddingBottom: 4 },
  bandSentence: { marginTop: 10 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  after: { marginTop: 14 },
});
