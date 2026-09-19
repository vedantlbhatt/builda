/**
 * The wall's own chrome: its large title with the line under it, a band's heading, and the fade
 * that keeps the clock on the ground when the posters scroll under the status bar.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { tokens } from '../../generated/tokens';
import { LARGE_TITLE } from '../../nav/chrome';
import { BlurText } from '../../ui/bits/text/BlurText';
import { T } from '../../ui/Text';

const S = tokens.surface;
export const GUTTER = 16;

/** The platform's large title, left on the gutter, and what the wall holds, in words. */
export function WallHeader({ line }: { line: string }) {
  return (
    <View style={styles.head}>
      <BlurText text="Drops" textStyle={LARGE_TITLE} color={S.text.dark} numberOfLines={1} maxFontSizeMultiplier={1.5} accessibilityRole="header" delay={90} />
      {line ? (
        <T role="body" style={{ color: S.textDim.dark, marginTop: 2 }}>
          {line}
        </T>
      ) : null}
    </View>
  );
}

/** A band of the wall: a heading in sentence case and what is in it. */
export function WallBand({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.band}>
      <T role="headline" style={{ color: S.textDim.dark, marginBottom: 10 }}>
        {title}
      </T>
      {children}
    </View>
  );
}

/** The ground colour fading out below the status bar. */
export function TopFade({ height }: { height: number }) {
  const bg = S.bg.dark;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height }}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="wallTopFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={bg} stopOpacity={1} />
            <Stop offset="0.72" stopColor={bg} stopOpacity={0.94} />
            <Stop offset="1" stopColor={bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#wallTopFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingTop: 10 },
  band: { marginTop: 26, paddingHorizontal: GUTTER },
});
