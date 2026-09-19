/**
 * Drops: every reel and link you sent yourself, read top to bottom as what happens next.
 *
 * The fifth tab, and the only one you arrive at from outside the app: you share a reel in
 * Instagram, Builda opens, and the thumb is already in the middle of the bar.
 *
 * WHAT THIS REPLACED, three times over. A pixel sigil per drop on a dotted field; then piles with
 * a PILES / GRID switch; then a web of strands settled by forces. All three grouped drops by what
 * they were ABOUT, which is a question nobody opening this tab is asking, and all three drew the
 * drop as something other than the reel it was. The owner's verdict on the last one was that it
 * did not work, and that reels in a build app need a reason to be there beyond "build something
 * off a reel" (docs/motion.md, "Drops: seen, built, shown").
 *
 * So the wall is the drop's LIFE: what is being built right now, what is waiting on your thumb,
 * what came of the reels you sent (the reel beside what you made of it, and the way to make a
 * reel of that), and then everything you ever sent, as the posters they were. A drop opens out of
 * its own poster (`wall/Opening.tsx`).
 *
 * On a desktop the wall is a list column and a drop opens BESIDE it, as its route in the pane to
 * the right (`src/desktop/`), so the poster grows into that pane (`motion/MorphNav.tsx`) rather
 * than into an overlay over the whole window: the Opening covered the sidebar and the wall it was
 * opened from, and was a page with no route, so Esc, the sidebar and a second poster all fought it.
 */
import { useIsFocused } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions, type View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIsDesktop } from '../../src/desktop/formFactor';
import { search } from '../../src/drops/cluster';
import { drainPending, landShared, pendingCount } from '../../src/drops/intake';
import { SearchLine } from '../../src/drops/SearchLine';
import { useBoard } from '../../src/drops/useBoard';
import { BuildingCard, PairCard, PickCard } from '../../src/drops/wall/Cards';
import { wallLine, wallOf, type WallDrop } from '../../src/drops/wall/model';
import { Opening, type Rect as Origin } from '../../src/drops/wall/Opening';
import { Poster } from '../../src/drops/wall/Poster';
import { showPairShare } from '../../src/drops/wall/PairShare';
import { GUTTER, TopFade, WallBand, WallHeader } from '../../src/drops/wall/Chrome';
import { tokens } from '../../src/generated/tokens';
import { api } from '../../src/data/client';
import * as cache from '../../src/data/cache';
import { notice } from '../../src/island/feeds';
import { RippleItem } from '../../src/motion';
import { morphOpen } from '../../src/motion/MorphNav';
import { useAccent } from '../../src/theme/accent';
import { T } from '../../src/ui/Text';
import { TextField } from '../../src/ui/TextField';
import { commit, select } from '../../src/ui/haptics';
import { overlay } from '../../src/ui/overlay';
import { useColors } from '../../src/ui/scheme';
import { TRY_AGAIN } from '../../src/copy/device';

/** Between posters in the grid. */
const GAP = 6;
const COLUMNS = 3;
/** A poster's corner at the grid's size (7% of a 158 point cell, `Poster`): where a morph starts. */
const POSTER_RADIUS = 11;

