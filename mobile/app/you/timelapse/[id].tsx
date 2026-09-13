import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { SessionDetail } from '../../../src/data/api';
import type { LiveFile, LiveFrame, LiveState } from '../../../src/generated/live';
import { spanOf, spikeBins, trackBins } from '../../../src/map/frames';
import { buildReplay } from '../../../src/map/heat';
import { findBurst, findKnot } from '../../../src/map/knot';
import { layoutMap } from '../../../src/map/layout';
import { MapCanvas } from '../../../src/map/MapCanvas';
import { Legend, MapRefusal, SampleNote, TimelapseSkeleton, useOpenSession } from '../../../src/map/MapParts';
import { Scrubber } from '../../../src/map/Scrubber';
import { usePlayback } from '../../../src/map/usePlayback';
import { useSessionMap } from '../../../src/map/useSessionMap';
import {
  burstSentence,
  elapsedLabel,
  knotSentence,
  legend,
  mapSummary,
  offMapNote,
  thinnedNote,
  timelapseContent,
  timelapseMeta,
  timelapseTitle,
} from '../../../src/map/view';
import { SessionError, SessionMissing, SessionSignedOut, StaleLine } from '../../../src/session/SessionStates';
import { colors, layout, space } from '../../../src/theme';
import {
  Button,
  exitMs,
  PressableScale,
  roleScaling,
  roleStyle,
  SHAPE,
  SymbolIcon,
  T,
  timing,
  useColors,
  useReduceMotion,
} from '../../../src/ui';
// The kit's barrel exports the Text component as `T`; the duration table is `motionSpec`'s.
import { T as DUR } from '../../../src/ui/motionSpec';

const c = colors('dark');

/** One empty knot, so a render outside the knot hands the canvas the same array. */
const NO_CELLS: readonly number[] = [];

/**
 * The time lapse (brief D8, docs/approved-roadmap.md 2.8): the session replayed in fifteen
 * seconds on its own codebase map. Cells light as the frames play and cool as the agent moves
 * on; the knot where it got stuck pulses while the playhead is inside it; the burst at the end
 * pops once when the replay lands. A scrubber to drag, play and pause, and Replay.
 *
 * Plays once on arrival; under Reduce Motion it opens on the last frame and waits for Play.
 * Only a running session has frames (the server deletes the live state when it finalises), so
 * a finished one says so and offers the session. Exporting a video is out of scope.
 */
export default function TimelapseScreen() {
  const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { load, refresh, refreshing, now } = useSessionMap(id, variant, { poll: false });
  const openSession = useOpenSession(id ?? 'sample', variant);
  const column = width - layout.gutter * 2;
  const maxHeight = Math.min(Math.round(height * 0.5), Math.round(column * 1.1));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xxl, gap: layout.sectionGap }}
      refreshControl={
        load.kind === 'signedOut' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.accent} />
      }
    >
      {load.kind === 'loading' && <TimelapseSkeleton width={column} />}
      {load.kind === 'signedOut' && <SessionSignedOut onSignIn={() => router.push('/settings')} />}
      {load.kind === 'missing' && <SessionMissing onBack={() => (router.canGoBack() ? router.back() : router.replace('/sessions'))} />}
      {load.kind === 'error' && <SessionError message={load.message} onRetry={() => void refresh()} />}
      {load.kind === 'ready' && (
        <>
          {load.stale ? <StaleLine text={load.stale} /> : null}
          <TimelapseBody session={load.session} now={now} column={column} maxHeight={maxHeight} onSession={openSession} onRetry={() => void refresh()} />
        </>
      )}
    </ScrollView>
  );
}

function TimelapseBody({
  session,
  now,
  column,
  maxHeight,
  onSession,
  onRetry,
}: {
  session: SessionDetail;
  now: number;
  column: number;
  maxHeight: number;
  onSession: () => void;
  onRetry: () => void;
}) {
  const content = useMemo(() => timelapseContent(session), [session]);
  if (content.kind !== 'ready') {
    return <MapRefusal kind={content.kind} screen="timelapse" session={session} now={now} onSession={onSession} onRetry={onRetry} />;
  }
  return (
    <Replayer
      session={session}
      state={content.state}
      files={content.files}
      frames={content.frames}
      names={content.names}
      now={now}
      column={column}
      maxHeight={maxHeight}
    />
  );
}

function cellsOf(ids: readonly string[], index: Readonly<Record<string, number>>): number[] {
  return ids.map((i) => index[i]).filter((i): i is number => i !== undefined);
}

