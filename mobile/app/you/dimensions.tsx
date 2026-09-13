import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { capital } from '../../src/copy/numbers';
import { colors, layout, space } from '../../src/theme';
import { Bar, Row, Section, StatGrid, Surface, T } from '../../src/ui';
import {
  archetypeView,
  runnerUpLine,
  sourceLine,
  thresholdSentence,
  type ArchetypeView,
} from '../../src/you/archetype';
import {
  dimensionViews,
  dimensionsBasis,
  dimensionsPending,
  modalArchetypeLine,
  type DimensionView,
} from '../../src/you/dimensions';
import { useBuilderProfile } from '../../src/you/hooks';
import { DimensionsSkeleton, PageError, PageNotSent, PageSignedOut, StaleNote } from '../../src/you/States';

const c = colors('dark');

/** The command that analyses sessions, the input the five dimensions are averaged from. */
const ANALYSE_COMMAND = 'python -m capture sync --analyze';

/**
 * Dimensions: the five per session scores averaged across the window, each as a labelled bar
 * with its trend in words, then the builder type with its rule, the numbers behind it, the
 * rules that came next, and where every bar came from. No radar chart: five bars are read in a
 * glance, a radar's area means nothing and its shape changes with the order of its axes.
 *
 * Two different questions on one page, said apart: the dimensions are the model's reading of
 * each session, averaged by the server; the type is a rule over measured numbers. A bar that was
 * never measured (the explainx.ai mock's 2.4 and 487, Paxel's heavy steerer) says so wherever
 * its number is shown.
 */
export default function DimensionsScreen() {
  const { load, refresh, refreshing } = useBuilderProfile();
  const data = load.kind === 'ready' ? load.data : null;
  const dims = useMemo(() => dimensionViews(data?.builder_profile), [data]);
  const view = useMemo(() => (data ? archetypeView(data.corpus, data.report) : null), [data]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: layout.sectionGap,
      }}
      refreshControl={
        load.kind === 'signedOut' ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.accent} />
        )
      }
    >
      {load.kind === 'loading' && <DimensionsSkeleton />}
      {load.kind === 'signedOut' && <PageSignedOut what="dimensions" />}
      {load.kind === 'error' && <PageError message={load.message} onRetry={() => void refresh()} />}

      {load.kind === 'ready' && data && (
        <>
          {load.stale && <StaleNote stale={load.stale} />}

          {data.builder_profile && dims.length > 0 ? (
            <Section label="Five dimensions">
              <Surface style={{ gap: space.lg }}>
                {dims.map((d) => (
                  <DimensionBar key={d.dimension} d={d} />
                ))}
              </Surface>
              <T role="meta" tone="dim">
                {dimensionsBasis(data.builder_profile)} Each session is scored out of 100 by the model that read
                it, and a trend is the newer half of those sessions against the older half.
              </T>
              {modalArchetypeLine(data.builder_profile) ? (
                <T role="meta" tone="dim">
                  {modalArchetypeLine(data.builder_profile)}
                </T>
              ) : null}
            </Section>
          ) : (
            <PageNotSent
              title="No dimensions yet."
              text={`Each session is scored on five axes once your Mac analyses it. ${dimensionsPending(
                data.sessions_analysed,
                data.min_sessions,
              )}`}
              command={ANALYSE_COMMAND}
            />
          )}

          {view && <TypeSection view={view} />}
        </>
      )}
    </ScrollView>
  );
}

function DimensionBar({ d }: { d: DimensionView }) {
  return (
    <View
      style={{ gap: space.xs }}
      accessible
      accessibilityLabel={`${d.label}, ${d.mean} of 100, ${d.trend.words}, over ${d.sessions} sessions`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <T role="row" style={{ flex: 1 }} numberOfLines={1}>
          {d.label}
        </T>
        <T role="row">{d.mean}</T>
        <T role="meta" tone="dim">
          of 100
        </T>
      </View>
      <Bar progress={d.mean / 100} />
      {/* The trend in words, never an arrow or a colour: a move is not a verdict, and a
          steady one is a real answer. */}
      <T role="meta" tone="dim">
        {d.trend.words}
      </T>
    </View>
  );
}

function TypeSection({ view }: { view: ArchetypeView }) {
  const bar = view.winner ? thresholdSentence(view.winner) : null;
  return (
    <>
      <Section label="Your builder type">
        <View style={{ gap: space.sm }}>
          <T role="title" tone={view.state === 'refused' ? 'dim' : 'text'} accessibilityRole="header">
            {view.display}
          </T>
          {view.line ? <T role="body">{view.line}</T> : null}
        </View>
        {view.evidence.length > 0 ? (
          <Surface>
            <StatGrid items={view.evidence} />
          </Surface>
        ) : null}
        {bar ? (
          <T role="meta" tone="dim">
            {bar}
          </T>
        ) : null}
        <T role="meta" tone="dim">
          {sourceLine(view)}
        </T>
      </Section>

      {view.runnersUp.length > 0 && (
        <Section label={view.state === 'generalist' ? 'The next nearest' : 'Runners up'}>
          <Surface padding={0}>
            {view.runnersUp.map((r, i) => {
              const where = thresholdSentence(r);
              return (
                <Row
                  key={r.name}
                  title={r.display}
                  meta={where ? `${capital(runnerUpLine(r))}. ${where}` : capital(runnerUpLine(r))}
                  metaLines={4}
                  hairline={i < view.runnersUp.length - 1}
                />
              );
            })}
          </Surface>
        </Section>
      )}

      {view.unscored.length > 0 && (
        <Section label="Not scored here">
          <Surface padding={0}>
            {view.unscored.map((u, i) => {
              const rule = capital(u.rule.rule ?? u.rule.metric.replace(/_/g, ' '));
              return (
                <Row
                  key={u.rule.name}
                  title={u.rule.display}
                  meta={u.reason ? `${rule}. ${capital(u.reason)}.` : `${rule}.`}
                  metaLines={4}
                  hairline={i < view.unscored.length - 1}
                />
              );
            })}
          </Surface>
        </Section>
      )}
    </>
  );
}