export default function DropsScreen() {
  const c = useColors();
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { drops, moves, loading, error, refresh, start } = useBoard();
  const [query, setQuery] = useState('');
  const focused = useIsFocused();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; open?: string }>();
  const consumed = useRef<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const posters = useRef(new Map<string, RNView | null>());
  // Always false on a phone (a constant): the Opening below is the phone's, unchanged.
  const desktop = useIsDesktop();

  const wall = useMemo(() => wallOf(drops, moves), [drops, moves]);

  /** What the search box narrowed to, or null for all of them (`cluster.search`). */
  const only = useMemo(() => {
    const hits = search(
      query,
      wall.all.map((w) => ({ kind: w.drop.kind, title: w.drop.title, summary: w.drop.summary, tags: w.drop.resolution?.plan?.tags ?? [] })),
    );
    return hits ? new Set(hits.map((i) => wall.all[i]?.drop.id).filter(Boolean) as string[]) : null;
  }, [query, wall]);

  const openDrop = useCallback(
    (id: string, from?: string) => {
      const node = posters.current.get(from ?? id);
      if (!node) {
        router.push(`/drop/${id}`);
        return;
      }
      const row = drops.find((d) => d.id === id);
      if (desktop) {
        morphOpen(
          node,
          () => router.push(`/drop/${id}?morph=1`),
          { color: tokens.surface.card.dark, radius: POSTER_RADIUS, ground: c.bg, image: row?.thumbnail_url ?? null },
          `/drop/${id}`,
        );
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        if (!w || !h || !row) {
          router.push(`/drop/${id}`);
          return;
        }
        const origin: Origin = { x, y, w, h, r: Math.max(10, Math.round(w * 0.07)) };
        overlay.show(
          (hide) => <Opening origin={origin} initial={{ drop: row, moves }} onClosed={hide} onChanged={() => void refresh()} />,
          { closeOnNavigate: true },
        );
      });
    },
    [router, drops, moves, refresh, desktop, c.bg],
  );

  // The project a built move made is its session's repository; the ship kit films that. A session
  // whose repository did not resolve (a scratch run) has nothing a kit could be keyed to.
  const filmBuilt = useCallback(
    async (sessionId: string, title: string) => {
      const s = (await cache.getDetail(sessionId).catch(() => null)) ?? (await api.session(sessionId).catch(() => null));
      const key = s?.repo_key ?? null;
      if (!key || key.length !== 64) {
        notice('That run has no project to film yet. It needs its session uploaded first.', 'thinking', accent.animal, accent.ink);
        return;
      }
      router.push({ pathname: '/ship/[key]', params: { key, name: title } });
    },
    [router, accent.animal, accent.ink],
  );

  const startMove = useCallback(
    (w: WallDrop, moveId: string, title: string) => {
      void start(w.drop.id, [moveId], null, {});
      // Said on the island, the app's one voice: the work has gone to the Mac.
      notice(`Sent to your Mac: ${title}`, 'working', accent.animal, accent.ink);
    },
    [start, accent.animal, accent.ink],
  );

  /**
   * The queue the share extension writes into, emptied, on focus AND on foreground: share a reel
   * from Safari while Builda already sits on this tab and focus never changes (the note this
   * replaced had the full story).
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
    void refresh();
    drain();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => sub.remove();
  }, [focused, drain, refresh]);

  // A tapped banner: `builder://drops?open=<id>`.
  useEffect(() => {
    const id = params.open;
    if (!id) return;
    router.setParams({ open: undefined });
    if (drops.some((d) => d.id === id)) router.push(`/drop/${id}`);
  }, [params.open, drops, router]);

  useEffect(() => {
    const url = params.url;
    if (!url || consumed.current === url) return;
    consumed.current = url;
    void landShared(url)
      .then(() => refresh())
      .finally(() => router.setParams({ url: undefined }));
  }, [params.url, refresh, router]);

  const inner = width - GUTTER * 2;
  const cell = Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);
  const grid = only ? wall.all.filter((w) => only.has(w.drop.id)) : wall.all;
  const line = wallLine(wall.counts);
  let section = 0;

  const register = (id: string) => (n: RNView | null) => {
    posters.current.set(id, n);
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {drops.length === 0 && !loading ? (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          {/* A board that failed to load is not an empty board. FOUND ON THE SIMULATOR: a first
              load that failed during a reload drew "Send yourself something to build" over eleven
              drops the server had. The line says what happened; pull to try again. */}
          <WallHeader line={error ? `Builda could not load your drops. ${TRY_AGAIN}` : waiting ? `${waiting} arriving` : ''} />
          <Empty
            onRefresh={refresh}
            onPaste={async (link) => {
              await landShared(link);
              await refresh();
            }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={false} tintColor={c.textDim} onRefresh={() => void refresh()} />}
        >
          <WallHeader line={[line, waiting ? `${waiting} arriving` : ''].filter(Boolean).join(', ')} />
          <View style={styles.search}>
            <SearchLine value={query} onChangeText={setQuery} hits={only ? { shown: only.size, total: wall.all.length } : null} />
          </View>

          {!only && wall.bands.building.length > 0 ? (
            <RippleItem i={section++}>
              <WallBand title="Being built">
                {wall.bands.building.map((w, i) => (
                  <View key={w.drop.id} style={{ marginBottom: 10 }}>
                    <BuildingCard posterRef={register(w.drop.id)} w={w} width={inner} aura={i === 0} onOpen={() => openDrop(w.drop.id)} />
                  </View>
                ))}
              </WallBand>
            </RippleItem>
          ) : null}

          {!only && wall.bands.pick.length > 0 ? (
            <RippleItem i={section++}>
              <WallBand title="Pick a move">
                {wall.bands.pick.map((w) => (
                  <View key={w.drop.id} style={{ marginBottom: 12 }}>
                    <PickCard posterRef={register(w.drop.id)} w={w} width={inner} onOpen={() => openDrop(w.drop.id)} onStart={(m) => startMove(w, m.id, m.title)} />
                  </View>
                ))}
              </WallBand>
            </RippleItem>
          ) : null}

          {!only && wall.bands.built.length > 0 ? (
            <RippleItem i={section++}>
              <WallBand title="What you made of them">
                {wall.bands.built.map((w) => (
                  <View key={w.drop.id} style={{ marginBottom: 14 }}>
                    <PairCard
                      posterRef={register(w.drop.id)}
                      w={w}
                      width={inner}
                      onOpen={() => openDrop(w.drop.id)}
                      onSession={(id) => router.push(`/session/${id}`)}
                      onShare={w.active ? () => showPairShare(w.drop, w.active!, { animal: accent.animal, ink: accent.ink }) : undefined}
                      onFilm={(id) => void filmBuilt(id, w.active?.title ?? 'what you built')}
                    />
                  </View>
                ))}
              </WallBand>
            </RippleItem>
          ) : null}

          <RippleItem i={section++}>
            <WallBand title={only ? `${grid.length} of ${wall.all.length}` : 'Everything you sent'}>
              <View style={styles.grid}>
                {grid.map((w) => (
                  <Pressable
                    key={w.drop.id}
                    accessibilityRole="button"
                    accessibilityLabel={w.drop.title ?? 'A drop'}
                    onPress={() => {
                      select();
                      openDrop(w.drop.id, `grid:${w.drop.id}`);
                    }}
                  >
                    {/* The grid is where search lands, so every drop registers here too; the
                        card above, when there is one, is measured first. */}
                    <View>
                      <Poster frameRef={register(`grid:${w.drop.id}`)} drop={w.drop} width={cell} foot={footOf(w)} footTone={w.band === 'built' ? 'add' : w.band === 'pick' ? 'hue' : 'dim'} reading={w.band === 'reading'} />
                    </View>
                  </Pressable>
                ))}
              </View>
            </WallBand>
          </RippleItem>
        </ScrollView>
      )}

      {/* The wall scrolls under the status bar; the clock sits on the ground, not on a poster. */}
      <TopFade height={insets.top + 8} />
    </View>
  );
}