function Replayer({
  session,
  state,
  files,
  frames,
  names,
  now,
  column,
  maxHeight,
}: {
  session: SessionDetail;
  state: LiveState;
  files: LiveFile[];
  frames: LiveFrame[];
  names: Record<string, string> | null;
  now: number;
  column: number;
  maxHeight: number;
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

  // The burst pops once when a replay lands on the last frame.
  const pop = useSharedValue(0);
  const onEnd = useCallback(() => {
    if (reduce || burstCells.length === 0) return;
    pop.value = withSequence(withTiming(1, timing(DUR.micro)), withTiming(0, timing(exitMs(DUR.enter))));
  }, [reduce, burstCells.length, pop]);
  const pb = usePlayback(span, reduce, onEnd);
  // The latest controls in refs, so the two effects below run on arrival and on leaving only,
  // never again because a render made new callbacks (a re-run would cancel the autoplay, and a
  // focus cleanup on every render would pause the replay it just started).
  const replayRef = useRef(pb.replay);
  replayRef.current = pb.replay;
  const pauseRef = useRef(pb.pause);
  pauseRef.current = pb.pause;

  // Plays once on arrival, after the map has drawn; Reduce Motion opens on the last frame.
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => replayRef.current(), 400);
    return () => clearTimeout(t);
  }, [reduce]);
  // Leaving the screen stops the clock.
  useFocusEffect(
    useCallback(() => {
      return () => pauseRef.current();
    }, []),
  );

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

  const knotLine = knot ? knotSentence(knot, files, names) : null;
  const burstLine = burst ? burstSentence(burst, span, knot !== null) : null;
  const notes = [thinnedNote(frames, files), offMapNote(frames, lay.index)].filter((n): n is string => n !== null);

  return (
    <>
      <View style={{ gap: space.xs }}>
        <T role="headline">{timelapseTitle(frames)}</T>
        <T role="meta" tone="dim">
          {timelapseMeta(session, state, frames, now)}
        </T>
        {session.id === 'sample' ? <SampleNote /> : null}
      </View>

      <View style={{ gap: space.md }}>
        <MapCanvas
          layout={lay}
          width={column}
          maxHeight={maxHeight}
          replay={replay}
          playhead={pb.playhead}
          knot={inKnot ? knotCells : NO_CELLS}
          knotWindow={knotWindow}
          burst={burstCells}
          pop={pop}
          accessibilityLabel={`${mapSummary(files, lay.folders.length)} Replayed as the session went.`}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
          <PressableScale
            onPress={pb.playing ? pb.pause : pb.play}
            accessibilityLabel={pb.playing ? 'Pause' : pb.ended ? 'Play from the start' : 'Play'}
            style={styles.play}
          >
            <SymbolIcon name={pb.playing ? 'pause.fill' : 'play.fill'} size={17} weight="semibold" tone="onAccent" />
          </PressableScale>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flex: 1 }}>
            <Readout playhead={pb.playhead} longest={elapsedLabel(span)} />
            <T role="meta" tone="dim">
              of {elapsedLabel(span)}
            </T>
          </View>
          <Button kind="secondary" size="compact" block={false} label="Replay" haptic="snap" onPress={pb.replay} />
        </View>

        <Scrubber
          width={column}
          bins={bins}
          spikes={spikes}
          span={span}
          playhead={pb.playhead}
          knot={knotWindow}
          burst={burstWindow}
          onScrubStart={pb.scrubStart}
          onScrubEnd={pb.scrubEnd}
          valueText={`${elapsedLabel(pb.position)} of ${elapsedLabel(span)}`}
          onStep={pb.step}
        />
      </View>

      {knotLine || burstLine || notes.length ? (
        <View style={{ gap: space.sm }}>
          {knotLine ? (
            <T role="body" tone={inKnot ? 'text' : 'dim'}>
              {knotLine}
            </T>
          ) : null}
          {burstLine ? (
            <T role="body" tone={pb.ended ? 'text' : 'dim'}>
              {burstLine}
            </T>
          ) : null}
          {notes.map((n) => (
            <T key={n} role="meta" tone="dim">
              {n}
            </T>
          ))}
        </View>
      ) : null}

      <Legend items={legend('timelapse', knot !== null, reduce)} />
    </>
  );
}

// On Fabric a prop on neither of Reanimated's allowlists is bounced to the JS thread every
// frame; `text` goes on the native list, as the kit's CountUp does.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Where the replay is, in session time, redrawn on the UI thread every frame without a React
 * render. A hidden copy of the longest label holds the width, so nothing beside it moves.
 */
function Readout({ playhead, longest }: { playhead: SharedValue<number>; longest: string }) {
  const colorsNow = useColors();
  const props = useAnimatedProps(() => {
    const text = elapsedLabel(playhead.value);
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });
  const font = roleStyle('row');
  return (
    <View accessible={false}>
      <T role="row" style={styles.hidden} importantForAccessibility="no">
        {longest}
      </T>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        importantForAccessibility="no"
        accessibilityElementsHidden
        defaultValue={elapsedLabel(playhead.value)}
        animatedProps={props}
        {...roleScaling('row')}
        style={[StyleSheet.absoluteFill, font, { color: colorsNow.text, padding: 0, margin: 0 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  play: {
    width: 44,
    height: 44,
    borderRadius: SHAPE.action,
    borderCurve: 'continuous',
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: { opacity: 0 },
});
