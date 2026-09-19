/**
 * Mission control, in the house style (design-refs/HOUSE-STYLE.md; the reference is the analysis
 * page, `src/insights/**`): one chapter. It opens on a full bleed band in the builder's creature
 * hue that prints itself, with the one number that matters set huge in dark ink ("1 needs you",
 * or "3 running" with "Nothing needs you." under it) and the running crew printed along its foot.
 * Under it, on the warm dark ground with a slow radar turning very quietly behind, each session is
 * a tile printed in its own creature's hue (`MissionTile.tsx`), the one who needs you most first
 * and set largest.
 *
 * When nothing runs, the screen IS the reward: the whole screen is the builder's band, Bit asleep
 * on it, "Nothing needs you." huge, "Go do something else." under it, and the last finished
 * session as one line you can open.
 *
 * The rules are the ones mission control always had, pure in `mission.ts` and pinned by its
 * tests: the engine's order (the Lock Screen's), at most one re-sort every 15 s and never under
 * a finger (`holdOrder`), a finished tile for ten minutes, the five screen states. Motion:
 * tiles enter on AnimatedList's stagger and glide to new places on its layout spring; nothing
 * moves under a thumb.
 *
 * Sources, named: the band, the print, the count up and the reveal clock are the analysis
 * page's (`insights/Band.tsx`, `Num.tsx`, `reveal.tsx`); react-bits ports from `ui/bits`
 * (AnimatedList, StarBorder, Radar, SplitText, SpotlightCard's layer); the loading mark is the
 * flip wave pattern from Appllama's loader set (a 5 by 5 grid flipping along its diagonal and
 * settling centre out; the pattern only, drawn here from scratch, that repository is GPL).
 */
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, useWindowDimensions, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

import type { SessionDetail } from '../data/api';
import { useRepoNames } from '../data/repoNames';
import * as cache from '../data/cache';
import { api } from '../data/client';
import { Band, BandWords } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { fitSize } from '../insights/format';
import { figure, GUTTER, Refusal, type as kitType } from '../insights/kit';
import { GROUND, ON_HUE, type Hue as BandHue } from '../insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import { useRevealScroll } from '../insights/RevealScroll';
import { ANIMAL_KEY } from '../onboarding/keys';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { PixelSprite } from '../pixel/PixelSprite';
import { dayLabel, layout } from '../theme';
import { useAccent, type AccentState } from '../theme/accent';
import { T, useReduceMotion } from '../ui';
import { AnimatedList } from '../ui/bits/components/AnimatedList';
import { staleLine } from '../you/load';
import {
  EMPTY_HOLD,
  holdOrder,
  HOLD_MAX_MS,
  isHeld,
  lastFinished,
  lastFinishedLine,
  missionOrderIds,
  missionSample,
  missionScreen,
  noteFinishes,
  refusalLine,
  summaryHead,
  tileHeight,
  tileModel,
  tileVariant,
  tileWidthFor,
  topNeedsYou,
  visibleRows,
  type HeldOrder,
  type MissionInputs,
  type SampleKind,
  type TileModel,
} from './mission';
import { crewFor, crewHashed } from './crew';
import { select } from '../ui/haptics';
import { awaySummary } from './away';
import { AwayBand, useAwayFrom } from './AwayBand';
import { FACE_FOR_TILE } from '../island/feeds';
import type { CrewMember } from '../island/model';
import { creatureHue } from '../theme';
import { inked, LiveNum, MissionTile, StandaloneReveal } from './MissionTile';
import { refreshLiveSurfaces } from './useLiveSurfaces';

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
 * The builder's own creature: their pick, else the default. Sessions wear their crew creature
 * now (`sessionCreature`); this stays for anything that shows the builder themself.
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
    }, []),
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

/**
 * Each session's creature, remembered for the process (`crew.ts`: the grid, the Sessions doorway,
 * the live bar, the Lock Screen and the widget ask the same memory, so a session keeps one
 * colour everywhere). Re-exported for the screens that have always asked mission control.
 */
export { crewFor, sessionCreature } from './crew';

