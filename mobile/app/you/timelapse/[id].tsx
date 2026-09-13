/**
 * `builder://you/timelapse/<id>`: the time lapse (brief D8, docs/approved-roadmap.md 2.8), the
 * session replayed in fifteen seconds on its own codebase map, in the house style: "When a
 * session ends, replay it in fifteen seconds: the map lighting up, the knot where it got stuck,
 * the burst at the end."
 *
 *   the band     in the session's hue: the repository, and the figure is the replay's own clock,
 *                counting up from 0s as it plays; the whole in a sentence; the creature printed
 *   the map      the same islands, blooming in as empty slots, then lit as the frames play: each
 *                file turns over the first time it is touched (the braille flipwave), glows while
 *                it is in the working set, and leaves a thinning trail of the last six files
 *                (ShapeGrid's trail, PixelTrail's age, Strava's route). Inside the knot, its files
 *                pulse in the session's hue with rings going out (MagicRings). When the replay
 *                lands, a ripple crosses the map from the burst (PixelBlast) and the burst's files
 *                throw sparks (ClickSpark). A tap on a file sparks it and says what happened to it.
 *   the controls one round key to play and pause, where the replay is, Replay as a word, and the
 *                scrubber: a selection tick when a finger drags across a spike, the knot or the
 *                burst
 *
 * Plays once, on its own, as soon as the map has drawn itself; under Reduce Motion it opens on
 * the last frame and waits for Play. Only a running session has frames (the server deletes the
 * live state when it finalises), so a finished one says so and offers the session.
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Easing, runOnJS, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';

import type { SessionDetail } from '../../../src/data/api';
import type { LiveFile, LiveFrame, LiveState } from '../../../src/generated/live';
import { GUTTER, type, Words } from '../../../src/insights/kit';
import { GROUND } from '../../../src/insights/palette';
import { Block, Section, useClock } from '../../../src/insights/reveal';
import { widestLabel } from '../../../src/map/figure';
import { spanOf, spikeBins, trackBins } from '../../../src/map/frames';
import { buildReplay } from '../../../src/map/heat';
import { findBurst, findKnot } from '../../../src/map/knot';
import { layoutMap } from '../../../src/map/layout';
import { BLOOM_AT, MapCanvas, POP_MS } from '../../../src/map/MapCanvas';
import { MapError, MapLoading, MapMissing, MapPage, MapRefusal, MapSignedOut, SAMPLE_NOTE, StaleNote, useOpenSession } from '../../../src/map/MapParts';
import { Legend, ReplayControls, ReplayFigure, SessionBand } from '../../../src/map/MapWords';
import { bloomDelays, bloomEnd, bloomWaves } from '../../../src/map/paint';
import { Scrubber } from '../../../src/map/Scrubber';
import { usePlayback } from '../../../src/map/usePlayback';
import { useSessionMap } from '../../../src/map/useSessionMap';
import {
  burstSentence,
  cellCaption,
  elapsedLabel,
  knotSentence,
  legend,
  mapSummary,
  offMapNote,
  replayNote,
  rolesOnMap,
  TAP_HINT,
  thinnedNote,
  timelapseContent,
  timelapseTitle,
} from '../../../src/map/view';
import { useAccent, type AccentState } from '../../../src/theme/accent';
import { snap } from '../../../src/ui/haptics';
import { useReduceMotion } from '../../../src/ui/motion';

/** One empty knot, so a render outside the knot hands the canvas the same array. */
const NO_CELLS: readonly number[] = [];

/** How long after the last cell lands the replay starts on its own. */
const AUTOPLAY_AFTER_MS = 260;

export default function TimelapseScreen() {
  const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const accent = useAccent();
  const { load, refresh, refreshing, now } = useSessionMap(id, variant, { poll: false });
  const openSession = useOpenSession(id ?? 'sample', variant);
  const retry = useCallback(() => void refresh(), [refresh]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/sessions')), [router]);
  const ready = load.kind === 'ready' && accent.ready;

  return (
    <MapPage title="Time lapse" refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : retry}>
      {load.kind === 'loading' || (load.kind === 'ready' && !accent.ready) ? <MapLoading sentence="Getting the replay ready." /> : null}
      {load.kind === 'signedOut' ? <MapSignedOut what="time lapse" accent={accent.ink} onSignIn={() => router.push('/settings')} /> : null}
      {load.kind === 'missing' ? <MapMissing accent={accent.ink} onBack={back} /> : null}
      {load.kind === 'error' ? <MapError message={load.message} accent={accent.ink} onRetry={retry} /> : null}
      {ready && load.stale ? <StaleNote text={load.stale} /> : null}
      {ready ? <TimelapseBody session={load.session} now={now} width={width} height={height} accent={accent} onSession={openSession} onRetry={retry} /> : null}
    </MapPage>
  );
}

