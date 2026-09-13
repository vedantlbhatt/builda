import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, FadingTransition, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';

import type { SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api } from '../data/client';
import { ANIMAL_KEY } from '../onboarding/keys';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { HarnessGlyph } from '../pixel/HarnessGlyph';
import { PixelAnimal, PixelAnimalIcon } from '../pixel/PixelAnimal';
import { PixelBadge } from '../pixel/PixelBadge';
import { colors, dayLabel, layout, space } from '../theme';
import { Button, REDUCED_FADE, Row, Section, SNAP, Surface, T, useReduceMotion } from '../ui';
import { exitMs, T as DUR } from '../ui/motion';
import { Bone } from '../you/States';
import { staleLine } from '../you/load';
import {
  countsOf,
  EMPTY_HOLD,
  finishedMeta,
  holdOrder,
  HOLD_MAX_MS,
  isHeld,
  lastFinished,
  missionOrderIds,
  missionSample,
  missionScreen,
  noteFinishes,
  refusalLine,
  summaryParts,
  tileHeight,
  tileModel,
  tileWidth,
  topNeedsYou,
  visibleRows,
  type HeldOrder,
  type MissionInputs,
  type SampleKind,
  type TileModel,
} from './mission';
import { MissionTile, MissionTileSkeleton } from './MissionTile';
import { refreshLiveSurfaces } from './useLiveSurfaces';

const c = colors('dark');

/** Same cadence as Sessions and the Mac's live upload (`LIVE_UPLOAD_MIN_INTERVAL_SEC`, 60 s). */
export const LIVE_REFRESH_MS = 60_000;
/**
 * How often the times on a tile are redrawn: the elapsed minute, "waiting on you for five
 * minutes", "about 9m left". A minute label is at most this late. UNMEASURED JUDGEMENT CALL:
 * well under a minute, and a tick redraws only the tiles whose words changed (`MissionTile`
 * is memoised on its model).
 */
export const CLOCK_TICK_MS = 5_000;

// ------------------------------------------------------------------ hooks

/** Date.now(), re-read every `tickMs` while `active`. */
export function useNow(tickMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs, active]);
  return now;
}

/**
 * The builder's own creature: their pick, else the default. The same read the live debug route
 * makes for the Lock Screen, so the tile and the card beside it on the Lock Screen are one animal.
 */
export function useCreature(): Animal {
  const [chosen, setChosen] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void cache
        .getKv(ANIMAL_KEY)
        .catch(() => null)
        .then((v) => {
          if (live) setChosen(v);
        });
      return () => {
        live = false;
      };
    }, [])
  );
  return resolveAnimal(chosen);
}

/**
 * When this process saw each session leave the live list (`mission.noteFinishes`), and which
 * sessions were live at the last look. Module state, not component state: Now and `/live` are
 * two views of one grid, and a finish seen on one is a finish on the other. Never persisted: a
 * launch that finds a session already final did not see it finish.
 */
let seenFinal: Map<string, number> = new Map();
let lastLiveIds: string[] = [];
/** The last time a sync worked in this process, for "Showing what was saved at 9:41". */
let lastGoodSyncMs: number | null = null;

export interface MissionData {
  /** Live rows from the cache, then from the server; null until the cache has been read. */
  live: SessionDetail[] | null;
  /** Final rows the phone saw finish in the last ten minutes. */
  finals: SessionDetail[];
  seen: ReadonlyMap<string, number>;
  /** The latest finished session, for the empty state's one row. */
  lastFinal: SessionDetail | null;
  inputs: Omit<MissionInputs, 'rows'>;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** A DEV sample is on screen, not the account's sessions. */
  sample: boolean;
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Builda is not reachable right now.';
}

/**
 * Mission control's data: cache first, then a sync while the screen is focused, every
 * LIVE_REFRESH_MS, through `cache.sync` (the same pass Sessions runs, so the two never disagree
 * about what is live). Only the focused screen polls.
 */