export interface MissionData {
  /** Live rows from the cache, then from the server; null until the cache has been read. */
  live: SessionDetail[] | null;
  /** Final rows the phone saw finish in the last ten minutes. */
  finals: SessionDetail[];
  seen: ReadonlyMap<string, number>;
  /** The latest finished session, for the empty state's one line. */
  lastFinal: SessionDetail | null;
  /** The latest finished sessions from the cache, for "while you were away" (`away.ts`). */
  recent: SessionDetail[];
  inputs: Omit<MissionInputs, 'rows'>;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** A DEV sample is on screen, not the account's sessions. */
  sample: boolean;
}

/**
 * Finished rows read for "while you were away". Twenty was the empty state's need (the last one);
 * parallel agents finish more than that in a day. MEASURED on the local stack's corpus: 64
 * sessions on its busiest day (2026-09-12), 24 on the next; the band names three and counts the
 * rest, so reading one busy day whole is enough.
 */
const AWAY_READ = 64;

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
  const [recent, setRecent] = useState<SessionDetail[]>([]);
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
        (s): s is SessionDetail => s !== null,
      );
      const recentRows = await cache.listSessions(AWAY_READ);
      if (!failed) lastGoodSyncMs = nowMs;
      // The Lock Screen card and the widget from the same rows these tiles show, now rather
      // than at the root poll's next tick (docs/overnight-integration.md 3.5, the one line).
      void refreshLiveSurfaces(nowMs).catch(() => null);
      setLive(after);
      setFinals(finished);
      setSeen(new Map(seenFinal));
      setLastFinal(lastFinished(recentRows));
      setRecent(recentRows);
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
    }, [load, sample]),
  );

  // The sample is fixed at the moment it was asked for, so its clocks age like real ones.
  const fake = useMemo(() => (sample ? missionSample(sample, Date.now()) : null), [sample]);
  if (fake) {
    return {
      live: fake.inputs.signedIn === false ? [] : fake.live,
      finals: fake.finals,
      seen: fake.seen,
      lastFinal: lastFinished(fake.finals),
      recent: [],
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
    recent,
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
    [],
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
    [settle],
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
    [set],
  );

  return { ids: held.ids, handlers };
}

/** The accent as a chapter hue (`insights/Band` reads ink, partner and light). */
function bandHue(a: AccentState): BandHue {
  return { ink: a.ink, partner: a.partner, light: a.light };
}


const noop = () => undefined;

// ------------------------------------------------------------------ the screen

/**
 * Mission control: the whole screen body, used by the Now tab (inline, where the summary band is
 * a doorway into `/live`) and by `/live` (the same chapter pushed full screen), so the two can
 * never differ about who comes first.
 *
 * Five states from `mission.missionScreen`: the flip wave while the first answer is on its way;
 * the full screen band when nothing needs you; signed out with the way to sign in; could not
 * check, with Try again; and the chapter, with one sentence on the ground above it when it is
 * showing what was saved because the refresh failed. The refusal is a sentence under the grid
 * when sessions came without the engine's state.
 */
