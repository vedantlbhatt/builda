/**
 * `builder://compare`: how your projects compare, pushed from the foot of the Projects list.
 *
 * Until 2026-09-28 these chapters were the Projects tab. The owner asked for the tab to be a list
 * of projects, each with its picture and nothing to tap to see it (docs/trailers.md, "The Projects
 * tab"), so the charts moved here whole, in the order they had, over the same report:
 *
 *   the split       your hours with you there in the window, split project by project (`HoursSplit`)
 *   rivers          every project as a river of its hours, week by week (`Rivers.tsx`)
 *   the race        the projects re-ranking week by week (`RankRace.tsx`)
 *   compare         the comparisons across projects, each a sentence with its two numbers
 *
 * Every number is the report's (`src/projects/model.ts`), every refusal is a sentence, and a
 * project's hue is its own here as on its row (`projectHues`).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { n } from '../copy/numbers';
import { HERE } from '../copy/device';
import { Band, BandWords } from '../insights/Band';
import { numSpec } from '../insights/format';
import { BandFigure, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { REPORT_COMMAND } from '../insights/model';
import { SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { useAccent } from '../theme/accent';
import { ChapterPage } from '../you/ChapterPage';
import { useBuilderProfile } from '../you/hooks';
import { ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../you/parts';
import { ComparisonBlock } from './Comparisons';
import { HoursSplit } from './HoursSplit';
import { chapterHues, hoursFigure, projectHues, projectsHero, projectsView, raceSummary, weeklyView } from './model';
import { useNicknames, useProjectRegistry } from './nicknames';
import { RankRace } from './RankRace';
import { Rivers } from './Rivers';

const NO_BLOCK = 'Your Mac sent a report without projects. A newer Mac sends them, and this page fills in.';

export function CompareScreen() {
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
  const hues = useMemo(() => (block ? projectHues(block.projects, registry) : {}), [block, registry]);
  const [riversHue, raceHue, compareHue] = useMemo(
    () => chapterHues(['cobalt', 'heather', 'brass'], [accent.name, ...Object.values(hues)], accent.name, null),
    [accent.name, hues],
  );
  const heroHue: Hue = useMemo(() => ({ ink: accent.ink, partner: accent.partner, light: accent.light }), [accent.ink, accent.partner, accent.light]);
  const rawByMetric = useMemo(() => new Map((block?.comparisons ?? []).map((c) => [c.metric as string, c])), [block]);

  const inner = width - GUTTER * 2;
  const answered = view?.comparisons.filter((c) => c.answered).length ?? 0;

  return (
    <ChapterPage title="Compare" chapters={4} ready={accent.ready && registered && view !== null} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
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
              <Section>
                <HoursSplit hero={hero} rows={view.rows} width={width} ink={accent.ink} empty={view.rows.length === 0} />
              </Section>

              {stage >= 1 && weekly && view.rows.length > 0 ? (
                <Section style={styles.chapter}>
                  <Band hue={SPECTRUM[riversHue!]} title="Rivers">
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

              {stage >= 2 && weekly && !weekly.refusal && race && race.leader ? (
                <Section style={styles.chapter}>
                  <Band hue={SPECTRUM[raceHue!]} title="The rank race">
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

              {stage >= 3 && view.comparisons.length > 0 ? (
                <Section style={styles.chapter}>
                  <Band hue={SPECTRUM[compareHue!]} title="How they compare">
                    <View style={styles.figureRow}>
                      <BandFigure spec={numSpec(answered, n(answered))} width={inner * 0.3} max={104} delay={200} />
                      <View style={{ flex: 1 }}>
                        <BandWords delay={320}>
                          <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                            {`of ${view.comparisons.length} ${answered === 1 ? 'shows' : 'show'} a real difference`}
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

              {stage >= 4 && view.rows.some((r) => r.label.source === 'private') ? (
                <Section style={styles.foot}>
                  <Block>
                    <Words style={type.meta}>{`A private project goes by a number ${HERE} gave it, because its name never leaves your Mac.`}</Words>
                  </Block>
                </Section>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20, gap: 12 },
  chapter: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  lines: { marginTop: 16, gap: 8 },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  foot: { marginTop: 40, paddingHorizontal: GUTTER },
});
