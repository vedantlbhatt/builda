/**
 * The Projects tab: a list of your projects, each one a row with its picture and one line of words.
 *
 * The owner, 2026-09-28: "Projects page sucks. It should be focused on projects ... a layout of 1
 * project per row with actual visuals ... I don't want to have to click anything to see it. It
 * should just be a list of projects ... with visuals of the project so it is easy to understand."
 *
 * So the tab is the projects, in the report's order (most of your time in the window first), and
 * nothing else above them. Each row (`ProjectRow.tsx`) is its stage, the width of the screen:
 *
 *   its trailer playing (docs/trailers.md), else its kit's 16:9 video, else its demo's stills on its
 *   band, else its ink (`rows.stageVisual`)
 *
 * and under it its name, its hours with you there, its weeks in pixels, its stage and when it was
 * last built. A tap on either grows the stage into the project's page. The charts that were this tab
 * (the split, rivers, the race, the comparisons) are one door at the foot, `Compare`, a page of
 * their own (`CompareScreen.tsx`).
 *
 * Every number is the report's (`model.ts`), reconciled with what this phone holds (`recency.ts`:
 * a row never says "Winding down" over a project with a session running in it). A project's name
 * is its public one, the one you gave it here, or "Private project" and a number, never a character
 * of its key (`model.projectLabel`). Its pictures are read once a focus: the kits four at a time
 * (`useKits`), the demos' stills in one request (`useDemoPreviews`), and a row the phone has not
 * heard about yet shows its plain ground, never "No demo yet".
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useDemoPreviews } from '../demos/useDemo';
import { Band, BandWords } from '../insights/Band';
import { GUTTER, type } from '../insights/kit';
import { REPORT_COMMAND } from '../insights/model';
import { SPECTRUM, type Hue } from '../insights/palette';
import { Section } from '../insights/reveal';
import { followingWords, withDraft } from '../releases/model';
import { useDraftKeys, useFollowingCount } from '../releases/useDrafts';
import { useAccent } from '../theme/accent';
import { ChapterPage } from '../you/ChapterPage';
import { useBuilderProfile } from '../you/hooks';
import { ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../you/parts';
import { projectDoors, projectsView, weeklyView } from './model';
import { useNicknames, useProjectRegistry } from './nicknames';
import { ProjectRow, type ProjectRowModel } from './ProjectRow';
import { recency } from './recency';
import { rowMeta, stageVisual, weekCells } from './rows';
import { useDoorRecency } from './useDoorRecency';
import { useKits } from './useKits';

/** Said when the Mac's report predates the projects block. */
const NO_BLOCK = 'Your Mac sent a report without projects. A newer Mac sends them, and this tab fills in.';
/** The widest a row's stage grows (a desktop window, an iPad): wider only puts the words far from it. */
const STAGE_MAX = 760;

