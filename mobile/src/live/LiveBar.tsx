/**
 * The live bar at the top of a RUNNING session's screen: the island, opened on this one session.
 * The Live Activity for the run is the system island's black with the run's creature in it, so
 * here it is the same object at the page's width (docs/motion.md: the island is the app's one
 * voice for what is happening elsewhere). Left, the run's face in its state (working, waiting on
 * you with the lids down, asleep when the Mac stopped reporting) with its glow; the tool's mark
 * and the repository; the one sentence with the light passing across it, because it is the
 * active line; on the right, how long it has run; along its foot, elapsed over the repository's
 * typical run while the ETA is an answer. A wash of the run's hue from the left says whose it is.
 *
 * WHAT THIS REPLACED. A flat slab of the creature's hue, square cornered, with a pixel creature
 * printing itself in and the elapsed clock counting up from zero, directly over the hero card
 * that is the same hue with the same creature and a clock that ALSO counts up: two cyan blocks
 * saying one thing twice, and the first screenshot of it caught the bar at "1h 39m" on its way to
 * "3h 09m". The clock here is still, set once and moving with the minute; the hero counts.
 *
 * Words and numbers are `mission.barModel`, the tile's rules, so the bar and the tile agree to
 * the minute. Renders nothing for a final session: a finished session's screen is the recap.
 */
import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { SessionDetail } from '../data/api';
import { useRepoNames } from '../data/repoNames';
import { tokens } from '../generated/tokens';
import { FACE_FOR_TILE } from '../island/feeds';
import { Block } from '../insights/reveal';
import { Face, ISLAND_BLACK, Shimmer, Wash, withAlpha } from '../motion';
import type { Animal } from '../pixel/animals';
import { creatureHue, MONO_FAMILY } from '../theme';
import { T } from '../ui';
import { CLOCK_TICK_MS, sessionCreature, useNow } from './LiveSessions';
import { barModel, elapsedLabel, TILE_MAX_SCALE } from './mission';
import { Arrive, FootTrack, HarnessStamp, inked, StandaloneReveal } from './MissionTile';

/** Flighty's in-app status bar: 64pt, the height the Lock Screen layout folds into. */
export const LIVE_BAR_HEIGHT = 64;
const CREATURE = 36;
const TRACK = 4;

export interface LiveBarProps {
  /** A session from `GET /v1/sessions/{id}` (the full live state) or a live list row (the slim one). */
  session: SessionDetail;
  /** Default the session's crew creature, the one its tile wears. */
  creature?: Animal;
  /**
   * Whether this bar's creature may move. Default: only while the session needs you. A screen
   * with another moving creature passes false (one animating creature per screen).
   */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LiveBar({ session, creature, animate, style }: LiveBarProps) {
  const focused = useIsFocused();
  const now = useNow(CLOCK_TICK_MS, focused);
  if (session.state !== 'live') return null;
  return (
    <StandaloneReveal style={style}>
      <Block enter={false}>
        <BarBody session={session} now={now} creature={creature ?? sessionCreature(session)} animate={animate} />
      </Block>
    </StandaloneReveal>
  );
}

function BarBody({ session, now, creature, animate }: { session: SessionDetail; now: number; creature: Animal; animate?: boolean }) {
  const names = useRepoNames();
  const m = barModel(session, now, names);
  const hue = useMemo(() => creatureHue(creature), [creature]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  const waiting = m.kind === 'needsYou' && !m.stale;
  // One creature moves per screen: the bar's blinks only when it is the one that needs you, or
  // when the screen says it may.
  const alive = (animate ?? waiting) && !m.stale;
  const state = m.stale ? 'sleep' : m.kind === 'finished' ? 'done' : FACE_FOR_TILE[m.kind];
  const trackH = m.track !== null ? TRACK : 0;

  const corner =
    m.stale || m.kind === 'needsYou' || m.kind === 'finished' || m.elapsedMin === null ? (
      <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(13, '700', waiting ? AMBER : DIM)}>
        {m.kind === 'finished' ? 'finished' : m.corner.text}
      </T>
    ) : (
      // Labelled: this is the clock since the session started, and the hero right under the bar
      // counts ACTIVE time. FOUND IN THE FINAL CAPTURE (2026-09-13): "47m" here beside "42m
      // active so far" with nothing to say they are two clocks.
      <View style={styles.corner} accessible accessibilityLabel={`${elapsedLabel(m.elapsedMin * 60)} elapsed`}>
        <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(15, '800', INK, 18)}>
          {elapsedLabel(m.elapsedMin * 60)}
        </T>
        <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(11, '600', DIM, 13)}>
          elapsed
        </T>
      </View>
    );
  // Under the sentence: the ETA or "since 9:37" when there is an honest one; for a turn the
  // engine called done while the row is live, that nobody has looked at it yet.
  const under = m.unreviewed ? 'not looked at yet' : m.eta && m.eta !== 'no ETA yet' && !m.stale ? m.eta : null;

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={m.label}
      testID="live-bar"
      style={[styles.bar, { paddingBottom: 14 + trackH }]}
    >
      <Wash color={m.stale ? null : waiting ? AMBER : hue.ink} from={waiting ? 'top' : 'left'} strength={waiting ? 0.3 : 0.2} />
      <View style={styles.creature}>
        <Face animal={creature} state={state} ink={m.stale ? hue.ink : hue.ink} size={CREATURE} alive={alive} glow={!m.stale} />
      </View>
      <Arrive delay={140} style={styles.words}>
        <View style={styles.top}>
          <HarnessStamp harness={m.harness} size={12} color={m.stale ? DIM : hue.ink} />
          {/* The repository in full: it wraps, it never ellipsizes. */}
          <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={[inked(13, '700', m.stale ? DIM : INK), styles.repo]}>
            {m.repo}
          </T>
          {corner}
        </View>
        {m.stale ? (
          <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(16, '700', DIM, 21)}>
            {m.sentence}
          </T>
        ) : (
          <Shimmer text={m.sentence} style={inked(16, '700', INK, 21)} dim={withAlpha(INK, 0.72)} bright={INK} />
        )}
        {under ? (
          <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(12, '600', DIM)}>
            {under}
          </T>
        ) : null}
      </Arrive>
      {m.track !== null && box.w > 0 ? <FootTrack track={m.track} width={box.w} height={trackH} color={hue.ink} delay={360} /> : null}
    </View>
  );
}

const INK = tokens.surface.text.dark;
const DIM = tokens.surface.textDim.dark;
const AMBER = tokens.spectrum.hues.amber.dark;
/** The island's radius at this height: the Now stage's 44 would be a pill on a two line card. */
const RADIUS = 28;

const styles = StyleSheet.create({
  bar: {
    minHeight: LIVE_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    marginHorizontal: 8,
    borderRadius: RADIUS,
    borderCurve: 'continuous',
    // The hardware's black, as the system island is: the same object as the Live Activity.
    backgroundColor: ISLAND_BLACK,
    overflow: 'hidden',
  },
  creature: { width: CREATURE, height: CREATURE, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repo: { flex: 1, fontFamily: MONO_FAMILY },
  corner: { alignItems: 'flex-end' },
});
