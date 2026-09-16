/**
 * Drops: everything you have shared into Builda, as its own frame, piled by what it is about.
 *
 * The fifth tab, and the only one you arrive at from outside the app: you share a reel in
 * Instagram, Builda opens, and the thumb is already in the middle of the bar.
 *
 * Three things on it and nothing else: the search box, the wall (`Board.tsx`), and the drop you
 * opened (`DropSheet.tsx`). Two ways to see the wall, because the right one depends on how many
 * you have: PILES, which groups them by what they are about, and a GRID, which is every card in
 * order with nothing decided for you. The toggle is two words, not an icon nobody can read.
 */
import { useIsFocused } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DropsBoard } from '../../src/drops/Board';
import { DropCard } from '../../src/drops/CardView';
import { search } from '../../src/drops/cluster';
import { SearchLine } from '../../src/drops/SearchLine';
import { drainPending, landShared, pendingCount } from '../../src/drops/intake';
import { GUTTER } from '../../src/drops/layout';
import { useBoard } from '../../src/drops/useBoard';
import { WordToggle } from '../../src/drops/WordToggle';
import { T } from '../../src/ui/Text';
import { TextField } from '../../src/ui/TextField';
import { commit, select } from '../../src/ui/haptics';
import { useColors } from '../../src/ui/scheme';

type Shape = 'piles' | 'grid';

export default function DropsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { drops, moves, loading, refresh } = useBoard();
  const [shape, setShape] = useState<Shape>('piles');
  const [query, setQuery] = useState('');
  /**
   * How to put a hand arranged wall back, or null when nobody has moved anything.
   *
   * Stored through an updater. `useState`'s setter treats a bare function as "compute the next
   * state from the last one", so `setUnarrange(fn)` would CALL fn — which here means the board
   * unarranges itself the instant it reports that it is arranged.
   */
  const [unarrange, setUnarrange] = useState<null | (() => void)>(null);
  const takeUnarrange = useCallback((fn: null | (() => void)) => setUnarrange(() => fn), []);
  const focused = useIsFocused();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; open?: string }>();
  const consumed = useRef<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);

  const openDrop = useCallback((id: string) => router.push(`/drop/${id}`), [router]);

  /** What the search box narrowed to, or null for all of them (`cluster.search`). */
  const only = useMemo(() => {
    const hits = search(
      query,
      drops.map((d) => ({
        kind: d.kind,
        title: d.title,
        summary: d.summary,
        tags: d.resolution?.plan?.tags ?? [],
      })),
    );
    return hits ? new Set(hits.map((i) => drops[i]?.id).filter(Boolean) as string[]) : null;
  }, [query, drops]);

  const shown = useMemo(() => (only ? drops.filter((d) => only.has(d.id)) : drops), [drops, only]);
  const todo = useMemo(() => moves.filter((m) => m.status === 'offered').length, [moves]);
  const going = useMemo(
    () => moves.filter((m) => m.status === 'queued' || m.status === 'running').length,
    [moves],
  );
  const busy = useMemo(() => {
    const ids = new Set<string>();
    for (const m of moves) if (m.status === 'running' || m.status === 'queued') ids.add(m.drop_id);
    return ids;
  }, [moves]);

  /**
   * The queue the share extension writes into, emptied.
   *
   * ON FOCUS **AND ON FOREGROUND**, because those are two different events and only one of them
   * used to be handled. Share a reel from Safari while Builda is already sitting on this tab,
   * come back, and `useIsFocused` never changes: the screen was focused the whole time. The drop
   * would then sit in the App Group until the person tabbed away and back, which is the one thing
   * nobody does when they have just shared something and are waiting to see it land.
   */
  const drain = useCallback(() => {
    setWaiting(pendingCount());
    void drainPending().then((n) => {
      setWaiting(pendingCount());
      if (n > 0) void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!focused) return;
    // The board does not poll while nothing is in flight (`useBoard`), so arriving on this tab
    // is the moment to ask: the Mac may have finished a run while you were on another screen.
    void refresh();
    drain();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => sub.remove();
  }, [focused, drain, refresh]);

  // A tapped banner: `builder://drops?open=<id>`. It opens the drop's own screen.
  useEffect(() => {
    const id = params.open;
    if (!id) return;
    router.setParams({ open: undefined });
    if (drops.some((d) => d.id === id)) openDrop(id);
  }, [params.open, drops, router, openDrop]);

  useEffect(() => {
    const url = params.url;
    if (!url || consumed.current === url) return;
    consumed.current = url;
    void landShared(url)
      .then(() => refresh())
      .finally(() => router.setParams({ url: undefined }));
  }, [params.url, refresh, router]);

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headRow}>
          <T role="label" style={{ color: c.textDim, letterSpacing: 1.6 }}>
            {`DROPS  ·  ${drops.length}`}
            {todo ? (
              <T role="label" style={{ color: c.textFaint, letterSpacing: 1.6 }}>{`   ${todo} TO DO`}</T>
            ) : null}
            {going ? (
              <T role="label" style={{ color: c.accent, letterSpacing: 1.6 }}>{`   ${going} GOING`}</T>
            ) : null}
            {waiting ? (
              <T role="label" style={{ color: c.accent, letterSpacing: 1.6 }}>{`   ${waiting} WAITING`}</T>
            ) : null}
          </T>
          <View style={styles.shape}>
            {/* Only while there is something to undo. A permanent "reset" on a wall nobody has
                touched is a control that spends its life telling you about a state you are not
                in. */}
            {shape === 'piles' && unarrange ? (
              <Pressable accessibilityRole="button" hitSlop={10} onPress={unarrange}>
                <T role="mono" style={{ color: c.textFaint }}>
                  arranged
                </T>
              </Pressable>
            ) : null}
            <WordToggle word="PILES" on={shape === 'piles'} onPress={() => setShape('piles')} />
            <WordToggle word="GRID" on={shape === 'grid'} onPress={() => setShape('grid')} />
          </View>
        </View>

        <View style={styles.search}>
          <SearchLine
            value={query}
            onChangeText={setQuery}
            hits={only ? { shown: only.size, total: drops.length } : null}
          />
        </View>
      </View>

      {drops.length === 0 && !loading ? (
        <Empty
          onRefresh={refresh}
          onPaste={async (link) => {
            await landShared(link);
            await refresh();
          }}
        />
      ) : shape === 'piles' ? (
        <DropsBoard
          drops={drops}
          moves={moves}
          onOpenCard={openDrop}
          only={only}
          onArranged={takeUnarrange}
        />
      ) : (
        <GridWall drops={shown} busy={busy} onOpenCard={openDrop} />
      )}
    </View>
  );
}

