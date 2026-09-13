import React from 'react';
import { useWindowDimensions, View } from 'react-native';

import type { BuilderProfileResponse, Profile } from '../data/api';
import { ContributionGrid } from '../profile/ContributionGrid';
import { FactList } from '../profile/FactList';
import { NarrativeSection } from '../profile/NarrativeSection';
import { ReportSections } from '../profile/ReportSections';
import { ShareBars } from '../profile/ShareBars';
import { duration, layout, space } from '../theme';
import { Row, Section, StatGrid, Surface, T, type StatItem } from '../ui';
import { count, n } from '../copy/numbers';

/**
 * The rest of the You tab, under the hero, the Wrapped card and the rows: the profile as it
 * was before these pages, minus what moved into them. The five dimensions moved to Dimensions
 * and the model mix to Money; what is running lives on Now. Everything here is the existing
 * components, unchanged, in the order they were: the words first (the narrative), the measured
 * half, the facts, then the totals and the refusals.
 */
export function YouSections({ builder, profile }: { builder: BuilderProfileResponse | null; profile: Profile | null }) {
  const { width } = useWindowDimensions();
  const corpus = builder?.corpus ?? null;
  const narrative = builder?.narrative ?? null;
  const report = builder?.report ?? null;
  const missing = Object.entries(corpus?.sample.missing ?? {});

  return (
    <>
      {/* The sentence that explains the type, from the Mac, checked against its numbers. */}
      {narrative && <NarrativeSection narrative={narrative} />}

      {/* The measured half: each block is silent when the machine refused it. */}
      {report && <ReportSections report={report} />}

      {corpus && corpus.facts.length > 0 && (
        <Section label="What stands out">
          <FactList facts={corpus.facts} />
        </Section>
      )}

      {profile && <Totals profile={profile} builder={builder} width={width} />}

      {corpus && corpus.top_tools.length > 0 && (
        <Section label="What you reach for">
          <Surface>
            <ShareBars
              mono
              items={corpus.top_tools.map((t) => ({ label: t.tool, share: t.share, detail: `${n(t.calls)} calls` }))}
            />
          </Surface>
        </Section>
      )}

      {profile && profile.projects.length > 0 && (
        <Section label="Projects">
          <Surface padding={0}>
            {profile.projects.map((p, i) => (
              <Row
                key={p.key}
                // A private repo's key is a hash, and showing it reads as a bug; a letter per repo
                // tells them apart, which is the only job the label has.
                title={p.name ?? `Private repo ${String.fromCharCode(65 + i)}`}
                monoTitle={p.name !== null}
                meta={count(p.sessions, 'session')}
                value={duration(p.active_seconds)}
                hairline={i < profile.projects.length - 1}
              />
            ))}
          </Surface>
        </Section>
      )}

      {profile && (
        <Section label="Human vs agent">
          <Surface padding={0}>
            <Row title={n(profile.attribution.agent_lines)} meta="lines from the agent" hairline />
            <Row title={count(profile.attribution.human_edit_events, 'event')} meta="your edits outside the agent" hairline />
            <Row title={n(profile.attribution.prompts)} meta="prompts you typed" />
          </Surface>
          <T role="meta" tone="dim">
            Three separately measured numbers, deliberately not combined into a percentage. Your edits are
            recorded as events without line counts, so any ratio would be false precision.
          </T>
        </Section>
      )}

      {/* The refusals, in full: a metric this server cannot honestly compute is null with a
          reason, and printing the reasons is the difference between a profile you can trust and
          one you cannot check. */}
      {missing.length > 0 && (
        <Section label="What this cannot see">
          <Surface padding={0}>
            {missing.map(([key, reason], i) => (
              <Row key={key} title={key.replace(/_/g, ' ')} meta={reason} metaLines={6} hairline={i < missing.length - 1} />
            ))}
          </Surface>
        </Section>
      )}
    </>
  );
}

