/**
 * The page's typography and small parts: figures set large as graphics, the ledger (a big
 * number followed by what it counts, like a line of print, never a grid of stats with grey
 * labels under them), captions, refusals, and the hairline.
 *
 * Type is the system's (SF Pro, SF Mono for machine words), heavy against light: numbers at 800,
 * words at 400 to 600, and every figure tabular so a count does not jitter.
 */
import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { keepDots } from '../copy/plain';
import { MONO_FAMILY } from '../theme';
import { fitSize, type NumSpec } from './format';
import { COUNT_MS, ease, phase, STAGGER_MS } from './motion';
import { Num } from './Num';
import { GROUND, ON_HUE } from './palette';
import { useClock } from './reveal';

/** The page gutter. */
export const GUTTER = 20;

/** A figure as a graphic: heavy, tight, tabular. */
export function figure(size: number, color: string, weight: TextStyle['fontWeight'] = '800'): TextStyle {
  return {
    fontSize: size,
    lineHeight: Math.round(size * 1.08),
    fontWeight: weight,
    letterSpacing: -Math.round(size * 0.035 * 10) / 10,
    color,
    fontVariant: ['tabular-nums'],
  };
}

export const type = StyleSheet.create({
  bandCaption: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2, color: ON_HUE },
  bandNote: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: ON_HUE, opacity: 0.8 },
  heading: { fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.3, color: GROUND.text },
  lead: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2, color: GROUND.text },
  body: { fontSize: 17, lineHeight: 23, fontWeight: '400', letterSpacing: -0.2, color: GROUND.text },
  dim: { fontSize: 15, lineHeight: 20, fontWeight: '400', color: GROUND.dim },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: GROUND.dim },
  label: { fontSize: 12, lineHeight: 15, fontWeight: '600', letterSpacing: 0.2, color: GROUND.dim },
  mono: { fontFamily: MONO_FAMILY, fontSize: 13, lineHeight: 17, fontWeight: '500', color: GROUND.dim },
});

/** Words on the ground, scaled with Dynamic Type up to 1.6x. */
export function Words({ style, children, lines }: { style: StyleProp<TextStyle>; children: ReactNode; lines?: number }) {
  return (
    <Text maxFontSizeMultiplier={1.6} numberOfLines={lines} style={style}>
      {/* A wrapped line never starts with the dot between two facts (`copy/plain.keepDots`). */}
      {keepDots(children)}
    </Text>
  );
}

/**
 * The one big number of a band, sized to fit its width. It fades in as the band's pixels land
 * (a dark figure over the ground before its band has printed would be a smudge), then counts.
 */
export function BandFigure({ spec, width, max = 96, min = 48, delay = 180, color = ON_HUE, label }: { spec: NumSpec; width: number; max?: number; min?: number; delay?: number; color?: string; label?: string }) {
  const size = fitSize(spec.final, width, max, min);
  const clock = useClock();
  const fade = useAnimatedStyle(() => ({ opacity: ease(phase(clock.value, Math.max(0, delay - 160), 260)) }));
  return (
    <Animated.View style={fade}>
      <Num spec={spec} textStyle={figure(size, color)} delay={delay} accessibilityLabel={label} />
    </Animated.View>
  );
}

export interface LedgerItem {
  key: string;
  num: NumSpec;
  label: string;
  note?: string | null;
  /** This line's figure in its own ink (lines added in green, removed in red). Default: the ledger's. */
  color?: string;
  /** Set this string still instead of counting (a masked dollar, `$•••`): no digit ever shows. */
  shown?: string;
}

/**
 * Numbers set as lines of print: "74.5 hours with you there". The figure in the section's ink,
 * what it counts beside it in text, and one quiet line under it when there is one.
 */
export function Ledger({ items, color, size = 44, delay = 0 }: { items: readonly LedgerItem[]; color: string; size?: number; delay?: number }) {
  if (!items.length) return null;
  return (
    <View>
      {items.map((it, i) => (
        <View key={it.key} style={[styles.ledgerRow, i > 0 ? styles.hairTop : null]}>
          <View style={styles.ledgerLine}>
            {it.shown !== undefined ? (
              <Text allowFontScaling={false} style={figure(size, it.color ?? color)}>
                {it.shown}
              </Text>
            ) : (
              <Num spec={it.num} textStyle={figure(size, it.color ?? color)} delay={delay + i * STAGGER_MS * 2} duration={COUNT_MS} />
            )}
            <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.ledgerLabel]}>
              {it.label}
            </Text>
          </View>
          {it.note ? <Words style={type.dim}>{it.note}</Words> : null}
        </View>
      ))}
    </View>
  );
}

/** A refusal: why there is nothing to draw, in a sentence. Never a zero, never a dash. */
export function Refusal({ children, onHue = false }: { children: ReactNode; onHue?: boolean }) {
  return (
    <View style={styles.refusal}>
      <View style={[styles.refusalMark, { backgroundColor: onHue ? ON_HUE : GROUND.faint }]} />
      <Text maxFontSizeMultiplier={1.6} style={[onHue ? type.bandNote : type.dim, styles.refusalText]}>
        {children}
      </Text>
    </View>
  );
}

/** A small lower case label over a chart: what the chart is, in two or three words. */
export function Kicker({ children, color = GROUND.dim }: { children: ReactNode; color?: string }) {
  return (
    <Text allowFontScaling={false} style={[type.label, { color, marginBottom: 10 }]}>
      {children}
    </Text>
  );
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.hairline, style]} />;
}

/** A square key for a chart's legend: a mark, not a chip. */
export function Swatch({ color, size = 10, hollow = false }: { color: string; size?: number; hollow?: boolean }) {
  return (
    <View
      style={
        hollow
          ? { width: size, height: size, borderWidth: 1.5, borderColor: color }
          : { width: size, height: size, backgroundColor: color }
      }
    />
  );
}

const styles = StyleSheet.create({
  ledgerRow: { paddingVertical: 12, gap: 2 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  ledgerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  ledgerLabel: { flexShrink: 1 },
  refusal: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  refusalMark: { width: 3, alignSelf: 'stretch', marginVertical: 2 },
  refusalText: { flex: 1 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: GROUND.border },
});