/**
 * Every card, in order, two across. The alternative to the piles for anybody who would rather
 * decide for themselves what goes with what.
 */
function GridWall({
  drops,
  busy,
  onOpenCard,
}: {
  drops: ReturnType<typeof useBoard>['drops'];
  busy: Set<string>;
  onOpenCard: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 96 }]}
      showsVerticalScrollIndicator={false}
    >
      {drops.map((d, i) => (
        <Animated.View key={d.id} entering={FadeIn.duration(200).delay(Math.min(i, 8) * 28)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.title ?? d.url}
            onPress={() => {
              select();
              onOpenCard(d.id);
            }}
          >
            <DropCard drop={d} busy={busy.has(d.id)} scale={1.42} />
          </Pressable>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

function Empty({
  onRefresh,
  onPaste,
}: {
  onRefresh: () => Promise<void>;
  onPaste: (link: string) => Promise<void>;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
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
      <T role="title" style={{ color: c.text, textAlign: 'center' }}>
        Send yourself something to build
      </T>
      <T role="body" style={{ color: c.textDim, marginTop: 10, textAlign: 'center' }}>
        In Instagram or TikTok, hit share and pick Builda. Your Mac reads the post and works out
        what you could do with it, and you pick which of those actually happens.
      </T>
      <T role="mono" style={{ color: c.textFaint, marginTop: 22, textAlign: 'center' }}>
        nothing runs until you tap it
      </T>
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
  head: { paddingHorizontal: GUTTER, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  shape: { flexDirection: 'row', gap: 14 },
  search: { marginTop: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: GUTTER,
    paddingTop: 4,
  },
  empty: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32 },
  paste: { marginTop: 26 },
});
