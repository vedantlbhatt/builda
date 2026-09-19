/**
 * The top of Projects: where your hours went, drawn as the split itself.
 *
 * WHAT THIS REPLACED. A hue band with a count up from zero and the builder's creature printed on
 * it, which was also the top of Sessions, You and six other screens (docs/motion.md). The question
 * this screen answers is a PROPORTION, so its head is one: a single thick bar cut into each
 * project's share of your attended time, each segment in its own hue, growing out from the left
 * on the island spring one after another, with the names and shares under it. The count of
 * projects is a word in the sentence above it, not a hero number.
 *
 * On the warm ground, never on a hue: the segments are the colour.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { Kicker, Refusal } from '../insights/kit';
import { Block, useClock, useReducedSV } from '../insights/reveal';
import { springAt } from '../motion/spec';
import type { ProjectsHero, ProjectRow } from './model';

const S = tokens.surface;
const H = tokens.spectrum.hues;
/** Project hues in order: cool first, never the builder's amber, far apart on the wheel. */
const SEGMENT_HUES = [H.tide.dark, H.orchid.dark, H.cobalt.dark, H.brass.dark, H.coral.dark, H.heather.dark];
/** A segment starts this long after the one before it. */
const STAGGER = 110;
const BAR_H = 30;
const GAP = 3;

export interface Split {
  key: string;
  label: string;
  share: number;
  color: string;
}

/** The segments: every project with a share of the window, largest first, the rest as "others". */
export function splitOf(rows: readonly Pick<ProjectRow, 'key' | 'label' | 'window'>[], max = 4): Split[] {
  const withShare = rows
    .map((r) => ({ key: r.key, label: r.label.text, share: r.window?.share ?? 0 }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share);
  const shown = withShare.slice(0, max);
  const rest = withShare.slice(max).reduce((n, r) => n + r.share, 0);
  const out: Split[] = shown.map((r, i) => ({ ...r, color: SEGMENT_HUES[i % SEGMENT_HUES.length]! }));
  if (rest > 0.0005) out.push({ key: 'others', label: `${withShare.length - max} more`, share: rest, color: S.textFaint.dark });
  return out;
}

/** A share as the list says it: "98%", "under 1%". */
export function shareLabel(share: number): string {
  if (share > 0 && share < 0.01) return 'under 1%';
  return `${Math.round(share * 100)}%`;
}

export function HoursSplit({ hero, rows, width, ink, empty }: { hero: ProjectsHero; rows: readonly ProjectRow[]; width: number; ink: string; empty: boolean }) {
  const split = splitOf(rows);
  const inner = width - 40;
  const total = split.reduce((n, s) => n + s.share, 0) || 1;
  const usable = inner - GAP * Math.max(0, split.length - 1);
  return (
    <Block style={styles.wrap}>
      <Kicker>Where your hours go</Kicker>
      <Text maxFontSizeMultiplier={1.3} style={styles.head}>
        <Text style={{ color: ink }}>{hero.count.final}</Text>
        {` ${hero.countCaption}`}
      </Text>
      {split.length > 0 ? (
        <>
          <View style={[styles.bar, { width: inner }]}>
            {split.map((s, i) => (
              <Segment key={s.key} w={Math.max(4, (s.share / total) * usable)} color={s.color} i={i} last={i === split.length - 1} first={i === 0} />
            ))}
          </View>
          <View style={styles.legend}>
            {split.map((s) => (
              <View key={s.key} style={styles.item}>
                <View style={[styles.swatch, { backgroundColor: s.color }]} />
                <Text maxFontSizeMultiplier={1.3} style={styles.itemText}>
                  {s.label}
                  <Text style={styles.itemShare}>{`  ${shareLabel(s.share)}`}</Text>
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {hero.hours ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.hours}>
          <Text style={styles.hoursNum}>{hero.hours.final}</Text>
          {` ${hero.hoursCaption}`}
        </Text>
      ) : null}
      {empty ? (
        <View style={{ marginTop: 12 }}>
          <Refusal>No project to show. A session in a folder with no git belongs to none, and a repository you left out in Settings never appears here.</Refusal>
        </View>
      ) : null}
    </Block>
  );
}

/** One project's share, growing out from the left on the island spring after the one before it. */
function Segment({ w, color, i, first, last }: { w: number; color: string; i: number; first: boolean; last: boolean }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const style = useAnimatedStyle(() => {
    const p = reduced.value ? 1 : Math.max(0, springAt(clock.value - 120 - i * STAGGER));
    return { width: w * p };
  });
  return (
    <View style={{ width: w, height: BAR_H }}>
      <Animated.View
        style={[
          { height: BAR_H, backgroundColor: color },
          first && styles.firstEnd,
          last && styles.lastEnd,
          !first && !last && styles.midEnd,
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 26 },
  head: { color: S.text.dark, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4, marginTop: 6 },
  bar: { flexDirection: 'row', gap: GAP, marginTop: 20 },
  firstEnd: { borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderTopRightRadius: 4, borderBottomRightRadius: 4, borderCurve: 'continuous' },
  lastEnd: { borderTopRightRadius: 10, borderBottomRightRadius: 10, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderCurve: 'continuous' },
  midEnd: { borderRadius: 4, borderCurve: 'continuous' },
  legend: { marginTop: 14, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 10, height: 10, borderRadius: 3, borderCurve: 'continuous' },
  itemText: { color: S.text.dark, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  itemShare: { color: S.textDim.dark, fontWeight: '500' },
  hours: { color: S.textDim.dark, fontSize: 15, lineHeight: 21, marginTop: 16 },
  hoursNum: { color: S.text.dark, fontWeight: '700' },
});