function TimelapseBody({
  session,
  now,
  width,
  height,
  accent,
  onSession,
  onRetry,
}: {
  session: SessionDetail;
  now: number;
  width: number;
  height: number;
  accent: AccentState;
  onSession: () => void;
  onRetry: () => void;
}) {
  const content = useMemo(() => timelapseContent(session), [session]);
  const title = session.repo_name ?? 'This session';
  if (content.kind !== 'ready') {
    return (
      <MapRefusal
        kind={content.kind}
        screen="timelapse"
        session={session}
        now={now}
        onSession={onSession}
        onRetry={onRetry}
        hue={accent}
        animal={accent.animal}
        title={title}
        width={width}
        accent={accent.ink}
      />
    );
  }
  return (
    <Replayer
      session={session}
      state={content.state}
      files={content.files}
      frames={content.frames}
      names={content.names}
      now={now}
      width={width}
      height={height}
      title={title}
      accent={accent}
    />
  );
}

function cellsOf(ids: readonly string[], index: Readonly<Record<string, number>>): number[] {
  return ids.map((i) => index[i]).filter((i): i is number => i !== undefined);
}

/** Starts the replay once its block's clock passes `at`: the map has drawn itself by then. */
function AutoPlay({ at, onReady }: { at: number; onReady: () => void }) {
  const clock = useClock();
  useAnimatedReaction(
    () => clock.value >= at,
    (on, was) => {
      if (on && !was) runOnJS(onReady)();
    },
    [at],
  );
  return null;
}

