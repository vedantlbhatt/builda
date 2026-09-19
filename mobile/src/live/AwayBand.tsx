/**
 * The band at the top of Now after time away (`away.ts` says what it counts and why): printed in
 * the finished green (the data green, the colour a finished thing is everywhere here) with its
 * dithered dissolve, in its own order, the lead in words, the work it added up to, up to three of
 * the runs by name (each opens its session), and "Got it", which puts it away until the next time
 * away.
 *
 * `useAwayFrom` is the clock: the moment the app last went to the background, written to the
 * phone's cache when it goes and read back when it comes to the front, so a cold start the next
 * morning knows when you left as well as a warm one does.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { getKv, setKv } from '../data/cache';
import { tokens } from '../generated/tokens';
import { BandPixels, FRINGE } from '../insights/Band';
import { ON_HUE } from '../insights/palette';
import { Block } from '../insights/reveal';
import { StandaloneReveal } from './MissionTile';
import { RippleItem, STAGGER_MS, withAlpha } from '../motion';
import { motionFor } from '../motion/pixelMotion';
import { select } from '../ui/haptics';
import type { AwaySummary } from './away';

const KEY = 'away.left_at';
const ADD = tokens.data.add.dark;
const INK = ON_HUE;
const DIM = withAlpha(ON_HUE, 0.72);

/** When the app last went to the background, null until known; `done` puts the band away. */
export function useAwayFrom(): { from: number | null; done: () => void } {
  const [from, setFrom] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void getKv(KEY)
        .then((v) => {
          const n = v === null ? NaN : Number(v);
          if (live) setFrom(Number.isFinite(n) ? n : null);
        })
        .catch(() => null);
    read();
    const sub = AppState.addEventListener('change', (next) => {
      // Written when it goes, read when it comes back: the stored value is always "when you left".
      if (next === 'background') void setKv(KEY, String(Date.now())).catch(() => null);
      else if (next === 'active') read();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  // Read is read: written back as "now", so a Now that remounts (a tab re-created, a reload) does
  // not bring the same band back before the next time away.
  const done = useCallback(() => {
    setFrom(null);
    void setKv(KEY, String(Date.now())).catch(() => null);
  }, []);
  return { from, done };
}

/** Memoised: Now re-renders on its clock, and nothing in the band changes with it. */
export const AwayBand = React.memo(AwayBandImpl);

function AwayBandImpl({ away, onOpen, onDone }: { away: AwaySummary; onOpen: (id: string) => void; onDone: () => void }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (Math.abs(b.w - width) < 0.5 && Math.abs(b.h - height) < 0.5 ? b : { w: width, h: height }));
  }, []);
  return (
    <StandaloneReveal style={styles.wrap}>
      <Block enter={false}>
        <BandPixels width={box.w} solid={box.h} ink={ADD} motion={motionFor('away')} />
        <View style={styles.card} onLayout={onLayout} accessibilityRole="summary" accessibilityLabel={`${away.lead}. ${away.line}`}>
          <Text maxFontSizeMultiplier={1.3} style={styles.lead}>
            {away.lead}
          </Text>
          {/* The total under the heading was a small second line (2026-09-19, the owner: say less);
              each row carries its own time, and VoiceOver still hears the total. */}
          <View style={styles.rows}>
            {away.rows.map((r, i) => (
              <RippleItem key={r.id} i={i} per={STAGGER_MS}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${r.title}, ${r.active}${r.alone ? ', ran on its own' : ''}. Opens the session`}
                  onPress={() => {
                    select();
                    onOpen(r.id);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={[styles.dot, { backgroundColor: INK, opacity: r.alone ? 0.45 : 1 }]} />
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.title}>
                    {r.title}
                  </Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.active}>
                    {r.active}
                  </Text>
                </Pressable>
              </RippleItem>
            ))}
            {away.finished > away.rows.length ? (
              <Text maxFontSizeMultiplier={1.3} style={styles.more}>
                {`and ${away.finished - away.rows.length} more in Sessions`}
              </Text>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onDone} style={styles.done}>
            <Text maxFontSizeMultiplier={1.3} style={styles.doneText}>
              Got it
            </Text>
          </Pressable>
        </View>
        <View style={{ height: FRINGE }} />
      </Block>
    </StandaloneReveal>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  card: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  lead: { color: INK, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  line: { color: DIM, fontSize: 14, lineHeight: 19, marginTop: 2 },
  rows: { marginTop: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  dot: { width: 7, height: 7, borderRadius: 2, borderCurve: 'continuous' },
  title: { flex: 1, color: INK, fontSize: 15, fontWeight: '600' },
  active: { color: DIM, fontSize: 14, fontVariant: ['tabular-nums'] },
  more: { color: DIM, fontSize: 13, marginTop: 4 },
  done: { alignSelf: 'flex-end', marginTop: 6, paddingVertical: 4 },
  doneText: { color: INK, fontSize: 14, fontWeight: '700' },
});
