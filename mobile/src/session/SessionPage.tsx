/**
 * A session's page, in the house style the owner picked (design-refs/HOUSE-STYLE.md), composed
 * as a Strava activity page is (design-refs/awesome-ios-design-md/design-md/fitness/strava: the
 * trophy number, the route, the splits, the analysis, then sharing), one chapter after another
 * on the warm dark ground:
 *
 *   the hero        a band in the session's creature's hue: the engineer voice title a word at a
 *                   time, the creature printed, the active time HUGE and counting, the tool's
 *                   real logo and the repository (`Hero.tsx`)
 *   the route       the strip traced left to right, its start and stop clocks, its key (`Route.tsx`)
 *   what landed     lines added in green, removed in red, commits and prompts, counting, over the
 *                   diff bar that grows from the split
 *   what happened   the plain English paragraph a sentence at a time, the notes, the decisions,
 *                   and the doorways to the map and the time lapse, as words
 *   the burn        its own band in its own hue, the chart that grows and pulses once, the splits
 *                   (`BurnSection.tsx`)
 *   the reading     the model's, on its own band (`analysis/AnalysisView.tsx`)
 *   the card        and what can be done with it, as words (`Share.tsx`)
 *
 * A running session opens on the live bar that mirrors its Lock Screen card (`live/LiveBar.tsx`,
 * owned by the live surface), with the refused ETA said under it as a sentence.
 *
 * The frame is the analysis page's: one scroll view, the reveal clock (every number counts up
 * and every chart draws on the first time it arrives, once per mount; Reduce Motion puts them
 * at rest behind a 150 ms fade), nothing playing until the push has landed, the chapters mounted
 * one at a time so the first count is never starved of frames (`insights/RevealScroll.tsx`).
 */
import { Stack } from 'expo-router';
import React, { useMemo, useState, type RefObject } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { CardModel } from '../card/RecapCard';
import type { SessionDetail } from '../data/api';
import { describeEnd } from '../analysis/format';
import { AnalysisView } from '../analysis/AnalysisView';
import { DiffBar } from '../insights/Bars';
import { figure, GUTTER, Kicker, Refusal, type, Words } from '../insights/kit';
import { COUNT_MS } from '../insights/motion';
import { Num } from '../insights/Num';
import { creatureHue, DATA, GROUND, SPECTRUM, type Hue } from '../insights/palette';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import { useChapterStages, useRevealScroll } from '../insights/RevealScroll';
import { LiveBar } from '../live/LiveBar';
import type { HueName } from '../theme';
import { SparkBurst } from '../ui/bits/effects';
import { useAccent } from '../theme/accent';
import { useReduceMotion } from '../ui/motion';
import { burnChart } from './burnChart';
import { burnView } from './burnView';
import { BurnSection } from './BurnSection';
import { sessionHues, type CrewCreature } from './crew';
import { DecisionList } from './DecisionList';
import { decisionRows } from './decisions';
import { SessionHero } from './Hero';
import { sessionLinks } from './links';
import { heroOf, ledgerOf, untitledName, wordsOf, type LedgerLine, type LedgerModel } from './page';
import { useClockReached } from './parts';
import { Route } from './Route';
import { SessionLinks } from './SessionLinks';
import { StaleLine } from './SessionStates';
import { ShareChapter, type PostState } from './Share';
import { SessionWords } from './TitleLine';

/** Chapters after the first (the hero and the route play alone, then these mount in turn). */
const CHAPTERS = 4;

export interface SessionPageProps {
  session: SessionDetail;
  creature: CrewCreature;
  stale: string | null;
  /** The sample's state, carried to the map and the time lapse so they draw the same sample. */
  sampleVariant?: string;
  etaNote: string | null;
  card: CardModel;
  cardRef: RefObject<View | null>;
  post: PostState;
  saving: boolean;
  onPost: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFeed: () => void;
  onSave: () => void;
}

