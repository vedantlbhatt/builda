/**
 * The band at the top of Now after time away (`away.ts` says what it counts and why): a dark card
 * in the island's black, the lead in words, the work it added up to, up to three of the runs by
 * name (each opens its session), and "Got it", which puts it away until the next time away.
 *
 * `useAwayFrom` is the clock: the moment the app last went to the background, written to the
 * phone's cache when it goes and read back when it comes to the front, so a cold start the next
 * morning knows when you left as well as a warm one does.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { getKv, setKv } from '../data/cache';
import { tokens } from '../generated/tokens';
import { RippleItem, STAGGER_MS, Wash, ISLAND_BLACK } from '../motion';
import { select } from '../ui/haptics';
import type { AwaySummary } from './away';

const KEY = 'away.left_at';
const S = tokens.surface;
const INK = S.text.dark;
const DIM = S.textDim.dark;
const FAINT = S.textFaint.dark;
const ADD = tokens.data.add.dark;

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

export function AwayBand({ away, onOpen, onDone }: { away: AwaySummary; onOpen: (id: string) => void; onDone: () => void }) {
  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`${away.lead}. ${away.line}`}>
      {/* Green from the left, the finished colour, into the black: news that is good or at least over. */}
      <Wash color={ADD} from="left" strength={0.16} />
      <Text maxFontSizeMultiplier={1.3} style={styles.lead}>
        {away.lead}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.line}>
        {away.line}
      </Text>
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
              <View style={[styles.dot, { backgroundColor: r.alone ? FAINT : ADD }]} />
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
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 8,
    marginTop: 10,
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: ISLAND_BLACK,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  lead: { color: INK, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  line: { color: DIM, fontSize: 14, lineHeight: 19, marginTop: 2 },
  rows: { marginTop: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  dot: { width: 7, height: 7, borderRadius: 2, borderCurve: 'continuous' },
  title: { flex: 1, color: INK, fontSize: 15, fontWeight: '600' },
  active: { color: DIM, fontSize: 14, fontVariant: ['tabular-nums'] },
  more: { color: FAINT, fontSize: 13, marginTop: 4 },
  done: { alignSelf: 'flex-end', marginTop: 6, paddingVertical: 4 },
  doneText: { color: DIM, fontSize: 14, fontWeight: '600' },
});
