/**
 * The top of a session's page: a full bleed band in the session's own creature's hue that prints
 * itself in 1 bit pixels, the engineer voice title arriving a word at a time (react-bits
 * SplitText, through its port), the session's creature printed beside it, the active time set
 * HUGE and counting up from zero, and the tool, its real logo and the repository.
 *
 * Borrowed, concretely:
 *   - Strava's activity detail: the hero stat is the trophy number, set in the heaviest weight
 *     with tabular figures (design-md/fitness/strava: "SF Pro Display Black weight 900 for the
 *     hero stats on activity detail"). Here it is the house style's size, fitted to the width.
 *   - Spotify's playlist hero takes its colour from the record's own art (design-md/music/
 *     spotify: "the UI borrows color from content"). The page takes its colour from the session's
 *     creature, the one it wears in the list, on the Lock Screen's crew and here.
 *   - react-bits SplitText (design-refs/react-bits/src/ts-default/TextAnimations/SplitText) by
 *     words, started by this band's clock so the title lands as the band finishes printing.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords, WORDS_AT } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { BandFigure, GUTTER, type } from '../insights/kit';
import { ON_HUE, type Hue } from '../insights/palette';
import { Section } from '../insights/reveal';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { MONO_FAMILY } from '../theme';
import { SplitText } from '../ui/bits/text';
import type { CrewCreature } from './crew';
import type { HeroModel } from './page';
import { useClockReached } from './parts';
import { BAND_TITLE, BAND_TITLE_LONG } from './type';

/** The creature on the hero: whole points per cell, at most seven a cell. */
const CREATURE_MAX = 112;

export function SessionHero({ hero, creature, hue, width, fallbackTitle }: { hero: HeroModel; creature: CrewCreature; hue: Hue; width: number; fallbackTitle: string }) {
  const inner = width - GUTTER * 2;
  const size = Math.min(CREATURE_MAX, Math.floor((inner * 0.3) / 16) * 16);
  const title = hero.title?.text ?? fallbackTitle;
  return (
    <Section>
      <Band hue={hue} title={hero.when}>
        <View style={styles.titleRow}>
          <View style={styles.titleWords}>
            <HeroTitle text={title} />
          </View>
          <CreaturePrint animal={creature} size={size} color={ON_HUE} delay={180} spread={560} />
        </View>
        <View style={styles.figure}>
          <BandFigure spec={hero.active} width={inner} max={120} min={56} delay={440} label={`${hero.active.final} ${hero.caption}`} />
        </View>
        <BandWords delay={560}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, styles.caption]}>
            {hero.caption}
          </Text>
        </BandWords>
        <BandWords delay={640}>
          <View style={styles.tool} accessible accessibilityLabel={`${hero.harnessName}, ${hero.repo}`}>
            <HarnessLogo harness={hero.harness} size={18} color={ON_HUE} />
            <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
              {hero.harnessName}
            </Text>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} ellipsizeMode="middle" style={[type.bandNote, styles.repo]}>
              {hero.repo}
            </Text>
          </View>
        </BandWords>
      </Band>
    </Section>
  );
}

/** The engineer voice title, a word at a time, once the band's words are due. */
function HeroTitle({ text }: { text: string }) {
  const play = useClockReached(WORDS_AT);
  return (
    <SplitText
      text={text}
      by="words"
      play={play}
      color={ON_HUE}
      allowFontScaling={false}
      accessibilityRole="header"
      textStyle={text.length > 34 ? BAND_TITLE_LONG : BAND_TITLE}
    />
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: 4 },
  titleWords: { flex: 1, paddingTop: 2 },
  figure: { marginTop: 14 },
  caption: { marginTop: -2 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  repo: { flexShrink: 1, fontFamily: MONO_FAMILY, opacity: 0.8 },
});