export function useMission(sample: SampleKind | null): MissionData {
  const [live, setLive] = useState<SessionDetail[] | null>(null);
  const [finals, setFinals] = useState<SessionDetail[]>([]);
  const [seen, setSeen] = useState<ReadonlyMap<string, number>>(seenFinal);
  const [lastFinal, setLastFinal] = useState<SessionDetail | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(lastGoodSyncMs);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (sample || busy.current) return;
    busy.current = true;
    try {
      const before = await cache.listLive();
      setLive(before);
      const isIn = await api.isSignedIn();
      setSignedIn(isIn);
      if (!isIn) return;
      let failed: string | null = null;
      try {
        await cache.sync(api);
      } catch (e) {
        // Cached live rows are still the answer when there are some; the screen says it could
        // not check rather than claiming nothing runs.
        failed = errorText(e);
      }
      const after = await cache.listLive();
      const nowMs = Date.now();
      const nowIds = after.map((s) => s.id);
      seenFinal = noteFinishes(seenFinal, [...lastLiveIds, ...before.map((s) => s.id)], nowIds, nowMs);
      lastLiveIds = nowIds;
      const finished = (await Promise.all([...seenFinal.keys()].map((id) => cache.getDetail(id)))).filter(
        (s): s is SessionDetail => s !== null
      );
      const recent = await cache.listSessions(20);
      if (!failed) lastGoodSyncMs = nowMs;
      // The Lock Screen card and the widget from the same rows these tiles show, now rather
      // than at the root poll's next tick (docs/overnight-integration.md 3.5, the one line).
      void refreshLiveSurfaces(nowMs).catch(() => null);
      setLive(after);
      setFinals(finished);
      setSeen(new Map(seenFinal));
      setLastFinal(lastFinished(recent));
      setError(failed);
      if (!failed) setSynced(true);
      setSavedAt(lastGoodSyncMs);
    } finally {
      busy.current = false;
    }
  }, [sample]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (sample) return;
      void load();
      const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load, sample])
  );

  // The sample is fixed at the moment it was asked for, so its clocks age like real ones.
  const fake = useMemo(() => (sample ? missionSample(sample, Date.now()) : null), [sample]);
  if (fake) {
    return {
      live: fake.inputs.signedIn === false ? [] : fake.live,
      finals: fake.finals,
      seen: fake.seen,
      lastFinal: lastFinished(fake.finals),
      inputs: fake.inputs,
      refreshing: false,
      refresh: async () => undefined,
      sample: true,
    };
  }
  return {
    live,
    finals,
    seen,
    lastFinal,
    inputs: { signedIn, synced, error, savedAt },
    refreshing,
    refresh,
    sample: false,
  };
}

type Finger = 'touch' | 'drag' | 'momentum';

/**
 * The order on screen (`mission.holdOrder`): at most one re-sort every 15 s, and none while a
 * finger is down, dragging, or the list is still gliding from a flick. The finger lifting asks
 * again, one frame later so a flick's momentum can claim the hold first.
 */
function useHeldOrder(target: readonly string[]) {
  const [held, setHeld] = useState<HeldOrder>(EMPTY_HOLD);
  const heldRef = useRef(held);
  const targetRef = useRef(target);
  targetRef.current = target;
  const fingers = useRef<Record<Finger, boolean>>({ touch: false, drag: false, momentum: false });
  const downSince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const now = Date.now();
    const blocked = isHeld(downSince.current, now);
    const r = holdOrder(heldRef.current, targetRef.current, now, blocked);
    if (r.order !== heldRef.current) {
      heldRef.current = r.order;
      setHeld(r.order);
    }
    if (r.resortInMs !== null) timer.current = setTimeout(settle, r.resortInMs);
    // A touch whose end never arrives stops holding after HOLD_MAX_MS.
    else if (blocked && downSince.current !== null) timer.current = setTimeout(settle, HOLD_MAX_MS - (now - downSince.current));
  }, []);

  const key = target.join('\n');
  useEffect(() => settle(), [key, settle]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const set = useCallback(
    (k: Finger, v: boolean) => {
      const f = fingers.current;
      const was = f.touch || f.drag || f.momentum;
      f[k] = v;
      const is = f.touch || f.drag || f.momentum;
      if (is && !was) downSince.current = Date.now();
      if (!is && was) {
        requestAnimationFrame(() => {
          const g = fingers.current;
          if (g.touch || g.drag || g.momentum) return;
          downSince.current = null;
          settle();
        });
      }
    },
    [settle]
  );

  const handlers = useMemo(
    () => ({
      onTouchStart: () => set('touch', true),
      onTouchEnd: (e: GestureResponderEvent) => {
        if (e.nativeEvent.touches.length === 0) set('touch', false);
      },
      onTouchCancel: () => set('touch', false),
      onScrollBeginDrag: () => set('drag', true),
      onScrollEndDrag: () => set('drag', false),
      onMomentumScrollBegin: () => set('momentum', true),
      onMomentumScrollEnd: () => set('momentum', false),
    }),
    [set]
  );

  return { ids: held.ids, handlers };
}

// ------------------------------------------------------------------ the screen

