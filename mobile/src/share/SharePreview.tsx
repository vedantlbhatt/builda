/**
 * A card you are about to post, previewed over everything (`ui/overlay.tsx`) before it goes: it pops
 * on the island's small spring over a dark scrim, with Share and Close under it. Share captures the
 * card view at 3x (a 360 x 450 point card is 1080 x 1350, the 4:5 Instagram and LinkedIn show whole)
 * and hands the PNG to the system share sheet, so it goes to any app.
 *
 * Used by the drop pair card (`drops/wall/PairShare.tsx`) and the week card (`share/WeekShare.tsx`).
 * It lives beside the cards, outside the UI kit: a share card is an image of fixed size, so its
 * sizes are literal on purpose, and the kit's token laws are for screens that scale. The card itself is the caller's: a fixed size view, so the image is the
 * same on every phone.
 */
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../generated/tokens';
import { SPRING } from '../motion';
import { commit, select } from '../ui/haptics';
import { overlay } from '../ui/overlay';

const S = tokens.surface;

/** Show `card` in a share preview. `title` is the share sheet's title where the platform shows one. */
export function showSharePreview(card: ReactNode, title: string): void {
  overlay.show((hide) => <SharePreview title={title} onClose={hide}>{card}</SharePreview>, { closeOnNavigate: true });
}

function SharePreview({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const card = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const p = useSharedValue(0);
  const scrim = useSharedValue(0);

  useEffect(() => {
    scrim.value = withTiming(1, { duration: 200 });
    p.value = withSpring(1, SPRING.pop);
  }, [p, scrim]);

  const close = () => {
    scrim.value = withTiming(0, { duration: 120 });
    p.value = withTiming(0, { duration: 120 });
    setTimeout(onClose, 130);
  };
  // Esc on a desktop closes it the same way (`ui/overlay.tsx` dismiss); nothing calls it on a phone.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => overlay.onDismiss(() => closeRef.current()), []);

  const share = async () => {
    if (!card.current || busy) return;
    setBusy(true);
    commit();
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile', ...(Platform.OS === 'ios' ? { pixelRatio: 3 } : {}) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
      }
    } finally {
      setBusy(false);
    }
  };

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.4), transform: [{ scale: interpolate(p.value, [0, 1], [0.9, 1]) }] }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={close} />
      </Animated.View>
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]} pointerEvents="box-none">
        <Animated.View style={cardStyle}>
          <View ref={card} collapsable={false}>
            {children}
          </View>
        </Animated.View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => void share()} style={({ pressed }) => [styles.share, pressed && { backgroundColor: S.accentPressed.dark }]}>
            <Text style={styles.shareText}>{busy ? 'Getting it ready' : 'Share'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              select();
              close();
            }}
          >
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(8,7,6,0.82)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 22 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  share: { height: 48, paddingHorizontal: 34, borderRadius: 24, borderCurve: 'continuous', backgroundColor: S.accent.dark, alignItems: 'center', justifyContent: 'center' },
  shareText: { color: S.text.light, fontSize: 17, fontWeight: '700' },
  close: { color: S.textDim.dark, fontSize: 17, fontWeight: '600' },
});
