/**
 * The share card only Builda can make: the reel you saw beside what you built from it.
 *
 * docs/motion.md, "Drops: seen, built, shown". Every other app that reads a reel ends at a card
 * you read; a build app that saw BOTH ends can say "saw this, built this", and that pair is the
 * post a builder actually wants to make. 4:5, the size Instagram and LinkedIn feeds show whole.
 *
 * Every number on it is measured: the session's attended minutes, its commits and the lines its
 * agent wrote, from the session record when the run has become one. With no session yet it says
 * what is true ("built on my Mac with Claude Code") and no number at all. The outcome line is the
 * run's own, through the dash rule.
 *
 * It comes up as a preview over everything (`ui/overlay.tsx`), popping on the island's small
 * spring, with Share and Close under it: you see the card you are about to post before you post it.
 */
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { undash } from '../../copy/plain';
import type { SessionDetail } from '../../data/api';
import { api } from '../../data/client';
import { tokens } from '../../generated/tokens';
import { Face, SPRING } from '../../motion';
import type { Animal } from '../../pixel/animals';
import { dropHue } from '../../theme';
import { commit, select } from '../../ui/haptics';
import { overlay } from '../../ui/overlay';
import { PLATFORM_WORD } from '../copy';
import type { DropRow, MoveRow } from '../types';
import { factsLine, factsOf, posterWords } from './model';

const S = tokens.surface;
/** The card in points; captured at 3x it is 1080 x 1350. */
const CARD_W = 360;
const CARD_H = 450;

export function showPairShare(drop: DropRow, move: MoveRow, you: { animal: Animal; ink: string }): void {
  overlay.show((hide) => <Preview drop={drop} move={move} you={you} onClose={hide} />, { closeOnNavigate: true });
}

function Preview({ drop, move, you, onClose }: { drop: DropRow; move: MoveRow; you: { animal: Animal; ink: string }; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const card = useRef<View>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const p = useSharedValue(0);
  const scrim = useSharedValue(0);

  useEffect(() => {
    scrim.value = withTiming(1, { duration: 200 });
    p.value = withSpring(1, SPRING.pop);
    if (move.session_id) api.session(move.session_id).then(setSession).catch(() => {});
  }, [move.session_id, p, scrim]);

  const close = () => {
    scrim.value = withTiming(0, { duration: 120 });
    p.value = withTiming(0, { duration: 120 }, () => {});
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
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: `Saw it, built it: ${move.title}` });
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
            <PairCardImage drop={drop} move={move} session={session} you={you} />
          </View>
        </Animated.View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => void share()} style={({ pressed }) => [styles.share, pressed && { backgroundColor: S.accentPressed.dark }]}>
            <Text style={styles.shareText}>{busy ? 'Getting it ready' : 'Share'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { select(); close(); }}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** The card itself: what gets captured. Fixed size, so the image is the same on every phone. */
export function PairCardImage({ drop, move, session, you }: { drop: DropRow; move: MoveRow; session: SessionDetail | null; you: { animal: Animal; ink: string } }) {
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const facts = factsLine(factsOf(session));
  const [failed, setFailed] = useState(false);
  const poster = drop.thumbnail_url && !failed ? drop.thumbnail_url : null;
  return (
    <View style={styles.card}>
      <View style={styles.cols}>
        <View style={styles.col}>
          <Text style={styles.label}>Saw this</Text>
          <View style={styles.poster}>
            {poster ? (
              <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setFailed(true)} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.typePoster]}>
                <Text numberOfLines={6} style={[styles.typeWords, { color: hue?.ink ?? S.text.dark }]}>
                  {posterWords(drop)}
                </Text>
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={styles.source}>
            {`on ${PLATFORM_WORD[drop.platform] ?? drop.platform}`}
          </Text>
        </View>
        <View style={styles.col}>
          <Text style={[styles.label, { color: tokens.data.add.dark }]}>Built this</Text>
          <View style={styles.built}>
            <Text numberOfLines={4} style={styles.builtTitle}>
              {move.title}
            </Text>
            {move.outcome ? (
              <Text numberOfLines={5} style={styles.outcome}>
                {undash(move.outcome)}
              </Text>
            ) : null}
            <View style={{ flex: 1 }} />
            <Text style={styles.facts}>{facts ?? 'on my Mac, with Claude Code'}</Text>
          </View>
        </View>
      </View>
      <View style={styles.foot}>
        <Face animal={you.animal} state="done" ink={you.ink} size={32} glow={false} alive={false} />
        <Text style={styles.brand}>Builda</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(8,7,6,0.82)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 22 },
  card: { width: CARD_W, height: CARD_H, backgroundColor: S.bg.dark, borderRadius: 28, borderCurve: 'continuous', padding: 18, overflow: 'hidden' },
  cols: { flex: 1, flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 8 },
  label: { color: S.textDim.dark, fontSize: 14, fontWeight: '700' },
  poster: { flex: 1, borderRadius: 18, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: S.card.dark },
  typePoster: { padding: 12 },
  typeWords: { fontSize: 18, lineHeight: 21, fontWeight: '800' },
  source: { color: S.textFaint.dark, fontSize: 12, fontWeight: '600' },
  built: { flex: 1, borderRadius: 18, borderCurve: 'continuous', backgroundColor: S.card.dark, padding: 12 },
  builtTitle: { color: S.text.dark, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  outcome: { color: S.textDim.dark, fontSize: 12, lineHeight: 16, marginTop: 8 },
  facts: { color: tokens.data.add.dark, fontSize: 13, fontWeight: '700' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  brand: { color: S.text.dark, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  share: { height: 48, paddingHorizontal: 34, borderRadius: 24, borderCurve: 'continuous', backgroundColor: S.accent.dark, alignItems: 'center', justifyContent: 'center' },
  shareText: { color: S.text.light, fontSize: 17, fontWeight: '700' },
  close: { color: S.textDim.dark, fontSize: 17, fontWeight: '600' },
});
