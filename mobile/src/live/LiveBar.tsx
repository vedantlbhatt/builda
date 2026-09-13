import { useIsFocused } from '@react-navigation/native';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { SessionDetail } from '../data/api';
import type { Animal } from '../pixel/animals';
import { PixelAnimal, PixelAnimalIcon } from '../pixel/PixelAnimal';
import { layout, space } from '../theme';
import { Ring, Surface, T } from '../ui';
import { CLOCK_TICK_MS, useCreature, useNow } from './LiveSessions';
import { barModel } from './mission';

/** Flighty's in-app status bar: 64pt, the height the Lock Screen layout folds into. */
export const LIVE_BAR_HEIGHT = 64;
const CREATURE = 32;
const RING = 36;

export interface LiveBarProps {
  /** A session from `GET /v1/sessions/{id}` (the full live state) or a live list row (the slim one). */
  session: SessionDetail;
  /** Default the builder's own creature, the one on their Lock Screen. */
  creature?: Animal;
  /**
   * Whether this bar's creature may move. Default: only while the session needs you. A screen
   * with another moving creature passes false (one animating creature per screen).
   */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The live bar at the top of a RUNNING session's screen (DESIGN-DIRECTION 7.1): the Lock Screen
 * card folded into 64pt, so the session looks the same on both surfaces (Flighty's
 * cross-surface rule). Left, the creature; then the repo and the elapsed time (or "needs you" in
 * amber in its place) over the one sentence; right, the ring: elapsed over typical, the minutes
 * left inside it while on track, a dotted track when there is no ETA yet, an empty track while
 * it waits on you. Words and numbers are `mission.barModel`, the tile's rules.
 *
 * Renders nothing for a final session: a finished session's screen is the recap, not a bar.
 */
export function LiveBar({ session, creature, animate, style }: LiveBarProps) {
  const focused = useIsFocused();
  const now = useNow(CLOCK_TICK_MS, focused);
  const own = useCreature();
  if (session.state !== 'live') return null;

  const m = barModel(session, now);
  const moving = animate ?? (m.kind === 'needsYou' && !m.stale);
  const animal = creature ?? own;
  const tone = m.kind === 'needsYou' && !m.stale ? 'rest' : m.dim ? 'faint' : 'idle';

  return (
    <Surface
      padding={0}
      style={[styles.bar, style]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={m.label}
      testID="live-bar"
    >
      {moving ? (
        <PixelAnimal animal={animal} size={CREATURE} tone="rest" />
      ) : (
        <PixelAnimalIcon animal={animal} size={CREATURE} tone={tone} />
      )}
      <View style={styles.text}>
        <View style={styles.top}>
          <T role="mono" numberOfLines={1} ellipsizeMode="middle" style={styles.repo}>
            {m.repo}
          </T>
          <T role="meta" tone={m.corner.tone} weight={m.corner.weight} numberOfLines={1}>
            {m.corner.text}
          </T>
        </View>
        <T role="meta" weight={600} tone={m.dim ? 'dim' : 'text'} numberOfLines={2}>
          {m.sentence}
        </T>
      </View>
      <Ring progress={m.progress} size={RING} accessibilityLabel={m.ringLabel}>
        {m.inner ? (
          <T role="label" tone="text">
            {m.inner}
          </T>
        ) : null}
      </Ring>
    </Surface>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: LIVE_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tile,
    paddingHorizontal: layout.liveActivityPad,
    paddingVertical: space.xs,
  },
  text: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  repo: { flexShrink: 1 },
});
