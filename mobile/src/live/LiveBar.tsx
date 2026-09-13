/**
 * The live bar at the top of a RUNNING session's screen: the Lock Screen card folded into a
 * printed strip in the session's crew creature hue, so the session looks the same on the grid,
 * here and on the Lock Screen (Flighty's cross surface rule: the in app status bar mirrors the
 * Live Activity). Left, the creature; then the tool's mark and the repository in full; the one
 * sentence; on the right, how long it has run (counted, then moving with the clock) or the word
 * that replaces it; along its foot, elapsed over the repository's typical run, solid then dotted
 * (Flighty's arc: flown solid, remaining dashed), drawn only while the ETA is an answer.
 *
 * Words and numbers are `mission.barModel`, the tile's rules, so the bar and the tile agree to
 * the minute. Renders nothing for a final session: a finished session's screen is the recap.
 */
import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { SessionDetail } from '../data/api';
import { CreaturePrint } from '../insights/Creature';
import { GROUND, ON_HUE } from '../insights/palette';
import { Block } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { PixelAnimal } from '../pixel/PixelAnimal';
import { creatureHue, MONO_FAMILY } from '../theme';
import { T } from '../ui';
import { CLOCK_TICK_MS, sessionCreature, useNow } from './LiveSessions';
import { barModel, elapsedLabel, TILE_MAX_SCALE } from './mission';
import { Arrive, FootTrack, HarnessStamp, inked, LiveNum, PrintMask, StandaloneReveal } from './MissionTile';

/** Flighty's in-app status bar: 64pt, the height the Lock Screen layout folds into. */
export const LIVE_BAR_HEIGHT = 64;
const CREATURE = 32;
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
  const m = barModel(session, now);
  const hue = useMemo(() => creatureHue(creature), [creature]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  const current = m.kind === 'needsYou' && !m.stale;
  const moving = (animate ?? current) && !m.stale;
  // The hue means live: a bar the Mac stopped reporting on is printed on the warm dark instead.
  const fill = m.stale ? GROUND_RAISED : hue.fill;
  const text = m.stale ? GROUND_TEXT : ON_HUE;
  const dim = m.stale ? GROUND_DIM : ON_HUE;
  const trackH = m.track !== null ? TRACK : 0;

  const corner =
    m.stale || m.kind === 'needsYou' || m.kind === 'finished' || m.elapsedMin === null ? (
      <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(14, '800', m.stale ? dim : text)}>
        {m.kind === 'finished' ? 'finished' : m.corner.text}
      </T>
    ) : (
      // Labelled: this is the clock since the session started, and the hero right under the bar
      // counts ACTIVE time. FOUND IN THE FINAL CAPTURE (2026-09-13): "47m" here beside "42m
      // active so far" with nothing to say they are two clocks.
      <View style={styles.corner}>
        <LiveNum
          value={m.elapsedMin * 60}
          final={elapsedLabel(m.elapsedMin * 60)}
          figure={{ kind: 'elapsed' }}
          textStyle={inked(20, '800', text, 22)}
          delay={320}
          accessibilityLabel={`${elapsedLabel(m.elapsedMin * 60)} elapsed`}
        />
        <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(11, '700', dim, 13)}>
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
      style={[styles.bar, { backgroundColor: fill, paddingBottom: 10 + trackH }]}
    >
      <PrintMask width={box.w || 360} height={box.h || LIVE_BAR_HEIGHT * 2} delay={0} />
      <View style={styles.creature}>
        {moving ? (
          <PixelAnimal animal={creature} size={CREATURE} tone="selected" />
        ) : (
          <CreaturePrint animal={creature} size={CREATURE} color={m.stale ? hue.ink : ON_HUE} delay={200} spread={260} />
        )}
      </View>
      <Arrive delay={240} style={styles.words}>
        <View style={styles.top}>
          <HarnessStamp harness={m.harness} size={12} color={m.stale ? GROUND_TEXT : hue.ink} />
          {/* The repository in full: it wraps, it never ellipsizes. */}
          <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={[inked(13, '700', text), styles.repo]}>
            {m.repo}
          </T>
          {corner}
        </View>
        <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(15, '700', m.stale ? dim : text, 19)}>
          {m.sentence}
        </T>
        {under ? (
          <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(12, '700', dim)}>
            {under}
          </T>
        ) : null}
      </Arrive>
      {m.track !== null && box.w > 0 ? <FootTrack track={m.track} width={box.w} height={trackH} color={text} delay={360} /> : null}
    </View>
  );
}

// The warm neutrals, for a stale bar (tokens.json's dark column, through the chapter palette).
const GROUND_RAISED = GROUND.raised;
const GROUND_TEXT = GROUND.text;
const GROUND_DIM = GROUND.dim;

const styles = StyleSheet.create({
  bar: {
    minHeight: LIVE_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    overflow: 'hidden',
  },
  creature: { width: CREATURE, height: CREATURE, marginTop: 2 },
  words: { flex: 1, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repo: { flex: 1, fontFamily: MONO_FAMILY },
  corner: { alignItems: 'flex-end' },
});
