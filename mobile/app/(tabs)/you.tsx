import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { api } from '../../src/data/client';
import { OFFLINE_MESSAGE, type BuilderProfileResponse, type Profile } from '../../src/data/api';
import { LiveSessions } from '../../src/live/LiveSessions';
import { PixelBadge } from '../../src/pixel/PixelBadge';
import { ArchetypeHero } from '../../src/profile/ArchetypeHero';
import { BuilderProfileCard } from '../../src/profile/BuilderProfileCard';
import { ContributionGrid } from '../../src/profile/ContributionGrid';
import { FactList } from '../../src/profile/FactList';
import { ANIMAL_KEY } from '../icon';
import { resolveAnimal } from '../../src/pixel/animals';
import { archetypeSentence } from '../../src/profile/narrative';
import { NarrativeSection } from '../../src/profile/NarrativeSection';
import { ReportSections } from '../../src/profile/ReportSections';
import { ShareBars } from '../../src/profile/ShareBars';
import { colors, duration, layout, space } from '../../src/theme';
import { Row, Section, StatGrid, Surface, T, type StatItem } from '../../src/ui';
import { YouLinks } from '../../src/nav/YouLinks';

const c = colors('dark');

/** The page's frame: the gutter, and 32pt between blocks set once here, not by margins. */
const page = {
  paddingHorizontal: layout.gutter,
  paddingTop: space.md,
  paddingBottom: space.xxl,
  gap: layout.sectionGap,
} as const;

/** Where the builder profile is kept between launches, so a cold start is not blank. */
const CORPUS_KEY = 'profile.builder.v1';

