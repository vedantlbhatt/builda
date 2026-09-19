/**
 * The wall's three kinds of card, one per band that asks something of you or shows you something.
 *
 *   PickCard      read, moves offered: the poster, the creator's own words the move rests on, and
 *                 the one move a thumb can start right here. Everything else is one tap away.
 *   BuildingCard  a move running on your Mac: the poster small, the step it is on as a wheel,
 *                 and the aura, which on this screen means "an agent is driving this one".
 *   PairCard      the payoff: the reel you sent beside what you made of it, and the way to make
 *                 a reel of THAT (the ship kit). Seen, built, shown.
 *
 * No chips, no pale fills of a hue with a border of the same hue, no uppercase labels: a word in
 * the kind's hue is how a kind is said.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { undash } from '../../copy/plain';
import { tokens } from '../../generated/tokens';
import { Aura, Wheel } from '../../motion';
import { dropHue } from '../../theme';
import { PressableScale } from '../../ui/PressableScale';
import { commit, select } from '../../ui/haptics';
import { EFFORT_WORD, KIND_WORD, MOVE_TARGET_WORD, MOVE_VERB } from '../copy';
import type { MoveRow } from '../types';
import { cardA11y, pairActions, pickActions, runningFor, startsFromPoster } from './model';
import type { WallDrop } from './model';
import { Poster } from './Poster';

const S = tokens.surface;
const TEXT = S.text.dark;
const DIM = S.textDim.dark;
const FAINT = S.textFaint.dark;
const CARD = S.card.dark;
const AMBER = S.accent.dark;
const ON_AMBER = S.text.light;

export function PickCard({
  w,
  width,
  onOpen,
  onStart,
  posterRef,
}: {
  posterRef?: (n: View | null) => void;
  w: WallDrop;
  width: number;
  onOpen: () => void;
  onStart: (m: MoveRow) => void;
}) {
  const hue = w.drop.kind ? dropHue(w.drop.kind) : null;
  const posterW = Math.round(width * 0.32);
  const more = w.moves.filter((m) => m.status === 'offered').length - 1;
  const lead = w.lead;
  const direct = startsFromPoster(lead);
  const go = () => {
    if (!lead) return;
    if (direct) {
      commit();
      onStart(lead);
    } else {
      select();
      onOpen();
    }
  };
  return (
    <PressableScale
      style={styles.pickPress}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${w.drop.title ?? 'A drop'}. Open it.`}
      {...cardA11y(pickActions(lead), onOpen, { start: go })}
    >
      <View style={[styles.card, { width }]}>
        <Poster drop={w.drop} width={posterW} frameRef={posterRef} />
        <View style={styles.body}>
          <Text style={[styles.kind, { color: hue?.ink ?? DIM }]}>{w.drop.kind ? KIND_WORD[w.drop.kind] : 'a drop'}</Text>
          <Text numberOfLines={3} style={styles.title}>
            {w.drop.title ?? 'Untitled'}
          </Text>
          {lead?.evidence ? (
            // The creator's own words: why this move exists at all. Verbatim, so it is quoted,
            // and quoted in the platform's voice rather than ours.
            <Text numberOfLines={2} style={styles.quote}>
              {`“${lead.evidence.trim()}”`}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {lead ? (
            <View>
              <Text numberOfLines={2} style={styles.moveTitle}>
                {lead.title}
              </Text>
              <Text style={styles.moveWhere}>{`${MOVE_TARGET_WORD[lead.target]} · ${EFFORT_WORD[lead.effort]}`}</Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={go}
                  style={({ pressed }) => [styles.go, pressed && { backgroundColor: S.border.dark }]}
                >
                  <Text style={styles.goText}>{direct ? MOVE_VERB[lead.move_kind] : 'Choose a repo'}</Text>
                </Pressable>
                {more > 0 ? <Text style={styles.more}>{`${more} more`}</Text> : null}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

/** The steps a running move walks through, as the wheel shows them. */
function buildSteps(m: MoveRow, nowMs: number): { rows: { key: string; text: string }[]; index: number } {
  const mins = runningFor(m, nowMs);
  const rows = [
    { key: 'queued', text: 'Waiting for your Mac' },
    { key: 'running', text: mins !== null && m.status === 'running' ? `Claude Code, ${mins < 1 ? 'just started' : `${mins}m in`}` : 'Claude Code is on it' },
    { key: 'done', text: 'Done' },
  ];
  return { rows, index: m.status === 'queued' ? 0 : m.status === 'running' ? 1 : 2 };
}