export function SessionPage(props: SessionPageProps) {
  const { session: s, creature, stale, sampleVariant, etaNote } = props;
  const { width } = useWindowDimensions();
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { stage, hurry } = useChapterStages(CHAPTERS, true);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, hurry);
  const accent = useAccent();

  const now = useMemo(() => Date.now(), []);
  const hues = useMemo(() => sessionHues(creature), [creature]);
  const hue = creatureHue(creature);
  const hero = useMemo(() => heroOf(s, now), [s, now]);
  const ledger = useMemo(() => ledgerOf(s), [s]);
  const words = useMemo(() => wordsOf(s), [s]);
  const burn = useMemo(() => burnView(s), [s]);
  const chart = useMemo(() => burnChart(s.burn), [s.burn]);
  const decisions = useMemo(() => decisionRows(s.live_state?.decisions, s.started_at), [s.live_state?.decisions, s.started_at]);
  const links = useMemo(() => sessionLinks(s, sampleVariant), [s, sampleVariant]);
  const live = (s.state ?? 'final') === 'live';
  const endNote = describeEnd(s);

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: GROUND.bg },
          headerTintColor: GROUND.text,
        }}
      />
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
      >
        <RevealPage page={page}>
          {stale || live ? (
            <View style={styles.lead}>
              {stale ? <StaleLine text={stale} /> : null}
              {live ? <LiveBar session={s} /> : null}
              {live && etaNote ? <Words style={type.meta}>{etaNote}</Words> : null}
            </View>
          ) : null}

          <SessionHero hero={hero} creature={creature} hue={hue} width={width} fallbackTitle={untitledName(s.started_at, now)} />
          <Section>
            <Route session={s} width={width} endNote={endNote} />
          </Section>

          {stage >= 1 ? (
            <Section>
              <LedgerBlock ledger={ledger} hue={hue} hueName={hues.session} />
              <SessionWords words={words} />
              <DecisionList rows={decisions} />
              <SessionLinks links={links} color={accent.ink} />
            </Section>
          ) : null}

          {stage >= 2 ? <BurnSection burn={s.burn} view={burn} chart={chart} hue={SPECTRUM[hues.burn]} width={width} prompts={promptCount(s)} /> : null}

          {stage >= 3 ? (
            s.analysis ? (
              <AnalysisView analysis={s.analysis} hue={SPECTRUM[hues.reading]} width={width} still={live} />
            ) : (
              <Section style={styles.quiet}>
                <Block style={styles.pad}>
                  <Kicker>the reading</Kicker>
                  {/* Quiet, and no creature: a finished session without a reading will not grow one by
                      waiting. A running one gets its reading when it ends. */}
                  <Refusal>{live ? 'The reading is written when the session ends.' : 'No reading was written for this session.'}</Refusal>
                </Block>
              </Section>
            )
          ) : null}

          {stage >= 4 ? (
            <ShareChapter
              model={props.card}
              width={width}
              cardRef={props.cardRef}
              accent={accent.ink}
              post={props.post}
              saving={props.saving}
              onPost={props.onPost}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onOpenFeed={props.onOpenFeed}
              onSave={props.onSave}
            />
          ) : null}
        </RevealPage>
      </Animated.ScrollView>
    </>
  );
}

/** The session's prompt count as it sent it, or null when it sent none. */
function promptCount(s: SessionDetail): number | null {
  const p = (s.stats as { human_prompt_count?: unknown } | null | undefined)?.human_prompt_count;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

/** When the ledger's first figure starts counting, and the gap to the next. */
const LEDGER_AT = 120;
const LEDGER_STEP = 180;

/**
 * What landed, as lines of print (the kit `Ledger`'s look): the diff bar growing out of its split,
 * then lines added in the data green, removed in the data red, commits and prompts in the
 * session's ink, each counting up in turn. As the commits figure lands it throws one burst of
 * sparks in the session's hue: react-bits ClickSpark, through its port (`ui/bits/effects`), whose
 * notes name "a commit landing" as its one use without a finger. Reduce Motion: no sparks.
 */
function LedgerBlock({ ledger, hue, hueName }: { ledger: LedgerModel; hue: Hue; hueName: HueName }) {
  if (!ledger.lines.length) return null;
  return (
    <Block style={styles.pad}>
      <Kicker>what landed</Kicker>
      {ledger.diff ? (
        <View style={styles.diff}>
          <DiffBar addedShare={ledger.diff.addedShare} add={DATA.add} del={DATA.del} height={14} delay={40} />
        </View>
      ) : null}
      {ledger.lines.map((l, i) => (
        <View key={l.key} style={[styles.ledgerRow, i > 0 ? styles.hairTop : null]}>
          <View style={styles.ledgerLine}>
            <LedgerFigure
              line={l}
              color={l.tone === 'add' ? DATA.add : l.tone === 'del' ? DATA.del : hue.ink}
              delay={LEDGER_AT + i * LEDGER_STEP}
              spark={l.key === 'commits' ? hueName : null}
            />
            <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.ledgerLabel]}>
              {l.label}
            </Text>
          </View>
        </View>
      ))}
    </Block>
  );
}

function LedgerFigure({ line, color, delay, spark }: { line: LedgerLine; color: string; delay: number; spark: HueName | null }) {
  const landed = useClockReached(delay + COUNT_MS);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  return (
    <View onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Num spec={line.num} textStyle={figure(48, color)} delay={delay} accessibilityLabel={`${line.num.final} ${line.label}`} />
      {spark && box ? <SparkBurst x={box.w / 2} y={box.h / 2} hue={spark} playKey={landed ? 1 : 0} radius={30} /> : null}
    </View>
  );
}

/** The frame the states sit in while there is no session to lay out (`SessionStates.tsx`). */
export function SessionFrame({ children, padded = true }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <>
      <Stack.Screen options={{ title: '', headerShadowVisible: false, headerStyle: { backgroundColor: GROUND.bg }, headerTintColor: GROUND.text }} />
      <Animated.ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.frame, padded ? styles.padded : null]}>
        {children}
      </Animated.ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: 120 },
  frame: { paddingBottom: 120, gap: 20 },
  padded: { paddingHorizontal: GUTTER, paddingTop: 12 },
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 18, gap: 8 },
  pad: { paddingHorizontal: GUTTER, marginTop: 30 },
  diff: { marginBottom: 6 },
  ledgerRow: { paddingVertical: 12 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  ledgerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  ledgerLabel: { flexShrink: 1 },
  // A block after the ledger above, not a chapter (FOUND IN THE FINAL CAPTURE, 2026-09-13: 48 on
  // top of the block's own 30 left an empty chapter's worth of ground before two lines).
  quiet: { marginTop: 8 },
});
