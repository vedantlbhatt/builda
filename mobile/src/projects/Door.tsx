/**
 * A project as a door on the Projects tab: a band in the project's own hue that prints itself,
 * its place as the index and its stage as the title with the arrow that says the band opens its
 * page, its name set large and arriving a letter at a time (react-bits SplitText, through its port
 * in `src/ui/bits/text/SplitText.tsx`, started by the band's clock), its hours with you there and
 * its share of your time counting up, and its week in words. A project with nothing in the window
 * says so in a sentence, and still opens.
 *
 * Borrowed: a door that is the thing itself in its own colour, with the one number that matters
 * on it, is Spotify's playlist tile (design-md/music/spotify: "the art is the only colour, the
 * chrome recedes"); the press that settles it a hair smaller is the band's own (0.985).
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords, WORDS_AT } from '../insights/Band';
import { fitSize } from '../insights/format';
import { figure, GUTTER, Refusal, type } from '../insights/kit';
import { Num } from '../insights/Num';
import { ON_HUE, SPECTRUM } from '../insights/palette';
import { Section } from '../insights/reveal';
import { SplitText } from '../ui/bits/text';
import { useClockReached } from '../you/parts';
import type { ProjectDoor } from './model';

/** The name on a band: as large as fits one or two lines, arriving a letter at a time. */
export function BandName({ text, width, max = 52, min = 30, delay = WORDS_AT }: { text: string; width: number; max?: number; min?: number; delay?: number }) {
  const play = useClockReached(delay);
  // Two lines at most: a long name is fitted to half its length a line.
  const size = Math.max(min, Math.min(max, fitSize(text.length > 18 ? text.slice(0, Math.ceil(text.length / 2) + 2) : text, width, max, min)));
  return (
    <SplitText
      text={text}
      by="chars"
      play={play}
      color={ON_HUE}
      allowFontScaling={false}
      numberOfLines={2}
      accessibilityRole="header"
      textStyle={{ fontSize: size, lineHeight: Math.round(size * 1.04), fontWeight: '800', letterSpacing: -Math.round(size * 0.03 * 10) / 10 }}
    />
  );
}

export function ProjectDoorBand({ door, width }: { door: ProjectDoor; width: number }) {
  const router = useRouter();
  const inner = width - GUTTER * 2;
  return (
    <Section style={styles.section}>
      <Band
        hue={SPECTRUM[door.hue]}
        index={String(door.rank).padStart(2, '0')}
        title={door.stage ?? 'Project'}
        onPress={() => router.push(`/project/${door.key}`)}
        accessibilityLabel={door.a11y}
      >
        <BandName text={door.label.text} width={inner} />
        {door.hours ? (
          <BandWords delay={360}>
            <View style={styles.numbers}>
              <View style={styles.pair}>
                <Num spec={door.hours} textStyle={figure(44, ON_HUE)} delay={420} />
                <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                  {door.hoursCaption}
                </Text>
              </View>
              {door.share ? (
                <View style={styles.pair}>
                  <Num spec={door.share} textStyle={figure(44, ON_HUE)} delay={520} />
                  <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                    {door.shareCaption}
                  </Text>
                </View>
              ) : null}
            </View>
          </BandWords>
        ) : door.quiet ? (
          <BandWords delay={360}>
            <View style={styles.quiet}>
              <Refusal onHue>{door.quiet}</Refusal>
            </View>
          </BandWords>
        ) : null}
        <BandWords delay={480}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, styles.week]}>
            {[door.momentum, door.hours ? null : door.lastSession].filter(Boolean).join(' ')}
          </Text>
        </BandWords>
      </Band>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 40 },
  numbers: { flexDirection: 'row', gap: 20, marginTop: 14 },
  pair: { flex: 1, gap: 0 },
  quiet: { marginTop: 12 },
  week: { marginTop: 12 },
});