export function MissionControl({ sample = null, doorway = false }: { sample?: SampleKind | null; doorway?: boolean }) {
  const router = useRouter();
  const focused = useIsFocused();
  const data = useMission(sample);
  const now = useNow(CLOCK_TICK_MS, focused);
  // What a tile calls a private project: the number the Projects tab gives it (`copy/repoLabel`).
  const names = useRepoNames();
  const accent = useAccent();
  const reduce = useReduceMotion();
  const page = usePageReveal(reduce);
  const { scrollRef, onScroll, onLayout: onRevealLayout } = useRevealScroll(page, noop);
  const { width, fontScale } = useWindowDimensions();
  // The empty band measured the viewport to fill it; the stage that replaced it does not.
  const onLayout = useCallback((e: LayoutChangeEvent) => onRevealLayout(e), [onRevealLayout]);

  const rows = useMemo(
    () => (data.live === null ? null : visibleRows(data.live, data.finals, data.seen, now)),
    [data.live, data.finals, data.seen, now],
  );
  const screen = missionScreen({ ...data.inputs, rows });
  const models = useMemo(() => new Map((rows ?? []).map((s) => [s.id, tileModel(s, now, names)] as const)), [rows, now, names]);
  const crew = useMemo(() => crewFor(rows ?? []), [rows]);
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

  const top = topNeedsYou(ids, models);
  const head = summaryHead([...models.values()]);
  const refusal = rows ? refusalLine(rows) : null;
  // `morph`: the tile grew into the page and it is already on screen (`motion/MorphNav.tsx`).
  const open = useCallback((id: string, morph?: boolean) => router.push(morph ? `/session/${id}?morph=1` : `/session/${id}`), [router]);
  const awayClock = useAwayFrom();
  const away = useMemo(
    () => (data.sample ? null : awaySummary(data.recent, data.live ?? [], awayClock.from, Date.now(), names)),
    [data.sample, data.recent, data.live, awayClock.from, names],
  );
  const awayGone = awayClock.done;
  const awayDone = useCallback(() => {
    select();
    awayGone();
  }, [awayGone]);
  const openLive = useCallback(() => router.push('/live'), [router]);

  const signedIn = data.inputs.signedIn;
  const ready = screen.kind === 'ready';
  const halfMin = tileHeight(fontScale);

  return (
    <View style={styles.screen}>
      {/* The radar that turned behind the grid is gone: the island stage says "watching" now,
          and a texture behind every screen was half of why they all looked alike. */}
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
        refreshControl={
          signedIn && !data.sample ? <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} tintColor={GROUND.dim} /> : undefined
        }
        // The empty band fills the screen to its foot; the grid keeps room under its last tile.
        contentContainerStyle={screen.kind === 'empty' ? styles.contentEmpty : styles.content}
        {...hold.handlers}
      >
        <RevealPage page={page}>
          {data.sample ? (
            <Section style={styles.note}>
              <Block>
                <T role="label" tone="dim">
                  sample sessions, not yours
                </T>
              </Block>
            </Section>
          ) : null}

          {screen.kind === 'loading' ? (
            <Section style={styles.pad}>
              <Block style={styles.waiting}>
                <FlipWave color={accent.ink} />
                <T maxFontSizeMultiplier={1.6} style={kitType.dim}>
                  Checking what is running.
                </T>
              </Block>
            </Section>
          ) : null}

          {screen.kind === 'signedOut' ? (
            <Section style={styles.pad}>
              <Block style={styles.stateBlock}>
                <PixelSprite state="sleeping" size={64} />
                <T maxFontSizeMultiplier={1.6} style={kitType.heading}>
                  Nothing running that we can see.
                </T>
                <T maxFontSizeMultiplier={1.6} style={kitType.dim}>
                  Sign in, and your agents show up here while they run.
                </T>
                <WordLink label="Sign in" color={accent.text} onPress={() => router.push('/settings')} />
              </Block>
            </Section>
          ) : null}

          {screen.kind === 'error' ? (
            <Section style={styles.pad}>
              <Block style={styles.stateBlock}>
                <PixelSprite state="sleeping" size={64} />
                <T maxFontSizeMultiplier={1.6} style={kitType.heading}>
                  Could not check what is running.
                </T>
                <Refusal>{screen.message}</Refusal>
                <WordLink label="Try again" color={accent.text} onPress={() => void data.refresh()} />
              </Block>
            </Section>
          ) : null}

          {ready && screen.stale ? (
            <Section style={styles.note}>
              <Block>
                <Refusal>{staleLine(screen.stale, now)}</Refusal>
              </Block>
            </Section>
          ) : null}

          {/* The island stage that stood here is gone (2026-09-19, the owner: the island is not
              for saying how a run is doing). Empty says so in one line, with the last run. */}
          {screen.kind === 'empty' ? (
            <Section style={styles.pad}>
              <Block>
                <T maxFontSizeMultiplier={1.6} style={kitType.dim}>
                  Nothing running.
                </T>
                {data.lastFinal ? (
                  <WordLink
                    label={lastFinishedLine(data.lastFinal, (iso) => dayLabel(iso), names)}
                    color={accent.text}
                    onPress={() => open(data.lastFinal!.id)}
                  />
                ) : null}
                {screen.stale ? <Refusal>{staleLine(screen.stale, now)}</Refusal> : null}
              </Block>
            </Section>
          ) : null}
          {away ? (
            <View style={styles.stageWrap}>
              <AwayBand away={away} onOpen={open} onDone={awayDone} />
            </View>
          ) : null}

          {ready ? (
            <Section style={styles.grid}>
              <AnimatedList
                scroll={false}
                data={shown}
                keyExtractor={(m) => m.id}
                style={styles.tiles}
                renderItem={({ item: m, index }) => {
                  const variant = tileVariant(index, shown.length);
                  return (
                    <MissionTile
                      model={m}
                      creature={crew.get(m.id) ?? crewHashed(m.id)}
                      animate={m.id === top}
                      variant={variant}
                      width={tileWidthFor(variant, width)}
                      minHeight={variant === 'half' ? halfMin : 0}
                      delay={Math.min(index, 6) * 70}
                      onOpen={open}
                    />
                  );
                }}
              />
            </Section>
          ) : null}

          {ready && refusal ? (
            <Section style={styles.after}>
              <Block>
                <Refusal>{refusal}</Refusal>
              </Block>
            </Section>
          ) : null}
        </RevealPage>
      </Animated.ScrollView>
    </View>
  );
}

