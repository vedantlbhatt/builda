/**
 * Bars that grow from nothing to their value when their block plays, with a spring's small
 * give (`motion.spring`: about 4% past, settled by the end), then stand still. Each is a view
 * scaled on the UI thread from its left edge (or from a centre line, for the diff), so a bar
 * costs one animated style and no layout per frame.
 *
 * A share that is not zero is never drawn as nothing: the smallest segment keeps a two point
 * mark, the way `src/ui/Bar.tsx` keeps a floor, and the number beside it says the real value.
 */
import React from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { radius } from '../theme';
import { DRAW_MS, spring, phase } from './motion';
import { GROUND } from './palette';
import { useClock } from './reveal';

function pctOf(frac: number): DimensionValue {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  return `${f * 100}%`;
}

/** One segment that grows from `origin` over `duration` from `delay`. */
function Grow({
  width,
  minWidth = 0,
  color,
  height,
  delay,
  duration = DRAW_MS,
  origin = 'left',
  round = true,
}: {
  width: DimensionValue;
  minWidth?: number;
  color: string;
  height: number;
  delay: number;
  duration?: number;
  origin?: 'left' | 'right';
  round?: boolean;
}) {
  const clock = useClock();
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: spring(phase(clock.value, delay, duration)) }] }));
  return (
    <Animated.View
      style={[
        {
          width,
          minWidth,
          height,
          backgroundColor: color,
          transformOrigin: origin,
        },
        round ? styles.round : null,
        style,
      ]}
    />
  );
}

export interface GrowBarProps {
  /** 0 to 1 of the track. */
  frac: number;
  color: string;
  height?: number;
  delay?: number;
  /** Draw the track under it. Default true. */
  track?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A single meter: a hairline weight track and the value grown over it. */
export function GrowBar({ frac, color, height = 8, delay = 0, track = true, style }: GrowBarProps) {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  return (
    <View style={[{ height, justifyContent: 'center' }, style]}>
      {track ? <View style={[styles.track, { height: Math.max(1, Math.round(height / 4)) }]} /> : null}
      <View style={StyleSheet.absoluteFill}>
        {f > 0 ? <Grow width={pctOf(f)} minWidth={2} color={color} height={height} delay={delay} /> : null}
      </View>
    </View>
  );
}

/**
 * Lines added and removed as one diff bar: the split sits where removed ends and added begins,
 * red grows left from it and green grows right, both at once, so the bar reads as a single
 * change of `added + removed` lines.
 */
export function DiffBar({ addedShare, add, del, height = 18, delay = 0 }: { addedShare: number; add: string; del: string; height?: number; delay?: number }) {
  const a = Math.min(1, Math.max(0, addedShare));
  const r = 1 - a;
  return (
    <View style={{ height, flexDirection: 'row', alignItems: 'center' }}>
      {r > 0 ? (
        <View style={{ width: pctOf(r), minWidth: 3, height, alignItems: 'flex-end' }}>
          <Grow width="100%" color={del} height={height} delay={delay} origin="right" round={false} />
        </View>
      ) : null}
      <View style={[styles.split, { height: height + 10 }]} />
      {a > 0 ? (
        <View style={{ flex: 1, height }}>
          <Grow width="100%" color={add} height={height} delay={delay} origin="left" round={false} />
        </View>
      ) : null}
    </View>
  );
}

export interface Segment {
  key: string;
  value: number;
  color: string;
}

/**
 * Parts of one whole, left to right, each growing in turn: the languages, the commits split by
 * who was in the room, the token buckets. A segment with any value keeps a two point mark.
 */
export function StackBar({ segments, height = 14, delay = 0, step = 110, gap = 2 }: { segments: readonly Segment[]; height?: number; delay?: number; step?: number; gap?: number }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  return (
    <View style={{ height, flexDirection: 'row', gap }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <View key={s.key} style={{ flexGrow: s.value / total, flexBasis: 0, minWidth: 2, height }}>
            <Grow width="100%" color={s.color} height={height} delay={delay + i * step} duration={700} round={false} />
          </View>
        ))}
    </View>
  );
}

/**
 * An archetype rule against its bar: the track is two bars long, a tick marks the bar at its
 * middle, and the fill is the rule's score (value over the bar, capped at two, halved), so past
 * the tick is past the bar. The winner and the runners up share one geometry.
 */
export function RuleTrack({ score, color, height = 10, delay = 0, tick }: { score: number; color: string; height?: number; delay?: number; tick: string }) {
  return (
    <View style={{ height: height + 8, justifyContent: 'center' }}>
      <View style={[styles.track, { height: 2 }]} />
      <View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]}>
        <Grow width={pctOf(score)} minWidth={2} color={color} height={height} delay={delay} />
      </View>
      <View style={[styles.tick, { backgroundColor: tick, height: height + 8 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: GROUND.border, borderRadius: radius.pill, borderCurve: 'continuous' },
  round: { borderRadius: radius.pill, borderCurve: 'continuous' },
  split: { width: 2, marginHorizontal: 2, backgroundColor: GROUND.text, borderRadius: 1, borderCurve: 'continuous' },
  tick: { position: 'absolute', left: '50%', width: 2, marginLeft: -1, borderRadius: 1, borderCurve: 'continuous' },
});