function Replayer({
  session,
  state,
  files,
  frames,
  names,
  now,
  width,
  height,
  title,
  accent,
}: {
  session: SessionDetail;
  state: LiveState;
  files: LiveFile[];
  frames: LiveFrame[];
  names: Record<string, string> | null;
  now: number;
  width: number;
  height: number;
  title: string;
  accent: AccentState;
}) {
  const reduce = useReduceMotion();
  const lay = useMemo(() => layoutMap(files), [files]);
  const replay = useMemo(() => buildReplay(frames, lay.index, lay.cells.length), [frames, lay]);
  const span = Math.max(1, spanOf(frames));
  const knot = useMemo(() => findKnot(frames), [frames]);
  const burst = useMemo(() => findBurst(frames, knot), [frames, knot]);
  const knotCells = useMemo(() => cellsOf(knot?.files ?? [], lay.index), [knot, lay]);
  const burstCells = useMemo(() => cellsOf(burst?.files ?? [], lay.index), [burst, lay]);
  const bins = useMemo(() => trackBins(frames, span), [frames, span]);
  const spikes = useMemo(() => spikeBins(bins), [bins]);
  const roles = useMemo(() => rolesOnMap(files), [files]);
  const landed = useMemo(() => bloomEnd(bloomDelays(bloomWaves(lay), BLOOM_AT)), [lay]);
  const total = elapsedLabel(span);
  const widest = widestLabel(total, span);

  // The end: the ripple, the sparks and the pop run once when a replay lands on the last frame.
  const pop = useSharedValue(0);
  const onEnd = useCallback(() => {
    if (reduce || burstCells.length === 0) return;
    pop.value = 0;
    pop.value = withTiming(1, { duration: POP_MS, easing: Easing.linear });
  }, [reduce, burstCells.length, pop]);
  const pb = usePlayback(span, reduce, onEnd);

  // The latest controls in refs, so the arrival and the leaving run once each, never again
  // because a render made new callbacks (a re-run would cancel the autoplay, and a focus cleanup
  // on every render would pause the replay it just started).
  const replayRef = useRef(pb.replay);
  replayRef.current = pb.replay;
  const pauseRef = useRef(pb.pause);
  pauseRef.current = pb.pause;
  const started = useRef(false);

  // Plays once on its own when the map has drawn itself; Reduce Motion opens on the last frame.
  const autoplay = useCallback(() => {
    if (reduce || started.current) return;
    started.current = true;
    replayRef.current();
  }, [reduce]);
  // Leaving the screen stops the clock.
  useFocusEffect(
    useCallback(() => {
      return () => pauseRef.current();
    }, []),
  );

  const toggle = useCallback(() => {
    started.current = true;
    if (pb.playing) {
      pb.pause();
      return;
    }
    if (pb.ended) pop.value = 0;
    pb.play();
  }, [pb, pop]);
  const again = useCallback(() => {
    started.current = true;
    snap();
    pop.value = 0;
    pb.replay();
  }, [pb, pop]);
  const scrubStart = useCallback(() => {
    started.current = true;
    pop.value = 0;
    pb.scrubStart();
  }, [pb, pop]);

  const knotWindow = useMemo(() => (knot ? { from: knot.startT, to: knot.endT } : null), [knot]);
  const burstWindow = useMemo(() => (burst ? { from: burst.startT, to: span } : null), [burst, span]);

  // Inside the knot: its sentence speaks up and its cells pulse. One JS update per crossing.
  const [inKnot, setInKnot] = useState(false);
  useAnimatedReaction(
    () => (knot ? pb.playhead.value >= knot.startT && pb.playhead.value <= knot.endT : false),
    (inside, was) => {
      if (inside !== was) runOnJS(setInKnot)(inside);
    },
    [knot],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId !== null ? (lay.index[pickedId] ?? null) : null;
  const pickedFile = picked !== null ? files.find((f) => f.id === pickedId) : undefined;
  const onSelect = useCallback((i: number | null) => setPickedId(i === null ? null : (lay.cells[i]?.id ?? null)), [lay]);

  const knotLine = knot ? knotSentence(knot, files, names) : null;
  const burstLine = burst ? burstSentence(burst, span, knot !== null) : null;
  const notes = [thinnedNote(frames, files), offMapNote(frames, lay.index)].filter((n): n is string => n !== null);
  const items = useMemo(() => legend('timelapse', { knot: knot !== null, reduceMotion: reduce, path: true }), [knot, reduce]);
  const maxHeight = Math.min(Math.round(height * 0.56), Math.round(width * 1.1));
  const column = width - GUTTER * 2;

  return (
    <>
      <Section>
        <SessionBand
          hue={accent}
          animal={accent.animal}
          title={title}
          width={width}
          figure={(inner) => <ReplayFigure playhead={pb.playhead} widest={widest} width={inner} />}
          sentence={timelapseTitle(frames)}
          note={replayNote(state, frames, now)}
        />
      </Section>

      <Section style={styles.map}>
        <Block enter={false}>
          <MapCanvas
            layout={lay}
            width={width}
            maxHeight={maxHeight}
            hue={accent}
            replay={replay}
            playhead={pb.playhead}
            span={span}
            knot={inKnot ? knotCells : NO_CELLS}
            knotWindow={knotWindow}
            burst={burstCells}
            pop={pop}
            selected={picked}
            onSelect={onSelect}
            accessibilityLabel={`${mapSummary(files, lay.folders.length)} Replayed as the session went.`}
            accessibilityHint={TAP_HINT}
          />
          <AutoPlay at={landed + AUTOPLAY_AFTER_MS} onReady={autoplay} />
        </Block>
        <Block style={styles.gutter}>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={pickedFile ? type.body : type.dim}>
            {pickedFile ? cellCaption(pickedFile, names?.[pickedFile.id], now) : TAP_HINT}
          </Text>
          {session.id === 'sample' ? <Words style={[type.meta, styles.after]}>{SAMPLE_NOTE}</Words> : null}
        </Block>
        <Block style={styles.controls}>
          <ReplayControls
            playing={pb.playing}
            ended={pb.ended}
            onToggle={toggle}
            onReplay={again}
            playhead={pb.playhead}
            widest={widest}
            total={total}
            accent={{ fill: accent.fill, onFill: accent.onFill, text: accent.text }}
          />
          <View style={styles.scrubber}>
            <Scrubber
              width={column}
              bins={bins}
              spikes={spikes}
              span={span}
              playhead={pb.playhead}
              knot={knotWindow}
              burst={burstWindow}
              ink={accent.ink}
              partner={accent.partner}
              onScrubStart={scrubStart}
              onScrubEnd={pb.scrubEnd}
              valueText={`${elapsedLabel(pb.position)} of ${total}`}
              onStep={pb.step}
            />
          </View>
        </Block>
      </Section>

      {knotLine || burstLine || notes.length ? (
        <Section style={[styles.gutter, styles.chapter]}>
          <Block style={styles.sentences}>
            {knotLine ? (
              <Words style={[type.body, { color: inKnot ? accent.text : GROUND.dim }]}>{knotLine}</Words>
            ) : null}
            {burstLine ? <Words style={[type.body, { color: pb.ended ? GROUND.text : GROUND.dim }]}>{burstLine}</Words> : null}
            {notes.map((n) => (
              <Words key={n} style={type.meta}>
                {n}
              </Words>
            ))}
          </Block>
        </Section>
      ) : null}

      <Section style={[styles.gutter, styles.chapter]}>
        <Block>
          <Legend items={items} roles={roles} accent={accent.ink} />
        </Block>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  map: { marginTop: 4 },
  gutter: { paddingHorizontal: GUTTER },
  chapter: { marginTop: 30 },
  after: { marginTop: 8 },
  controls: { marginTop: 18 },
  scrubber: { paddingHorizontal: GUTTER, marginTop: 14 },
  sentences: { gap: 10 },
});