export function ProjectsScreen() {
  const { width } = useWindowDimensions();
  const { load, refresh, refreshing } = useBuilderProfile();
  const nicknames = useNicknames();
  const accent = useAccent();

  const data = load.kind === 'ready' ? load.data : null;
  const report = data?.report ?? null;
  const block = report?.projects ?? null;
  const names = data?.project_names ?? null;

  const { registry, ready: registered } = useProjectRegistry(block?.projects);
  const view = useMemo(() => projectsView(block, names, nicknames, registry), [block, names, nicknames, registry]);
  const weekly = useMemo(() => weeklyView(block, names, nicknames, registry), [block, names, nicknames, registry]);
  const doors = useMemo(() => (view && block ? projectDoors(view, block, report, Date.now(), registry) : []), [view, block, report, registry]);
  const heroHue: Hue = useMemo(() => ({ ink: accent.ink, partner: accent.partner, light: accent.light }), [accent.ink, accent.partner, accent.light]);

  const keys = useMemo(() => doors.map((d) => d.key), [doors]);
  const { previews, reload: reloadPreviews } = useDemoPreviews(keys);
  const { kits, sources, reload: reloadKits } = useKits(keys);
  const phone = useDoorRecency(keys);
  const drafts = useDraftKeys();
  const following = useFollowingCount();

  const rows: ProjectRowModel[] = useMemo(() => {
    const now = Date.now();
    const series = new Map((weekly?.series ?? []).map((s) => [s.key, s]));
    return doors.map((d) => {
      const p = block?.projects.find((x) => x.key === d.key);
      const recent = p ? recency({ key: d.key, history: p.history, reportAt: report?.generated_at ?? null, finals: phone.finals[d.key] ?? [], live: phone.live, lastStartedAt: phone.listed[d.key] ?? null, now }) : null;
      return {
        key: d.key,
        name: d.label.text,
        hue: d.hue,
        hours: d.hours ? d.hours.final : null,
        meta: withDraft(rowMeta(recent ? recent.title : d.stage, recent ? recent.doorLine : d.lastSession), drafts.has(d.key)),
        weeks: weekCells(series.get(d.key)),
        visual: stageVisual(kits[d.key] ?? { kind: 'unknown' }, previews[d.key]?.prints),
        a11y: d.a11y,
      };
    });
  }, [doors, block, report, phone, kits, previews, weekly, drafts]);

  const stageW = Math.min(width, STAGE_MAX);
  // The door at the foot never wears the last row's hue, so the two never read as one band.
  const compareHue = SPECTRUM[rows[rows.length - 1]?.hue === 'cobalt' ? 'heather' : 'cobalt'];
  const followingHue = SPECTRUM[compareHue === SPECTRUM.cobalt ? 'amber' : 'coral'];
  const reload = () => {
    reloadKits();
    reloadPreviews();
  };

  return (
    <ChapterPage chapters={rows.length + 1} ready={accent.ready && registered && view !== null} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
      {(stage) => (
        <>
          {load.kind === 'signedOut' || load.kind === 'error' || (load.kind === 'ready' && load.stale) ? (
            <View style={styles.lead}>
              {load.kind === 'signedOut' ? <SignedOutChapter what="projects" /> : null}
              {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
              {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
            </View>
          ) : null}

          {load.kind === 'loading' || (data !== null && !accent.ready) ? <ChapterSkeleton /> : null}

          {data && accent.ready && !report ? (
            <RefusalChapter hue={heroHue} title="Your projects" refusal="This arrives with the report from your Mac, which has not been sent yet." command={REPORT_COMMAND} />
          ) : null}
          {data && accent.ready && report && !block ? <RefusalChapter hue={heroHue} title="Your projects" refusal={NO_BLOCK} command={REPORT_COMMAND} /> : null}

          {view && accent.ready && block ? (
            <View style={width > STAGE_MAX ? styles.centred : null}>
              {rows.length === 0 ? (
                <View style={styles.lead}>
                  <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                    No projects yet. One is here once a session runs in a repository.
                  </Text>
                </View>
              ) : null}
              {rows.map((r, i) =>
                stage >= i ? <ProjectRow key={r.key} row={r} width={stageW} first={i === 0} playing sources={sources} printSources={previews[r.key]?.sources} onError={reload} /> : null,
              )}
              {stage >= rows.length && rows.length > 1 ? (
                <Section style={styles.compare}>
                  <Band hue={compareHue} title="Compare" href="/compare" accessibilityLabel="Compare your projects: your hours split, rivers, the rank race and the comparisons. Opens the page.">
                    <BandWords>
                      <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                        {`your ${rows.length} projects, week by week`}
                      </Text>
                    </BandWords>
                  </Band>
                </Section>
              ) : null}
              {stage >= rows.length ? (
                <Section style={rows.length > 1 ? styles.following : styles.compare}>
                  <Band hue={followingHue} title="Following" href="/following" accessibilityLabel="Releases from the projects you starred and the builders you follow. Opens the page.">
                    <BandWords>
                      <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                        {followingWords(following)}
                      </Text>
                    </BandWords>
                  </Band>
                </Section>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20, gap: 12 },
  centred: { alignSelf: 'center', width: STAGE_MAX },
  compare: { marginTop: 56 },
  following: { marginTop: 20 },
});