/** The totals, the ranking the app is allowed to make, and the active hours grid. */
function Totals({ profile, builder, width }: { profile: Profile; builder: BuilderProfileResponse | null; width: number }) {
  const corpus = builder?.corpus ?? null;
  const attended = profile.attribution.attended_seconds;
  const autonomous = profile.attribution.autonomous_seconds;
  // Only a server that splits the clocks gets the pair; "0 / 0" from an older one would be a
  // plausible wrong number.
  const hasSplit = attended !== undefined || autonomous !== undefined;
  const longest = profile.longest_session;
  const longestLabel = longest?.attended_seconds !== undefined ? 'longest attended' : 'longest session';

  const numbers: StatItem[] = [];
  if (hasSplit) {
    numbers.push({ value: duration(attended ?? 0), label: 'attended' });
    numbers.push({ value: duration(autonomous ?? 0), label: 'autonomous' });
  }
  if (longest) numbers.push({ value: duration(longest.attended_seconds ?? longest.active_seconds), label: longestLabel });
  if (corpus) {
    numbers.push({ value: n(corpus.totals.total_prompts), label: 'prompts' });
    numbers.push({ value: n(corpus.totals.total_lines_added), label: 'agent lines' });
    // Absent, not zero: two sessions that overlapped in one repo both counted the commits
    // between them, so the sum reads high and is dropped rather than shown wrong.
    if (corpus.totals.total_commits !== null) numbers.push({ value: n(corpus.totals.total_commits), label: 'commits' });
    numbers.push({ value: n(corpus.totals.total_tool_calls), label: 'tool calls' });
  }

  const standing: { key: string; value: string; label: string; mono?: boolean }[] = [];
  if (corpus?.session_rank[0]) {
    standing.push({
      key: 'longest',
      value: duration(corpus.session_rank[0].attended_seconds),
      label: `longest attended session, 1 of ${n(corpus.ranked_sessions)}`,
    });
  }
  if (typeof corpus?.metrics.default_model?.value === 'string') {
    standing.push({ key: 'model', value: corpus.metrics.default_model.value, label: 'model that did most of the work', mono: true });
  }
  if (typeof corpus?.metrics.shipping_day?.value === 'string') {
    standing.push({ key: 'ship', value: corpus.metrics.shipping_day.value, label: 'day the most code landed' });
  }
  if (typeof corpus?.metrics.busiest_day?.value === 'string') {
    standing.push({ key: 'busy', value: corpus.metrics.busiest_day.value, label: 'day you were at it longest' });
  }

  // The grid sits inside a surface: the gutter, the surface's padding and its hairline.
  const gridWidth = width - layout.gutter * 2 - layout.tilePad * 2 - 2;

  return (
    <>
      <Section label="The numbers">
        <Surface style={{ gap: space.md }}>
          <View style={{ gap: space.xs }}>
            <T role="title">{duration(profile.totals.active_seconds)}</T>
            <T role="meta" tone="dim">
              across {count(profile.totals.sessions, 'session')}
            </T>
          </View>
          {numbers.length > 0 && <StatGrid items={numbers} />}
        </Surface>
      </Section>

      {standing.length > 0 && (
        <Section label="Where you stand">
          <Surface padding={0}>
            {standing.map((r, i) => (
              <Row key={r.key} title={r.value} monoTitle={r.mono} meta={r.label} hairline={i < standing.length - 1} />
            ))}
          </Surface>
          <T role="meta" tone="dim">
            Sessions are ranked on attended time, never on elapsed. An overnight run the agent did alone counts
            toward your hours and can never hold a record.
          </T>
        </Section>
      )}

      <Section label="Active hours">
        <Surface>
          <ContributionGrid days={profile.graph.slice(-119)} width={gridWidth} />
        </Surface>
        <T role="meta" tone="dim">
          Coloured by hours, not tokens. Hours are the metric every editor has.
        </T>
      </Section>
    </>
  );
}
