/**
 * One project on the Projects list: its picture, and one line of words under it.
 *
 *   the stage   the width of the screen, 16:9: its trailer or its demo playing, its screens on its
 *               band, or its ink (`Stage.tsx`); a tap grows the stage into the project's page, in
 *               its own hue (`motion/MorphNav`), the house's navigation
 *   the name    the lead line, its public name or the one this phone gave it, and on the right its
 *               hours with you there in the window, the tabular row figure the Sessions list uses
 *   the line    its weeks in pixels, then its stage and when it was last built, and nothing else
 *
 * The owner, 2026-09-19: say less, no big over small grey pattern, no accent filled buttons. So a
 * row is one lead line and one meta line under a picture, exactly the Sessions row's weight, and
 * the picture carries the rest.
 */
import { useRouter } from 'expo-router';
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import type { DemoSources } from '../demos/useDemo';
import { GUTTER, type } from '../insights/kit';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { morphOpen } from '../motion/MorphNav';
import { ROW_FIGURE } from '../session/type';
import { Stage } from './Stage';
import type { StageVisual } from './rows';
import { WeekPixels } from './WeekPixels';

export interface ProjectRowModel {
  key: string;
  name: string;
  hue: HueName;
  /** "38.2", the hours with you there in the window; null when none. */
  hours: string | null;
  /** "Active · 2 hours ago". */
  meta: string;
  weeks: number[];
  visual: StageVisual;
  /** What VoiceOver reads for the words. */
  a11y: string;
}

export function ProjectRow({
  row,
  width,
  first,
  playing,
  sources,
  printSources,
  onError,
}: {
  row: ProjectRowModel;
  width: number;
  first: boolean;
  playing: boolean;
  sources: Record<string, MediaSourceRef>;
  printSources: DemoSources | undefined;
  onError?: () => void;
}) {
  const router = useRouter();
  const stageRef = useRef<View>(null);
  const hue = SPECTRUM[row.hue];
  const href = `/project/${row.key}`;
  const open = () => morphOpen(stageRef.current, () => router.push(`${href}?morph=1` as never), { color: hue.ink, radius: 0, ground: GROUND.bg }, href);
  return (
    <Section style={first ? styles.first : styles.next}>
      <Block>
        <View ref={stageRef} collapsable={false}>
          <Stage keyId={row.key} name={row.name} hue={row.hue} width={width} visual={row.visual} sources={sources} printSources={printSources} playing={playing} onOpen={open} onError={onError} />
        </View>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${row.a11y} Opens the project.`} style={({ pressed }) => [styles.words, { opacity: pressed ? 0.6 : 1 }]}>
          <View style={styles.head}>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[type.heading, styles.name]}>
              {row.name}
            </Text>
            {row.hours ? (
              <Text allowFontScaling={false} style={[ROW_FIGURE, styles.figure]}>
                {`${row.hours}h`}
              </Text>
            ) : null}
          </View>
          <View style={styles.meta}>
            <WeekPixels cells={row.weeks} ink={hue.ink} />
            {row.meta ? (
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[type.meta, styles.metaText]}>
                {row.meta}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  first: { marginTop: 4 },
  next: { marginTop: 34 },
  words: { paddingHorizontal: GUTTER, paddingTop: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  name: { flex: 1 },
  figure: { color: GROUND.text },
  meta: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  metaText: { flex: 1 },
});
