import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { colors, layout, space } from '../../src/theme';
import { Row, Section, Surface, T } from '../../src/ui';
import { glossaryView, type GlossaryView } from '../../src/you/glossary';
import { useBuilderProfile } from '../../src/you/hooks';
import { ListSkeleton, PageEmpty, PageError, PageNotSent, PageSignedOut, StaleNote } from '../../src/you/States';

const c = colors('dark');

/** The command that sends the report the glossary rides in. */
const REPORT_COMMAND = 'python -m capture report';

/**
 * Glossary: the words your sessions have run into, a collection that fills in over months. Each
 * term is a row with its one line definition and the day a session first met it, grouped by the
 * month it was met, newest month first. What is left is one quiet line, "58 more to find". No
 * game: nothing is unlocked, levelled or scored, and nothing here asks to be completed.
 */
export default function GlossaryScreen() {
  const { load, refresh, refreshing } = useBuilderProfile();
  const data = load.kind === 'ready' ? load.data : null;
  const view = useMemo(() => glossaryView(data?.report?.vocab), [data]);

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
      {load.kind === 'loading' && <ListSkeleton label="Loading your glossary" />}
      {load.kind === 'signedOut' && <PageSignedOut what="glossary" />}
      {load.kind === 'error' && <PageError message={load.message} onRetry={() => void refresh()} />}

      {load.kind === 'ready' && (
        <>
          {load.stale && <StaleNote stale={load.stale} />}
          {view === null ? (
            <PageNotSent
              title="No glossary yet."
              text="Terms show up here the first time one of your sessions runs into them. Your Mac finds them and sends them with its report."
              command={REPORT_COMMAND}
            />
          ) : view.refusal ? (
            <PageEmpty title="Nothing to read yet." text={view.refusal} />
          ) : (
            <Terms view={view} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function Terms({ view }: { view: GlossaryView }) {
  return (
    <>
      <View style={{ gap: space.xs }}>
        <T role="headline">{view.summary}</T>
        {/* The one line about what is left: a count, quiet, never a progress bar. */}
        {view.locked ? (
          <T role="meta" tone="dim">
            {view.locked}
          </T>
        ) : null}
      </View>

      {view.months.map((m) => (
        <Section key={m.key} label={m.label}>
          <Surface padding={0}>
            {m.terms.map((t, i) => (
              <Row
                key={t.id}
                title={t.word}
                titleLines={2}
                meta={t.definition}
                metaLines={3}
                value={t.firstSeen ?? undefined}
                hairline={i < m.terms.length - 1}
              />
            ))}
          </Surface>
        </Section>
      ))}

      {view.cutNote ? (
        <T role="meta" tone="dim">
          {view.cutNote}
        </T>
      ) : null}
    </>
  );
}
