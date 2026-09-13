/**
 * The Sessions tab, in the house style (design-refs/HOUSE-STYLE.md): a band in the builder's own
 * hue (the accent is their creature's colour) with this week's hours counting up and the week
 * drawn as seven bars in its ink, then the sessions as OPEN rows, no card round any of them, each
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
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { Profile, SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api, SAMPLE_SESSION } from '../data/client';
import { Band, BandWords } from '../insights/Band';
import { CreatureMark } from '../insights/Creature';
import { BandFigure, figure as figureStyle, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { fitSize } from '../insights/format';
import { Num } from '../insights/Num';
import { creatureHue, GROUND } from '../insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import { useChapterStages, useRevealScroll } from '../insights/RevealScroll';
import { crewFor, LIVE_REFRESH_MS, LiveSessions } from '../live/LiveSessions';
import { summaryHead, tileModel, visibleRows } from '../live/mission';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { recapEligible } from '../recap/format';
import { decodeMarks } from '../strip/decode';
import { TRACK_HEIGHT } from '../strip/layout';
import { StripDraw, stripDoneAt, useOwnClock } from '../strip/StripDraw';
import { useAccent } from '../theme/accent';
import { AnimatedList } from '../ui/bits/components';
import { useReduceMotion } from '../ui/motion';
import { crewBase, type CrewCreature } from './crew';
import { rowOf } from './page';
import { Door } from './parts';
import { ROW_FIGURE } from './type';
import { CREW_WINDOW } from './useCrew';
import { QUIET_WEEK, weekFigure, weekOf } from './week';
import { WEEK_BARS_WIDTH, WeekBars } from './WeekBars';

/** Rows drawn in the first commit; the rest mount a moment later, still (a page of fifty canvases mounted at once starves the first frames). */
const FIRST_ROWS = 12;
/** Rows whose strip traces as the list arrives; the ones further down are drawn at rest. */
const TRACED_ROWS = 10;
/** The mark in a row's art slot: whole points per cell (2 pt a cell). */
const MARK = 32;
const MARK_GAP = 14;
const STRIP_SWEEP_MS = 620;

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

  const load = useCallback(async (withProfile: boolean) => {
    // Cache first, always. On a cold launch over cellular this is the difference between real
    // content immediately and a spinner; with the network gone, saved rows beat an empty screen.
    const [cached, savedLive, savedProfile] = await Promise.all([cache.listSessions(CREW_WINDOW), cache.listLive(), withProfile ? cache.getProfile() : Promise.resolve(null)]);
    if (cached.length) setSessions(cached);
    setLive(savedLive);
    if (savedProfile) setProfile(savedProfile);

    const isIn = await api.isSignedIn();
    setSignedIn(isIn);
    if (!isIn) {
      setSessions(cached.length ? cached : [SAMPLE_SESSION]);
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
    // Whatever the sync managed to save is shown, banner or not.
    setSessions(await cache.listSessions(CREW_WINDOW));
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
  }, []);

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
  // Whether the live surface's band shows (`LiveSessions` renders nothing otherwise): its rule.
  const liveBand = useMemo(() => {
    const rows = visibleRows(live, [], new Map(), now);
    return rows.length > 0 && summaryHead(rows.map((r) => tileModel(r, now))) !== null;
  }, [live, now]);
  // Each session's creature, from mission control's rule and its memory (`crew.ts`): a session
  // keeps the colour it was first drawn in, here, on the Now grid and on its page.
  const crew = useMemo(() => {
    const map = crewFor([...live, ...sessions].filter((s) => s.id !== 'sample'));
    return (s: SessionDetail): CrewCreature => (s.id === 'sample' ? crewBase(s.client_session_id) : (map.get(s.id) ?? crewBase(s.client_session_id || s.id)));
  }, [live, sessions]);

  const week = useMemo(() => (profile ? weekOf(profile.graph, Date.now()) : null), [profile]);
  const shown = stage >= 1 ? sessions : sessions.slice(0, FIRST_ROWS);
  const inner = width - GUTTER * 2;
  const stripWidth = inner - MARK - MARK_GAP;
  const open = useCallback((id: string) => router.push(`/session/${id}`), [router]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onLayout={onLayout}
      refreshControl={signedIn === false ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={accent.ink} />}
    >
      <RevealPage page={page}>
        {/* While something runs, the top band is the live surface's (`live/LiveSessions.tsx`, the
            Sessions doorway into mission control), in the builder's hue; the week follows on the
            ground, so two bands of one hue never meet. Otherwise the week is the top band. */}
        {liveBand && accent.ready ? <LiveSessions sessions={live} /> : null}
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
            ) : liveBand ? (
              <WeekGround week={week} ink={accent.ink} width={width} />
            ) : (
              <WeekBand week={week} accent={accent} width={width} />
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
              <Refusal>{`${sentence(error)} Pull down to try again.`}</Refusal>
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
              <Kicker>{signedIn === false ? 'the sample' : 'finished'}</Kicker>
            </View>
            <AnimatedList
              scroll={false}
              data={shown}
              keyExtractor={(s) => s.id}
              onItemPress={(s) => open(s.id)}
              renderItem={({ item, index }) => (
                <FinishedRow
                  session={item}
                  creature={crew(item)}
                  index={index}
                  width={stripWidth}
                  now={now}
                  accent={accent.ink}
                  trace={!reduced && index < TRACED_ROWS}
                  onRecap={() => router.push(`/session/${item.id}?recap=1`)}
                />
              )}
            />
          </View>
        ) : null}
      </RevealPage>
    </Animated.ScrollView>
  );
}