export default function ProfileScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [builder, setBuilder] = useState<BuilderProfileResponse | null>(null);
  const [chosenAnimal, setChosenAnimal] = useState<string | null>(null);
  // null until asked. Signed out and signed in with nothing loaded are different screens:
  // telling a signed-in person to "sign in" because the network dropped is a lie.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setProfile(await cache.getProfile());
    setChosenAnimal(await cache.getKv(ANIMAL_KEY));
    const stored = await cache.getKv(CORPUS_KEY);
    if (stored) {
      try {
        setBuilder(JSON.parse(stored) as BuilderProfileResponse);
      } catch {
        // A stored blob from an older shape is dropped, not repaired.
      }
    }
    const isIn = await api.isSignedIn();
    setSignedIn(isIn);
    if (!isIn) return;
    try {
      const fresh = await api.profile();
      await cache.putProfile(fresh);
      setProfile(fresh);
      setProfileError(null);
    } catch (e) {
      // Cached profile is a fine answer offline; with none, the screen says why.
      setProfileError(e instanceof Error ? e.message : OFFLINE_MESSAGE);
    }
    try {
      const b = await api.builderProfile();
      setBuilder(b);
      await cache.setKv(CORPUS_KEY, JSON.stringify(b));
    } catch {
      // A server without the route leaves the cached one, or nothing.
    }
  }, []);

  // On focus, not once on mount: signing in happens in Settings, pushed over this tab, and
  // coming back has to show the profile rather than the "sign in" note it left behind.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!profile) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={page}
        refreshControl={
          signedIn ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined
        }
      >
        {/* The same opener as Now and Sessions when nothing is yours yet: Bit and two lines,
            not a lone grey sentence. Nothing until the sign in state is known, so a signed-in
            launch never flashes "sign in". */}
        {signedIn === false && (
          <PixelBadge
            state="idle"
            size={64}
            title="No profile yet."
            text="Sign in from Settings, the gear above, and it fills in from the sessions you finish."
            style={{ padding: 0 }}
          />
        )}
        {signedIn === true && profileError !== null && (
          <PixelBadge
            state="sleeping"
            size={64}
            title="Could not load your profile."
            text={`${profileError} Pull down to try again.`}
            style={{ padding: 0 }}
          />
        )}
        {signedIn === true && profileError === null && (
          <PixelBadge state="thinking" size={64} text="Reading your profile…" style={{ padding: 0 }} />
        )}
        <YouLinks />
      </ScrollView>
    );
  }

  // The grid sits inside a surface: the gutter, the surface's padding and its hairline.
  const contentWidth = width - layout.gutter * 2 - layout.tilePad * 2 - 2;
  const recentDays = profile.graph.slice(-119);
  const attended = profile.attribution.attended_seconds;
  const autonomous = profile.attribution.autonomous_seconds;
  // Only a server that splits the clocks gets the pair; "0 / 0" from an older one would
  // be a plausible wrong number.
  const hasSplit = attended !== undefined || autonomous !== undefined;
  // The record is attended time on a v2 server. An older server ranks by active time and
  // omits `attended_seconds`, so the label follows the field rather than claiming a split
  // that was never made.
  const longest = profile.longest_session;
  const longestLabel = longest?.attended_seconds !== undefined ? 'longest attended' : 'longest session';
  const longestValue = longest ? duration(longest.attended_seconds ?? longest.active_seconds) : null;

  const corpus = builder?.corpus ?? null;
  // Absent on a server older than 0016, and null until this account's own machine has
  // run `python -m capture narrative`. Both are the same thing on screen: nothing.
  const narrative = builder?.narrative ?? null;
  // Absent on a server older than 0018, and null until this account's machine has run
  // `python -m capture report`. The sections are skipped rather than drawn empty.
  const report = builder?.report ?? null;
  const missing = Object.entries(corpus?.sample.missing ?? {});

  // One grid for every total, so a value always sits over the one above it.
  const numbers: StatItem[] = [];
  if (hasSplit) {
    numbers.push({ value: duration(attended ?? 0), label: 'attended' });
    numbers.push({ value: duration(autonomous ?? 0), label: 'autonomous' });
  }
  if (longestValue) numbers.push({ value: longestValue, label: longestLabel });
  if (corpus) {
    numbers.push({ value: corpus.totals.total_prompts.toLocaleString(), label: 'prompts' });
    numbers.push({ value: corpus.totals.total_lines_added.toLocaleString(), label: 'agent lines' });
    // Absent, not zero. Two sessions that overlapped in one repo both counted the commits
    // in between, so the sum would read high; the stat is dropped rather than shown wrong.
    if (corpus.totals.total_commits !== null) {
      numbers.push({ value: corpus.totals.total_commits.toLocaleString(), label: 'commits' });
    }
    numbers.push({ value: corpus.totals.total_tool_calls.toLocaleString(), label: 'tool calls' });
  }

  // The three questions a person actually asks about their own profile, and the one
  // ranking the app is allowed to make. The value leads and the question sits under it.
  // Every value is null-checked: a refused metric prints its reason further down rather
  // than a zero here.
  const standing: { key: string; value: string; label: string; mono?: boolean }[] = [];
  if (corpus?.session_rank[0]) {
    standing.push({
      key: 'longest',
      value: duration(corpus.session_rank[0].attended_seconds),
      label: `longest attended session, 1 of ${corpus.ranked_sessions}`,
    });
  }
  if (typeof corpus?.metrics.default_model?.value === 'string') {
    standing.push({
      key: 'model',
      value: String(corpus.metrics.default_model.value),
      label: 'model that did most of the work',
      mono: true,
    });
  }
  if (typeof corpus?.metrics.shipping_day?.value === 'string') {
    standing.push({ key: 'ship', value: String(corpus.metrics.shipping_day.value), label: 'day the most code landed' });
  }
  if (typeof corpus?.metrics.busiest_day?.value === 'string') {
    standing.push({ key: 'busy', value: String(corpus.metrics.busiest_day.value), label: 'day you were at it longest' });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={page}
    >
      <LiveSessions sessions={profile.live ?? []} onPress={(id) => router.push(`/session/${id}`)} />

      {/* The archetype is the top of the screen, not a card buried under the totals: it is
          the one line a person would say out loud about themselves. Only a server that
          computes it gets the hero; an older one keeps the totals as the opener. */}
      {corpus && (
        <ArchetypeHero
          archetype={corpus.archetype}
          sessions={corpus.sample.sessions}
          sentence={archetypeSentence(narrative)}
          animal={resolveAnimal(chosenAnimal, corpus.archetype?.name)}
          onPressAnimal={() => router.push('/icon' as never)}
        />
      )}

      {/* Directly under the archetype, because it is the sentence that explains it. A
          person who reads "quality guardian" and nothing else has learned a label; the
          paragraph under it is the part that is about them. */}
      {narrative && <NarrativeSection narrative={narrative} />}

      {/* The measured half, directly under the prose it was written from: whether you are
          getting better, what fanning out bought you, how much of the work is yours, and
          how long you stay broken. Each section is silent when the machine refused it. */}
      {report && <ReportSections report={report} />}

      {corpus && corpus.facts.length > 0 && (
        <Section label="What stands out">
          <FactList facts={corpus.facts} />
        </Section>
      )}

      <Section label="The numbers">
        <Surface style={{ gap: space.md }}>
          <View style={{ gap: space.xs }}>
            <T role="title">{duration(profile.totals.active_seconds)}</T>
            <T role="meta" tone="dim">
              across {profile.totals.sessions} sessions
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
            Sessions are ranked on attended time, never on elapsed. An overnight run the
            agent did alone counts toward your hours and can never hold a record.
          </T>
        </Section>
      )}

      <Section label="Active hours">
        <Surface>
          <ContributionGrid days={recentDays} width={contentWidth} />
        </Surface>
        <T role="meta" tone="dim">
          Coloured by hours, not tokens. Hours are the metric every editor has.
        </T>
      </Section>

      {corpus && corpus.model_mix.length > 0 && (
        <Section label="Which models did the work">
          <Surface>
            <ShareBars mono items={corpus.model_mix.map((m) => ({ label: m.model, share: m.share }))} />
          </Surface>
          <T role="meta" tone="dim">
            Share of output tokens, which is the only per-model number that leaves your
            machine.
          </T>
        </Section>
      )}

      {corpus && corpus.top_tools.length > 0 && (
        <Section label="What you reach for">
          <Surface>
            <ShareBars
              mono
              items={corpus.top_tools.map((t) => ({
                label: t.tool,
                share: t.share,
                detail: `${t.calls.toLocaleString()} calls`,
              }))}
            />
          </Surface>
        </Section>
      )}

      {/* Only a server that computes the aggregate gets the card; an older one is silent
          rather than told to analyse three sessions it will never aggregate. */}
      {profile.builder_profile !== undefined && (
        <Section label="How you build">
          <Surface>
            <BuilderProfileCard profile={profile.builder_profile} />
          </Surface>
        </Section>
      )}

      {profile.projects.length > 0 && (
        <Section label="Projects">
          <Surface padding={0}>
            {profile.projects.map((p, i) => (
              <Row
                key={p.key}
                // A private repo's key is a hash. Showing it reads as a bug; a letter per
                // repo tells them apart, which is the only job the label has.
                title={p.name ?? `Private repo ${String.fromCharCode(65 + i)}`}
                monoTitle={p.name !== null}
                meta={`${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}`}
                value={duration(p.active_seconds)}
                hairline={i < profile.projects.length - 1}
              />
            ))}
          </Surface>
        </Section>
      )}

      <Section label="Human vs agent">
        <Surface padding={0}>
          <Row title={profile.attribution.agent_lines.toLocaleString()} meta="lines from the agent" hairline />
          <Row title={`${profile.attribution.human_edit_events} events`} meta="your edits outside the agent" hairline />
          <Row title={profile.attribution.prompts.toLocaleString()} meta="prompts you typed" />
        </Surface>
        <T role="meta" tone="dim">
          Three separately measured numbers, deliberately not combined into a percentage.
          Your edits are recorded as events without line counts, so any ratio would be
          false precision.
        </T>
      </Section>

      {/* The refusals, in full. A metric this server cannot honestly compute is null with
          a reason, and printing those reasons is the difference between a profile you can
          trust and one you cannot check. Most of them say the same true thing: the words
          you type never leave your machine, so nothing derived from them can be measured
          here. */}
      {missing.length > 0 && (
        <Section label="What this cannot see">
          <Surface padding={0}>
            {missing.map(([key, reason], i) => (
              <Row key={key} title={key.replace(/_/g, ' ')} meta={reason} metaLines={6} hairline={i < missing.length - 1} />
            ))}
          </Surface>
        </Section>
      )}

      {/* Where the Factions row was: the social layer is out of the navigation (the route
          still opens by link). These are the You pages. */}
      <YouLinks />
    </ScrollView>
  );
}
