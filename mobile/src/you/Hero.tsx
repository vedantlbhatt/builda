/**
 * The top of the You tab: a band in the builder's own hue (the accent, which is their creature's),
 * their name as its title, their type set huge in dark ink and arriving a letter at a time, the
 * three headline numbers counting up as lines of print, and their creature printed large beside
 * them, pixel by pixel. Pressing the creature opens the picker.
 *
 * Borrowed: the mascot at hero scale is Duolingo's (design-md/misc/duolingo: Duo about 200 pt on
 * its moments, the hero number about twice the UI around it); the letters are react-bits SplitText
 * through its port (`src/ui/bits/text/SplitText.tsx`), started by this band's clock so they land
 * as the band finishes printing. The first time a type is shown it lands with the one success
 * haptic the reveal has always had (`useFirstReveal`).
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Band, BandWords, WORDS_AT } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { Face } from '../motion';
import { figure, GUTTER, type, Words } from '../insights/kit';
import { GoLink } from '../insights/sections/Reading';
import type { HeroModel, LedgerRow } from '../insights/model';
import { Num } from '../insights/Num';
import { ON_HUE, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { ANIMAL_LABELS, type Animal } from '../pixel/animals';
import { SplitText } from '../ui/bits/text';
import { useFirstReveal } from './hooks';
import { useClockReached } from './parts';

/** The creature on the hero: ten points a cell at most, whole points so the pixels stay square. */
const CREATURE_MAX = 160;

export function YouHero({
  hero,
  name,
  animal,
  hue,
  width,
  source,
}: {
  hero: HeroModel;
  name: string | null;
  animal: Animal;
  hue: Hue;
  width: number;
  source: string | null;
}) {
  const router = useRouter();
  const inner = width - GUTTER * 2;
  const creature = Math.min(CREATURE_MAX, Math.floor((inner * 0.45) / 16) * 16);
  const nameSize = hero.name.length > 14 ? 52 : 58;
  const named = hero.state === 'named' || hero.state === 'generalist';
  return (
    <Section>
      <Band hue={hue} title={name ?? 'You'}>
        <TypeName text={hero.name} size={nameSize} id={named ? hero.archetypeId : null} />
        {!named && hero.sentence ? (
          <BandWords delay={320}>
            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
              {hero.sentence}
            </Text>
          </BandWords>
        ) : null}
        <View style={styles.row}>
          <View style={styles.numbers}>
            {hero.ledger.map((r, i) => (
              <BandLine key={r.key} row={r} i={i} />
            ))}
          </View>
          <Pressable
            onPress={() => router.push('/icon')}
            accessibilityRole="button"
            accessibilityLabel={`Your creature, the ${ANIMAL_LABELS[animal]}. Change it`}
            hitSlop={8}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
          >
            {/* Alive: it breathes and blinks, the island's character at rest. The one screen that
                is about you is the one place your creature is a face rather than a print. No
                glow: on its own hue the glow would be a paler patch of the same colour. */}
            <Face animal={animal} state="idle" ink={ON_HUE} size={creature} glow={false} />
          </Pressable>
        </View>
      </Band>
      {source ? (
        <Block style={styles.below}>
          <Words style={type.meta}>{source}</Words>
        </Block>
      ) : null}
    </Section>
  );
}

/** The type, a letter at a time, once the band's words are due. */
function TypeName({ text, size, id }: { text: string; size: number; id: string | null }) {
  const play = useClockReached(WORDS_AT);
  const { phase, revealed } = useFirstReveal(id);
  return (
    <SplitText
      text={text}
      by="chars"
      play={play}
      color={ON_HUE}
      allowFontScaling={false}
      accessibilityRole="header"
      textStyle={{ fontSize: size, lineHeight: Math.round(size * 1.02), fontWeight: '800', letterSpacing: -1.6 }}
      onEnd={phase === 'play' ? revealed : undefined}
    />
  );
}

/** One headline number on the band: the figure in dark ink, what it counts under it. */
function BandLine({ row, i }: { row: LedgerRow; i: number }) {
  return (
    <BandWords delay={360 + i * 90}>
      <Num spec={row.num} textStyle={figure(40, ON_HUE)} delay={420 + i * 150} accessibilityLabel={`${row.num.final} ${row.label}`} />
      <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.lineLabel]}>
        {row.label}
      </Text>
    </BandWords>
  );
}

/**
 * No sessions yet: the builder's creature printed large on their band (Duolingo puts its mascot
 * at about 200 pt on an empty state), one sentence saying what fills the page, and the one thing
 * that does. Not a page of zeros.
 */
export function YouEmpty({ animal, hue, width }: { animal: Animal; hue: Hue; width: number }) {
  const size = Math.min(192, Math.floor(((width - GUTTER * 2) * 0.5) / 16) * 16);
  return (
    <Section>
      <Band hue={hue} title="You">
        <BandWords delay={260}>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            No sessions yet.
          </Text>
        </BandWords>
        <View style={styles.emptyCreature}>
          <CreaturePrint animal={animal} size={size} color={ON_HUE} delay={200} />
        </View>
        <BandWords delay={420}>
          <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
            Finish a session on your Mac and this page fills in: your type, your numbers, your Wrapped.
          </Text>
        </BandWords>
      </Band>
      <Block style={styles.below}>
        <GoLink title="Connect your Mac" href="/pair" color={hue.ink} big />
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  emptyTitle: { fontSize: 44, lineHeight: 46, fontWeight: '800', letterSpacing: -1.2, color: ON_HUE },
  emptyCreature: { marginVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 18 },
  numbers: { flex: 1, gap: 12, paddingBottom: 2 },
  lineLabel: { marginTop: -2, opacity: 1 },
  below: { paddingHorizontal: GUTTER, marginTop: 14 },
});
