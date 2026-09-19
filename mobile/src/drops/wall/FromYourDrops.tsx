/**
 * On a session's page: the reels you saved that are about what this session did
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
import { Poster } from './Poster';

const S = tokens.surface;

export function FromYourDrops({ analysis }: { analysis: SessionAnalysis | null | undefined }) {
  const router = useRouter();
  const [related, setRelated] = useState<Related[]>([]);

  useEffect(() => {
    if (!analysis) return;
    let live = true;
    api
      .dropsBoard()
      .then((b) => {
        if (live) setRelated(relatedDrops(analysis, b.drops));
      })
      .catch(() => {
        // No board, no shelf: this is a nicety on a page that stands without it.
      });
    return () => {
      live = false;
    };
  }, [analysis]);

  if (related.length === 0) return null;
  return (
    <Section>
      <Block style={styles.wrap}>
        <Kicker>from your drops</Kicker>
        <Text maxFontSizeMultiplier={1.3} style={styles.lead}>
          {related.length === 1 ? 'You saved a reel about this.' : `You saved ${related.length} reels about this.`}
        </Text>
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
  words: { flex: 1, minWidth: 0 },
  kind: { color: S.textDim.dark, fontSize: 13, fontWeight: '600' },
  title: { color: S.text.dark, fontSize: 16, lineHeight: 20, fontWeight: '600', marginTop: 1 },
  why: { color: S.textFaint.dark, fontSize: 13, marginTop: 3 },
});
