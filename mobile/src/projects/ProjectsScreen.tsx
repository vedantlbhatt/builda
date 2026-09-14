/**
 * The Projects tab: which projects your hours went to, how each one is going, and how they differ,
 * in the house style (design-refs/HOUSE-STYLE.md; the analysis page is the reference).
 *
 *   the hero        a band in your hue (the accent, your creature's): how many projects your Mac
 *                   holds and your hours with you there in the window, both counting up, and your
 *                   creature printed beside them
 *   the doors       each project as a band in its own hue: its name, its stage, its hours and share
 *                   counting up, its week in words; the band opens its page. Beside the words, the
 *                   prints of its demo fanned like prints (`src/demos/DoorPrints.tsx`, one request
 *                   for every door, `useDemoPreviews`), a tap opening the full screen gallery; or one
 *                   blank print saying how to make a demo. The stage is the report's reconciled with
 *                   the sessions this phone holds (`recency.ts`, `useDoorRecency.ts`)
 *   01 rivers       every project as a river of its hours, week by week, flowing in from the left
 *                   (`Rivers.tsx`); a tap holds one and names it
 *   02 the race     the projects re-ranking week by week, the race run left to right and the latest
 *                   week's order landing at the finish (`RankRace.tsx`)
 *   03 compare      the comparisons across projects, each a sentence with its two numbers
 *
 * The doors come first, right under the hero. The owner, 2026-09-14: "the projects page should
 * show a list of projects", and "where do I see the screenshots? I don't see them": the list of
 * projects, with each one's prints, sat under eight screens of rivers, the race and ten
 * comparisons, so the tab read as charts and the screenshots were never reached.
 *
 * Every number is the report's (`src/projects/model.ts`, pinned to the engine's words), every
 * refusal is a sentence, and a project with nothing in the window says so instead of showing 0.
 * A project's hue is its own on every screen (`projectHues`); its name is its public one, or the
 * one you gave it on this phone, or "Private project" and the number this phone gave it, never a
 * character of its key (`model.projectLabel`).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { n } from '../copy/numbers';
import { DemoGallery } from '../demos/Gallery';
import { useDemoLists, useDemoPreviews, type DemoLoad } from '../demos/useDemo';
import { Band, BandWords } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { numSpec } from '../insights/format';
import { BandFigure, figure, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { REPORT_COMMAND } from '../insights/model';
import { Num } from '../insights/Num';
import { ON_HUE, SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { useAccent } from '../theme/accent';
import { ChapterPage } from '../you/ChapterPage';
import { useBuilderProfile } from '../you/hooks';
import { ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../you/parts';
import { ComparisonBlock } from './Comparisons';
import { ProjectDoorBand } from './Door';
import {
  chapterHues,
  hoursFigure,
  projectDoors,
  projectHues,
  projectsHero,
  projectsView,
  raceSummary,
  weeklyView,
  type ProjectsHero,
} from './model';
import { useNicknames, useProjectRegistry } from './nicknames';
import { RankRace } from './RankRace';
import { recency } from './recency';
import { Rivers } from './Rivers';
import { useDoorRecency } from './useDoorRecency';

/** Said when the Mac's report predates the projects block. */
const NO_BLOCK = 'Your Mac sent a report without projects. A newer Mac sends them, and this tab fills in.';

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
  const race = useMemo(() => (weekly ? raceSummary(weekly) : null), [weekly]);
  const hero = useMemo(() => (view && block ? projectsHero(view, block, report) : null), [view, block, report]);
  const doors = useMemo(() => (view && block ? projectDoors(view, block, report, Date.now(), registry) : []), [view, block, report, registry]);
  const hues = useMemo(() => (block ? projectHues(block.projects, registry) : {}), [block, registry]);
  // The chapters follow the doors now: the first clears the last door's hue, and nothing follows the last.
  const [riversHue, raceHue, compareHue] = useMemo(
    () => chapterHues(['cobalt', 'heather', 'brass'], [accent.name, ...doors.map((d) => d.hue)], doors[doors.length - 1]?.hue ?? accent.name, null),
    [accent.name, doors],
  );
  const heroHue: Hue = useMemo(() => ({ ink: accent.ink, partner: accent.partner, light: accent.light }), [accent.ink, accent.partner, accent.light]);
  const rawByMetric = useMemo(() => new Map((block?.comparisons ?? []).map((c) => [c.metric as string, c])), [block]);

  const inner = width - GUTTER * 2;
  const answered = view?.comparisons.filter((c) => c.answered).length ?? 0;

  // The demos: every door's prints in one request; then the whole list of each project that has
  // prints, so a door counts what its demo holds and the gallery opens on the whole of it, never on
  // the preview's three (FOUND IN REVIEW, 2026-09-14: "1 of 3" jumping to "1 of 7").
  const doorKeys = useMemo(() => doors.map((d) => d.key), [doors]);
  const { previews, reload: reloadPreviews } = useDemoPreviews(doorKeys);
  const listKeys = useMemo(() => doorKeys.filter((k) => (previews[k]?.prints.length ?? 0) > 0), [doorKeys, previews]);
  const { lists, reload: reloadLists } = useDemoLists(listKeys);
  const phone = useDoorRecency(doorKeys);
  const recents = useMemo(() => {
    const now = Date.now();
    const out: Record<string, ReturnType<typeof recency>> = {};
    for (const p of block?.projects ?? []) {
      out[p.key] = recency({ key: p.key, history: p.history, reportAt: report?.generated_at ?? null, finals: phone.finals[p.key] ?? [], live: phone.live, lastStartedAt: phone.listed[p.key] ?? null, now });
    }
    return out;
  }, [block, report, phone]);
  const [opened, setOpened] = useState<{ key: string; id: string | null } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const openDemo = useCallback((key: string, id: string | null) => {
    setOpened({ key, id });
    setGalleryOpen(true);
  }, []);
  // The opened project's own whole list; until it is in, that project's prints and no count at all
  // (`DemoGallery counted`), so the gallery never shows a number it will change. Never another
  // project's pictures: every list is held under its own key (`useDemoLists`).
  const galleryDoor = opened ? doors.find((d) => d.key === opened.key) ?? null : null;
  const openedList = opened ? lists[opened.key] : undefined;
  const whole = openedList?.kind === 'ready' ? openedList : null;
  const galleryEntries = whole ? whole.entries : opened ? previews[opened.key]?.prints ?? [] : [];
  const gallerySources = whole ? whole.sources : opened ? previews[opened.key]?.sources ?? { file: {}, poster: {} } : { file: {}, poster: {} };

  return (
    <>
      <ChapterPage chapters={3 + doors.length + 1} ready={accent.ready && registered && view !== null} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
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

            {view && hero && accent.ready ? (
              <>
                <HeroChapter hero={hero} hue={heroHue} width={width} animal={accent.animal} empty={view.rows.length === 0} />

                {doors.map((d, i) =>
                  stage >= 1 + i ? (
                    <ProjectDoorBand
                      key={d.key}
                      door={d}
                      width={width}
                      demo={previews[d.key]}
                      whole={lists[d.key]?.kind === 'ready' ? (lists[d.key] as Extract<DemoLoad, { kind: 'ready' }>).entries : null}
                      recent={recents[d.key] ?? null}
                      onOpenDemo={openDemo}
                      onDemoError={reloadPreviews}
                    />
                  ) : null,
                )}

                {stage >= 1 + doors.length && weekly && view.rows.length > 0 ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[riversHue!]} index="01" title="Rivers">
                      {weekly.refusal ? (
                        <BandWords delay={300}>
                          <Refusal onHue>{weekly.refusal}</Refusal>
                        </BandWords>
                      ) : (
                        <>
                          <BandFigure spec={hoursFigure(weekly.totalSeconds)} width={inner} max={96} delay={200} label={`${hoursFigure(weekly.totalSeconds).final} hours with you there`} />
                          <BandWords delay={360}>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                              {`hours with you there on your Mac, ${weekly.weeks.length === 1 ? 'in one week' : `over ${weekly.weeks.length} weeks`}`}
                            </Text>
                          </BandWords>
                        </>
                      )}
                    </Band>
                    {!weekly.refusal ? (
                      <Block style={styles.block}>
                        <Kicker>every project, week by week</Kicker>
                        <Rivers view={weekly} width={width} delay={120} />
                      </Block>
                    ) : null}
                  </Section>
                ) : null}

                {stage >= 2 + doors.length && weekly && !weekly.refusal && race && race.leader ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[raceHue!]} index="02" title="The rank race">
                      <View style={styles.figureRow}>
                        <BandFigure spec={numSpec(race.leader.weeksLed, n(race.leader.weeksLed))} width={inner * 0.3} max={104} delay={200} />
                        <View style={{ flex: 1 }}>
                          <BandWords delay={320}>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                              {`${race.leader.weeksLed === 1 ? 'week' : 'weeks'} at the top for ${race.leader.label.text}`}
                            </Text>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                              {`of the ${race.weeksRead} ${race.weeksRead === 1 ? 'week' : 'weeks'} your Mac read`}
                            </Text>
                          </BandWords>
                        </View>
                      </View>
                    </Band>
                    <Block style={styles.block}>
                      <Kicker>place each week, by hours with you there</Kicker>
                      <RankRace view={weekly} summary={race} width={inner} delay={120} />
                      <View style={styles.lines}>
                        {race.lines.map((l) => (
                          <Words key={l} style={type.body}>
                            {l}
                          </Words>
                        ))}
                      </View>
                    </Block>
                  </Section>
                ) : null}

                {stage >= 3 + doors.length && view.comparisons.length > 0 ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[compareHue!]} index="03" title="How they compare">
                      <View style={styles.figureRow}>
                        <BandFigure spec={numSpec(answered, n(answered))} width={inner * 0.3} max={104} delay={200} />
                        <View style={{ flex: 1 }}>
                          <BandWords delay={320}>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                              {`of ${view.comparisons.length} ${answered === 1 ? 'shows' : 'show'} a real difference`}
                            </Text>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                              the rest are too close to call, rest on too few sessions, or are both lower bounds
                            </Text>
                          </BandWords>
                        </View>
                      </View>
                    </Band>
                    {[...view.comparisons]
                      .sort((a, b) => Number(b.answered) - Number(a.answered))
                      .map((c, i) => (
                        <ComparisonBlock key={c.metric} c={c} raw={rawByMetric.get(c.metric) ?? null} hues={hues} first={i === 0} />
                      ))}
                  </Section>
                ) : null}

                {stage >= 4 + doors.length ? (
                  <Section style={styles.foot}>
                    <Block style={{ gap: 10 }}>
                      {hero.small.map((s) => (
                        <Words key={s} style={type.meta}>
                          {s}
                        </Words>
                      ))}
                      {view.rows.some((r) => r.label.source === 'private') ? (
                        <Words style={type.meta}>
                          A private project goes by a number this phone gave it, because its name never leaves your Mac. Open one to give it a name only this phone knows.
                        </Words>
                      ) : null}
                    </Block>
                  </Section>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ChapterPage>
      {opened && galleryDoor && galleryEntries.length ? (
        <DemoGallery
          visible={galleryOpen}
          entries={galleryEntries}
          sources={gallerySources}
          hue={galleryDoor.hue}
          startId={opened.id}
          title={galleryDoor.label.text}
          counted={whole !== null}
          onClose={() => setGalleryOpen(false)}
          onError={reloadLists}
        />
      ) : null}
    </>
  );
}

