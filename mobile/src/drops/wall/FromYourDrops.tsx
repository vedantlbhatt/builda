/**
 * On a session's page: the reel this session was MADE from, when one of your moves ran as it
 * (the other direction of the wall's "what you made of them" pair, which already links the reel
 * to its session), and the reels you saved that are about what this session did
 * (`drops/context.ts`). Small posters, the words the two share, and a tap opens the drop.
 *
 * Only after the session's reading, and only when there is a match: an empty shelf titled "from
 * your drops" on every session would be a feature asking to be noticed, and most sessions have
 * nothing to do with anything you saved.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../data/client';
import type { SessionAnalysis } from '../../generated/analysis';
import { tokens } from '../../generated/tokens';
import { Kicker } from '../../insights/kit';
import { Block, Section } from '../../insights/reveal';
import { select } from '../../ui/haptics';
import { relatedDrops, sharedLine, type Related } from '../context';
import { KIND_WORD } from '../copy';
import type { DropRow, MoveRow } from '../types';
import { Poster } from './Poster';

const S = tokens.surface;

export function FromYourDrops({ analysis, sessionId }: { analysis: SessionAnalysis | null | undefined; sessionId?: string }) {
  const router = useRouter();
  const [related, setRelated] = useState<Related[]>([]);
  const [madeFrom, setMadeFrom] = useState<{ drop: DropRow; move: MoveRow } | null>(null);

  useEffect(() => {
    if (!analysis && !sessionId) return;
    let live = true;
    api
      .dropsBoard()
      .then((b) => {
        if (!live) return;
        const move = sessionId ? b.moves.find((m) => m.session_id === sessionId) : undefined;
        const drop = move ? b.drops.find((d) => d.id === move.drop_id) : undefined;
        setMadeFrom(move && drop ? { drop, move } : null);
        // The reel it was made from is not also "a reel you saved about this".
        if (analysis) setRelated(relatedDrops(analysis, b.drops).filter((r) => r.drop.id !== drop?.id));
      })
      .catch(() => {
        // No board, no shelf: this is a nicety on a page that stands without it.
      });
    return () => {
      live = false;
    };
  }, [analysis, sessionId]);

  if (related.length === 0 && !madeFrom) return null;
  return (
    <Section>
      <Block style={styles.wrap}>
        <Kicker>from your drops</Kicker>
        {madeFrom ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Made from a reel you shared: ${madeFrom.drop.title ?? 'a drop'}. ${madeFrom.move.title}`}
            onPress={() => {
              select();
              router.push(`/drop/${madeFrom.drop.id}`);
            }}
            style={({ pressed }) => [styles.made, pressed && { opacity: 0.7 }]}
          >
            <Poster drop={madeFrom.drop} width={72} />
            <View style={styles.words}>
              <Text maxFontSizeMultiplier={1.3} style={styles.lead}>
                Made from a reel you shared.
              </Text>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.title}>
                {madeFrom.drop.title ?? 'Untitled'}
              </Text>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.why}>
                {`The move: ${madeFrom.move.title}`}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {related.length ? (
          <Text maxFontSizeMultiplier={1.3} style={[styles.lead, madeFrom ? { marginTop: 8 } : null]}>
            {related.length === 1 ? 'You saved a reel about this.' : `You saved ${related.length} reels about this.`}
          </Text>
        ) : null}
        {related.map((r) => (
          <Pressable
            key={r.drop.id}
            accessibilityRole="button"
            accessibilityLabel={`${r.drop.title ?? 'A drop'}, ${sharedLine(r)}`}
            onPress={() => {
              select();
              router.push(`/drop/${r.drop.id}`);
            }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <Poster drop={r.drop} width={52} />
            <View style={styles.words}>
              <Text maxFontSizeMultiplier={1.3} style={styles.kind}>
                {r.drop.kind ? KIND_WORD[r.drop.kind] : 'a drop'}
              </Text>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.title}>
                {r.drop.title ?? 'Untitled'}
              </Text>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.why}>
                {sharedLine(r)}
              </Text>
            </View>
          </Pressable>
        ))}
      </Block>
    </Section>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8, gap: 12 },
  lead: { color: S.text.dark, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  made: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  words: { flex: 1, minWidth: 0 },
  kind: { color: S.textDim.dark, fontSize: 13, fontWeight: '600' },
  title: { color: S.text.dark, fontSize: 16, lineHeight: 20, fontWeight: '600', marginTop: 1 },
  why: { color: S.textFaint.dark, fontSize: 13, marginTop: 3 },
});
