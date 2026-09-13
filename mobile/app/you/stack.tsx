import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { colors, layout, space } from '../../src/theme';
import { Row, Section, Surface, T } from '../../src/ui';
import { useBuilderProfile } from '../../src/you/hooks';
import { stackView, type StackView } from '../../src/you/stack';
import { ListSkeleton, PageEmpty, PageError, PageNotSent, PageSignedOut, StaleNote } from '../../src/you/States';

const c = colors('dark');

/** The command that sends the report the stack rides in. */
const REPORT_COMMAND = 'python -m capture report';

/**
 * Your stack: what the project is made of, grouped by kind the way Strava lists gear, each item
 * with the sessions that used it and the day one first did. Only catalog items reach the phone
 * (a manifest's package names never leave the Mac), and an item only a manifest names says so
 * rather than "0 sessions".
 */
export default function StackScreen() {
  const { load, refresh, refreshing } = useBuilderProfile();
  const data = load.kind === 'ready' ? load.data : null;
  const view = useMemo(() => stackView(data?.report?.stack), [data]);

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
      {load.kind === 'loading' && <ListSkeleton label="Loading your stack" />}
      {load.kind === 'signedOut' && <PageSignedOut what="stack" />}
      {load.kind === 'error' && <PageError message={load.message} onRetry={() => void refresh()} />}

      {load.kind === 'ready' && (
        <>
          {load.stale && <StaleNote stale={load.stale} />}
          {view === null ? (
            <PageNotSent
              title="No stack yet."
              text="The languages, tools and services your sessions use show up here. Your Mac reads them and sends them with its report."
              command={REPORT_COMMAND}
            />
          ) : view.refusal ? (
            <PageEmpty title="Nothing named yet." text={view.refusal} />
          ) : (
            <Groups view={view} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function Groups({ view }: { view: StackView }) {
  return (
    <>
      <View style={{ gap: space.xs }}>
        <T role="headline">{view.summary}</T>
      </View>

      {view.groups.map((g) => (
        <Section key={g.category} label={g.label}>
          <Surface padding={0}>
            {g.items.map((item, i) => (
              <Row
                key={item.id}
                title={item.name}
                meta={item.meta}
                value={item.value ?? undefined}
                hairline={i < g.items.length - 1}
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