/** The one line at a grid poster's foot: where this drop is in its life. */
function footOf(w: WallDrop): string {
  switch (w.band) {
    case 'building':
      return 'Being built';
    case 'pick': {
      const n = w.moves.filter((m) => m.status === 'offered').length;
      return n === 1 ? '1 move' : `${n} moves`;
    }
    case 'built':
      return 'Built';
    case 'reading':
      return w.drop.status === 'resolving' ? 'Reading' : 'Waiting for your Mac';
    case 'kept':
      if (w.drop.status === 'refused') return 'Nothing to do';
      // A recipe whose method was fetched is not "kept", it is ready to cook from.
      return w.drop.resolution?.plan?.recipe ? 'Recipe' : 'Kept';
  }
}



function Empty({ onRefresh, onPaste }: { onRefresh: () => Promise<void>; onPaste: (link: string) => Promise<void> }) {
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
        In Instagram or TikTok, hit share and pick Builda. Your Mac reads the post and works out what you could do with it,
        and when you build it, Builda cuts a reel of what you made.
      </T>
      <T role="meta" style={{ color: c.textFaint, marginTop: 22, textAlign: 'center' }}>
        Nothing runs until you tap it.
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
  search: { marginTop: 14, paddingHorizontal: GUTTER },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  empty: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32 },
  paste: { marginTop: 26 },
});
