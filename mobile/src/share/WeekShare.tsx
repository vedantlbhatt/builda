/**
 * The week as a card you can post: Strava's weekly summary, for building. 360 x 450 points, captured
 * at 3x as 1080 x 1350 through the share preview (`ui/SharePreview.tsx`).
 *
 * It is made of the app's own pixels: the week's hours on a band printed in your colour with its
 * dithered dissolve (`insights/Band.BandPixels`, drawn printed because a card being captured has no
 * clock), the seven days as pixel columns in the same ink, your creature in cells, then the week's
 * longest sessions by name. Every number on it is the Sessions head's own (`week.weekOf`,
 * `weekFigure`), so the card and the screen it came from can never disagree.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '../generated/tokens';
import { BandPixels, FRINGE } from '../insights/Band';
import { CreatureMark } from '../insights/Creature';
import { ON_HUE } from '../insights/palette';
import { motionFor } from '../motion/pixelMotion';
import type { Animal } from '../pixel/animals';
import { showSharePreview } from './SharePreview';
import { weekFigure, type WeekCardRow, type WeekModel } from '../session/week';

const S = tokens.surface;
const CARD_W = 360;
const CARD_H = 450;
/** The band's solid height; its dissolve hangs under it. */
const BAND_H = 176;
/** The tallest day's column. */
const TALL = 64;
const COL_W = 30;
export function showWeekShare(week: WeekModel, rows: WeekCardRow[], you: { animal: Animal; ink: string }): void {
  showSharePreview(<WeekCard week={week} rows={rows} you={you} />, 'My week in builds');
}

export function WeekCard({ week, rows, you }: { week: WeekModel; rows: WeekCardRow[]; you: { animal: Animal; ink: string } }) {
  const figure = weekFigure(week);
  const most = Math.max(1, ...week.days.map((d) => d.seconds));
  return (
    <View style={styles.card}>
      <View style={{ height: BAND_H }}>
        <BandPixels width={CARD_W} solid={BAND_H} ink={you.ink} motion={motionFor('week card')} />
        <View style={styles.bandWords}>
          <Text style={styles.kicker}>my week in builds</Text>
          <Text style={styles.figure}>{figure?.num.final ?? '0'}</Text>
          <Text style={styles.caption}>{figure ? figure.caption : 'this week'}</Text>
          {figure ? <Text style={styles.note}>{figure.note}</Text> : null}
        </View>
        <View style={styles.creature}>
          <CreatureMark animal={you.animal} size={64} color={ON_HUE} />
        </View>
      </View>
      <View style={{ height: FRINGE - 8 }} />
      <View style={styles.cols}>
        {week.days.map((d) => {
          const h = d.future ? 0 : d.seconds > 0 ? Math.max(6, Math.round((d.seconds / most) * TALL)) : 3;
          return (
            <View key={d.date} style={styles.col}>
              <View style={{ height: TALL, justifyContent: 'flex-end' }}>
                {h > 0 ? (
                  <View style={{ width: COL_W, height: h }}>
                    <BandPixels width={COL_W} solid={h} ink={d.seconds > 0 ? you.ink : S.raised.dark} motion="rise" fringe={0} />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.letter, d.today && styles.today]}>{d.letter}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.rows}>
        {rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {r.title}
            </Text>
            <Text style={styles.rowTime}>{r.active}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.foot}>
        <CreatureMark animal={you.animal} size={16} color={you.ink} />
        <Text style={styles.brand}>Builda</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, backgroundColor: S.bg.dark, overflow: 'hidden' },
  bandWords: { paddingHorizontal: 20, paddingTop: 18 },
  kicker: { color: ON_HUE, fontSize: 13, fontWeight: '700', opacity: 0.8 },
  figure: { color: ON_HUE, fontSize: 64, lineHeight: 70, fontWeight: '900', letterSpacing: -2, marginTop: 4, fontVariant: ['tabular-nums'] },
  caption: { color: ON_HUE, fontSize: 17, fontWeight: '800', marginTop: -2 },
  note: { color: ON_HUE, fontSize: 13, fontWeight: '600', opacity: 0.8, marginTop: 2 },
  creature: { position: 'absolute', right: 20, bottom: 14 },
  cols: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  col: { alignItems: 'center', gap: 6 },
  letter: { color: S.textDim.dark, fontSize: 11, fontWeight: '700' },
  today: { color: S.text.dark, textDecorationLine: 'underline' },
  rows: { paddingHorizontal: 20, marginTop: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  rowTitle: { flex: 1, color: S.text.dark, fontSize: 15, fontWeight: '700' },
  rowTime: { color: S.textDim.dark, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 18 },
  brand: { color: S.text.dark, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
});
