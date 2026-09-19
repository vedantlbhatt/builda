/**
 * One project's page, `builder://project/<key>`: the report's own chapters asked of this one
 * repository, in the house style (the analysis page is the reference).
 *
 *   the hero        a band in the project's own hue: its name large (with the pencil that names a
 *                   private one, on this phone only), its stage, its hours with you there and its
 *                   share of your time counting up; under it THE DEMO (`src/demos/PageDemo.tsx`):
 *                   the video playing muted in a frame of its own, sunk under the band's pixel
 *                   edge, the stills beside it as a pile, a tap opening the full screen gallery;
 *                   then the ledger (the hours it ran alone, its sessions, its streaks) and its
 *                   week in words. The stage and the last session are the Mac's report reconciled
 *                   with the sessions this phone holds (`recency.ts`): never idle while one ran
 *   01 time         the days you built it, and the hour you build it most on the day clock, with
 *                   the night window and the share of the time that falls in it
 *   02 how you      the archetype asked of this project and its six rules against their bars, how
 *      build it     often you take the wheel back, prompts a session, tool calls a prompt, the tests
 *                   already green on one ring and the time back to green on a stopwatch, the helper
 *                   agents, and which tool wrote it, by the owner's own logos
 *   03 shipping     lines added against removed on one diff bar, the commits with a session running
 *                   against without, every commit day as a bar that grows in (a tap sparks), the
 *                   languages
 *   04 money        dollars at API list prices and what that is not, an hour and a commit, the model
 *                   split on a donut, the tokens that changed nothing
 *   05 made of      its stack as the Stack page's cloud of real logos
 *   06 sessions     THE SWARM: every session a dot dropping into place, a tap opens it
 *   07 compare      the comparisons that name this project, each with its two numbers
 *
 * A chapter the window cannot answer is not drawn as zeroes: a project with nothing in the window
 * keeps its hero (stage, last session, history) and its sessions, and says so in a sentence.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { n } from '../copy/numbers';
import { DemoGallery } from '../demos/Gallery';
import { HeroDemo } from '../demos/PageDemo';
import { ShipKitDoor } from '../shipkit/ShipKitDoor';
import { useProjectDemo, type DemoLoad } from '../demos/useDemo';
import { Band, BandWords } from '../insights/Band';
import { DiffBar, GrowBar, RuleTrack, StackBar } from '../insights/Bars';
import { Donut, PassRing, StopwatchRing } from '../insights/Charts';
import { CreatureMark } from '../insights/Creature';
import { numSpec } from '../insights/format';
import { BandFigure, figure, GUTTER, Kicker, Ledger, Refusal, Swatch, type, Words, type LedgerItem } from '../insights/kit';
import { REPORT_COMMAND } from '../insights/model';
import { Num } from '../insights/Num';
import { categorical, DATA, GROUND, ON_HUE, SPECTRUM, type Hue, type HueName } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { BurnBody, modelColors } from '../insights/sections/Money';
import { WordLink } from '../nav/chrome';
import { HARNESS_NAMES } from '../pixel/harness';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { Bubbles } from '../stack/Bubbles';
import { stackPage, type StackThing } from '../stack/model';
import { useAccent } from '../theme/accent';
import { ChapterPage } from '../you/ChapterPage';
import { useBuilderProfile } from '../you/hooks';
import { ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../you/parts';
import { CommitDays } from './CommitDays';
import { ComparisonBlock } from './Comparisons';
import { DayDial } from './DayDial';
import { BandName } from './Door';
import { PROJECT_CONSTANTS } from '../generated/copy';
import { chapterHues, projectHues, projectPage, swarmLine, type ProjectPage as Page } from './model';
import { NameField } from './NameField';
import { useNicknames, useProjectRegistry } from './nicknames';
import { recency, type Recency } from './recency';
import { Swarm } from './Swarm';
import { useProjectSessions } from './useProjectSessions';

/** The chapters after the hero, mounted one at a time (`ChapterPage`). */
const CHAPTERS = 7;

/** The index of the last of a list: the chapter the next one follows. */
function lastIndex(xs: readonly unknown[]): number {
  return xs.length - 1;
}

