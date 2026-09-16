/**
 * Drops: everything you have shared into Builda, as a map you can start work from.
 *
 * The fifth tab, and the only one that is not a reading of what you already did. Share a reel or
 * a TikTok from the OS share sheet, and it lands here as a node; the Mac reads it and proposes
 * moves; you tap one and Claude Code does it, which makes the reel a Builda session like any
 * other. `docs/drops.md` is the design.
 *
 * The screen is three things and nothing else: the board (`Board.tsx`), the drop you have open
 * (`DropDetail.tsx`), and an empty state that tells you how to put the first one on it. The tab
 * has no header of its own: the board IS the screen, edge to edge, and a large title over a map
 * would take a fifth of it to say a word that is already in the tab bar.
 */
import { useIsFocused } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DropsBoard } from '../../src/drops/Board';
import { drainPending, landShared, pendingCount } from '../../src/drops/intake';
import { DropDetail } from '../../src/drops/DropDetail';
import { Sigil } from '../../src/drops/SigilView';
import { useBoard } from '../../src/drops/useBoard';
import { dropHue } from '../../src/theme';
import { T } from '../../src/ui/Text';
import { TextField } from '../../src/ui/TextField';
import { commit } from '../../src/ui/haptics';
import { useColors } from '../../src/ui/scheme';

export default function DropsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { drops, moves, loading, refresh, start, archive } = useBoard();
  const [open, setOpen] = useState<string | null>(null);
  const focused = useIsFocused();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string }>();
  const consumed = useRef<string | null>(null);
  /**
   * How many shares the extension has queued that this app has not sent.
   *
   * On screen, not in a log. A share that reaches the App Group and stops there is invisible
   * otherwise: the person hit share, the sheet said "on your board", and the board does not have
   * it. Null means there is no native module here at all (Expo Go, Android, web), and then the
   * line says nothing rather than "0".
   */
  const [waiting, setWaiting] = useState<number | null>(null);

  // The share extension's queue, drained every time the tab comes forward. A share that happened
  // while the app was closed lands the first time you open it, and one that happened while it
  // was in the background lands when you come back to this tab.
  useEffect(() => {
    if (!focused) return;
    setWaiting(pendingCount());
    void drainPending().then((n) => {
      setWaiting(pendingCount());
      if (n > 0) void refresh();
    });
  }, [focused, refresh]);

  // A link that arrived as `builder://drop?url=...`. Consumed once, by value, and the query is
  // cleared: without that, every re render of a focused tab would send the same link again.
  useEffect(() => {
    const url = params.url;
    if (!url || consumed.current === url) return;
    consumed.current = url;
    void landShared(url)
      .then(() => refresh())
      .finally(() => router.setParams({ url: undefined }));
  }, [params.url, refresh, router]);

  const drop = useMemo(() => drops.find((d) => d.id === open) ?? null, [drops, open]);

  const onStart = useCallback(
    (ids: string[], adjustment: string | null) => {
      if (drop) void start(drop.id, ids, adjustment);
    },
    [drop, start],
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {drops.length === 0 && !loading ? (
        <Empty onRefresh={refresh} onPaste={async (link) => { await landShared(link); await refresh(); }} />
      ) : (
        <DropsBoard drops={drops} moves={moves} selected={open} onSelect={setOpen} />
      )}

      {/* The word, top left, over the map. The tab has no header, so this is the only chrome:
          one label, on the ground, with nothing behind it. */}
      <View style={[styles.title, { top: insets.top + 8 }]} pointerEvents="none">
        <T role="label" style={{ color: c.textDim, letterSpacing: 1.6 }}>
          {`DROPS  ·  ${drops.length}`}
          {waiting ? <T role="label" style={{ color: c.accent, letterSpacing: 1.6 }}>{`   ${waiting} WAITING`}</T> : null}
        </T>
      </View>

      {drop ? (
        <DropDetail
          drop={drop}
          moves={moves}
          onStart={onStart}
          onArchive={() => {
            void archive(drop.id);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * Nothing shared yet.
 *
 * It shows three sigils grown from three example links rather than an illustration: the empty
 * state is made of the same thing the full one is, so what you are being promised is what you
 * will get. Pull to refresh, because a person who has just shared from another app comes back
 * here expecting it to be there.
 */
function Empty({ onRefresh, onPaste }: { onRefresh: () => Promise<void>; onPaste: (link: string) => Promise<void> }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const seeds = [
    'https://www.tiktok.com/@a/video/1',
    'https://www.instagram.com/reel/b',
    'https://www.youtube.com/shorts/c',
  ];
  const kinds = ['skill', 'technique', 'recipe'];
  return (
    <ScrollView
      contentContainerStyle={styles.empty}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          tintColor={c.textDim}
          onRefresh={() => {
            setBusy(true);
            void onRefresh().finally(() => setBusy(false));
          }}
        />
      }
    >
      <View style={styles.seeds}>
        {seeds.map((s, i) => {
          const hue = dropHue(kinds[i] ?? 'skill');
          if (!hue) return null;
          return <Sigil key={s} seed={s} size={52} ink={hue.ink} partner={hue.partner} motion="still" />;
        })}
      </View>
      <T role="title" style={{ color: c.text, marginTop: 28, textAlign: 'center' }}>
        Send yourself something to build
      </T>
      <T role="body" style={{ color: c.textDim, marginTop: 10, textAlign: 'center' }}>
        In Instagram or TikTok, hit share and pick Builda. Your Mac reads the post and works out
        what you could do with it, and you pick which of those actually happens.
      </T>
      <T role="mono" style={{ color: c.textFaint, marginTop: 22, textAlign: 'center' }}>
        nothing runs until you tap it
      </T>

      {/* The door that works everywhere, including Expo Go, where there is no share extension
          in the binary at all. A feature you cannot try without a native build is a feature
          nobody tries. */}
      <View style={styles.paste}>
        <TextField
          value={link}
          onChangeText={setLink}
          placeholder="or paste a link"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => {
            const v = link.trim();
            if (!v) return;
            commit();
            setLink('');
            void onPaste(v);
          }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { position: 'absolute', left: 16 },
  empty: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32 },
  seeds: { flexDirection: 'row', justifyContent: 'center', gap: 18 },
  paste: { marginTop: 26 },
});
