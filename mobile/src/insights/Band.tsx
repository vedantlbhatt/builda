/**
 * A chapter's colour world: a full bleed band in the chapter's hue, words and the one big
 * number in dark ink on it, and under it a dissolve where the hue breaks up into the warm dark
 * ground through the app's 1-bit ordered dither. No gradient: every point is ink or ground.
 *
 * It PRINTS ITSELF when its block plays, and HOW is the band's own (`motion/pixelMotion.ts`): one
 * scans in row by row, one rises column by column like a meter, one opens from the centre, one
 * lands as blocks, and so on through eight orders, picked from the band's title so a band always
 * arrives the same way, with the page handing out the next free one so no two bands of one page
 * share an order. The print used to be one order everywhere (random cells biased downwards), and 52 bands
 * arriving identically across 30 screens was the sameness, not the pixels. Then the words fade
 * up, and the band is still.
 *
 * The dither is the kit's (8x8 Bayer by arithmetic, from react-bits Dither and PixelBlast by
 * David Haz, MIT + Commons Clause; the notice is in `src/ui/digits.ts`; used as part of this
 * application, not redistributed). What is new here is the density: 1 across the band, falling
 * to 0 over the dissolve, and the arrival orders.
 */
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { morphOpen } from '../motion/MorphNav';
import { modeOf, motionFor, orderSksl, PIXEL_MOTIONS, type PixelMotion } from '../motion/pixelMotion';
import { MONO_FAMILY } from '../theme';
import { ease, phase, RISE } from './motion';
import { GROUND, ON_HUE, type Hue } from './palette';
import { Block, useClock, useOptionalClock, useOptionalReducedSV, usePageOrder, useReducedSV } from './reveal';

/**
 * The orders are `pixelMotion.orderSksl` over this `hash` (`pixelMotion.cellHash` with seed 0 in
 * JS), so a band and a JS print that share an order scatter alike.
 */
const BAND_SKSL = `
uniform float cell;
uniform float solid;
uniform float fringe;
uniform float reveal;
uniform float mode;
uniform float cols;
uniform float rows;
uniform float2 origin;
uniform half4 ink;

float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }
float hash(float2 c) { return fract(sin(dot(c, float2(12.9898, 78.233))) * 43758.5453); }

${orderSksl('hash')}

half4 main(float2 p) {
  float2 c = floor(p / cell);
  float y = (c.y + 0.5) * cell;
  float d = y < solid ? 1.0 : clamp(1.0 - (y - solid) / fringe, 0.0, 1.0);
  if (d <= 0.0) { return half4(0.0); }
  float on = b8(p / cell) < d * 0.999 ? 1.0 : 0.0;
  float arrived = clamp(orderOf(c, mode, cols, rows, origin), 0.0, 1.0) < reveal * 1.02 ? 1.0 : 0.0;
  return ink * half(on * arrived);
}
`;

let effect: SkRuntimeEffect | null | undefined;
function bandEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(BAND_SKSL);
    if (!effect && __DEV__) console.warn('[insights/Band] the band shader did not compile; bands draw flat');
  }
  return effect;
}

/** The dissolve under the band, in points. */
export const FRINGE = 36;
/** One dither cell, in points (tokens.dither.cell): whole device pixels at @2x and @3x. */
const CELL = 3;
/**
 * How long the band takes to print. 620 ms, a touch over the old 560: the orders that sweep
 * (scan, wipe, rise) read as a movement across the band and need the extra beat to be seen as
 * one; the random ones look the same at either length.
 */
const PRINT_MS = 620;
/** When the words start to fade up, and how long they take. */
export const WORDS_AT = 280;
const WORDS_MS = 420;

function rgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export function BandPixels({
  width,
  solid,
  ink,
  motion,
  origin,
  fringe = FRINGE,
  delay = 0,
}: {
  width: number;
  solid: number;
  ink: string;
  motion: PixelMotion;
  origin?: { x: number; y: number };
  /** The dissolve under it; 0 for a block that ends square (a tile). */
  fringe?: number;
  /** When the print starts on the block's clock. */
  delay?: number;
}) {
  // Outside a block (a share card being captured) there is no clock, and it is drawn printed.
  const clock = useOptionalClock();
  const reduced = useOptionalReducedSV();
  const source = bandEffect();
  const inkU = rgba(ink);
  const height = solid + fringe;
  const mode = modeOf(motion);
  const cols = Math.max(1, Math.ceil(width / CELL));
  const rows = Math.max(1, Math.ceil(height / CELL));
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    solid,
    fringe: Math.max(0.001, fringe),
    reveal: !clock || !reduced || reduced.value ? 1 : ease(phase(clock.value, delay, PRINT_MS)),
    mode,
    cols,
    rows,
    origin: [ox, oy],
    ink: inkU,
  }));
  if (!source || width <= 0 || solid <= 0) {
    return <View style={[styles.pixels, { width, height: solid, backgroundColor: ink }]} />;
  }
  return (
    <View pointerEvents="none" style={[styles.pixels, { width, height }]}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </View>
  );
}

/** The words on a band fade up after its pixels land. */
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
  /**
   * A doorway to a route: the band itself grows into the page it opens (`motion/MorphNav.tsx`),
   * in its own hue, instead of the page sliding in beside it. Wins over `onPress`.
   */
  href?: string;
  /** How it prints. Default: its own, from its title (`pixelMotion.motionFor`). */
  motion?: PixelMotion;
  /** What VoiceOver reads for a doorway band: where it goes and the number on it. */
  accessibilityLabel?: string;
}

export function Band({ hue, index, title, children, onPress: press, href, motion, accessibilityLabel }: BandProps) {
  const router = useRouter();
  const bandRef = useRef<View>(null);
  const mine = useMemo(() => modeOf(motion ?? motionFor(title)), [motion, title]);
  const onPage = usePageOrder(mine, PIXEL_MOTIONS.length);
  const own = motion ?? PIXEL_MOTIONS[onPage]!;
  const onPress = href
    ? () => morphOpen(bandRef.current, () => router.push(`${href}${href.includes('?') ? '&' : '?'}morph=1` as never), { color: hue.ink, radius: 0, ground: GROUND.bg }, href)
    : press;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (Math.abs(b.w - width) < 0.5 && Math.abs(b.h - height) < 0.5 ? b : { w: width, h: height }));
  }, []);
  const body = (
    <View ref={bandRef} collapsable={false}>
      <BandPixels width={box.w} solid={box.h} ink={hue.ink} motion={own} />
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
          // A press settles the band a hair smaller, the way a printed card gives under a thumb.
          // Scale, not opacity: a hue at partial opacity over the warm ground reads brown.
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
  pixels: { position: 'absolute', left: 0, top: 0 },
  band: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 22, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 4 },
  index: { fontFamily: MONO_FAMILY, fontSize: 13, fontWeight: '600', color: ON_HUE, opacity: 0.62, fontVariant: ['tabular-nums'] },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1, color: ON_HUE },
  titleDoor: { flex: 1 },
  arrow: { width: 18, height: 18, alignSelf: 'center' },
});