/** A tile as one of the island's crew: the same face, state and words the island draws. */
function memberOf(m: TileModel, animal: Animal, nowMs: number): CrewMember {
  return {
    sessionId: m.id,
    repo: m.repo,
    animal,
    ink: creatureHue(animal).ink,
    state: FACE_FOR_TILE[m.kind],
    sentence: m.sentence,
    startedMs: m.elapsedMin !== null ? nowMs - m.elapsedMin * 60_000 : null,
  };
}

// ------------------------------------------------------------------ small parts

/** The crew, printed along a band's foot in order: one creature per session, in the dark ink. */
function CrewRow({ creatures, delay }: { creatures: readonly Animal[]; delay: number }) {
  if (creatures.length === 0) return null;
  const shown = creatures.slice(0, 8);
  return (
    <View style={styles.crew} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown.map((c, i) => (
        <CreaturePrint key={`${c}.${i}`} animal={c} size={32} color={ON_HUE} delay={delay + i * 70} spread={260} />
      ))}
    </View>
  );
}



/** Navigation as words: a line of text in the accent with an arrow after it (the house style). */
function WordLink({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={10} style={({ pressed }) => [styles.link, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <T maxFontSizeMultiplier={1.4} style={inked(17, '700', color, 22)}>
        {label}
      </T>
      <SymbolView name="arrow.right" tintColor={color} weight="bold" size={15} style={styles.arrow} />
    </Pressable>
  );
}

/** One loop of the flip wave. */
const WAVE_MS = 2400;
const WAVE = 5;

/**
 * The loading mark: a 5 by 5 grid of cells in the accent that fold down along the diagonal and
 * come back from the centre out, the flip wave pattern from Appllama's loader set (the pattern
 * only: this is drawn from scratch; that repository is GPL). Cells change size, never opacity,
 * so the hue never goes brown. Reduce Motion: a still checker.
 */
function FlipWave({ color }: { color: string }) {
  const reduce = useReduceMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: WAVE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [reduce, t]);
  const cells = Array.from({ length: WAVE * WAVE }, (_, i) => i);
  return (
    <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cells.map((i) => (
        <WaveCell key={i} row={Math.floor(i / WAVE)} col={i % WAVE} t={t} color={color} still={reduce} />
      ))}
    </View>
  );
}

const WAVE_CELL = 7;
const WAVE_GAP = 3;

function WaveCell({ row, col, t, color, still }: { row: number; col: number; t: SharedValue<number>; color: string; still: boolean }) {
  // Down along the diagonal over the first half of the loop, back from the centre out after it.
  const down = ((row + col) / ((WAVE - 1) * 2)) * 0.42;
  const up = 0.55 + (Math.hypot(row - 2, col - 2) / Math.hypot(2, 2)) * 0.3;
  const style = useAnimatedStyle(() => {
    if (still) return { transform: [{ scale: (row + col) % 2 === 0 ? 1 : 0.34 }] };
    const x = t.value;
    const fold = Math.min(1, Math.max(0, (x - down) / 0.1));
    const back = Math.min(1, Math.max(0, (x - up) / 0.12));
    return { transform: [{ scale: 1 - 0.66 * fold + 0.66 * back }] };
  });
  return <Animated.View style={[{ width: WAVE_CELL, height: WAVE_CELL, backgroundColor: color }, style]} />;
}

