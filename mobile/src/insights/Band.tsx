/**
 * A chapter's colour world: a card in the chapter's hue, words and the one big number in dark
 * ink on it.
 *
 * WHAT THIS REPLACED (docs/motion.md, "Why the app looked the same everywhere"). The band used to
 * be a full-bleed slab that printed itself in pixel by pixel through an ordered dither and
 * dissolved into the ground through a 36 point dithered fringe. Each part was good; on 52 bands
 * across 30 screens it was a template, and a template is what reads as generated. The pixel print
 * and the fringe are gone from every band at once, here.
 *
 * What it is now: an inset card with the island's corners, and it arrives the way the island does.
 * The hue grows DOWN from the title row on the island spring (`springAt`: the same overshoot and
 * settle as the island, as a function of the block's clock, because bands play on the reveal
 * clock rather than on a spring of their own), passing its height and coming back, and the words
 * follow it in (`BandWords`), so the colour leads and the words lag, as content lags its
 * container on the island. A second tone of the hue washes in from the far corner, so the card
 * has light in it instead of being one flat fill.
 */
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { springAt } from '../motion/spec';
import { MONO_FAMILY } from '../theme';
import { ease, phase, RISE } from './motion';
import { ON_HUE, type Hue } from './palette';
import { Block, useClock, useReducedSV } from './reveal';

/** The space under a band before whatever follows it, in points (the dithered fringe's old slot). */
export const FRINGE = 12;
/** When the words start to fade up, and how long they take. */
export const WORDS_AT = 240;
const WORDS_MS = 420;
/** The row the hue grows down from: the title's own height. */
const TITLE_ROW = 52;
/** The card's corners: the island's expanded radius, less the 8 point inset. */
export const BAND_RADIUS = 28;

/** The hue, growing down from the title row on the island spring. */
function BandGround({ height, hue }: { height: number; hue: Hue }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const grow = useAnimatedStyle(() => {
    if (height <= 0) return { height: 0 };
    const p = reduced.value ? 1 : springAt(clock.value);
    return { height: Math.max(0, TITLE_ROW + (height - TITLE_ROW) * p), opacity: reduced.value ? 1 : Math.min(1, clock.value / 90) };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.ground, { backgroundColor: hue.ink }, grow]}>
      <Svg width="100%" height={Math.max(1, height)} preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`band${hue.ink.slice(1)}`} x1="1" y1="1" x2="0.2" y2="0">
            <Stop offset="0" stopColor={hue.partner} stopOpacity={0.55} />
            <Stop offset="0.6" stopColor={hue.partner} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#band${hue.ink.slice(1)})`} />
      </Svg>
    </Animated.View>
  );
}

/** The words on a band fade up after its colour lands. */
export function BandWords({ children, delay = WORDS_AT }: { children: ReactNode; delay?: number }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const style = useAnimatedStyle(() => {
    const p = ease(phase(clock.value, delay, WORDS_MS));
    return { opacity: p, transform: [{ translateY: reduced.value ? 0 : (1 - p) * RISE }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

export interface BandProps {
  hue: Hue;
  /** "02". Left out on a page whose chapters are not numbered. */
  index?: string;
  /** "Time". */
  title: string;
  children: ReactNode;
  /**
   * A doorway: the whole band opens a page, and an arrow at the end of its title says so. The
   * house style's navigation is words and bands, never a row with a chevron.
   */
  onPress?: () => void;
  /** What VoiceOver reads for a doorway band: where it goes and the number on it. */
  accessibilityLabel?: string;
}

export function Band({ hue, index, title, children, onPress, accessibilityLabel }: BandProps) {
  const [h, setH] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setH((v) => (Math.abs(v - next) < 0.5 ? v : next));
  }, []);
  const body = (
    <View style={styles.outer}>
      <BandGround height={h} hue={hue} />
      <View onLayout={onLayout} style={styles.band}>
        <BandWords>
          <View style={styles.head} accessibilityRole={onPress ? undefined : 'header'}>
            {index ? (
              <Text allowFontScaling={false} style={styles.index}>
                {index}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={1.4} style={[styles.title, onPress ? styles.titleDoor : null]}>
              {title}
            </Text>
            {onPress ? <SymbolView name="arrow.right" tintColor={ON_HUE} weight="bold" size={18} style={styles.arrow} /> : null}
          </View>
        </BandWords>
        {children}
      </View>
      <View style={{ height: FRINGE }} />
    </View>
  );
  return (
    <Block enter={false}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="link"
          accessibilityLabel={accessibilityLabel ?? title}
          // A press settles the card a hair smaller. Scale, not opacity: a hue at partial opacity
          // over the warm ground reads brown.
          style={({ pressed }) => ({ transform: [{ scale: pressed ? PRESSED_SCALE : 1 }] })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Block>
  );
}

/** How far a doorway band gives under a press. */
const PRESSED_SCALE = 0.985;

const styles = StyleSheet.create({
  // 8 in from each edge with 12 of padding: the words sit 20 in, where the full-bleed band put
  // them, so every figure fitted to `width - 2 * GUTTER` still fits.
  outer: { marginHorizontal: 8 },
  ground: { position: 'absolute', left: 0, right: 0, top: 0, borderRadius: BAND_RADIUS, borderCurve: 'continuous', overflow: 'hidden' },
  band: { paddingHorizontal: 12, paddingTop: 22, paddingBottom: 22, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 4 },
  index: { fontFamily: MONO_FAMILY, fontSize: 13, fontWeight: '600', color: ON_HUE, opacity: 0.62, fontVariant: ['tabular-nums'] },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1, color: ON_HUE },
  titleDoor: { flex: 1 },
  arrow: { width: 18, height: 18, alignSelf: 'center' },
});