export function BuildingCard({ w, width, aura, onOpen, posterRef }: { w: WallDrop; width: number; aura: boolean; onOpen: () => void; posterRef?: (n: View | null) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);
  const m = w.active;
  if (!m) return null;
  const steps = buildSteps(m, now);
  return (
    <PressableScale style={styles.buildingPress} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${m.title}, ${steps.rows[steps.index]!.text}`}>
      <View style={[styles.building, { width }]}>
        <Poster drop={w.drop} width={64} frameRef={posterRef} />
        <View style={[styles.body, { justifyContent: 'center' }]}>
          <Text numberOfLines={2} style={styles.moveTitle}>
            {m.title}
          </Text>
          <View style={{ marginTop: 6 }}>
            <Wheel rows={steps.rows} index={steps.index} width={width - 64 - 44} rowHeight={20} visible={1} textStyle={styles.wheel} dim="rgba(245,241,234,0.56)" bright={TEXT} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

export function PairCard({
  w,
  width,
  onOpen,
  onSession,
  onShare,
  onFilm,
  posterRef,
}: {
  w: WallDrop;
  width: number;
  onOpen: () => void;
  onSession: (id: string) => void;
  onShare?: () => void;
  /** Film what was built (the ship kit), for a move that made something that runs. */
  onFilm?: (sessionId: string) => void;
  posterRef?: (n: View | null) => void;
}) {
  const m = w.active;
  if (!m) return null;
  // Only a move that made or changed a project has something to film: installing a tool, trying
  // one out, filling in a card or keeping the reel leave nothing a demo could show.
  const filmable = m.session_id !== null && (m.move_kind === 'scaffold' || m.move_kind === 'apply');
  const posterW = Math.round(width * 0.3);
  const actions = pairActions({ session: m.session_id !== null, film: Boolean(onFilm && filmable), share: Boolean(onShare) });
  return (
    <PressableScale
      style={styles.pairPress}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${w.drop.title ?? 'A drop'}, built: ${m.title}`}
      {...cardA11y(actions, onOpen, {
        session: () => m.session_id && onSession(m.session_id),
        film: () => m.session_id && onFilm?.(m.session_id),
        share: () => onShare?.(),
      })}
    >
      <View style={[styles.pair, { width }]}>
        <View>
          <Poster drop={w.drop} width={posterW} frameRef={posterRef} />
        </View>
        <View style={styles.arrow}>
          <Text style={styles.arrowText}>→</Text>
        </View>
        <View style={[styles.built, { height: Math.round(posterW * (16 / 9)) }]}>
          {/* The title and what you can do with it. The kind word, the run's own words and the
              upload note were three more sizes and greys under it (2026-09-19, the owner: the
              big, small, grey pattern; say less). The run's words are one tap away, on the drop. */}
          <Text numberOfLines={3} style={styles.title}>
            {m.title}
          </Text>
          <View style={{ flex: 1 }} />
          {m.session_id ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                select();
                onSession(m.session_id!);
              }}
            >
              <Text style={styles.link}>Open the session</Text>
            </Pressable>
          ) : null}
          {onFilm && filmable ? (
            // Shown, the video half: the ship kit films the project the move made (`docs/ship-kit.md`).
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                select();
                onFilm(m.session_id!);
              }}
              style={{ marginTop: 10 }}
            >
              <Text style={styles.link}>Film it</Text>
            </Pressable>
          ) : null}
          {onShare ? (
            // Shown: the pair as the image only Builda can make (`PairShare.tsx`).
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                select();
                onShare();
              }}
              style={{ marginTop: 10 }}
            >
              <Text style={styles.link}>Share</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Each card's corner on its pressable as well: a desktop's hover wash is laid on the pressable
  // (`desktop/css.ts`) and drew a square behind every rounded card. No fill, so a phone sees
  // nothing. The pair is two shapes, so its wash takes the smaller corner of the two (18).
  pickPress: { borderRadius: 24, borderCurve: 'continuous' },
  buildingPress: { borderRadius: 22, borderCurve: 'continuous' },
  pairPress: { borderRadius: 18, borderCurve: 'continuous' },
  card: { flexDirection: 'row', gap: 14, padding: 10, borderRadius: 24, borderCurve: 'continuous', backgroundColor: CARD },
  building: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 22, borderCurve: 'continuous', backgroundColor: CARD },
  pair: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, minWidth: 0, paddingVertical: 4 },
  kind: { fontSize: 13, fontWeight: '600' },
  kindDim: { fontSize: 13, fontWeight: '500', color: DIM },
  title: { fontSize: 17, fontWeight: '700', color: TEXT, marginTop: 3, lineHeight: 21 },
  quote: { fontSize: 13, color: DIM, marginTop: 6, fontStyle: 'italic', lineHeight: 17 },
  moveTitle: { fontSize: 15, fontWeight: '600', color: TEXT, lineHeight: 19 },
  moveWhere: { fontSize: 12, color: FAINT, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  // The raised surface and the text colour (2026-09-19, the owner: no accent fill with dark ink).
  go: { height: 38, paddingHorizontal: 16, borderRadius: 19, borderCurve: 'continuous', backgroundColor: S.raised.dark, alignItems: 'center', justifyContent: 'center' },
  goText: { fontSize: 15, fontWeight: '700', color: TEXT },
  more: { fontSize: 13, color: DIM, fontWeight: '500' },
  wheel: { fontSize: 13, fontWeight: '500' },
  arrow: { width: 28, alignItems: 'center' },
  arrowText: { color: FAINT, fontSize: 18 },
  built: { flex: 1, padding: 12, borderRadius: 18, borderCurve: 'continuous', backgroundColor: CARD },
  outcome: { fontSize: 13, color: DIM, marginTop: 6, lineHeight: 17 },
  link: { fontSize: 14, fontWeight: '600', color: TEXT },
});
