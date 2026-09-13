import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { Row, Section, StatGrid, Surface, T } from '../ui';
import { spikesLabel, type BurnView, type SpikeView } from './burnView';

/**
 * Burn forensics on the session screen (brief B1): where this sitting's tokens went, as
 * numbers, then its costliest stretches with what drove each and what each produced.
 *
 * Two sections, each one surface: the numbers in the kit's 3 up grid (the same grid Numbers
 * uses, so a value always sits over its label), and the stretches as rows with hairlines,
 * never a card per stretch. Colour is not spent here: a share is a number, a cause is words,
 * and "Nothing was written." is said in the text colour at the row's weight, plainly, not
 * tinted as a warning. Every word and number is `burnView.ts`'s.
 */
export function BurnSection({ view }: { view: BurnView }) {
  if (view.kind !== 'ready') {
    return (
      <Section label="where the tokens went">
        {view.kind === 'refused' ? (
          <Surface>
            <T role="body">{view.sentence}</T>
          </Surface>
        ) : (
          <T role="meta" tone="dim">
            {view.sentence}
          </T>
        )}
      </Section>
    );
  }

  return (
    <>
      <Section label="where the tokens went">
        <Surface>
          <StatGrid items={view.stats} />
        </Surface>
        {view.ledgerNote ? (
          <T role="meta" tone="dim">
            {view.ledgerNote}
          </T>
        ) : null}
        {/* Why no stretch is named sits with the numbers it is about, not alone below them. */}
        {view.spikes.length === 0 && view.spikesNote ? (
          <T role="meta" tone="dim">
            {view.spikesNote}
          </T>
        ) : null}
      </Section>

      {view.spikes.length > 0 ? (
        <Section label={spikesLabel(view.spikes.length)}>
          <Surface padding={0}>
            {view.spikes.map((s, i) => (
              <SpikeRow key={i} spike={s} last={i === view.spikes.length - 1} />
            ))}
          </Surface>
          {view.overlapNote ? (
            <T role="meta" tone="dim">
              {view.overlapNote}
            </T>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

/**
 * One costly stretch: its tokens and how long it ran on the title line, how far above a
 * typical stretch it was and its cost per line under them, then each cause with its share,
 * and last what it produced.
 */
function SpikeRow({ spike: s, last }: { spike: SpikeView; last: boolean }) {
  return (
    <Row
      title={s.title}
      value={s.duration}
      meta={s.meta}
      metaLines={2}
      hairline={!last}
      below={
        <View style={{ gap: space.xs }}>
          {s.causes.map((c) => (
            <T key={c} role="meta">
              {c}
            </T>
          ))}
          <T role="meta" weight={600}>
            {s.verdict}
          </T>
        </View>
      }
    />
  );
}
