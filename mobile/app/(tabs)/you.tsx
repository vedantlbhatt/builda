import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { archetypeSentence } from '../../src/profile/narrative';
import { colors, layout, space } from '../../src/theme';
import { archetypeView } from '../../src/you/archetype';
import { ArchetypeReveal } from '../../src/you/ArchetypeReveal';
import { useBuilderProfile, useIdentity, useMoneyMask, useProfile } from '../../src/you/hooks';
import { Identity } from '../../src/you/Identity';
import { pageRows, wrappedLine } from '../../src/you/pages';
import { PageRows } from '../../src/you/PageRows';
import { PageEmpty, PageError, PageSignedOut, StaleNote, YouSkeleton } from '../../src/you/States';
import { WrappedEntry } from '../../src/you/WrappedEntry';
import { YouSections } from '../../src/you/YouSections';

const c = colors('dark');

/** The page's frame: the gutter, and 32pt between blocks, set once here rather than by margins. */
const page = {
  paddingHorizontal: layout.gutter,
  paddingTop: space.md,
  paddingBottom: space.xxl,
  gap: layout.sectionGap,
} as const;

/**
 * You: who you are as a builder.
 *
 * Top to bottom, in the order a person reads their own profile: their creature and name, small;
 * the builder type with the rule and the numbers that earned it; the way into Wrapped, drawn as
 * its first card; the four pages, each row stating a real number from the page it opens; then
 * the profile as it was (the narrative, the measured report, the facts, the totals, the
 * refusals).
 *
 * Every state is designed (the skill's law 8): a skeleton shaped like the page while the first
 * answer is on its way, Bit with the one action when signed out or when there are no sessions,
 * the error with Try again when nothing was saved, and one stale line at the top when a refresh
 * failed and the page is showing what was saved.
 */
export default function YouScreen() {
  const router = useRouter();
  const builder = useBuilderProfile();
  const profile = useProfile();
  const mask = useMoneyMask();

  const data = builder.load.kind === 'ready' ? builder.load.data : null;
  const profileData = profile.load.kind === 'ready' ? profile.load.data : null;
  const view = useMemo(() => (data ? archetypeView(data.corpus, data.report) : null), [data]);
  const identity = useIdentity(view?.id ?? data?.corpus?.archetype?.name ?? null);
  const rows = useMemo(() => (data ? pageRows(data, mask.masked) : []), [data, mask.masked]);

  const onRefresh = useCallback(async () => {
    await Promise.all([builder.refresh(), profile.reload()]);
  }, [builder, profile]);

  const load = builder.load;
  const noSessions = data?.corpus?.sample.sessions === 0 && (profileData?.totals.sessions ?? 0) === 0;
  // The Wrapped deck's first card is the type: the deck's own card when the Mac sent one.
  const firstCard = data?.report?.wrapped?.cards.find((x) => x.id === 'builder_type') ?? null;
  const wrappedAnswer = view && view.state !== 'refused' ? view.display : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={page}
      refreshControl={
        load.kind === 'signedOut' ? undefined : (
          <RefreshControl refreshing={builder.refreshing} onRefresh={onRefresh} tintColor={c.accent} />
        )
      }
    >
      {load.kind === 'loading' && <YouSkeleton />}

      {load.kind === 'signedOut' && (
        <>
          <Identity animal={identity.animal} name={identity.name} />
          <PageSignedOut what="profile" />
        </>
      )}

      {load.kind === 'error' && <PageError message={load.message} onRetry={() => void onRefresh()} />}

      {load.kind === 'ready' && (
        <>
          {load.stale && <StaleNote stale={load.stale} />}
          <Identity animal={identity.animal} name={identity.name} />

          {noSessions ? (
            <PageEmpty
              title="No sessions yet."
              text="Finish a session on your Mac and this page fills in: your type, your numbers, your Wrapped."
              action={{ label: 'Connect your Mac', onPress: () => router.push('/pair') }}
            />
          ) : (
            <>
              {view && (
                <ArchetypeReveal
                  view={view}
                  // The narrative's line is the Mac's, about the Mac's type: shown only beside
                  // that type, never under the server's, which can be a different one.
                  sentence={view.source === 'mac' ? archetypeSentence(data?.narrative) : null}
                />
              )}
              <WrappedEntry
                card={firstCard}
                answer={wrappedAnswer}
                line={data ? wrappedLine(data) : null}
                graph={profileData?.graph ?? null}
              />
              <PageRows rows={rows} />
              <YouSections builder={data} profile={profileData} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
