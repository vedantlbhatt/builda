import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';

import type { SessionDetail } from '../../../src/data/api';
import type { LiveFile, LiveState } from '../../../src/generated/live';
import { renderLiveSentence } from '../../../src/live/sentence';
import { cursorOf, mapLevels } from '../../../src/map/heat';
import { liveKnot } from '../../../src/map/knot';
import { layoutMap } from '../../../src/map/layout';
import { MapCanvas } from '../../../src/map/MapCanvas';
import { Legend, MapRefusal, MapSkeleton, SampleNote, useOpenSession } from '../../../src/map/MapParts';
import { useSessionMap } from '../../../src/map/useSessionMap';
import { cellCaption, cutNote, hotRows, legend, mapContent, mapMeta, mapSummary, sentenceInput } from '../../../src/map/view';
import { SessionError, SessionMissing, SessionSignedOut, StaleLine } from '../../../src/session/SessionStates';
import { colors, layout, space } from '../../../src/theme';
import { Button, Row, Section, Surface, T, useReduceMotion } from '../../../src/ui';

const c = colors('dark');

/** The hint under the map until a cell is picked. */
const TAP_HINT = 'Tap a square for what happened to that file.';

/**
 * The codebase map (brief D7, docs/approved-roadmap.md 2.7) for one session: the repository
 * drawn as islands of folders, one cell per file, amber where the agent changed things and dim
 * where it only read, hot where it works now and cooling as it moves on, the files it keeps
 * rewriting pulsing. `id` is the session id `session/[id]` takes; `sample` draws the built in
 * sample, `variant` picks which (`src/map/sample.ts`, `src/session/samples.ts`).
 *
 * Only a running session has a map (the server deletes the live state when it finalises), so a
 * finished one says so in a sentence and offers the session. Refreshes every minute while it
 * runs; the islands glide rather than jump when a refresh moves them.
 */
export default function MapScreen() {
  const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { load, refresh, refreshing, now } = useSessionMap(id, variant, { poll: true });
  const openSession = useOpenSession(id ?? 'sample', variant);
  const column = width - layout.gutter * 2;
  const maxHeight = Math.min(Math.round(height * 0.56), Math.round(column * 1.15));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xxl, gap: layout.sectionGap }}
      refreshControl={
        load.kind === 'signedOut' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.accent} />
      }
    >
      {load.kind === 'loading' && <MapSkeleton width={column} />}
      {load.kind === 'signedOut' && <SessionSignedOut onSignIn={() => router.push('/settings')} />}
      {load.kind === 'missing' && <SessionMissing onBack={() => (router.canGoBack() ? router.back() : router.replace('/sessions'))} />}
      {load.kind === 'error' && <SessionError message={load.message} onRetry={() => void refresh()} />}
      {load.kind === 'ready' && (
        <>
          {load.stale ? <StaleLine text={load.stale} /> : null}
          <MapBody
            session={load.session}
            now={now}
            column={column}
            maxHeight={maxHeight}
            onSession={openSession}
            onRetry={() => void refresh()}
            onTimelapse={() =>
              router.push({ pathname: '/you/timelapse/[id]', params: variant ? { id: id ?? 'sample', variant } : { id: id ?? 'sample' } })
            }
          />
        </>
      )}
    </ScrollView>
  );
}

function MapBody({
  session,
  now,
  column,
  maxHeight,
  onSession,
  onRetry,
  onTimelapse,
}: {
  session: SessionDetail;
  now: number;
  column: number;
  maxHeight: number;
  onSession: () => void;
  onRetry: () => void;
  onTimelapse: () => void;
}) {
  const content = useMemo(() => mapContent(session), [session]);
  if (content.kind !== 'ready') {
    return <MapRefusal kind={content.kind} screen="map" session={session} now={now} onSession={onSession} onRetry={onRetry} />;
  }
  return (
    <ReadyMap
      session={session}
      state={content.state}
      files={content.files}
      names={content.names}
      now={now}
      column={column}
      maxHeight={maxHeight}
      onTimelapse={onTimelapse}
    />
  );
}

function ReadyMap({
  session,
  state,
  files,
  names,
  now,
  column,
  maxHeight,
  onTimelapse,
}: {
  session: SessionDetail;
  state: LiveState;
  files: LiveFile[];
  names: Record<string, string> | null;
  now: number;
  column: number;
  maxHeight: number;
  onTimelapse: () => void;
}) {
  const reduce = useReduceMotion();
  const lay = useMemo(() => layoutMap(files), [files]);
  const levels = useMemo(() => mapLevels(files, lay.cells.map((cell) => cell.id)), [files, lay]);
  const knot = useMemo(
    () => liveKnot(state).map((k) => lay.index[k]).filter((i): i is number => i !== undefined),
    [state, lay],
  );
  const cursorId = useMemo(() => cursorOf(files, state.activity?.file_id), [files, state]);
  const cursor = cursorId ? (lay.index[cursorId] ?? null) : null;
  // Picked by file id, so a refresh that moves the islands keeps the same file picked.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId !== null ? (lay.index[pickedId] ?? null) : null;
  const pickedFile = picked !== null ? files.find((f) => f.id === pickedId) : undefined;
  const hot = useMemo(() => hotRows(files, names, now), [files, names, now]);
  const cut = cutNote(state);
  const hasFrames = (state.timelapse?.length ?? 0) > 0;

  return (
    <>
      <View style={{ gap: space.xs }}>
        <T role="headline">{renderLiveSentence(sentenceInput(state))}</T>
        <T role="meta" tone="dim">
          {mapMeta(session, state, now)}
        </T>
        {session.id === 'sample' ? <SampleNote /> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <MapCanvas
          layout={lay}
          width={column}
          maxHeight={maxHeight}
          levels={levels}
          knot={knot}
          cursor={cursor}
          selected={picked}
          onSelect={(i) => setPickedId(i === null ? null : lay.cells[i]!.id)}
          accessibilityLabel={mapSummary(files, lay.folders.length)}
          accessibilityHint={TAP_HINT}
        />
        <T role="meta" tone={pickedFile ? 'text' : 'dim'} accessibilityLiveRegion="polite">
          {pickedFile ? cellCaption(pickedFile, names?.[pickedFile.id], now) : TAP_HINT}
        </T>
        {cut ? (
          <T role="meta" tone="dim">
            {cut}
          </T>
        ) : null}
      </View>

      <Legend items={legend('map', knot.length > 0, reduce)} />

      {hot.rows.length ? (
        <Section label={hot.label}>
          <Surface padding={0}>
            {hot.rows.map((r, i) => (
              <Row
                key={r.id}
                title={r.title}
                monoTitle={Boolean(names?.[r.id])}
                meta={r.meta}
                value={r.value ?? undefined}
                selected={r.id === pickedId}
                haptic="select"
                onPress={() => setPickedId(r.id === pickedId ? null : r.id)}
                hairline={i < hot.rows.length - 1}
              />
            ))}
          </Surface>
        </Section>
      ) : null}

      {hasFrames ? <Button label="Watch the time lapse" onPress={onTimelapse} /> : null}
    </>
  );
}