/**
 * Mission control (DESIGN-DIRECTION 7.1): every running session as a tile, two to a row, the one
 * that needs you first. The whole screen body, used by the Now tab (inline) and by `/live` (the
 * same grid pushed full screen), so the two can never differ.
 *
 * Five states from `mission.missionScreen`: a skeleton shaped like two tiles while the first
 * answer is on its way; Bit and "Nothing needs you." with the last finished session as one row;
 * signed out with Sign in; could not check, with Try again; and the grid, with one line at the
 * top when it is showing what was saved because the refresh failed. The refusal is a sentence
 * under the grid when sessions came without the engine's state.
 */
export function MissionControl({ sample = null }: { sample?: SampleKind | null }) {
  const router = useRouter();
  const focused = useIsFocused();
  const data = useMission(sample);
  const now = useNow(CLOCK_TICK_MS, focused);
  const creature = useCreature();
  const { width, fontScale } = useWindowDimensions();
  const tileW = tileWidth(width);
  const tileH = tileHeight(fontScale);

  const rows = useMemo(
    () => (data.live === null ? null : visibleRows(data.live, data.finals, data.seen, now)),
    [data.live, data.finals, data.seen, now]
  );
  const screen = missionScreen({ ...data.inputs, rows });
  const models = useMemo(() => new Map((rows ?? []).map((s) => [s.id, tileModel(s, now)] as const)), [rows, now]);
  const target = useMemo(() => (rows ? missionOrderIds(rows, now) : []), [rows, now]);
  const hold = useHeldOrder(target);
  // Before anything is placed, the first placement is the target itself, drawn in this render
  // rather than one effect later: the grid arrives whole, never as an empty frame then tiles.
  const ids = hold.ids.length === 0 ? target : hold.ids;

  // A tile that left while a finger was down keeps its place, drawn as it last was, until the
  // finger lifts: nothing moves under a thumb, including a gap closing.
  const lastModels = useRef(new Map<string, TileModel>());
  for (const [id, m] of models) lastModels.current.set(id, m);
  for (const id of [...lastModels.current.keys()]) if (!ids.includes(id) && !models.has(id)) lastModels.current.delete(id);
  const shown = ids.map((id) => models.get(id) ?? lastModels.current.get(id)).filter((m): m is TileModel => m !== undefined);

  const counts = countsOf([...models.values()]);
  const top = topNeedsYou(ids, models);
  const refusal = rows ? refusalLine(rows) : null;
  const open = useCallback((id: string) => router.push(`/session/${id}`), [router]);

  const reduce = useReduceMotion();
  const motion = useMemo(
    () =>
      reduce
        ? { layout: FadingTransition.duration(REDUCED_FADE), entering: FadeIn.duration(REDUCED_FADE), exiting: FadeOut.duration(REDUCED_FADE) }
        : {
            // Moves glide on SNAP, critically damped: a tile arrives at its new place without
            // overshooting into its neighbour.
            layout: new LinearTransition().springify(SNAP.duration).dampingRatio(SNAP.dampingRatio),
            entering: FadeIn.duration(DUR.enter),
            exiting: FadeOut.duration(exitMs(DUR.enter)),
          },
    [reduce]
  );

  const signedIn = data.inputs.signedIn;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        signedIn && !data.sample ? (
          <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} tintColor={c.accent} />
        ) : undefined
      }
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: space.tile,
      }}
      {...hold.handlers}
    >
      {data.sample ? (
        <T role="label" tone="dim">
          sample sessions, not yours
        </T>
      ) : null}

      {screen.kind === 'loading' ? <MissionSkeleton width={tileW} height={tileH} /> : null}

      {screen.kind === 'signedOut' ? (
        <View style={{ gap: space.md }}>
          <PixelBadge
            state="sleeping"
            size={64}
            title="Nothing running that we can see."
            text="Sign in, and your agents show up here while they run."
            style={{ padding: 0 }}
          />
          <Button label="Sign in" size="compact" block={false} onPress={() => router.push('/settings')} />
        </View>
      ) : null}

      {screen.kind === 'error' ? (
        <View style={{ gap: space.md }}>
          <PixelBadge state="sleeping" size={64} title="Could not check what is running." text={screen.message} style={{ padding: 0 }} />
          <Button label="Try again" size="compact" block={false} onPress={() => void data.refresh()} />
        </View>
      ) : null}

      {(screen.kind === 'empty' || screen.kind === 'ready') && screen.stale ? (
        <T role="meta" tone="dim" accessibilityRole="alert">
          {staleLine(screen.stale, now)}
        </T>
      ) : null}

      {screen.kind === 'empty' ? (
        <View style={{ gap: layout.sectionGap }}>
          <PixelBadge
            state="sleeping"
            size={64}
            title="Nothing needs you."
            text="Go do something else. We'll tap you when that changes."
            style={{ padding: 0 }}
          />
          {data.lastFinal ? <LastFinished session={data.lastFinal} onOpen={open} /> : null}
        </View>
      ) : null}

      {screen.kind === 'ready' ? (
        <>
          <Summary parts={summaryParts(counts)} />
          <LayoutAnimationConfig skipEntering>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap }}>
              {shown.map((m) => (
                <Animated.View key={m.id} layout={motion.layout} entering={motion.entering} exiting={motion.exiting} style={{ width: tileW, height: tileH }}>
                  <MissionTile model={m} creature={creature} animate={m.id === top} width={tileW} height={tileH} onOpen={open} />
                </Animated.View>
              ))}
            </View>
          </LayoutAnimationConfig>
          {refusal ? (
            <T role="meta" tone="dim">
              {refusal}
            </T>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

/** "3 running · 1 needs you": `meta` in textDim, the needs you count in amber 13/600. */
function Summary({ parts }: { parts: { text: string; accent: boolean }[] }) {
  if (parts.length === 0) return null;
  return (
    <T role="meta" tone="dim" accessibilityRole="header">
      {parts.map((p, i) => (
        <React.Fragment key={p.text}>
          {i > 0 ? ' · ' : null}
          {p.accent ? (
            <T role="meta" tone="accent" weight={600}>
              {p.text}
            </T>
          ) : (
            p.text
          )}
        </React.Fragment>
      ))}
    </T>
  );
}

/** The skeleton: the summary line's bone and two tiles, the shape of the smallest real answer. */
function MissionSkeleton({ width, height }: { width: number; height: number }) {
  return (
    <View style={{ gap: space.tile }} accessible accessibilityLabel="Checking what is running">
      <Bone width={140} height={13} />
      <View style={{ flexDirection: 'row', gap: layout.tileGap }}>
        <MissionTileSkeleton width={width} height={height} />
        <MissionTileSkeleton width={width} height={height} />
      </View>
    </View>
  );
}

/** The empty state's one row: the session that finished last, pushing to it. */
function LastFinished({ session: s, onOpen }: { session: SessionDetail; onOpen: (id: string) => void }) {
  return (
    <Section label="Last finished">
      <Surface padding={0}>
        <Row
          title={s.repo_name ?? 'private repo'}
          monoTitle
          meta={finishedMeta(s, (iso) => dayLabel(iso))}
          leading={<HarnessGlyph harness={s.harness} size={16} ink="dim" />}
          chevron
          onPress={() => onOpen(s.id)}
        />
      </Surface>
    </Section>
  );
}

// ------------------------------------------------------------------ the entry row

/**
 * The block at the top of Sessions while something is running: ONE row into mission control
 * (DESIGN-DIRECTION 7.1), "3 running" with "1 needs you" in amber, and the top session's
 * sentence under it, in mission control's order, so the row and the grid it opens agree about
 * who comes first. The builder's creature leads it, and moves only when a session needs you.
 *
 * `onPress` is accepted for the caller that still passes one and is not used: the row opens
 * `/live`, and the tile there opens the session.
 */
export function LiveSessions({
  sessions,
}: {
  sessions: SessionDetail[];
  /** Unused: the row opens mission control. */
  onPress?: (id: string) => void;
}) {
  const router = useRouter();
  const focused = useIsFocused();
  const now = useNow(CLOCK_TICK_MS, focused);
  const creature = useCreature();
  if (sessions.length === 0) return null;

  const models = new Map(sessions.map((s) => [s.id, tileModel(s, now)] as const));
  const order = missionOrderIds(sessions, now);
  const first = models.get(order[0] ?? '') ?? null;
  const parts = summaryParts(countsOf([...models.values()]));
  const needs = topNeedsYou(order, models) !== null;
  const plain = parts.filter((p) => !p.accent).map((p) => p.text).join(' · ') || `${sessions.length} running`;
  const accent = parts.find((p) => p.accent)?.text ?? null;

  return (
    <Section label="Live now">
      <Surface padding={0}>
        <Row
          title={plain}
          meta={first ? `${first.repo} · ${first.sentence}` : undefined}
          metaLines={2}
          leading={needs ? <PixelAnimal animal={creature} size={32} tone="rest" /> : <PixelAnimalIcon animal={creature} size={32} tone="idle" />}
          trailing={
            accent ? (
              <T role="meta" tone="accent" weight={600}>
                {accent}
              </T>
            ) : undefined
          }
          chevron
          onPress={() => router.push('/live')}
          testID="live-now-row"
        />
      </Surface>
    </Section>
  );
}
