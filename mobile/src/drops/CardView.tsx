/**
 * One drop, as its own frame.
 *
 * The thumbnail the PLATFORM published, never a frame Builda pulled out of a video it did not
 * download, and never a generated glyph: a mark grown from a URL tells you nothing about the
 * post, and a board of them is a board you cannot read. This is the picture you recognise.
 *
 * WHAT IS DRAWN ON IT, and nothing else. A hairline of the kind's hue along the bottom edge, which
 * is the whole of the colour coding: no chip, no pale fill, no label in the same hue as its own
 * border. The title sits in a solid scrim band (a flat fill at low alpha, not a gradient) so it
 * reads over any frame. A drop the Mac has not read yet is dimmed and says so in mono. A drop with
 * something running takes an amber hairline, which is what amber means everywhere else in this app.
 *
 * NO THUMBNAIL is not a failure state to decorate. Instagram publishes none to anyone
 * (docs/drops.md), so that card is the ground with the host and the platform set in mono, and it
 * reads as what it is: a link nobody could look inside.
 */
import { Image } from 'expo-image';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { dropHue } from '../theme';
import { T } from '../ui/Text';
import { useColors } from '../ui/scheme';
import { CARD_H, CARD_RADIUS, CARD_W } from './card';
import { PLATFORM_WORD } from './copy';
import type { DropRow } from './types';

export interface CardProps {
  drop: DropRow;
  /** Something of this drop's is queued or running. */
  busy?: boolean;
  /** 1 at the front of a stack, lower behind it. */
  dim?: number;
  /** Multiplies the resting size. */
  scale?: number;
  /** Draw the title band. Off for the cards behind a stack's top one. */
  words?: boolean;
}

export function hostOf(url: string): string {
  const m = /^https:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

export function DropCard({ drop, busy = false, dim = 1, scale = 1, words = true }: CardProps) {
  const c = useColors();
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const unread = drop.status === 'waiting' || drop.status === 'resolving';
  const w = CARD_W * scale;
  const h = CARD_H * scale;

  return (
    <View
      style={[
        styles.card,
        {
          width: w,
          height: h,
          borderRadius: CARD_RADIUS * scale,
          backgroundColor: c.raised,
          borderColor: busy ? c.accent : c.border,
          opacity: dim,
        },
      ]}
    >
      {drop.thumbnail_url ? (
        <Image
          source={{ uri: drop.thumbnail_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blank]}>
          <T role="mono" numberOfLines={2} style={{ color: c.textFaint, textAlign: 'center' }}>
            {hostOf(drop.url)}
          </T>
          <T role="mono" style={{ color: c.textFaint, marginTop: 4 }}>
            {PLATFORM_WORD[drop.platform]}
          </T>
        </View>
      )}

      {/* A drop nobody has read yet is behind a scrim and says so, rather than looking finished. */}
      {unread ? (
        <View style={[StyleSheet.absoluteFill, styles.unread]}>
          <T role="mono" style={{ color: c.text }}>
            {drop.status === 'resolving' ? 'reading' : 'waiting'}
          </T>
          <Sweep width={w} ink={c.accent} />
        </View>
      ) : null}

      {words && drop.title ? (
        <View style={styles.band}>
          <T role="meta" numberOfLines={2} style={styles.bandText}>
            {drop.title}
          </T>
        </View>
      ) : null}

      {/* The kind, as a hairline on the edge. The whole of the colour coding. */}
      {hue ? (
        <View style={[styles.kind, { backgroundColor: hue.ink, height: Math.max(2, 3 * scale) }]} />
      ) : null}
    </View>
  );
}

/**
 * The card is being read, said as motion rather than as a spinner.
 *
 * A short rule crossing the bottom edge, on the same line the kind's hairline will take once the
 * Mac knows what this is: the placeholder and the answer occupy the same millimetre, so the card
 * settles instead of rearranging. A spinner would be a borrowed shape, and a percentage would be
 * a lie — nothing here knows how long a page takes to read.
 */
function Sweep({ width, ink }: { width: number; ink: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [t]);
  const run = Math.max(18, width * 0.34);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-run, width]) }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.sweep, { width: run, backgroundColor: ink }, style]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
  },
  blank: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  // A flat fill at low alpha, not a gradient: the app has a rule against them and a solid band
  // reads the same over a bright frame and a dark one.
  unread: {
    backgroundColor: 'rgba(20,18,16,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 9,
    backgroundColor: 'rgba(15,13,11,0.82)',
  },
  bandText: { color: '#F5F1EA', lineHeight: 15 },
  kind: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sweep: { position: 'absolute', left: 0, bottom: 0, height: 2 },
});
