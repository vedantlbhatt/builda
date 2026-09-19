/**
 * A drop as the reel it was: 9:16, the platform's own poster frame when it published one.
 *
 * WHY NOT A GENERATED MARK. The board before this drew a pixel sigil grown from each link, and
 * a mark grown from a URL tells you nothing about the post (the note on `WebBoard`). You
 * recognise a reel by its frame, so the frame is the drop. Where the platform served no picture
 * (Instagram serves none to anybody), the poster is TYPOGRAPHIC: the post's own first words set
 * big in the kind's hue on the card ground, the way a text post looks on the platform it came
 * from. Nothing is generated and nothing pretends to be the video.
 *
 * The poster carries one line at its foot saying where the drop is in its life (the band), and
 * nothing else: the moves live on the card around it, not on the picture.
 */
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { tokens } from '../../generated/tokens';
import { Shimmer } from '../../motion';
import { dropHue } from '../../theme';
import { PLATFORM_WORD } from '../copy';
import type { DropRow } from '../types';
import { posterWords } from './model';

const S = tokens.surface;

export const POSTER_RATIO = 16 / 9;

export function Poster({
  drop,
  width,
  foot,
  footTone = 'dim',
  reading = false,
  style,
}: {
  drop: DropRow;
  width: number;
  /** The one line at the poster's foot, or null for none. */
  foot?: string | null;
  footTone?: 'dim' | 'hue' | 'add';
  /** The Mac is reading it: the foot shimmers. */
  reading?: boolean;
  style?: ViewStyle;
}) {
  const height = Math.round(width * POSTER_RATIO);
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const ink = hue?.ink ?? S.textDim.dark;
  const radius = Math.max(10, Math.round(width * 0.07));
  const small = width < 140;
  const footColor = footTone === 'hue' ? ink : footTone === 'add' ? tokens.data.add.dark : S.text.dark;
  // A TikTok poster URL is signed and expires within days, so a drop from last week answers 403
  // and drew as an empty dark card (seen on the simulator, 2 of 11). A frame that does not load
  // falls back to the words, never to nothing.
  const [failed, setFailed] = useState(false);
  const picture = drop.thumbnail_url && !failed ? drop.thumbnail_url : null;

  return (
    <View style={[{ width, height, borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: S.card.dark }, style]}>
      {picture ? (
        <>
          <Image source={{ uri: picture }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} recyclingKey={drop.id} onError={() => setFailed(true)} />
          <Shade />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.type, { padding: small ? 9 : 14 }]}>
          <Text style={[styles.platform, { fontSize: small ? 10 : 12 }]}>{PLATFORM_WORD[drop.platform] ?? drop.platform}</Text>
          <Text
            numberOfLines={small ? 5 : 6}
            style={[styles.words, { color: ink, fontSize: Math.max(13, Math.round(width * (small ? 0.105 : 0.095))), lineHeight: Math.round(Math.max(13, width * (small ? 0.105 : 0.095)) * 1.12) }]}
          >
            {posterWords(drop)}
          </Text>
        </View>
      )}
      {foot ? (
        <View style={[styles.foot, { paddingHorizontal: small ? 8 : 12, paddingBottom: small ? 7 : 11 }]}>
          {reading ? (
            <Shimmer text={foot} style={[styles.footText, { fontSize: small ? 11 : 13 }]} dim="rgba(245,241,234,0.62)" bright={S.text.dark} />
          ) : (
            <Text numberOfLines={1} style={[styles.footText, { fontSize: small ? 11 : 13, color: footColor }]}>
              {foot}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** A darkening from the foot up, so white words read over any frame the platform chose. */
function Shade() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="posterShade" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#000000" stopOpacity={0.72} />
            <Stop offset="0.38" stopColor="#000000" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#posterShade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  type: { justifyContent: 'flex-start' },
  platform: { color: S.textFaint.dark, fontWeight: '600', marginBottom: 8 },
  words: { fontWeight: '800', letterSpacing: -0.3 },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footText: { fontWeight: '600', color: S.text.dark },
});