export function ProjectPage() {
  const params = useLocalSearchParams<{ key?: string }>();
  const key = typeof params.key === 'string' ? params.key.toLowerCase() : '';
  const { width } = useWindowDimensions();
  const inner = width - GUTTER * 2;
  const { load, refresh, refreshing } = useBuilderProfile();
  const nicknames = useNicknames();
  const accent = useAccent();

  const data = load.kind === 'ready' ? load.data : null;
  const report = data?.report ?? null;
  const block = report?.projects ?? null;
  const names = data?.project_names ?? null;
  const { registry, ready: registered } = useProjectRegistry(block?.projects);
  const page = useMemo(() => projectPage(block, key, names, nicknames, report, Date.now(), registry), [block, key, names, nicknames, report, registry]);
  const firstAt = page ? block?.projects.find((p) => p.key === page.detail.key)?.history.first_at ?? null : null;
  const lastAt = page ? block?.projects.find((p) => p.key === page.detail.key)?.history.last_at ?? null : null;
  const { sessions, total, error, phone } = useProjectSessions(page?.detail.key ?? (key.length >= 12 ? key : null), firstAt);
  const [naming, setNaming] = useState(false);
  const { demo, reload: reloadDemo, deleted: demoDeleted } = useProjectDemo(page?.detail.key ?? null);
  const [galleryAt, setGalleryAt] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const openGallery = useCallback((id: string) => {
    setGalleryAt(id);
    setGalleryOpen(true);
  }, []);
  const history = page ? block?.projects.find((p) => p.key === page.detail.key)?.history ?? null : null;
  const recent = useMemo(
    () => (page && history ? recency({ key: page.detail.key, history, reportAt: report?.generated_at ?? null, finals: phone.finals, live: phone.live, now: Date.now() }) : null),
    [page, history, report, phone],
  );

  const hues = useMemo(() => (block ? projectHues(block.projects, registry) : {}), [block, registry]);
  const own: Hue = page ? SPECTRUM[page.hue] : { ink: accent.ink, partner: accent.partner, light: accent.light };
  const [timeHue, buildHue, shipHue, moneyHue, stackHue, sessionsHue, compareHue] = useMemo(() => {
    // The sessions chapter wears the builder's own hue, because its arcs are theirs; so the five
    // before it leave that hue alone, and it takes it unless the project already wears it.
    const own = page?.hue ?? null;
    const reserve = own !== accent.name ? accent.name : null;
    const five = chapterHues(['amber', 'heather', 'tide', 'ember', 'cobalt'], [...(own ? [own] : []), ...(reserve ? [reserve] : [])], own, reserve);
    const [sessions, compare] = reserve
      ? [reserve, ...chapterHues(['iris'], [...(own ? [own] : []), reserve, ...five], reserve)]
      : chapterHues([accent.name, 'iris'], [...(own ? [own] : []), ...five], five[lastIndex(five)] ?? own);
    return [...five, sessions!, compare!];
  }, [accent.name, page]);
  const rawByMetric = useMemo(() => new Map((block?.comparisons ?? []).map((c) => [c.metric as string, c])), [block]);
  const stack = useMemo(() => {
    const w = block?.projects.find((p) => p.key === page?.detail.key)?.window ?? null;
    if (!data || !report || !w) return null;
    const s = stackPage({ ...data, report: { ...report, stack: w.stack } }, stackHue ?? 'cobalt');
    return 'top' in s.body ? s.body : null;
  }, [data, report, block, page, stackHue]);
  const hueOfThing = useCallback((_t: StackThing): HueName => stackHue ?? 'cobalt', [stackHue]);

  const ready = accent.ready && registered && (page !== null || load.kind !== 'loading');

  return (
    <>
      <Stack.Screen options={{ title: '', headerShadowVisible: false, headerStyle: { backgroundColor: GROUND.bg }, headerTintColor: GROUND.text }} />
      <ChapterPage chapters={CHAPTERS} ready={ready && page !== null} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
        {(stage) => (
          <>
            {load.kind === 'signedOut' || load.kind === 'error' || (load.kind === 'ready' && load.stale) ? (
              <View style={styles.lead}>
                {load.kind === 'signedOut' ? <SignedOutChapter what="project" /> : null}
                {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
                {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
              </View>
            ) : null}
            {load.kind === 'loading' ? <ChapterSkeleton /> : null}
            {data && !page ? (
              <RefusalChapter
                hue={own}
                title="This project"
                refusal={block ? 'The report your Mac sent does not hold this project. It may have been left out, or the report is older than it.' : 'This arrives with the report from your Mac, which has not been sent yet.'}
                command={REPORT_COMMAND}
              />
            ) : null}

            {page ? (
              <>
                <HeroChapter
                  page={page}
                  hue={own}
                  inner={inner}
                  width={width}
                  naming={naming}
                  onName={() => setNaming(true)}
                  onNamed={() => setNaming(false)}
                  recent={recent}
                  demo={demo}
                  held={galleryOpen}
                  onOpen={openGallery}
                  onDemoError={reloadDemo}
                  onDemoDeleted={demoDeleted}
                />
                <ShipKitDoor projectKey={page.detail.key} color={own.ink} hue={page.hue} name={page.detail.label.text} always />
                {page.time && stage >= 1 ? <TimeChapter page={page} hue={SPECTRUM[timeHue!]} inner={inner} /> : null}
                {page.build && stage >= 2 ? <BuildChapter page={page} hue={SPECTRUM[buildHue!]} inner={inner} /> : null}
                {page.shipping && stage >= 3 ? <ShippingChapter page={page} hue={SPECTRUM[shipHue!]} spark={page.hue} inner={inner} /> : null}
                {page.money && stage >= 4 ? <MoneyChapter page={page} hue={SPECTRUM[moneyHue!]} inner={inner} /> : null}
                {stack && stage >= 5 ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[stackHue!]} index="05" title="Made of">
                      <View style={styles.figureRow}>
                        <BandFigure spec={stack.total} width={inner * 0.4} max={104} delay={200} />
                        <View style={{ flex: 1 }}>
                          <BandWords delay={320}>
                            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                              {stack.caption.replace('your work is', 'this project is')}
                            </Text>
                          </BandWords>
                        </View>
                      </View>
                      <BandWords delay={420}>
                        <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                          {stack.note.replace(/your sessions/g, 'its sessions')}
                        </Text>
                      </BandWords>
                    </Band>
                    {stack.top.length ? (
                      <Block style={styles.block}>
                        <Kicker>what it is built with most</Kicker>
                        <Bubbles things={stack.top} width={inner} hueOf={hueOfThing} line={stack.topLine?.replace('the most sessions', 'the most of its sessions') ?? null} />
                      </Block>
                    ) : null}
                    <Block style={[styles.block, { gap: 8 }]}>
                      {stack.chapters.map((c) => (
                        <Words key={c.key} style={type.dim}>
                          <Text style={{ color: GROUND.text, fontWeight: '600' }}>{`${c.title}: `}</Text>
                          {[...c.used, ...c.named].map((t) => t.name).join(', ')}
                        </Words>
                      ))}
                      <Words style={type.meta}>{stack.credits}</Words>
                    </Block>
                  </Section>
                ) : null}
                {stage >= 6 ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[sessionsHue!]} index="06" title="Every session">
                      {sessions && sessions.length ? (
                        <View style={styles.figureRow}>
                          <BandFigure spec={numSpec(sessions.length, n(sessions.length))} width={inner * 0.4} max={104} delay={200} />
                          <View style={{ flex: 1 }}>
                            <BandWords delay={320}>
                              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                                {sessions.length === 1 ? 'session uploaded here, a dot' : 'sessions uploaded here, a dot each'}
                              </Text>
                            </BandWords>
                          </View>
                        </View>
                      ) : (
                        <BandWords delay={300}>
                          <Refusal onHue>{sessions === null ? 'Reading its sessions.' : swarmLine(0, page.detail.history.sessions, total)}</Refusal>
                        </BandWords>
                      )}
                    </Band>
                    {sessions && sessions.length ? (
                      <Block style={styles.block}>
                        <Kicker>every session, when it started, as big as it ran</Kicker>
                        <Swarm sessions={sessions} width={inner} ink={own.ink} core={accent.ink} from={firstAt} to={lastAt} delay={100} />
                        <Words style={[type.meta, styles.caption]}>{swarmLine(sessions.length, page.detail.history.sessions, total)}</Words>
                        {error ? <Words style={[type.meta, styles.caption]}>{`${error.replace(/\.?$/, '.')} Showing the sessions saved on this phone.`}</Words> : null}
                      </Block>
                    ) : null}
                  </Section>
                ) : null}
                {stage >= 7 ? (
                  <Section style={styles.chapter}>
                    <Band hue={SPECTRUM[compareHue!]} index="07" title="Against your other projects">
                      {page.detail.comparisons.length ? (
                        <BandWords delay={300}>
                          <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                            {`${page.detail.comparisons.filter((c) => c.answered).length} of ${page.detail.comparisons.length} comparisons that name it show a real difference.`}
                          </Text>
                        </BandWords>
                      ) : (
                        <BandWords delay={300}>
                          <Refusal onHue>{`No comparison names this project yet: each one needs two projects with ${n(PROJECT_CONSTANTS.min_group)} sessions in ${page.scope}.`}</Refusal>
                        </BandWords>
                      )}
                    </Band>
                    {[...page.detail.comparisons]
                      .sort((a, b) => Number(b.answered) - Number(a.answered))
                      .map((c, i) => (
                        <ComparisonBlock key={c.metric} c={c} raw={rawByMetric.get(c.metric) ?? null} hues={hues} first={i === 0} />
                      ))}
                  </Section>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ChapterPage>
      {page && demo.kind === 'ready' ? (
        <DemoGallery
          visible={galleryOpen}
          entries={demo.entries}
          sources={demo.sources}
          hue={page.hue}
          startId={galleryAt}
          title={page.detail.label.text}
          onClose={() => setGalleryOpen(false)}
          onError={reloadDemo}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ the hero

function HeroChapter({
  page,
  hue,
  inner,
  width,
  naming,
  onName,
  onNamed,
  recent,
  demo,
  held,
  onOpen,
  onDemoError,
  onDemoDeleted,
}: {
  page: Page;
  hue: Hue;
  inner: number;
  width: number;
  naming: boolean;
  onName: () => void;
  onNamed: () => void;
  /** The report's stage and last session, reconciled with the sessions this phone holds. */
  recent: Recency | null;
  demo: DemoLoad;
  held: boolean;
  onOpen: (id: string) => void;
  onDemoError: () => void;
  onDemoDeleted: () => void;
}) {
  const d = page.detail;
  const h = page.hero;
  const editable = d.label.source !== 'public';
  const ledger: LedgerItem[] = [];
  // Every number here is the Mac's report, and says so: the swarm below counts every session
  // uploaded, from any machine, and a second machine's are not in this report.
  if (h.autonomous) ledger.push({ key: 'alone', num: h.autonomous, label: 'hours the agent ran with nobody there', note: `on your Mac, ${page.scope}` });
  if (h.sessions) ledger.push({ key: 'sessions', num: h.sessions, label: h.sessions.final === '1' ? 'session your Mac read' : 'sessions your Mac read', note: page.scope.charAt(0).toUpperCase() + page.scope.slice(1) + '.' });
  if (h.currentStreak) ledger.push({ key: 'streak', num: h.currentStreak, label: 'days in a row, still going', note: h.longestStreak ? `The longest run was ${h.longestStreak.final} days.` : null });
  // "Not going now" is the report's to say, and the phone may know it is going again.
  else if (h.longestStreak) ledger.push({ key: 'longest', num: h.longestStreak, label: 'days in a row at the longest', note: recent?.streakNote ?? 'The run is not going now.' });
  ledger.push({ key: 'all', num: h.historySessions, label: `sessions your Mac read here since ${h.since}`, note: `${h.historyHours.final} hours with you there in all of them.` });
  const title = recent ? recent.title : d.stageLabel;
  const stageWords = recent ? recent.stageSentence : d.stageSentence;
  const band = (
    <Band hue={hue} title={title ?? 'Project'}>
      <View style={styles.nameRow}>
        <View style={{ flex: 1 }}>
          <BandName text={d.label.text} width={inner - (editable ? 44 : 0)} max={56} />
        </View>
        {editable ? (
          <Pressable
            onPress={onName}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={d.label.source === 'nickname' ? 'Rename this project' : 'Name this project'}
            style={({ pressed }) => [styles.pencil, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
          >
            <SymbolView name="pencil" tintColor={ON_HUE} weight="bold" size={20} />
          </Pressable>
        ) : null}
      </View>
      {h.hours ? (
        <BandWords delay={380}>
          <View style={styles.heroNumbers}>
            <View style={styles.pair}>
              <Num spec={h.hours} textStyle={figure(52, ON_HUE)} delay={420} accessibilityLabel={`${h.hours.final} hours with you there`} />
              <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                {`hours with you there on your Mac, ${page.scope}`}
              </Text>
            </View>
            {h.share ? (
              <View style={styles.pair}>
                <Num spec={h.share} textStyle={figure(52, ON_HUE)} delay={540} accessibilityLabel={`${h.share.final} of your time, ${page.scope}`} />
                <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                  {`of your time, ${page.scope}`}
                </Text>
              </View>
            ) : null}
          </View>
        </BandWords>
      ) : (
        <BandWords delay={380}>
          <View style={{ marginTop: 10 }}>
            <Refusal onHue>{d.window ? `Your Mac read no time with you there in ${page.scope}: the agent ran here alone.` : `Your Mac read nothing here in ${page.scope}.`}</Refusal>
          </View>
        </BandWords>
      )}
      {stageWords ? (
        <BandWords delay={500}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, { marginTop: 10 }]}>
            {stageWords}
          </Text>
        </BandWords>
      ) : null}
    </Band>
  );
  // With news the phone's own sentence comes first, then what the report read and when; the
  // report's week is said to be the report's. Without it, the report's words, as they were.
  const said = recent?.newer
    ? [recent.lastSession, recent.reportLine, d.momentum ? `Your Mac's report: ${d.momentum.charAt(0).toLowerCase()}${d.momentum.slice(1)}` : null]
    : [d.momentum, recent ? recent.lastSession : d.lastSession];
  return (
    <Section>
      <HeroDemo band={band} demo={demo} hue={page.hue} width={width} held={held} onOpen={onOpen} onError={onDemoError} projectKey={d.key} onDeleted={onDemoDeleted} />
      {naming ? (
        <Block style={styles.block}>
          <NameField projectKey={d.key} current={d.label.source === 'nickname' ? d.label.text : null} onDone={onNamed} />
        </Block>
      ) : editable && d.label.source === 'private' ? (
        <Block style={styles.nameHint}>
          <WordLink title="Name this project" onPress={onName} accessibilityHint="Its name never left your Mac. Give it one this phone keeps." />
        </Block>
      ) : null}
      <Block style={styles.block}>
        <Ledger items={ledger} color={hue.ink} size={44} delay={60} />
      </Block>
      <Block style={[styles.block, { gap: 6 }]}>
        {said.filter((s): s is string => Boolean(s)).map((s, i) => (
          <Words key={s} style={i === 0 || !recent?.newer ? type.body : type.dim}>
            {s}
          </Words>
        ))}
      </Block>
    </Section>
  );
}

// ------------------------------------------------------------------ time

function TimeChapter({ page, hue, inner }: { page: Page; hue: Hue; inner: number }) {
  const t = page.time!;
  const d = page.detail;
  return (
    <Section style={styles.chapter}>
      <Band hue={hue} index="01" title="Time">
        {t.activeDays ? (
          <View style={styles.figureRow}>
            <BandFigure spec={t.activeDays} width={inner * 0.4} max={104} delay={200} />
            <View style={{ flex: 1 }}>
              <BandWords delay={320}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                  {`${t.activeDays.final === '1' ? 'day' : 'days'} you built it, ${page.scope}`}
                </Text>
              </BandWords>
            </View>
          </View>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>{`No day with a session here in ${page.scope}.`}</Refusal>
          </BandWords>
        )}
        <BandWords delay={420}>
          <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
            {`${t.spanDays.final} days from its first session to its last, all of its history.`}
          </Text>
        </BandWords>
      </Band>
      <Block style={styles.block}>
        <Kicker>when in the day</Kicker>
        {t.peak && t.peakHour !== null ? (
          <View style={styles.clockRow}>
            <DayDial size={Math.min(200, Math.floor(inner * 0.56))} peakHour={t.peakHour} night={t.nightShare !== null} ink={hue.ink} partner={hue.partner} delay={60} />
            <View style={{ flex: 1, gap: 4 }}>
              <Num spec={t.peak} textStyle={figure(40, hue.ink)} delay={420} duration={950} />
              <Words style={type.dim}>you build it most, by the active time in each hour</Words>
              {t.night ? (
                <View style={styles.nightLine}>
                  <Num spec={t.night} textStyle={figure(28, hue.partner)} delay={620} duration={900} />
                  <Words style={type.dim}>of it between 10pm and 4am, the arc on the dial</Words>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <Refusal>{d.peakHourRefusal ?? 'There is no hour to name yet.'}</Refusal>
        )}
      </Block>
    </Section>
  );
}

// ------------------------------------------------------------------ how you build it

function BuildChapter({ page, hue, inner }: { page: Page; hue: Hue; inner: number }) {
  const b = page.build!;
  const ledger: LedgerItem[] = [];
  if (b.steer) ledger.push({ key: 'steer', num: b.steer, label: 'of prompts stop or redirect it', note: b.steerSentence });
  if (b.perSession) ledger.push({ key: 'per', num: b.perSession, label: 'prompts a session' });
  if (b.perPrompt) ledger.push({ key: 'calls', num: b.perPrompt, label: 'tool calls for every prompt you send' });
  const ring = Math.min(140, Math.floor(inner * 0.4));
  return (
    <Section style={styles.chapter}>
      <Band hue={hue} index="02" title="How you build it">
        {b.type ? (
          <>
            <BandName text={b.type} width={inner} max={52} delay={260} />
            {b.typeSentence ? (
              <BandWords delay={420}>
                <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, { marginTop: 8 }]}>
                  {b.typeSentence}
                </Text>
              </BandWords>
            ) : null}
          </>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>{b.typeRefusal ?? 'No type is asked of this project yet.'}</Refusal>
          </BandWords>
        )}
      </Band>

      {b.rules.length ? (
        <Block style={styles.block}>
          <Kicker>the six rules, asked of this project</Kicker>
          <View style={{ gap: 16 }}>
            {b.rules.map((r, i) => {
              const h = SPECTRUM[r.hue];
              return (
                <View key={r.key} style={{ gap: 6 }}>
                  <View style={styles.ruleHead}>
                    <CreatureMark animal={r.animal} size={16} color={h.ink} />
                    <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1, color: r.winner ? GROUND.text : GROUND.dim }]}>
                      {r.display}
                    </Text>
                    {r.bar ? (
                      <Text allowFontScaling={false} style={[type.meta, { fontVariant: ['tabular-nums'] }]}>
                        {`bar ${r.bar}`}
                      </Text>
                    ) : null}
                  </View>
                  <RuleTrack score={r.score} color={h.ink} height={r.winner ? 12 : 6} delay={120 + i * 140} tick={GROUND.text} />
                  <Words style={type.meta}>{r.said}</Words>
                </View>
              );
            })}
          </View>
          <Words style={[type.meta, styles.caption]}>The tick on each line is the bar its rule needs. Past the tick, the rule is met.</Words>
        </Block>
      ) : null}

      {ledger.length ? (
        <Block style={styles.block}>
          <Ledger items={ledger} color={hue.ink} size={40} delay={40} />
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>every test run</Kicker>
        {b.green ? (
          <>
            <View style={styles.ringRow}>
              <View>
                <PassRing passed={b.green.passed} failed={b.green.failed} size={ring} pass={DATA.add} fail={DATA.del} delay={60} />
                <View style={styles.ringCenter}>
                  <Num spec={b.green.rate} textStyle={figure(28, GROUND.text)} delay={120} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 10 }}>
                <Words style={type.lead}>already green on the first run</Words>
                <View style={styles.legendLine}>
                  <Swatch color={DATA.add} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                    {`${n(b.green.passed)} green, nothing failed after`}
                  </Text>
                </View>
                <View style={styles.legendLine}>
                  <Swatch color={DATA.del} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                    {`${n(b.green.failed)} an error followed`}
                  </Text>
                </View>
              </View>
            </View>
            <Words style={[type.meta, styles.caption]}>{b.green.runs}</Words>
          </>
        ) : (
          <Refusal>{b.greenRefusal ?? 'No test run was read here.'}</Refusal>
        )}
      </Block>

      {b.back || b.backRefusal ? (
        <Block style={styles.block}>
          <Kicker>back to green</Kicker>
          {b.back ? (
            <View style={styles.ringRow}>
              <View>
                <StopwatchRing seconds={b.back.seconds} dial={b.back.dial} size={124} ink={hue.ink} delay={60} />
                <View style={styles.ringCenter}>
                  <Num spec={b.back.median} textStyle={figure(24, GROUND.text)} delay={60} duration={1000} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Words style={type.lead}>the median time back to green</Words>
                <Words style={type.dim}>{b.back.worst}</Words>
                <Words style={type.meta}>{`${b.back.n} The ring is one ${b.back.dial}.`}</Words>
              </View>
            </View>
          ) : (
            <Refusal>{b.backRefusal!}</Refusal>
          )}
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>helper agents</Kicker>
        {b.agents ? (
          <Ledger
            items={[
              { key: 'agents', num: b.agents.agents, label: b.agents.agents.final === '1' ? 'agent its sessions sent off' : 'agents its sessions sent off' },
              { key: 'once', num: b.agents.atOnce, label: 'at the same moment, at the most' },
            ]}
            color={hue.ink}
            size={40}
            delay={40}
          />
        ) : (
          <Words style={type.dim}>{`No helper agent ran here in ${page.scope}.`}</Words>
        )}
      </Block>

      {b.harnesses.length ? (
        <Block style={styles.block}>
          <Kicker>which tool wrote it</Kicker>
          <View style={{ gap: 14 }}>
            {b.harnesses.map((x, i) => (
              <View key={x.harness} style={{ gap: 6 }}>
                <View style={styles.toolHead}>
                  <HarnessLogo harness={x.harness} size={22} color={GROUND.text} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1 }]}>
                    {HARNESS_NAMES[x.harness] ?? x.harness}
                  </Text>
                  <Text allowFontScaling={false} style={type.meta}>
                    {x.text}
                  </Text>
                </View>
                <GrowBar frac={x.share} color={hue.ink} height={6} delay={100 + i * 90} />
              </View>
            ))}
          </View>
        </Block>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ shipping

function ShippingChapter({ page, hue, spark, inner }: { page: Page; hue: Hue; spark: HueName; inner: number }) {
  const s = page.shipping!;
  const L = page.detail.languages;
  return (
    <Section style={styles.chapter}>
      <Band hue={hue} index="03" title="Shipping">
        {s.added ? (
          <>
            <BandFigure spec={s.added} width={inner} max={92} delay={200} label={`${s.added.final} lines added`} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {`lines the agent added${s.removed ? `, and ${s.removed.final.replace(/^-/, '')} it removed` : ''}`}
              </Text>
            </BandWords>
          </>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>{`No line the agent added was counted here in ${page.scope}.`}</Refusal>
          </BandWords>
        )}
      </Band>

      {s.added || s.removed ? (
        <Block style={styles.block}>
          <Kicker>the diff</Kicker>
          <View style={styles.diffLabels}>
            {s.removed ? <Num spec={s.removed} textStyle={figure(24, DATA.del)} delay={60} /> : <View />}
            {s.added ? <Num spec={s.added} textStyle={figure(24, DATA.add)} delay={60} /> : null}
          </View>
          <DiffBar addedShare={s.addedShare} add={DATA.add} del={DATA.del} delay={80} />
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>commits</Kicker>
        {s.commits ? (
          <>
            <View style={styles.bigLine}>
              <Num spec={s.commits.total} textStyle={figure(48, GROUND.text)} delay={40} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                {s.commits.total.final === '1' ? 'commit' : 'commits'}
              </Text>
            </View>
            <StackBar
              height={16}
              delay={160}
              segments={[
                { key: 'assisted', value: s.commits.assistedN, color: DATA.agent },
                { key: 'alone', value: s.commits.aloneN, color: DATA.human },
              ]}
            />
            <View style={styles.legend}>
              <View style={styles.legendLine}>
                <Swatch color={DATA.agent} />
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {`${s.commits.assisted.final} with a session of this project running`}
                </Text>
              </View>
              <View style={styles.legendLine}>
                <Swatch color={DATA.human} />
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {`${s.commits.alone.final} without one`}
                </Text>
              </View>
            </View>
            {s.commits.days.length ? (
              <View style={{ marginTop: 18 }}>
                <CommitDays days={s.commits.days} width={inner} spark={spark} delay={220} />
              </View>
            ) : null}
            <Words style={[type.meta, styles.caption]}>{s.commits.sentence}</Words>
          </>
        ) : (
          <Refusal>{s.commitsRefusal!}</Refusal>
        )}
      </Block>

      {L ? (
        <Block style={styles.block}>
          <Kicker>languages, by lines added</Kicker>
          {L.rows.length ? (
            <>
              <StackBar height={20} delay={40} step={90} segments={L.rows.map((r, i) => ({ key: r.language, value: r.lines, color: r.language === 'other' ? GROUND.faint : categorical(i).ink }))} />
              <View style={styles.rows}>
                {L.rows.map((r, i) => (
                  <View key={r.language} style={styles.langRow}>
                    <Swatch color={r.language === 'other' ? GROUND.faint : categorical(i).ink} />
                    <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1 }]} numberOfLines={1}>
                      {r.language === 'other' ? 'Everything else' : r.language}
                    </Text>
                    <Num spec={numSpec(r.lines, n(r.lines))} textStyle={styles.langLines} delay={120 + i * 70} duration={800} />
                    <Text allowFontScaling={false} style={[type.meta, styles.langShare]}>
                      {r.share}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Refusal>{L.refusal ?? 'Too few lines to split by language.'}</Refusal>
          )}
        </Block>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ money

function MoneyChapter({ page, hue, inner }: { page: Page; hue: Hue; inner: number }) {
  const m = page.money!;
  const colors = modelColors(m.models.map((x) => x.family));
  return (
    <Section style={styles.chapter}>
      <Band hue={hue} index="04" title="Money">
        {m.usd ? (
          <>
            <BandFigure spec={m.usd} width={inner} max={96} delay={200} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                {m.headline ?? 'at API list prices'}
              </Text>
            </BandWords>
            <BandWords delay={440}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, { marginTop: 8 }]}>
                {m.notAbill}
              </Text>
            </BandWords>
          </>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>{m.refusal ?? 'No dollar figure for this project in this window.'}</Refusal>
          </BandWords>
        )}
      </Band>

      {m.usd ? (
        <Block style={styles.block}>
          {m.perHour ? (
            <View style={styles.bigLine}>
              <Num spec={m.perHour} textStyle={figure(40, hue.ink)} delay={40} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                an active hour
              </Text>
            </View>
          ) : null}
          {m.perCommit ? (
            <View style={[styles.bigLine, { marginTop: 8 }]}>
              <Num spec={m.perCommit} textStyle={figure(40, hue.ink)} delay={160} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                a commit
              </Text>
            </View>
          ) : m.perCommitRefusal ? (
            <View style={{ marginTop: 8 }}>
              <Refusal>{m.perCommitRefusal}</Refusal>
            </View>
          ) : null}
          {m.without ? <Words style={[type.body, { marginTop: 14 }]}>{m.without}</Words> : null}
        </Block>
      ) : null}

      {m.models.length ? (
        <Block style={styles.block}>
          <Kicker>what each model would cost</Kicker>
          <View style={styles.donutRow}>
            <Donut size={128} stroke={22} delay={60} slices={m.models.map((x, i) => ({ key: x.key, value: x.usd, color: colors[i]! }))} />
            <View style={{ flex: 1, gap: 12 }}>
              {m.models.map((x, i) => (
                <View key={x.key} style={styles.legendLine}>
                  <Swatch color={colors[i]!} />
                  <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[type.lead, { flex: 1 }]}>
                    {x.name}
                  </Text>
                  <Text allowFontScaling={false} style={[type.lead, { fontVariant: ['tabular-nums'] }]}>
                    {x.text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Block>
      ) : null}

      {m.burn ? (
        <Block style={styles.block}>
          <Kicker>tokens that changed nothing</Kicker>
          <BurnBody burn={m.burn} ink={hue.ink} />
        </Block>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20, gap: 12 },
  chapter: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  caption: { marginTop: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pencil: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  nameHint: { paddingHorizontal: GUTTER, marginTop: 14 },
  heroNumbers: { flexDirection: 'row', gap: 20, marginTop: 14 },
  pair: { flex: 1 },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  nightLine: { marginTop: 10, gap: 2 },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  legend: { marginTop: 12, gap: 8 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  diffLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  bigLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, marginBottom: 10 },
  rows: { marginTop: 14 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GROUND.border,
  },
  langLines: { fontSize: 17, fontWeight: '700', color: GROUND.text, fontVariant: ['tabular-nums'] },
  langShare: { width: 58, textAlign: 'right' },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
});