/** A message as a sentence: its first letter up, one full stop at the end. */
function sentence(message: string): string {
  const t = message.trim();
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/** This week: the hours counting up, the days it took, and the week as seven bars in the band's ink. */
function WeekBand({ week, accent, width }: { week: ReturnType<typeof weekOf> | null; accent: ReturnType<typeof useAccent>; width: number }) {
  const inner = width - GUTTER * 2;
  const figure = week ? weekFigure(week) : null;
  return (
    <Band hue={accent} title="This week">
      {week === null ? (
        <BandWords delay={300}>
          <Refusal onHue>Your hours arrive with your profile, the next time this phone reaches Builda. Pull down to try.</Refusal>
        </BandWords>
      ) : (
        <View style={styles.weekRow}>
          <View style={styles.weekWords}>
            {figure ? (
              <>
                <BandFigure spec={figure.num} width={inner - WEEK_BARS_WIDTH - 16} max={108} min={52} delay={200} label={`${figure.num.final} ${figure.caption}`} />
                <BandWords delay={340}>
                  <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                    {figure.caption}
                  </Text>
                </BandWords>
                <BandWords delay={420}>
                  <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                    {figure.note}
                  </Text>
                </BandWords>
              </>
            ) : (
              <BandWords delay={300}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                  {QUIET_WEEK}
                </Text>
              </BandWords>
            )}
          </View>
          <WeekBars week={week} delay={320} />
        </View>
      )}
    </Band>
  );
}

/**
 * The week on the ground, under the live band: the same number and the same seven bars, in the
 * builder's ink instead of on a band of it.
 */
function WeekGround({ week, ink, width }: { week: ReturnType<typeof weekOf> | null; ink: string; width: number }) {
  const figure = week ? weekFigure(week) : null;
  const inner = width - GUTTER * 2;
  return (
    <Block style={styles.groundWeek}>
      <Kicker>this week</Kicker>
      {week === null ? (
        <Refusal>Your hours arrive with your profile, the next time this phone reaches Builda. Pull down to try.</Refusal>
      ) : (
        <View style={styles.weekRow}>
          <View style={styles.weekWords}>
            {figure ? (
              <>
                <Num spec={figure.num} textStyle={figureStyle(fitSize(figure.num.final, inner - WEEK_BARS_WIDTH - 16, 72, 44), ink)} delay={80} />
                <Words style={type.lead}>{figure.caption}</Words>
                <Words style={type.dim}>{figure.note}</Words>
              </>
            ) : (
              <Words style={type.lead}>{QUIET_WEEK}</Words>
            )}
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
  index,
  width,
  now,
  accent,
  trace,
  onRecap,
}: {
  session: SessionDetail;
  creature: CrewCreature;
  index: number;
  width: number;
  now: number;
  accent: string;
  trace: boolean;
  onRecap: () => void;
}) {
  const row = rowOf(s, now);
  const hue = creatureHue(creature);
  // Finished in the last hour and not yet posted: the recap a push would have opened, for the
  // person who dismissed the banner or never got one. A word in the accent, an act.
  const recap = recapEligible(s, now);
  return (
    <View style={[styles.row, index > 0 ? styles.hairTop : null]}>
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
            <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[type.meta, styles.metaText]} accessibilityLabel={`${row.harnessName}, ${row.meta}`}>
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
});

