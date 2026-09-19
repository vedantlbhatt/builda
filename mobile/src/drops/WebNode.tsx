/**
 * One drop, as a node on the web: the frame the platform published, and nothing else on it.
 *
 * NO TITLE BAND, no chip, no label. The pile cards this replaced carried their title because a
 * pile was read one card at a time; a web is read as a shape, and forty little captions is the
 * noise that stops you seeing the shape. You recognise the post, and the sheet has the words.
 *
 * The kind is one hairline along the bottom edge, which is the whole of the colour coding. A drop
 * the Mac has not read yet is dimmed with a rule sweeping that same edge; a drop with something
 * running wears amber, which is what amber means everywhere in this app.
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
import { NODE_H, NODE_W } from './force';
import type { DropRow } from './types';

export const NODE_RADIUS = 9;

export function hostOf(url: string): string {
  const m = /^https:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

export function WebNode({ drop, busy, held }: { drop: DropRow; busy: boolean; held?: boolean }) {
  const c = useColors();
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const unread = drop.status === 'waiting' || drop.status === 'resolving';

  return (
    <View
      style={[
        styles.node,
        {
          backgroundColor: c.raised,
          borderColor: busy ? c.accent : held ? c.text : c.border,
          borderWidth: held || busy ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {drop.thumbnail_url ? (
        <Image
          source={{ uri: drop.thumbnail_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.blank]}>
          <T role="mono" numberOfLines={2} style={{ color: c.textFaint, fontSize: 8, textAlign: 'center' }}>
            {hostOf(drop.url)}
          </T>
        </View>
      )}

      {unread ? (
        <View style={[StyleSheet.absoluteFill, styles.unread]}>
          <Sweep ink={c.accent} />
        </View>
      ) : null}

      {hue ? <View style={[styles.kind, { backgroundColor: hue.ink }]} /> : null}
    </View>
  );
}

/** Being read, said as motion on the edge the kind will take once the Mac knows what this is. */
function Sweep({ ink }: { ink: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [t]);
  const run = NODE_W * 0.4;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-run, NODE_W]) }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.sweep, { width: run, backgroundColor: ink }, style]} />;
}

const styles = StyleSheet.create({
  node: {
    width: NODE_W,
    height: NODE_H,
    borderRadius: NODE_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  blank: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unread: { backgroundColor: 'rgba(20,18,16,0.68)' },
  kind: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5 },
  sweep: { position: 'absolute', left: 0, bottom: 0, height: 2 },
});
