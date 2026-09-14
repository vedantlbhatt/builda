/**
 * A project as a door on the Projects tab: a band in the project's own hue that prints itself,
 * its place as the index and its stage as the title with the arrow that says the band opens its
 * page, its name set large and arriving a letter at a time (react-bits SplitText, through its port
 * in `src/ui/bits/text/SplitText.tsx`, started by the band's clock), its hours with you there and
 * its share of your time counting up, and its week in words. A project with nothing in the window
 * says so in a sentence, and still opens.
 *
 * Beside the words lie the prints of its demo (`src/demos/DoorPrints.tsx`): up to three stills
 * fanned like prints, the top one developing through the band's own pixels, a tap opening the
 * gallery; or one blank print that says how to make a demo. The prints sit OVER the band, not in
 * it: the band is one press that opens the page, and a print is its own press that opens the
 * gallery, so they are siblings and a finger on a print never also opens the page.
 *
 * The stage in the title and the last session are the Mac's report reconciled with what this
 * phone holds (`recency.ts`): a door never says "Winding down" over a project with a session
 * running in it.
 *
 * Borrowed: a door that is the thing itself in its own colour, with the one number that matters
 * on it, is Spotify's playlist tile (design-md/music/spotify: "the art is the only colour, the
 * chrome recedes"); the press that settles it a hair smaller is the band's own (0.985).
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DOOR_PRINTS, DoorPrints } from '../demos/DoorPrints';
import type { GalleryEntry } from '../demos/model';
import type { DoorDemo } from '../demos/useDemo';
import { Band, BandWords, WORDS_AT } from '../insights/Band';
import { fitSize } from '../insights/format';
import { figure, GUTTER, Refusal, type } from '../insights/kit';
import { Num } from '../insights/Num';
import { ON_HUE, SPECTRUM } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { SplitText } from '../ui/bits/text';
import { useClockReached } from '../you/parts';
import type { ProjectDoor } from './model';
import type { Recency } from './recency';

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

/** Room the prints take beside the words, and how far they sit in from the band's right edge. */
const PRINTS_GAP = 10;
const PRINTS_RIGHT = 12;

export function ProjectDoorBand({
  door,
  width,
  demo,
  whole = null,
  recent,
  onOpenDemo,
  onDemoError,
}: {
  door: ProjectDoor;
  width: number;
  /** The demo's prints; undefined when the phone has not heard, and then no print is drawn at all. */
  demo?: DoorDemo;
  /** The whole demo once its list has been read, null until then: what the prints' label counts. */
  whole?: readonly GalleryEntry[] | null;
  /** The report's stage and last session reconciled with this phone's rows; null to say the report's. */
  recent?: Recency | null;
  onOpenDemo?: (key: string, id: string | null) => void;
  onDemoError?: () => void;
}) {
  const router = useRouter();
  const inner = width - GUTTER * 2;
  const prints = demo !== undefined && onOpenDemo !== undefined;
  const room = prints ? DOOR_PRINTS.width + PRINTS_GAP - (GUTTER - PRINTS_RIGHT) : 0;
  const [top, setTop] = useState(0);
  const title = (recent ? recent.title : door.stage) ?? 'Project';
  // With news, the report's week is out of date: the phone's line, and where the report stops.
  const week = recent?.newer ? [recent.doorLine, recent.doorReport] : [door.momentum, door.hours ? null : (recent?.doorLine ?? door.lastSession)];
  // The door's own short lines, never the page's count of sessions since: a door reads one saved row
  // a project, and "after 1 more session" from one row is a count nobody measured.
  const a11y = recent?.newer ? [`${door.label.text}.`, `${title}.`, recent.doorLine, recent.doorReport, 'Opens the project.'].filter(Boolean).join(' ') : door.a11y;
  return (
    <Section style={styles.section}>
      <Band hue={SPECTRUM[door.hue]} index={String(door.rank).padStart(2, '0')} title={title} onPress={() => router.push(`/project/${door.key}`)} accessibilityLabel={a11y}>
        <View onLayout={(e) => setTop(Math.round(e.nativeEvent.layout.y))} style={{ paddingRight: room, minHeight: prints ? DOOR_PRINTS.height : undefined }}>
          <BandName text={door.label.text} width={inner - room} />
          {door.hours ? (
            <BandWords delay={360}>
              <View style={styles.numbers}>
                <View style={styles.pair}>
                  <Num spec={door.hours} textStyle={figure(prints ? 40 : 44, ON_HUE)} delay={420} />
                  <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                    {door.hoursCaption}
                  </Text>
                </View>
                {door.share ? (
                  <View style={styles.pair}>
                    <Num spec={door.share} textStyle={figure(prints ? 40 : 44, ON_HUE)} delay={520} />
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
              {week.filter(Boolean).join(' ')}
            </Text>
          </BandWords>
        </View>
      </Band>
      {prints ? (
        <Block enter={false} style={[styles.prints, { top }]}>
          <DoorPrints prints={demo.prints} sources={demo.sources} hue={door.hue} label={door.label.text} whole={whole} onOpen={(id) => onOpenDemo(door.key, id)} onError={onDemoError} />
        </Block>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 40 },
  numbers: { flexDirection: 'row', gap: 16, marginTop: 14 },
  pair: { flex: 1, gap: 0 },
  quiet: { marginTop: 12 },
  week: { marginTop: 12 },
  prints: { position: 'absolute', right: PRINTS_RIGHT },
});
