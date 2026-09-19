/**
 * The Sessions tab, in the house style (design-refs/HOUSE-STYLE.md): this week's hours on the
 * ground in the builder's own ink (its own head, not the hue band every tab used to open on) with the week drawn
 * as seven bars, then the sessions as OPEN rows, no card round any of them, each
 * marked by its creature in its hue, its title, its active time, the tool's real logo and the
 * repository, and its strip drawn on once.
 *
 * Borrowed, concretely:
 *   - Strava's feed (design-md/fitness/strava): every activity is its route over its numbers, the
 *     title 17 semibold and the stat beside it bold and tabular; an activity nobody titled is
 *     named for its day and the part of it ("Tuesday Morning Run"), and so is a session with no
 *     title here (`page.untitledName`). Pull to refresh wears the brand colour.
 *   - Spotify's track row (design-md/music/spotify): the art in a square slot, the title and the
 *     artist stacked beside it, a transparent row that only highlights under a finger. The art is
 *     the session's creature.
 *   - react-bits AnimatedList (design-refs/react-bits/src/ts-default/Components/AnimatedList,
 *     through its port `ui/bits/components/AnimatedList.tsx`): the first load staggers in, 40 ms
 *     apart, the eighth on as a block; a new session lands at the top and pushes the rest down;
 *     a refresh with the same rows is not an entrance.
 *
 * Every state is designed: the band flat while the first answer is on its way, the sample with
 * one sentence and the word to sign in, the error inline, one quiet line when a sync failed over
 * saved sessions, and a sentence with the one thing that fills the page when there are none yet.
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { morphOpen } from '../motion/MorphNav';
import { Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import type { Profile, SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api, SAMPLE_SESSION } from '../data/client';
import { useRepoNames } from '../data/repoNames';
import { Band, BandWords } from '../insights/Band';
import { CreatureMark } from '../insights/Creature';
import { figure as figureStyle, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { fitSize } from '../insights/format';
import { Num } from '../insights/Num';
import { creatureHue, GROUND } from '../insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import { useChapterStages, useRevealScroll } from '../insights/RevealScroll';
import { crewFor, LIVE_REFRESH_MS } from '../live/LiveSessions';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { recapEligible } from '../recap/format';
import { decodeMarks } from '../strip/decode';
import { TRACK_HEIGHT } from '../strip/layout';
import { StripDraw, stripDoneAt, useOwnClock } from '../strip/StripDraw';
import { useAccent } from '../theme/accent';
import { WordLink } from '../nav/chrome';
import { showWeekShare } from '../share/WeekShare';
import { AnimatedList } from '../ui/bits/components';
import { useReduceMotion } from '../ui/motion';
import { crewBase, type CrewCreature } from './crew';
import { extendReach, LIST_MAX, LIST_PAGE, listEnd, mergeReach, reachOfPage, sentence, type ListMode, type Reach } from './listReach';
import { rowOf } from './page';
import { Door } from './parts';
import { ROW_FIGURE } from './type';
import { lastWeekOf, lastWeekShown, QUIET_WEEK, sameDaysLastWeek, WEEK_OFFERED_KEY, weekFigure, weekOf, weekRows, type WeekModel } from './week';
import { WEEK_BARS_WIDTH, WeekBars } from './WeekBars';
import { HERE, TRY_AGAIN } from '../copy/device';

/** Rows drawn in the first commit; the rest mount a moment later, still (a page of fifty canvases mounted at once starves the first frames). */
const FIRST_ROWS = 12;
/** Rows whose strip traces as the list arrives; the ones further down are drawn at rest. */
const TRACED_ROWS = 10;
/** The mark in a row's art slot: whole points per cell (2 pt a cell). */
const MARK = 32;
const MARK_GAP = 14;
const STRIP_SWEEP_MS = 620;
/** Points from the end of the list at which a scroll that stops there reads the next page: about a screen. */
const END_REACH = 900;

/**
 * Finished sessions read for the week card. MEASURED on the local stack's corpus: its busiest day
 * held 64 sessions (2026-09-12), so a week of parallel agents can run past one day's worth; the card
 * names three, and the longest are what it needs.
 */
const WEEK_READ = 200;

