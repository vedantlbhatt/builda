/**
 * A drop, opened. This is what the board zooms INTO.
 *
 * NOT A MODAL AND NOT A CARD. The board stays on screen above it, still zoomed on the node you
 * tapped, and this rises underneath: you can see where you are the whole time, which is the
 * difference between a map you are exploring and a list that pushed a screen at you. The sigil
 * sits ON the top edge, half above the hairline, so the panel reads as the node opening rather
 * than as a sheet arriving over it.
 *
 * WHAT IS ON IT, and what is deliberately not:
 *
 *   the kind, in its own hue, as INK ON THE GROUND. Not a chip. A chip here would be a pale fill
 *   of the hue, a border of the hue and text of the hue, which is the exact shape the owner has
 *   twice asked never to see again, and it would say nothing the word alone does not.
 *
 *   the title, big, and the summary under it. Then a rule, then the moves.
 *
 *   the moves, as rows (`MoveRow.tsx`). Arming is local; starting is the bar at the bottom and
 *   it says how many. Two taps, and the second one counts.
 *
 *   the adjustment. One field, opened by a word rather than sitting there empty: "say more".
 *   What you type goes to the runner as YOUR words, last, after the post's quoted words, so it
 *   outranks them (`drops/runner.py`, `task_prompt`).
 *
 *   a refusal, when there is one: the sentence for the code, and underneath it, in mono, how
 *   much there actually was to read. A card that refuses without saying what it had is a card
 *   nobody can tell from a broken app.
 *
 *   for a recipe, the whole recipe (`RecipeSteps.tsx`).
 *
 * NO GRADIENT, no glow, no pale tint of anything.
 */
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { dropHue } from '../theme';
import { Button } from '../ui/Button';
import { Hairline } from '../ui/Hairline';
import { T } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { commit, select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { KIND_WORD, PLATFORM_WORD, REFUSAL, STATUS_LINE, readLine } from './copy';
import { MoveRowView } from './MoveRow';
import { RecipeSteps } from './RecipeSteps';
import { Sigil } from './SigilView';
import { movesOf, type DropRow, type MoveRow } from './types';

export interface DropDetailProps {
  drop: DropRow;
  moves: MoveRow[];
  onStart: (moveIds: string[], adjustment: string | null) => void;
  onArchive: () => void;
  onClose: () => void;
}

export function DropDetail({ drop, moves, onStart, onArchive, onClose }: DropDetailProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const ink = hue?.ink ?? c.textDim;
  const mine = useMemo(() => movesOf(moves, drop.id), [moves, drop.id]);
  const [armed, setArmed] = useState<string[]>([]);
  const [saying, setSaying] = useState(false);
  const [adjustment, setAdjustment] = useState('');
  // The tab bar is under this panel, so the last row of a recipe has to clear it. Read, never
  // guessed: the bar is 49 points plus whatever the home indicator takes on this device.
  const tabBar = 49 + insets.bottom;

  const source = drop.resolution?.source ?? null;
  const recipe = drop.resolution?.plan?.recipe ?? null;
  const busy = drop.status === 'waiting' || drop.status === 'resolving';

  const toggle = (id: string) =>
    setArmed((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      style={[styles.panel, { backgroundColor: c.bg, borderTopColor: c.border }]}
    >
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 28 + tabBar }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The node, on the panel's edge. It SCROLLS: it is the drop opening, and a sigil pinned
            over a recipe that moves under it reads as a sticker somebody stuck on. */}
        <View style={styles.dock} pointerEvents="none">
          <Sigil
            seed={drop.url}
            size={52}
            ink={ink}
            partner={hue?.partner ?? c.border}
            motion={busy ? 'growing' : mine.some((m) => m.status === 'running') ? 'running' : 'still'}
          />
        </View>
        <View style={styles.kindRow}>
          <T role="label" style={{ color: ink, letterSpacing: 1.4 }}>
            {(drop.kind ? KIND_WORD[drop.kind] : 'unread').toUpperCase()}
          </T>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <T role="label" style={{ color: c.textFaint, letterSpacing: 1.4 }}>
              CLOSE
            </T>
          </Pressable>
        </View>

        <T role="title" style={{ color: c.text, marginTop: 6 }}>
          {drop.title ?? 'Not read yet'}
        </T>

        {drop.summary ? (
          <T role="body" style={{ color: c.textDim, marginTop: 8 }}>
            {drop.summary}
          </T>
        ) : null}

        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the original post"
          onPress={() => Linking.openURL(drop.url)}
          style={styles.sourceRow}
        >
          <T role="mono" style={{ color: c.textFaint }}>
            {[PLATFORM_WORD[drop.platform], source?.author ? `@${source.author}` : null]
              .filter(Boolean)
              .join('  ·  ')}
          </T>
          <T role="mono" style={{ color: ink }}>
            OPEN
          </T>
        </Pressable>

        {busy ? (
          <T role="meta" style={{ color: c.textFaint, marginTop: 14 }}>
            {STATUS_LINE[drop.status]}
          </T>
        ) : null}

        {drop.refusal ? (
          <View style={styles.refusal}>
            <T role="body" style={{ color: c.text }}>
              {REFUSAL[drop.refusal]}
            </T>
            {source ? (
              <T role="mono" style={{ color: c.textFaint, marginTop: 6 }}>
                {readLine(source.caption_chars, source.transcript_chars)}
              </T>
            ) : null}
          </View>
        ) : null}

        {recipe ? (
          <View style={{ marginTop: 22 }}>
            <RecipeSteps recipe={recipe} />
          </View>
        ) : null}

        {mine.length ? (
          <View style={{ marginTop: 22 }}>
            <T role="label" style={{ color: c.textDim, letterSpacing: 1.4, paddingHorizontal: 16 }}>
              {`WHAT YOU COULD DO  ·  ${mine.length}`}
            </T>
            <View style={{ marginTop: 8 }}>
              {mine.map((m) => (
                <MoveRowView
                  key={m.id}
                  move={m}
                  kind={drop.kind}
                  armed={armed.includes(m.id)}
                  onToggle={toggle}
                />
              ))}
              <Hairline />
            </View>
          </View>
        ) : null}

        {armed.length ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.say}>
            {saying ? (
              <TextField
                accessibilityLabel="In your words"
                value={adjustment}
                onChangeText={setAdjustment}
                placeholder="Anything to add before it starts"
                multiline
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  select();
                  setSaying(true);
                }}
              >
                <T role="row" style={{ color: ink }}>
                  Say more first
                </T>
              </Pressable>
            )}
          </Animated.View>
        ) : null}

        <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archive}>
          <T role="meta" style={{ color: c.textFaint }}>
            Archive this drop
          </T>
        </Pressable>
      </ScrollView>

      {armed.length ? (
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={[styles.bar, { borderTopColor: c.border, backgroundColor: c.bg, paddingBottom: 16 + insets.bottom }]}
        >
          <Button
            kind="primary"
            label={armed.length === 1 ? 'Start it' : `Start ${armed.length}`}
            onPress={() => {
              commit();
              onStart(armed, adjustment.trim() || null);
              setArmed([]);
              setSaying(false);
              setAdjustment('');
            }}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '68%',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dock: { alignItems: 'center', marginTop: -32, marginBottom: 10 },
  body: { paddingTop: 8, paddingHorizontal: 16 },
  kindRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  refusal: { marginTop: 18 },
  say: { marginTop: 18, paddingHorizontal: 16 },
  archive: { marginTop: 28, alignItems: 'center' },
  bar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
