import React, { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { dollars, NOT_A_BILL } from '../../src/copy/money';
import { colors, layout, space } from '../../src/theme';
import { Row, Section, StatGrid, Surface, T, type StatItem } from '../../src/ui';
import { useBuilderProfile, useMoneyMask } from '../../src/you/hooks';
import { moneyView, type MoneyView } from '../../src/you/money';
import { MASKED_DOLLARS, maskDollars } from '../../src/you/numbers';
import { MoneySkeleton, PageError, PageNotSent, PageSignedOut, StaleNote } from '../../src/you/States';

const c = colors('dark');

/** The command that sends the report the money block rides in. */
const REPORT_COMMAND = 'python -m capture report';

/**
 * Money: one number, what the work would cost at API list prices, labelled as such with the day
 * the prices were read; the tokens beside it and the lines under it like a diff, added in the
 * add green and removed in the del red; the cost by model as rows; and plain sentences, what
 * went to sessions without a commit and what went into stretches that changed nothing, said as
 * shares and never as a scolding. Every word is `src/copy/`'s, the Python's own.
 *
 * Long press the dollar figure to mask every dollar on this page and the You tab (`$•••`),
 * and again to bring them back. The choice is kept on this phone.
 */
export default function MoneyScreen() {
  const { load, refresh, refreshing } = useBuilderProfile();
  const mask = useMoneyMask();
  const data = load.kind === 'ready' ? load.data : null;
  const view = useMemo(() => (data ? moneyView(data.corpus, data.report) : null), [data]);

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
      {load.kind === 'loading' && <MoneySkeleton />}
      {load.kind === 'signedOut' && <PageSignedOut what="money view" />}
      {load.kind === 'error' && <PageError message={load.message} onRetry={() => void refresh()} />}

      {load.kind === 'ready' && (
        <>
          {load.stale && <StaleNote stale={load.stale} />}
          {view ? (
            <MoneyBody view={view} masked={mask.masked} onToggleMask={mask.toggle} />
          ) : (
            <PageNotSent
              title="No money view yet."
              text="Your Mac prices the work and sends it with its report. Run the command there to fill this in."
              command={REPORT_COMMAND}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

function MoneyBody({ view, masked, onToggleMask }: { view: MoneyView; masked: boolean; onToggleMask: () => void }) {
  // Every line is written with its real figures; masked, every dollar amount in it is hidden.
  const say = (s: string) => (masked ? maskDollars(s) : s);
  const hero = view.usd === null ? null : masked ? MASKED_DOLLARS : dollars(view.usd);

  // Tokens beside the dollars, then the lines as a diff: a value over its label, tabular, added
  // in the add green and removed in the del red, the only colour on the page besides amber.
  const stats: StatItem[] = [];
  if (view.tokens) stats.push({ value: view.tokens.value, label: view.tokens.label });
  if (view.linesRefusal === null) {
    stats.push(view.added === null ? { value: null, label: 'lines added', refusal: 'not counted' } : { value: view.added, label: 'lines added', tone: 'add' });
    stats.push(
      view.removed === null
        ? { value: null, label: 'lines removed', refusal: 'not counted here yet' }
        : { value: view.removed, label: 'lines removed', tone: 'del' },
    );
  }

  return (
    <>
      <View style={{ gap: space.sm }}>
        <T role="label" tone="dim">
          {view.label}
        </T>
        {hero !== null ? (
          <Pressable
            onLongPress={onToggleMask}
            accessibilityRole="button"
            accessibilityLabel={masked ? `Dollar figure hidden, ${view.label}` : `${hero} ${view.label}`}
            accessibilityHint={masked ? 'Long press to show the dollar figures' : 'Long press to hide the dollar figures'}
            accessibilityActions={[{ name: 'longpress', label: masked ? 'Show dollars' : 'Hide dollars' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'longpress') onToggleMask();
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            <T role="display">{hero}</T>
          </Pressable>
        ) : (
          <T role="body">{view.refusal}</T>
        )}
        {hero !== null ? (
          <T role="meta" tone="dim">
            {view.perHour ? `${say(view.perHour)}. ${NOT_A_BILL}` : NOT_A_BILL}
          </T>
        ) : null}
      </View>

      {stats.length > 0 && (
        <View style={{ gap: space.sm }}>
          <StatGrid items={stats} />
          {view.linesNote ? (
            <T role="meta" tone="dim">
              {view.linesNote}
            </T>
          ) : null}
        </View>
      )}
      {view.linesRefusal ? (
        <T role="meta" tone="dim">
          {view.linesRefusal}
        </T>
      ) : null}

      {view.models.length > 0 && (
        <Section label="By model">
          <Surface padding={0}>
            {view.models.map((m, i) => (
              <Row
                key={m.key}
                title={m.name}
                meta={say(m.meta)}
                metaLines={2}
                value={masked ? MASKED_DOLLARS : dollars(m.usd)}
                hairline={i < view.models.length - 1}
              />
            ))}
          </Surface>
          {view.models.some((m) => m.perCommit !== null) ? (
            <T role="meta" tone="dim">
              Dollars a commit count only the sessions a model wrote most of: a session&apos;s commits belong to the
              session, not to a model.
            </T>
          ) : null}
        </Section>
      )}

      {view.sentences.length > 0 && (
        <Section label="Where it went">
          <Surface style={{ gap: space.md }}>
            {view.sentences.map((s) => (
              <T key={s} role="body">
                {say(s)}
              </T>
            ))}
          </Surface>
        </Section>
      )}
    </>
  );
}