// ------------------------------------------------------------------ the Sessions doorway

/**
 * The block at the top of Sessions while something is running: a band in the builder's hue that
 * opens mission control, the same words as its summary ("1 needs you", "2 running"), the top
 * session's sentence under them in mission control's order, and the crew along its foot. A
 * session the engine called done is finished here as on the grid, never running.
 *
 * `onPress` is accepted for the caller that still passes one and is not used: the band opens
 * `/live`, and the tile there opens the session.
 */
export function LiveSessions({
  sessions,
}: {
  sessions: SessionDetail[];
  /** Unused: the band opens mission control. */
  onPress?: (id: string) => void;
}) {
  const router = useRouter();
  const focused = useIsFocused();
  const now = useNow(CLOCK_TICK_MS, focused);
  const accent = useAccent();
  const { width } = useWindowDimensions();
  const names = useRepoNames();
  const rows = useMemo(() => visibleRows(sessions, [], new Map(), now), [sessions, now]);
  const crew = useMemo(() => crewFor(rows), [rows]);
  if (rows.length === 0 || !accent.ready) return null;

  const models = new Map(rows.map((s) => [s.id, tileModel(s, now, names)] as const));
  const order = missionOrderIds(rows, now);
  const head = summaryHead([...models.values()]);
  if (!head) return null;
  const first = models.get(order[0] ?? '') ?? null;
  const inner = width - layout.gutter * 2 - GUTTER * 2;
  const size = fitSize(`${head.figure} ${head.word}`, inner, 48, 30);
  const big = figure(size, ON_HUE);

  return (
    <StandaloneReveal>
      <Band
        hue={bandHue(accent)}
        title="Live now"
        onPress={() => router.push('/live')}
        accessibilityLabel={`${head.label}. Opens mission control`}
      >
        <BandWords delay={240}>
          <View style={styles.headline} accessible accessibilityLabel={`${head.figure} ${head.word}`}>
            <LiveNum value={head.figure} final={String(head.figure)} figure={{ kind: 'count' }} textStyle={big} delay={300} />
            <T allowFontScaling={false} style={big}>{` ${head.word}`}</T>
          </View>
        </BandWords>
        {head.lines.map((l, i) => (
          <BandWords key={l} delay={340 + i * 60}>
            <T maxFontSizeMultiplier={1.3} style={i === 0 ? kitType.bandCaption : kitType.bandNote}>
              {l}
            </T>
          </BandWords>
        ))}
        {first ? (
          <BandWords delay={420}>
            <T maxFontSizeMultiplier={1.3} style={kitType.bandNote}>
              {`${first.repo}: ${first.sentence}`}
            </T>
          </BandWords>
        ) : null}
        <CrewRow creatures={order.map((id) => crew.get(id)).filter((c): c is Animal => c !== undefined)} delay={440} />
      </Band>
    </StandaloneReveal>
  );
}

const styles = StyleSheet.create({
  // 8 a side: the system island's own expanded margin, so the stage reads as that shape.
  stageWrap: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 14 },
  screen: { flex: 1, backgroundColor: GROUND.bg },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 96 },
  contentEmpty: { paddingBottom: 0 },
  pad: { paddingHorizontal: GUTTER, paddingTop: 28 },
  note: { paddingHorizontal: layout.gutter, paddingTop: 14, paddingBottom: 4 },
  after: { paddingHorizontal: layout.gutter, paddingTop: 22 },
  grid: { paddingHorizontal: layout.gutter, paddingTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap },
  waiting: { alignItems: 'flex-start', gap: 18, paddingTop: 24 },
  stateBlock: { gap: 12 },
  headline: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  crew: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  empty: { gap: 14, paddingTop: 12 },
  emptyHead: { marginTop: 6 },
  spacer: { flexGrow: 1 },
  lastLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  shrink: { flexShrink: 1 },
  arrow: { width: 15, height: 15 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8 },
  wave: { width: WAVE * WAVE_CELL + (WAVE - 1) * WAVE_GAP, flexDirection: 'row', flexWrap: 'wrap', gap: WAVE_GAP },
});
