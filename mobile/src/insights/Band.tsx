/**
 * A chapter's colour world: a full bleed band in the chapter's hue, words and the one big
 * number in dark ink on it, and under it a dissolve where the hue breaks up into the warm dark
 * ground through the app's 1-bit ordered dither. No gradient: every point is ink or ground.
 *
 * It PRINTS ITSELF when its block plays: the band's cells switch on in a random order biased
 * top to bottom over about half a second (react-bits PixelTransition's rule), the dissolve with
 * them, then the words fade up. After that it is still.
 *
 * The dither is the kit's (8x8 Bayer by arithmetic, from react-bits Dither and PixelBlast by
 * David Haz, MIT + Commons Clause; the notice is in `src/ui/digits.ts`; used as part of this
 * application, not redistributed). What is new here is the density: 1 across the band, falling
 * to 0 over the dissolve, and the arrival order.
 */
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { MONO_FAMILY } from '../theme';
import { ease, phase, RISE } from './motion';
import { ON_HUE, type Hue } from './palette';
import { Block, useClock, useReducedSV } from './reveal';

const BAND_SKSL = `
uniform float cell;
uniform float solid;
uniform float fringe;
uniform float reveal;
uniform half4 ink;

float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }
float hash(float2 c) { return fract(sin(dot(c, float2(12.9898, 78.233))) * 43758.5453); }

half4 main(float2 p) {
  float2 c = floor(p / cell);
  float y = (c.y + 0.5) * cell;
  float total = solid + fringe;
  float d = y < solid ? 1.0 : clamp(1.0 - (y - solid) / fringe, 0.0, 1.0);
  if (d <= 0.0) { return half4(0.0); }
  float on = b8(p / cell) < d * 0.999 ? 1.0 : 0.0;
  float order = hash(c) * 0.55 + (y / total) * 0.45;
  float arrived = order < reveal * 1.02 ? 1.0 : 0.0;
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
/** How long the band takes to print. */
const PRINT_MS = 560;
/** When the words start to fade up, and how long they take. */
export const WORDS_AT = 240;
const WORDS_MS = 420;

function rgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

function BandPixels({ width, solid, ink }: { width: number; solid: number; ink: string }) {
  const clock = useClock();
  const source = bandEffect();
  const inkU = rgba(ink);
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    solid,
    fringe: FRINGE,
    reveal: ease(phase(clock.value, 0, PRINT_MS)),
    ink: inkU,
  }));
  const height = solid + FRINGE;
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
  /** "02". */
  index: string;
  /** "Time". */
  title: string;
  children: ReactNode;
}

export function Band({ hue, index, title, children }: BandProps) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);
  return (
    <Block enter={false}>
      <View>
        <BandPixels width={box.w} solid={box.h} ink={hue.ink} />
        <View onLayout={onLayout} style={styles.band}>
          <BandWords>
            <View style={styles.head} accessibilityRole="header">
              <Text allowFontScaling={false} style={styles.index}>
                {index}
              </Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.title}>
                {title}
              </Text>
            </View>
          </BandWords>
          {children}
        </View>
        <View style={{ height: FRINGE }} />
      </View>
    </Block>
  );
}

const styles = StyleSheet.create({
  pixels: { position: 'absolute', left: 0, top: 0 },
  band: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 22, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 4 },
  index: { fontFamily: MONO_FAMILY, fontSize: 13, fontWeight: '600', color: ON_HUE, opacity: 0.62, fontVariant: ['tabular-nums'] },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1, color: ON_HUE },
});