export function SessionsScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const accent = useAccent();
  const reduced = useReduceMotion();
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [live, setLive] = useState<SessionDetail[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileRead, setProfileRead] = useState(false);
  // The first sync has answered (or failed): only then is an empty list a finding.
  const [synced, setSynced] = useState(false);

  // What the list holds and how far back it has read (`listReach.ts`): the sessions you were there
  // for at least 20 minutes by default, read a page further back each time it is scrolled to its
  // end. Refs as well as state: the loads below run from timers and focus callbacks.
  const [mode, setModeState] = useState<ListMode>('notable');
  const modeRef = useRef<ListMode>('notable');
  const reachRef = useRef<Record<ListMode, Reach | null>>({ notable: null, every: null });
  const [reach, setReachState] = useState<Reach | null>(null);
  const [older, setOlder] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const olderBusy = useRef(false);
  const shownRef = useRef<SessionDetail[]>([]);
  const signedInRef = useRef<boolean | null>(null);

  const showRows = useCallback((rows: SessionDetail[]) => {
    shownRef.current = rows;
    setSessions(rows);
  }, []);
  const setReach = useCallback((m: ListMode, r: Reach | null) => {
    reachRef.current[m] = r;
    if (modeRef.current === m) setReachState(r);
  }, []);
  /** The saved rows of a mode, down to its reach; the newest page's worth while the server has not answered. */
  const readList = useCallback((m: ListMode) => {
    const r = reachRef.current[m];
    return cache.listFinished(m, r?.from ?? null, r ? LIST_MAX : LIST_PAGE);
  }, []);
  /** The saved rows of a mode on screen, unless the list moved to the other while they were read. */
  const showMode = useCallback(
    async (m: ListMode) => {
      const rows = await readList(m);
      if (modeRef.current === m) showRows(rows);
    },
    [readList, showRows],
  );
  /**
   * The top of the list as the server has it now, merged into the reach the list had: the sync's own
   * first page for the default list, and a page of every session for the other.
   */
  const refreshTop = useCallback(
    async (m: ListMode, prevNewest: string | null) => {
      if (m === 'notable') {
        const first = cache.syncedFirstPage();
        if (first) setReach(m, mergeReach(reachRef.current[m], reachOfPage(first.startedAt.map((started_at) => ({ started_at })), first.nextBefore), prevNewest));
        return;
      }
      const page = await cache.readPage(api, { before: null, notableOnly: false, limit: LIST_PAGE });
      setReach(m, mergeReach(reachRef.current[m], reachOfPage(page.rows, page.next_before), prevNewest));
      // The strips of the rows the sync never reads (it reads the default list's): they draw as they land.
      void cache.fillDetails(api, page.rows.map((s) => s.id)).then(() => showMode(m));
    },
    [setReach, showMode],
  );

  const load = useCallback(async (withProfile: boolean) => {
    const m = modeRef.current;
    // Cache first, always. On a cold launch over cellular this is the difference between real
    // content immediately and a spinner; with the network gone, saved rows beat an empty screen.
    const [cached, savedLive, savedProfile] = await Promise.all([readList(m), cache.listLive(), withProfile ? cache.getProfile() : Promise.resolve(null)]);
    if (cached.length && modeRef.current === m) showRows(cached);
    setLive(savedLive);
    if (savedProfile) setProfile(savedProfile);

    const isIn = await api.isSignedIn();
    setSignedIn(isIn);
    signedInRef.current = isIn;
    if (!isIn) {
      showRows(cached.length ? cached : [SAMPLE_SESSION]);
      setLive([]);
      setProfileRead(true);
      return;
    }
    try {
      await cache.sync(api);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reach the server');
    }
    setSynced(true);
    if (m === 'notable' || withProfile) {
      try {
        await refreshTop(m, shownRef.current[0]?.started_at ?? null);
      } catch {
        // The saved rows stay, and the end of the list does not claim to be all of them.
      }
    }
    // Whatever the sync managed to save is shown, banner or not.
    await showMode(m);
    setLive(await cache.listLive());
    if (withProfile) {
      // The week on the band is the profile's graph, never the list's sum (`week.ts`).
      try {
        const fresh = await api.profile();
        await cache.putProfile(fresh);
        setProfile(fresh);
      } catch {
        // The saved profile stays; without one the band says so in a sentence.
      }
      setProfileRead(true);
    }
  }, [readList, refreshTop, showMode, showRows]);

  /** A page further back than the list reaches, saved, then its strips. */
  const loadOlder = useCallback(async () => {
    const m = modeRef.current;
    const r = reachRef.current[m];
    if (olderBusy.current || signedInRef.current !== true || (r && !r.more)) return;
    const before = r?.from ?? shownRef.current[shownRef.current.length - 1]?.started_at ?? null;
    if (!before) return;
    olderBusy.current = true;
    setOlder({ loading: true, error: null });
    try {
      const page = await cache.readPage(api, { before, notableOnly: m === 'notable', limit: LIST_PAGE });
      if (modeRef.current !== m) return;
      setReach(m, extendReach(r ?? { from: before, more: true }, page.rows, page.next_before));
      await showMode(m);
      setOlder({ loading: false, error: null });
      await cache.fillDetails(api, page.rows.map((s) => s.id));
      await showMode(m);
    } catch (e) {
      setOlder({ loading: false, error: e instanceof Error && e.message ? e.message : 'could not reach the server' });
    } finally {
      olderBusy.current = false;
    }
  }, [setReach, showMode]);

  // Scrolled to within a screen of its end, the list reads the next page on its own; after a
  // failure it waits for the door to be tapped, so a dead connection is not asked again every flick.
  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      if (contentOffset.y + layoutMeasurement.height < contentSize.height - END_REACH) return;
      const r = reachRef.current[modeRef.current];
      if (r?.more && !older.error) void loadOlder();
    },
    [loadOlder, older.error],
  );

  const switchMode = useCallback(
    async (m: ListMode) => {
      modeRef.current = m;
      setModeState(m);
      setReachState(reachRef.current[m]);
      setOlder({ loading: false, error: null });
      const saved = await readList(m);
      if (modeRef.current !== m) return;
      showRows(saved);
      try {
        await refreshTop(m, saved[0]?.started_at ?? null);
      } catch (e) {
        setOlder({ loading: false, error: e instanceof Error && e.message ? e.message : 'could not reach the server' });
      }
      await showMode(m);
    },
    [readList, refreshTop, showMode, showRows],
  );

  // On focus, not on mount: coming back from Settings after signing in shows the person's own
  // sessions without a pull. While focused, the list re-syncs on the live list's own beat so a
  // running session's numbers move; the profile is read once per focus, not every beat.
  useFocusEffect(
    useCallback(() => {
      void load(true);
      const timer = setInterval(() => void load(false), LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const page = usePageReveal(reduced);
  const bandReady = signedIn !== null && accent.ready && (signedIn === false || profileRead || profile !== null);
  const { stage, hurry } = useChapterStages(1, bandReady);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, hurry);

  // One clock for the whole list, read once per load, so two rows never disagree about "the last
  // hour". The live band keeps its own ticking clock.
  const now = useMemo(() => Date.now(), [sessions, live]);
  // Each session's creature, from mission control's rule and its memory (`crew.ts`): a session
  // keeps the colour it was first drawn in, here, on the Now grid and on its page.
  const crew = useMemo(() => {
    const map = crewFor([...live, ...sessions].filter((s) => s.id !== 'sample'));
    return (s: SessionDetail): CrewCreature => (s.id === 'sample' ? crewBase(s.client_session_id) : (map.get(s.id) ?? crewBase(s.client_session_id || s.id)));
  }, [live, sessions]);

  const week = useMemo(() => (profile ? weekOf(profile.graph, Date.now()) : null), [profile]);
  // Monday to Wednesday, last week's card beside this week's (`week.lastWeekShown`).
  const lastWeek = useMemo(() => (profile ? lastWeekShown(profile.graph, Date.now()) : null), [profile]);
  const compare = useMemo(() => (profile ? sameDaysLastWeek(profile.graph, Date.now()) : null), [profile]);
  // The card names the week's longest sessions from every finished one the phone has, not only the
  // rows this list is showing (it opens on the notable ones).
  const shareWeek = useCallback(
    async (w: WeekModel) => {
      const all = await cache.listSessions(WEEK_READ).catch((): SessionDetail[] => sessions);
      showWeekShare(w, weekRows(all.length ? all : sessions, w), { animal: accent.animal, ink: accent.ink });
    },
    [sessions, accent.animal, accent.ink],
  );
  // Monday's notification opens here with `card=last-week` (`push/weekly`): the card goes up once
  // the profile has the week, and the week counts as offered so the island does not say it again.
  const { card } = useLocalSearchParams<{ card?: string }>();
  const cardShown = useRef(false);
  useEffect(() => {
    if (card !== 'last-week' || !profile || cardShown.current) return;
    cardShown.current = true;
    const last = lastWeekOf(profile.graph, Date.now());
    void cache.setKv(WEEK_OFFERED_KEY, last.days[0]!.date).catch(() => undefined);
    router.setParams({ card: undefined });
    if (last.seconds > 0) void shareWeek(last);
  }, [card, profile, router, shareWeek]);
  const shown = stage >= 1 ? sessions : sessions.slice(0, FIRST_ROWS);
  const inner = width - GUTTER * 2;
  const stripWidth = inner - MARK - MARK_GAP;
  const rowRefs = useRef(rowViews());
  // The project names, read once for the whole list rather than once a row (`data/repoNames`).
  const names = useRepoNames();
  // The end of the list, once every row is on screen: what it holds, how far back, and the door on.
  const end =
    signedIn === true && stage >= 1
      ? listEnd({ mode, shown: sessions.length, oldest: sessions[sessions.length - 1]?.started_at ?? null, reach, now, failed: older.error })
      : null;
  const onDoor = useCallback(
    (act: 'older' | 'every' | 'notable') => {
      if (act === 'older') {
        setOlder({ loading: false, error: null });
        void loadOlder();
        return;
      }
      void switchMode(act);
      scrollRef.current?.scrollTo({ y: 0, animated: !reduced });
    },
    [loadOlder, switchMode, scrollRef, reduced],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={onScrollEnd}
      onScrollEndDrag={onScrollEnd}
      onLayout={onLayout}
      refreshControl={signedIn === false ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={accent.ink} />}
    >
      <RevealPage page={page}>
        {/* The live band that sat here said, larger, what the island at the top of the screen is
            already saying on every tab (docs/motion.md): two surfaces for one fact is one too
            many, and it was the first of three identical hue slabs down this screen. The island
            is the doorway into mission control now. The week is the top of Sessions. */}
        {bandReady ? (
          <Section>
            {signedIn === false ? (
              <Band hue={accent} title="A sample">
                <BandWords delay={260}>
                  <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                    You are browsing a sample session.
                  </Text>
                </BandWords>
                <BandWords delay={340}>
                  <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.bandNote]}>
                    Sign in and your own land here, every one your Mac finishes. Nothing syncs until you do.
                  </Text>
                </BandWords>
              </Band>
            ) : (
              // The week on the ground, in the builder's ink, never as a hue slab: Sessions is the
              // list, and its head is set like a page, not like every other screen's chapter.
              <WeekGround
                week={week}
                ink={accent.ink}
                width={width}
                onShare={week && week.seconds > 0 ? () => void shareWeek(week) : undefined}
                onShareLast={lastWeek ? () => void shareWeek(lastWeek) : undefined}
                compare={compare}
              />
            )}
            {signedIn === false ? (
              <Block style={styles.pad}>
                <Door title="Sign in" line="In Settings, the gear on You." color={accent.ink} onPress={() => router.push('/settings')} hairline={false} />
              </Block>
            ) : null}
          </Section>
        ) : (
          <View style={styles.flatBand} accessibilityLabel="Loading your sessions" accessible />
        )}

        {error && sessions.length > 0 ? (
          <View style={styles.lead}>
            <Words style={type.meta}>{`Showing saved sessions. ${sentence(error)}`}</Words>
          </View>
        ) : null}
        {error && sessions.length === 0 ? (
          <View style={styles.lead}>
            <Words style={type.heading}>Could not load your sessions.</Words>
            <View style={styles.after}>
              <Refusal>{`${sentence(error)} ${TRY_AGAIN}`}</Refusal>
            </View>
          </View>
        ) : null}
        {signedIn && synced && sessions.length === 0 && live.length === 0 && !error ? (
          <View style={styles.lead}>
            <Words style={type.heading}>No sessions yet.</Words>
            <Words style={[type.dim, styles.after]}>Pair your Mac and the first session you finish lands here, with its shape and its story.</Words>
            <Door title="Connect your Mac" color={accent.ink} onPress={() => router.push('/pair')} small />
          </View>
        ) : null}

        {shown.length > 0 ? (
          <View style={styles.group}>
            <View style={styles.kicker}>
              <Kicker>{signedIn === false ? 'the sample' : mode === 'every' ? 'every session' : 'finished'}</Kicker>
            </View>
            <AnimatedList
              scroll={false}
              data={shown}
              keyExtractor={(s) => s.id}
              onItemPress={(s) =>
                // The row lifts into a card and grows into its page (`motion/MorphNav.tsx`).
                morphOpen(
                  rowRefs.current.get(s.id) ?? null,
                  () => router.push(`/session/${s.id}?morph=1`),
                  { color: GROUND.card, radius: 18, ground: GROUND.bg },
                  `/session/${s.id}`,
                )
              }
              renderItem={({ item, index }) => (
                <FinishedRow
                  rowRef={(n) => {
                    rowRefs.current.set(item.id, n);
                  }}
                  session={item}
                  creature={crew(item)}
                  names={names}
                  index={index}
                  width={stripWidth}
                  now={now}
                  accent={accent.ink}
                  trace={!reduced && index < TRACED_ROWS}
                  onRecap={() => router.push(`/session/${item.id}?recap=1`)}
                />
              )}
            />
            {end ? (
              <View style={styles.end}>
                <Words style={type.dim}>{end.words}</Words>
                {end.note ? <Words style={[type.meta, styles.endNote]}>{end.note}</Words> : null}
                {end.door ? (
                  <Door
                    title={end.door.title}
                    line={end.door.line}
                    color={accent.ink}
                    small
                    busy={end.door.act === 'older' && older.loading}
                    onPress={() => onDoor(end.door!.act)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </RevealPage>
    </Animated.ScrollView>
  );
}

/**
 * The week on the ground, under the live band: the same number and the same seven bars, in the
 * builder's ink instead of on a band of it.
 */
function WeekGround({
  week,
  ink,
  width,
  onShare,
  onShareLast,
  compare,
}: {
  week: ReturnType<typeof weekOf> | null;
  ink: string;
  width: number;
  onShare?: () => void;
  onShareLast?: () => void;
  /** "Same days last week: 7.2 hours" (`week.sameDaysLastWeek`), or null. */
  compare?: string | null;
}) {
  const figure = week ? weekFigure(week) : null;
  const inner = width - GUTTER * 2;
  return (
    <Block style={styles.groundWeek}>
      <Kicker>this week</Kicker>
      {week === null ? (
        <Refusal>{`Your hours arrive with your profile, the next time ${HERE} reaches Builda. ${TRY_AGAIN}`}</Refusal>
      ) : (
        <View style={styles.weekRow}>
          <View style={styles.weekWords}>
            {figure ? (
              <>
                <Num spec={figure.num} textStyle={figureStyle(fitSize(figure.num.final, inner - WEEK_BARS_WIDTH - 16, 72, 44), ink)} delay={80} />
                <Words style={type.lead}>{figure.caption}</Words>
                <Words style={type.dim}>{figure.note}</Words>
                {compare ? <Words style={type.dim}>{compare}</Words> : null}
                {onShare ? (
                  <View style={{ marginTop: 6 }}>
                    <WordLink title="Share this week" onPress={onShare} accessibilityHint="A card of this week's hours and longest sessions, for any app" />
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Words style={type.lead}>{QUIET_WEEK}</Words>
                {compare ? <Words style={type.dim}>{compare}</Words> : null}
              </>
            )}
            {onShareLast ? (
              <View style={{ marginTop: figure ? 0 : 6 }}>
                <WordLink title="Share last week" onPress={onShareLast} accessibilityHint="A card of last week's hours and longest sessions, for any app" />
              </View>
            ) : null}
          </View>
          <WeekBars week={week} delay={160} color={ink} />
        </View>
      )}
    </Block>
  );
}

/** A finished session, as an open row: its creature, its title and time, the tool and the repository, its strip. */
function FinishedRow({
  session: s,
  creature,
  names,
  index,
  width,
  now,
  accent,
  trace,
  onRecap,
  rowRef,
}: {
  /** The row's own view, so opening it can grow out of exactly this rectangle. */
  rowRef?: (n: View | null) => void;
  session: SessionDetail;
  creature: CrewCreature;
  /** A private project as the Projects tab names it ("Private project 2"), `copy/repoLabel`. */
  names: ReturnType<typeof useRepoNames>;
  index: number;
  width: number;
  now: number;
  accent: string;
  trace: boolean;
  onRecap: () => void;
}) {
  const row = rowOf(s, now, names);
  const hue = creatureHue(creature);
  // Finished in the last hour and not yet posted: the recap a push would have opened, for the
  // person who dismissed the banner or never got one. A word in the accent, an act.
  const recap = recapEligible(s, now);
  return (
    <View ref={rowRef} collapsable={false} style={[styles.row, index > 0 ? styles.hairTop : null]}>
      <View style={styles.rowHead}>
        <View style={styles.mark}>
          <CreatureMark animal={creature} size={MARK} color={hue.ink} />
        </View>
        <View style={styles.rowWords}>
          <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={type.lead}>
            {row.title}
          </Text>
          <View style={styles.meta}>
            <HarnessLogo harness={row.harness} size={13} color={GROUND.dim} />
            {/* Two lines on a narrow phone: FOUND ON AN iPHONE SE, one line cut the start time to "Sep 12, 7:...". */}
            <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={[type.meta, styles.metaText]} accessibilityLabel={`${row.harnessName}, ${row.meta}`}>
              {row.meta}
            </Text>
          </View>
        </View>
        <Text allowFontScaling={false} style={[ROW_FIGURE, styles.figure]}>
          {row.figure}
        </Text>
      </View>
      <View style={styles.stripSlot}>
        {s.strip ? (
          <RowStrip session={s} width={width} trace={trace} index={index} />
        ) : s.strip === null ? (
          // A header only session has no per event detail: Cursor drops message bodies at about
          // 60 days. Saying so is better than an empty bar that reads as a bug.
          <Words style={type.meta}>The timeline was not kept for this session.</Words>
        ) : (
          // Not read yet: the list endpoint sends no strip and the sync fetches it. The row keeps
          // the strip's place, so nothing moves when it arrives and traces.
          <View style={styles.stripWaiting} />
        )}
        {recap ? (
          <Pressable onPress={onRecap} accessibilityRole="button" accessibilityLabel="Open the recap for this session" hitSlop={10} style={({ pressed }) => [styles.recap, { opacity: pressed ? 0.55 : 1 }]}>
            <Text maxFontSizeMultiplier={1.4} style={[type.lead, { color: accent }]}>
              Open the recap
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A row's strip, traced once as its row arrives (a little after it, so the row lands first). */
function RowStrip({ session: s, width, trace, index }: { session: SessionDetail; width: number; trace: boolean; index: number }) {
  const strip = s.strip!;
  const marks = useMemo(() => decodeMarks(strip.marks), [strip.marks]);
  const delay = 260 + Math.min(index, 8) * 60;
  const end = stripDoneAt(delay, STRIP_SWEEP_MS);
  const clock = useOwnClock(end, trace);
  return <StripDraw preset="mini" cols={strip.cols} marks={marks} spanMs={Math.max(1, strip.t1_ms - strip.t0_ms)} width={width} clock={clock} delay={delay} sweepMs={STRIP_SWEEP_MS} />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: 120 },
  flatBand: { height: 220, backgroundColor: GROUND.raised },
  groundWeek: { paddingHorizontal: GUTTER, marginTop: 28 },
  bandNote: { marginTop: 6 },
  pad: { paddingHorizontal: GUTTER, marginTop: 8 },
  lead: { paddingHorizontal: GUTTER, paddingTop: 20, gap: 2 },
  after: { marginTop: 6, marginBottom: 6 },
  group: { marginTop: 26 },
  kicker: { paddingHorizontal: GUTTER },
  weekRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 2 },
  weekWords: { flex: 1 },
  row: { marginHorizontal: GUTTER, paddingVertical: 16 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: MARK_GAP },
  mark: { width: MARK, height: MARK, marginTop: 1 },
  rowWords: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1 },
  figure: { color: GROUND.text, marginTop: -1 },
  stripWaiting: { height: TRACK_HEIGHT.mini, borderBottomWidth: 1, borderBottomColor: GROUND.border },
  stripSlot: { marginLeft: MARK + MARK_GAP, marginTop: 12, gap: 10 },
  recap: { alignSelf: 'flex-start' },
  end: { marginHorizontal: GUTTER, marginTop: 8, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border, gap: 2 },
  endNote: { marginTop: 6, marginBottom: 4 },
});


/** Each row's view by session id, so a row can grow into its page (`motion/MorphNav.tsx`). */
function rowViews(): Map<string, View | null> {
  return new Map();
}