function HeroChapter({ hero, hue, width, animal, empty }: { hero: ProjectsHero; hue: Hue; width: number; animal: Parameters<typeof CreaturePrint>[0]['animal']; empty: boolean }) {
  const inner = width - GUTTER * 2;
  const creature = Math.min(128, Math.floor((inner * 0.34) / 16) * 16);
  return (
    <Section>
      <Band hue={hue} title="Where your hours go">
        <View style={styles.heroRow}>
          <View style={{ flex: 1 }}>
            <BandFigure spec={hero.count} width={inner - creature - 12} max={112} min={56} delay={200} label={`${hero.count.final} ${hero.countCaption}`} />
            <BandWords delay={320}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {hero.countCaption}
              </Text>
            </BandWords>
          </View>
          <CreaturePrint animal={animal} size={creature} color={ON_HUE} delay={180} spread={600} />
        </View>
        {hero.hours ? (
          <BandWords delay={420}>
            <View style={styles.hoursLine}>
              <Num spec={hero.hours} textStyle={figure(44, ON_HUE)} delay={480} accessibilityLabel={`${hero.hours.final} ${hero.hoursCaption}`} />
              <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, { flexShrink: 1 }]}>
                {hero.hoursCaption}
              </Text>
            </View>
          </BandWords>
        ) : null}
        {hero.note ? (
          <BandWords delay={520}>
            <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, { marginTop: 6 }]}>
              {hero.note}
            </Text>
          </BandWords>
        ) : null}
        {empty ? (
          <BandWords delay={520}>
            <Refusal onHue>No project to show. A session in a folder with no git belongs to none, and a repository you left out in Settings never appears here.</Refusal>
          </BandWords>
        ) : null}
      </Band>
    </Section>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20, gap: 12 },
  chapter: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  lines: { marginTop: 16, gap: 8 },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 6 },
  hoursLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, marginTop: 12 },
  foot: { marginTop: 40, paddingHorizontal: GUTTER },
});
