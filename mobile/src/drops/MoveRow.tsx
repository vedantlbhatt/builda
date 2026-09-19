/**
 * One proposed move, as a row you can arm.
 *
 * A ROW, NOT A CARD. Five cards stacked is card soup, and a card implies each move is a separate
 * thing; they are five ways of spending the same drop, so they are a list with hairlines between
 * them, the way every other list in this app is.
 *
 * ARMED IS A RAIL, NOT A SLAB. The first version filled the whole row with the kind's hue. On a
 * sheet that is deliberately half transparent — the poster is meant to stay visible behind it —
 * a full bleed block of purple is the one opaque thing on the screen, and it reads as a control
 * borrowed from some other app rather than as this row being chosen. So: a 3pt rule of the hue
 * down the row's left edge, the same rule the evidence quote already stands on and the same one
 * the card wears along its bottom; the ground lifts by a hair of neutral white, which the poster
 * still shows through; and the words go from dim to full ink. Nothing is tinted, nothing gets a
 * border in its own hue, and the picture underneath survives.
 *
 * WHAT A ROW SAYS, in the order it says it:
 *
 *   the verb        what tapping does, in the kind's hue: Install, Apply it, Start building.
 *   the title       the move, in the reader's words.
 *   the effort      minutes, about an hour, a session. Mono, dim, right aligned.
 *   the evidence    the post's OWN words that justify this move, under a rule in the hue. This
 *                   is the row's whole claim to be trusted and it is never hidden behind a tap.
 *   the source      what it would install, and whether that link answered. An unverified source
 *                   says so in words and the button becomes "open it" rather than "install it".
 *
 * ARMED IS NOT STARTED. Tapping a row arms it; the bar at the bottom of the sheet starts what is
 * armed. Two taps to start work on your machine, and the second one says how many.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { dropHue } from '../theme';
import { Hairline } from '../ui/Hairline';
import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { canStart } from './boardRules';
import { EFFORT_WORD, MOVE_REFUSAL, MOVE_STATUS_LINE, MOVE_VERB } from './copy';
import { RepoPicker } from './RepoPicker';
import type { MoveRow as Move } from './types';

export interface MoveRowProps {
  move: Move;
  kind: string | null;
  armed: boolean;
  onToggle: (id: string) => void;
  /** The repository this move is pointed at, for an `existing_repo` move. */
  repoKey?: string | null;
  onChooseRepo?: (moveId: string, repoKey: string) => void;
}

export function MoveRowView({ move, kind, armed, onToggle, repoKey, onChooseRepo }: MoveRowProps) {
  const c = useColors();
  const [picking, setPicking] = React.useState(false);
  const hue = kind ? dropHue(kind) : null;
  const ink = hue?.ink ?? c.text;
  // A failed move is armed like an offered one: it said why it stopped, and trying it again is the
  // same tap (`boardRules.canStart`).
  const again = move.status === 'failed';
  const live = !canStart(move) && move.status !== 'declined';
  const unverified = move.verification?.refusal === 'source_unverified';
  const verb = unverified && move.move_kind === 'install' ? 'Open it' : MOVE_VERB[move.move_kind];
  /**
   * A move that runs in one of YOUR repositories is not startable until you say which.
   *
   * The planner has never seen a repository and has no field to name one in, so this is the one
   * kind of move a tap cannot finish on its own. The picker opens inside the row rather than as
   * a sheet over it: the choice belongs to this move and to no other, and the moves around it
   * stay visible while it is made.
   */
  const needsRepo = move.target === 'existing_repo' && !repoKey && canStart(move);

  return (
    <View>
      <Hairline />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: armed, disabled: live }}
        accessibilityLabel={again ? `${verb} again. ${move.title}. It did not finish.` : `${verb}. ${move.title}`}
        disabled={live}
        onPress={() => {
          select();
          if (needsRepo) {
            setPicking((was) => !was);
            return;
          }
          onToggle(move.id);
        }}
        style={({ pressed }) => [
          styles.row,
          armed && styles.armed,
          pressed && !armed && styles.pressed,
        ]}
      >
        {armed ? <View style={[styles.rail, { backgroundColor: ink }]} /> : null}
        <View style={styles.head}>
          <T role="meta" weight={600} style={{ color: ink }}>
            {verb}
          </T>
          <T role="meta" style={{ color: armed ? c.text : c.textFaint }}>
            {live ? MOVE_STATUS_LINE[move.status] : armed ? 'armed' : again ? `${MOVE_STATUS_LINE.failed}, tap to try again` : EFFORT_WORD[move.effort]}
          </T>
        </View>

        <T role="row" style={{ color: c.text }}>
          {move.title}
        </T>
        <T role="meta" style={{ color: armed ? c.text : c.textDim, marginTop: 2 }}>
          {move.intent}
        </T>

        {/* The post's own words. A left rule in the hue, and the words in the dim grey: a quote
            is evidence, so it is set apart and never dressed up as a headline. */}
        <View style={styles.quote}>
          <View
            style={[styles.quoteRule, { backgroundColor: hue?.partner ?? c.border }]}
          />
          <T
            role="meta"
            numberOfLines={3}
            style={[styles.quoteText, { color: c.textDim }]}
          >
            {move.evidence}
          </T>
        </View>

        {move.source ? (
          <T role="mono" numberOfLines={1} style={{ color: armed ? c.textDim : c.textFaint, marginTop: 6 }}>
            {move.source.source_kind} {move.source.ref}
            {move.verification?.state === 'verified' ? ' · checked' : ''}
          </T>
        ) : null}

        {unverified ? (
          <T role="meta" style={{ color: c.textFaint, marginTop: 4 }}>
            {MOVE_REFUSAL.source_unverified}
          </T>
        ) : null}

        {move.outcome ? (
          <T role="meta" style={{ color: c.textDim, marginTop: 6 }}>
            {move.outcome}
          </T>
        ) : null}

        {move.target === 'existing_repo' && repoKey ? (
          <T role="mono" style={{ color: armed ? c.textDim : c.textFaint, marginTop: 6 }}>
            {`in ${repoKey.slice(0, 7)}`}
          </T>
        ) : null}

        {needsRepo && !picking ? (
          <T role="meta" style={{ color: ink, marginTop: 8 }}>
            Pick a repo first
          </T>
        ) : null}
      </Pressable>

      {picking && canStart(move) ? (
        <View style={styles.picker}>
          <RepoPicker
            chosen={repoKey ?? null}
            ink={ink}
            onFill={hue?.onFill ?? c.bg}
            onChoose={(key) => {
              onChooseRepo?.(move.id, key);
              setPicking(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 14, paddingHorizontal: 16 },
  // Neutral, and barely there: the sheet is translucent on purpose and an opaque lift here would
  // punch an opaque hole in it. White at 6% reads as a lift on every frame behind it.
  armed: { backgroundColor: 'rgba(245,241,234,0.06)' },
  pressed: { backgroundColor: 'rgba(245,241,234,0.03)' },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  quote: { flexDirection: 'row', marginTop: 10 },
  quoteRule: { width: 2, borderRadius: 1, borderCurve: 'continuous', marginRight: 10 },
  quoteText: { flex: 1, fontStyle: 'italic' },
  picker: { paddingHorizontal: 16, paddingBottom: 16 },
});
