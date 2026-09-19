/**
 * The reels waiting on you, as a pile of their own posters.
 *
 * It replaced a column of cards that each said the kind, the title, the creator's words, the
 * move, where it runs and how long, and "N more" (2026-09-19, the owner: too much text, the big,
 * small and grey pattern everywhere). The poster is the thing you shared, so it is the whole card;
 * under the pile is one line, the move the top reel offers, and two buttons.
 *
 * The pile is react-bits' Stack (`ui/bits/components/Stack.tsx`): the top poster follows the
 * finger and leans, and a throw or a tap tucks it under on the notch kit's spring, so going
 * through what you sent is a flick, not a scroll.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { tokens } from '../../generated/tokens';
import { space } from '../../theme';
import { Stack } from '../../ui/bits/components';
import { Button } from '../../ui/Button';
import { T } from '../../ui/Text';
import { MOVE_VERB } from '../copy';
import type { MoveRow } from '../types';
import { startsFromPoster, type WallDrop } from './model';
import { Poster, POSTER_RATIO } from './Poster';

/** The pile is narrower than the screen so the turned cards under it show at its sides. */
const CARD_OF_WIDTH = 0.6;
/** Tall posters make a tall pile: it stops at this height and the cards narrow to fit. */
const MAX_CARD_HEIGHT = 420;

export function PickPile({
  items,
  width,
  onOpen,
  onStart,
  posterRef,
}: {
  items: readonly WallDrop[];
  width: number;
  onOpen: (dropId: string) => void;
  onStart: (w: WallDrop, m: MoveRow) => void;
  posterRef?: (dropId: string) => (n: View | null) => void;
}) {
  const [top, setTop] = useState(0);
  // A drop that left the pile (its move started) makes a new pile, which starts at its first card.
  useEffect(() => setTop(0), [items.length]);

  const cardH = Math.min(MAX_CARD_HEIGHT, Math.round(width * CARD_OF_WIDTH * POSTER_RATIO));
  const cardW = Math.round(cardH / POSTER_RATIO);
  const w = items[top] ?? items[0];
  if (!w) return null;
  const lead = w.lead;
  const direct = startsFromPoster(lead);

  return (
    <View style={styles.wrap}>
      <Stack
        key={items.length}
        count={items.length}
        width={cardW}
        height={cardH}
        randomRotation
        onTopChange={setTop}
        labelFor={(i) => items[i]?.drop.title ?? 'A drop you sent'}
        renderCard={(i) => {
          const item = items[i]!;
          return <Poster drop={item.drop} width={cardW} frameRef={posterRef?.(item.drop.id)} />;
        }}
        style={{ width: cardW + space.xl, height: cardH + space.xl }}
      />
      {lead ? (
        <T role="row" numberOfLines={2} style={styles.move}>
          {lead.title}
        </T>
      ) : null}
      <View style={styles.actions}>
        <Button kind="secondary" size="compact" block={false} label="Open" onPress={() => onOpen(w.drop.id)} />
        {lead ? (
          <Button
            size="compact"
            block={false}
            haptic="commit"
            label={direct ? MOVE_VERB[lead.move_kind] : 'Choose a repo'}
            onPress={() => (direct ? onStart(w, lead) : onOpen(w.drop.id))}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.md },
  move: { color: tokens.surface.text.dark, textAlign: 'center', marginTop: space.md, paddingHorizontal: space.lg },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
