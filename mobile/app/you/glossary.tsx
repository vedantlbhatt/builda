import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { count } from '../../src/copy/numbers';
import { Band, BandWords } from '../../src/insights/Band';
import { BandFigure, GUTTER, Kicker, Swatch, type, Words } from '../../src/insights/kit';
import { GROUND, SPECTRUM, type Hue } from '../../src/insights/palette';
import { Block, Section } from '../../src/insights/reveal';
import { useAccent } from '../../src/theme/accent';
import { ChapterPage } from '../../src/you/ChapterPage';
import { doorHues, glossaryPage, isRefused, REPORT_COMMAND } from '../../src/you/chapters';
import type { GlossaryMonth, TermRow } from '../../src/you/glossary';
import { useBuilderProfile } from '../../src/you/hooks';
import { Arrive, ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine, TermSquares } from '../../src/you/parts';

/** Terms that arrive together, one stagger at a time, as each group scrolls into view. */
const PER_BLOCK = 6;
/** The step between one term and the next (appllama top-welcome-screens' Yazio stagger, about 67 ms). */
const TERM_STEP = 65;

/**
 * Glossary: the words your sessions have run into, a collection that fills in over months.
 *
 *   the band        in this page's hue, the terms found counting up against the catalog ("52 of
 *                   74"), and how many are left to find, said quietly
 *   the collection  one square a term, found ones filled, the rest quiet outlines, filling in a
 *                   wave from the top left
 *   the terms       an open list by the month a session first met them, newest month first, each
 *                   word with its one line definition and the day, arriving a few at a time
 *
 * A collection, not a game: nothing is unlocked, levelled or scored, and nothing asks to be
 * finished. What is left is one quiet line.
 */
export default function GlossaryScreen() {
  const { width } = useWindowDimensions();
  const { load, refresh, refreshing } = useBuilderProfile();
  const accent = useAccent();
  const data = load.kind === 'ready' ? load.data : null;
  const page = useMemo(() => (data ? glossaryPage(data) : null), [data]);
  const hue = SPECTRUM[doorHues(accent.name).glossary];
  const inner = width - GUTTER * 2;
  const body = page?.body ?? null;

  return (
    <ChapterPage title="Glossary" chapters={1} ready={page !== null && accent.ready} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
      {(stage) => (
        <>
          <View style={styles.lead}>
            {load.kind === 'signedOut' ? <SignedOutChapter what="glossary" /> : null}
            {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
            {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
          </View>

          {load.kind === 'loading' ? <ChapterSkeleton /> : null}

          {page && body && isRefused(body) ? (
            <RefusalChapter hue={hue} index="01" title="Words you have met" refusal={body.refusal} command={page.notSent ? REPORT_COMMAND : null} />
          ) : null}

          {body && !isRefused(body) ? (
            <>
              <Section>
                <Band hue={hue} index="01" title="Words you have met">
                  <View style={styles.side}>
                    <BandFigure spec={body.found} width={inner * 0.4} max={112} min={56} delay={200} label={`${body.found.final} of ${body.catalog} terms found`} />
                    <View style={styles.sideWords}>
                      <BandWords delay={320}>
                        <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                          {`of ${body.catalog} terms your sessions ran into`}
                        </Text>
                      </BandWords>
                    </View>
                  </View>
                  {body.locked ? (
                    <BandWords delay={420}>
                      <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
                        {`${body.summary} ${body.locked}`}
                      </Text>
                    </BandWords>
                  ) : null}
                </Band>
                <Block style={styles.block}>
                  <Kicker>the collection, one square a term</Kicker>
                  <TermSquares found={body.foundCount} catalog={body.catalog} width={inner} hue={hue} />
                </Block>
              </Section>

              {stage >= 1 ? body.months.map((m) => <Month key={m.key} month={m} hue={hue} />) : null}

              {stage >= 1 && body.cutNote ? (
                <Section style={styles.month}>
                  <Block style={styles.block}>
                    <Words style={type.meta}>{body.cutNote}</Words>
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

/** One month: its name as a chapter heading in the page's hue, then its terms a few at a time. */
function Month({ month, hue }: { month: GlossaryMonth; hue: Hue }) {
  const groups: TermRow[][] = [];
  for (let i = 0; i < month.terms.length; i += PER_BLOCK) groups.push(month.terms.slice(i, i + PER_BLOCK));
  return (
    <Section style={styles.month}>
      <Block style={styles.block}>
        <View style={styles.monthHead} accessibilityRole="header">
          <Text maxFontSizeMultiplier={1.3} style={[styles.monthName, { color: hue.ink }]}>
            {month.label}
          </Text>
          <Text allowFontScaling={false} style={type.meta}>
            {count(month.terms.length, 'term')}
          </Text>
        </View>
      </Block>
      {groups.map((g) => (
        <Block key={g[0]!.id} style={styles.terms}>
          {g.map((t, i) => (
            <Arrive key={t.id} delay={i * TERM_STEP}>
              <Term term={t} hue={hue} />
            </Arrive>
          ))}
        </Block>
      ))}
    </Section>
  );
}

function Term({ term, hue }: { term: TermRow; hue: Hue }) {
  return (
    <View style={styles.term} accessible accessibilityLabel={`${term.word}. ${term.definition}${term.firstSeen ? ` First met ${term.firstSeen}.` : ''}`}>
      <View style={styles.termHead}>
        <Swatch color={hue.ink} size={9} />
        <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.word]}>
          {term.word}
        </Text>
        {term.firstSeen ? (
          <Text allowFontScaling={false} style={[type.meta, styles.day]}>
            {term.firstSeen}
          </Text>
        ) : null}
      </View>
      <Words style={[type.dim, styles.definition]}>{term.definition}</Words>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 18, gap: 10 },
  side: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  sideWords: { flex: 1, paddingBottom: 14 },
  note: { marginTop: 8 },
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  month: { marginTop: 18 },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  monthName: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.7 },
  terms: { paddingHorizontal: GUTTER, marginTop: 6 },
  term: { paddingVertical: 11, gap: 3 },
  termHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  word: { flex: 1 },
  day: { color: GROUND.faint, fontVariant: ['tabular-nums'] },
  definition: { marginLeft: 19 },
});
