/**
 * `builder://you/map/<id>`: the codebase map (brief D7, docs/approved-roadmap.md 2.7) for one
 * running session, in the house style (design-refs/HOUSE-STYLE.md; the analysis page is the
 * reference). `sample` draws the built in sample, `variant` picks which (`src/map/sample.ts`,
 * `src/session/samples.ts`).
 *
 *   the band     full bleed in the session's hue, which is the builder's creature's (the theme
 *                is your creature's colour): the repository, "42 files, 3 hot" counting up, what
 *                it is doing now arriving a word at a time, the creature printing itself
 *   the map      full bleed on the warm ground: the repository drawn as islands of folders, one
 *                cell per file in its kind's hue, blooming from the top of the repository out;
 *                read files hollow, changed ones filled; glowing in the working set and cooling as
 *                it moves on; the last six files joined by its path; the files it keeps rewriting
 *                pulsing in the session's hue with rings going out from them
 *   the words    what happened to the file you tapped, the legend, the files changed most as
 *                lines of print, and the way to the time lapse
 *
 * Only a running session has a map (the server deletes the live state when it finalises), so a
 * finished one says so on its band and offers the session. Refreshes every minute while it runs:
 * islands glide rather than jump, and a file whose heat changed turns over to show it.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';

import type { SessionDetail } from '../../../src/data/api';
import type { LiveFile, LiveState } from '../../../src/generated/live';
import { GUTTER, type, Words } from '../../../src/insights/kit';
import { SPECTRUM } from '../../../src/insights/palette';
import { Block, Section } from '../../../src/insights/reveal';
import { renderLiveSentence } from '../../../src/live/sentence';
import { headlineParts } from '../../../src/map/figure';
import { cursorOf, mapLevels } from '../../../src/map/heat';
import { liveKnot } from '../../../src/map/knot';
import { layoutMap } from '../../../src/map/layout';
import { MapCanvas } from '../../../src/map/MapCanvas';
import { MapError, MapLoading, MapMissing, MapPage, MapRefusal, MapSignedOut, SAMPLE_NOTE, StaleNote, useOpenSession } from '../../../src/map/MapParts';
import { FigureLine, HotLedger, Legend, SessionBand, WordLink } from '../../../src/map/MapWords';
import { hotCount, HUE_WORD, recentPath, stuckHue } from '../../../src/map/paint';
import { useSessionMap } from '../../../src/map/useSessionMap';
import {
  asSentence,
  cellCaption,
  cutNote,
  hotLedger,
  legend,
  mapContent,
  mapHeadline,
  mapSummary,
  rolesOnMap,
  sentenceInput,
  TAP_HINT,
  updatedSentence,
} from '../../../src/map/view';
import { useAccent, type AccentState } from '../../../src/theme/accent';
import { select } from '../../../src/ui/haptics';
import { useReduceMotion } from '../../../src/ui/motion';

export default function MapScreen() {
  const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const accent = useAccent();
  const { load, refresh, refreshing, now } = useSessionMap(id, variant, { poll: true });
  const openSession = useOpenSession(id ?? 'sample', variant);
  const retry = useCallback(() => void refresh(), [refresh]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/sessions')), [router]);
  const openLapse = useCallback(
    () => router.push({ pathname: '/you/timelapse/[id]', params: variant ? { id: id ?? 'sample', variant } : { id: id ?? 'sample' } }),
    [router, id, variant],
  );
  // A band painted in the accent waits for the saved creature to be read once, so it never
  // prints in the default creature's hue and then changes colour under the reader.
  const ready = load.kind === 'ready' && accent.ready;

  return (
    <MapPage title="Codebase map" refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : retry}>
      {load.kind === 'loading' || (load.kind === 'ready' && !accent.ready) ? <MapLoading sentence="Drawing the map." /> : null}
      {load.kind === 'signedOut' ? <MapSignedOut what="map" accent={accent.ink} onSignIn={() => router.push('/settings')} /> : null}
      {load.kind === 'missing' ? <MapMissing accent={accent.ink} onBack={back} /> : null}
      {load.kind === 'error' ? <MapError message={load.message} accent={accent.ink} onRetry={retry} /> : null}
      {ready && load.stale ? <StaleNote text={load.stale} /> : null}
      {ready ? (
        <MapBody session={load.session} now={now} width={width} height={height} accent={accent} onSession={openSession} onRetry={retry} onTimelapse={openLapse} />
      ) : null}
    </MapPage>
  );
}

function MapBody({
  session,
  now,
  width,
  height,
  accent,
  onSession,
  onRetry,
  onTimelapse,
}: {
  session: SessionDetail;
  now: number;
  width: number;
  height: number;
  accent: AccentState;
  onSession: () => void;
  onRetry: () => void;
  onTimelapse: () => void;
}) {
  const content = useMemo(() => mapContent(session), [session]);
  const title = session.repo_name ?? 'This session';
  if (content.kind !== 'ready') {
    return (
      <MapRefusal
        kind={content.kind}
        screen="map"
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
    <ReadyMap
      session={session}
      state={content.state}
      files={content.files}
      names={content.names}
      now={now}
      width={width}
      height={height}
      title={title}
      accent={accent}
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
  width,
  height,
  title,
  accent,
  onTimelapse,
}: {
  session: SessionDetail;
  state: LiveState;
  files: LiveFile[];
  names: Record<string, string> | null;
  now: number;
  width: number;
  height: number;
  title: string;
  accent: AccentState;
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
  const path = useMemo(() => recentPath(files, lay.index), [files, lay]);
  // Picked by file id, so a refresh that moves the islands keeps the same file picked.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId !== null ? (lay.index[pickedId] ?? null) : null;
  const pickedFile = picked !== null ? files.find((f) => f.id === pickedId) : undefined;

  const head = mapHeadline(state, hotCount(levels));
  const parts = useMemo(() => headlineParts(head.files, head.hot), [head.files, head.hot]);
  const ledger = useMemo(() => hotLedger(files, names, now), [files, names, now]);
  const roles = useMemo(() => rolesOnMap(files), [files]);
  // The stuck files' hue: none the kinds of file or the band wear (`paint.stuckHue`).
  const stuckName = useMemo(() => stuckHue(accent.name, roles), [accent.name, roles]);
  const stuck = SPECTRUM[stuckName].ink;
  const items = useMemo(
    () => legend('map', { knot: knot.length > 0, reduceMotion: reduce, path: path.length >= 2, stuck: HUE_WORD[stuckName] }),
    [knot.length, reduce, path.length, stuckName],
  );
  const cut = cutNote(state);
  const hasFrames = (state.timelapse?.length ?? 0) > 0;
  const maxHeight = Math.min(Math.round(height * 0.62), Math.round(width * 1.2));

  const onSelect = useCallback((i: number | null) => setPickedId(i === null ? null : (lay.cells[i]?.id ?? null)), [lay]);
  const onPick = useCallback(
    (id: string) => {
      select();
      setPickedId((p) => (p === id ? null : id));
    },
    [],
  );

  return (
    <>
      <Section>
        <SessionBand
          hue={accent}
          animal={accent.animal}
          title={title}
          width={width}
          figure={(inner) => <FigureLine parts={parts} width={inner} said={head.said} />}
          sentence={asSentence(renderLiveSentence(sentenceInput(state)))}
          note={updatedSentence(state.computed_at, now)}
        />
      </Section>

      <Section style={styles.map}>
        <Block enter={false}>
          <MapCanvas
            layout={lay}
            width={width}
            maxHeight={maxHeight}
            hue={accent}
            stuck={stuck}
            levels={levels}
            knot={knot}
            cursor={cursor}
            path={path}
            selected={picked}
            onSelect={onSelect}
            accessibilityLabel={mapSummary(files, lay.folders.length)}
            accessibilityHint={TAP_HINT}
          />
        </Block>
        <Block style={styles.gutter}>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.6} style={pickedFile ? type.body : type.dim}>
            {pickedFile ? cellCaption(pickedFile, names?.[pickedFile.id], now) : TAP_HINT}
          </Text>
          {cut ? <Words style={[type.meta, styles.after]}>{cut}</Words> : null}
          {session.id === 'sample' ? <Words style={[type.meta, styles.after]}>{SAMPLE_NOTE}</Words> : null}
        </Block>
      </Section>

      <Section style={[styles.gutter, styles.chapter]}>
        <Block>
          <Legend items={items} roles={roles} stuck={stuck} />
        </Block>
      </Section>

      {ledger.rows.length ? (
        <Section style={[styles.gutter, styles.chapter]}>
          <Block>
            <HotLedger label={ledger.label} rows={ledger.rows} picked={pickedId} onPick={onPick} />
          </Block>
        </Section>
      ) : null}

      {hasFrames ? (
        <Section style={[styles.gutter, styles.chapter]}>
          <Block>
            <WordLink
              title="Watch the time lapse"
              line="This session replayed in fifteen seconds: the map lighting up, where it got stuck, the burst at the end."
              color={accent.ink}
              onPress={onTimelapse}
            />
          </Block>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  map: { marginTop: 4 },
  gutter: { paddingHorizontal: GUTTER },
  chapter: { marginTop: 30 },
  after: { marginTop: 8 },
});
