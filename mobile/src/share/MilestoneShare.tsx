/**
 * An hours milestone as a card you can post (`milestones.ts`): 360 x 450 points, captured at 3x
 * as 1080 x 1350 through the share preview, the week card's size and makings.
 *
 * The band in your colour with its dissolve and the figure on it, your creature, and under it the
 * ladder: every milestone as a pixel square, filled up to the one you just passed and outlined
 * after it, so the card says how far along the ladder this is without a sentence.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../generated/tokens';
import { BandPixels, FRINGE } from '../insights/Band';
import { CreatureMark } from '../insights/Creature';
import { ON_HUE } from '../insights/palette';
import { motionFor } from '../motion/pixelMotion';
import type { Animal } from '../pixel/animals';
import { MILESTONE_HOURS, milestoneNote } from './milestones';
import { showSharePreview } from './SharePreview';

const S = tokens.surface;
const CARD_W = 360;
const CARD_H = 450;
const BAND_H = 236;
const STEP = 30;

export function showMilestoneShare(hours: number, sessions: number, firstIso: string | null, you: { animal: Animal; ink: string }): void {
  showSharePreview(<MilestoneCard hours={hours} sessions={sessions} firstIso={firstIso} you={you} />, `${hours} hours of building`);
}

export function MilestoneCard({ hours, sessions, firstIso, you }: { hours: number; sessions: number; firstIso: string | null; you: { animal: Animal; ink: string } }) {
  const next = MILESTONE_HOURS.find((m) => m > hours) ?? null;
  return (
    <View style={styles.card}>
      <View style={{ height: BAND_H }}>
        <BandPixels width={CARD_W} solid={BAND_H} ink={you.ink} motion={motionFor(`milestone ${hours}`)} />
        <View style={styles.words}>
          <Text style={styles.kicker}>a milestone</Text>
          <Text style={styles.figure}>{hours}</Text>
          <Text style={styles.caption}>hours of building</Text>
          <Text style={styles.note}>{milestoneNote(sessions, firstIso)}</Text>
        </View>
        <View style={styles.creature}>
          <CreatureMark animal={you.animal} size={80} color={ON_HUE} />
        </View>
      </View>
      <View style={{ height: FRINGE }} />
      <View style={styles.lower}>
        <View style={styles.ladder}>
          {MILESTONE_HOURS.map((m) => {
            const passed = m <= hours;
            return (
              <View key={m} style={styles.rung}>
                <View style={[styles.square, passed ? { backgroundColor: you.ink } : { borderWidth: 2, borderColor: S.raised.dark }, m === hours && styles.now]} />
                <Text style={[styles.rungLabel, passed && { color: S.text.dark }]}>{m}</Text>
              </View>
            );
          })}
        </View>
        {next ? <Text style={styles.next}>{`next, ${next} hours`}</Text> : null}
      </View>
      <View style={styles.foot}>
        <CreatureMark animal={you.animal} size={16} color={you.ink} />
        <Text style={styles.brand}>Builda</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, backgroundColor: S.bg.dark, overflow: 'hidden' },
  words: { paddingHorizontal: 20, paddingTop: 18 },
  kicker: { color: ON_HUE, fontSize: 13, fontWeight: '700', opacity: 0.8 },
  figure: { color: ON_HUE, fontSize: 112, lineHeight: 118, fontWeight: '900', letterSpacing: -4, marginTop: 2 },
  caption: { color: ON_HUE, fontSize: 19, fontWeight: '800', marginTop: -4 },
  note: { color: ON_HUE, fontSize: 13, fontWeight: '600', opacity: 0.8, marginTop: 4 },
  creature: { position: 'absolute', right: 20, bottom: 16 },
  // The ladder and the next line sit in the middle of what is left under the band.
  lower: { flex: 1, justifyContent: 'center', gap: 18 },
  ladder: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  next: { color: S.textDim.dark, fontSize: 13, fontWeight: '600', paddingHorizontal: 20 },
  rung: { width: STEP + 8, alignItems: 'center', gap: 8 },
  square: { width: STEP, height: STEP },
  // The one just passed stands a cell taller than the rest.
  now: { height: STEP + 10, marginTop: -10 },
  rungLabel: { color: S.textDim.dark, fontSize: 12, fontWeight: '700' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 18 },
  brand: { color: S.text.dark, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
});
