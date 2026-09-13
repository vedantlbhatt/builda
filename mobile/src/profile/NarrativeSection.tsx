import React, { type ReactNode } from 'react';
import { View } from 'react-native';

import type { BuilderNarrative, NarrativeClaim } from '../generated/narrative';
import { layout, space } from '../theme';
import { Hairline, Section, Surface, T } from '../ui';
import { narrativeView } from './narrative';

/**
 * The "how you work" page: the only prose on this screen, and the only part of the
 * profile a model wrote.
 *
 * Nothing here computes anything, and nothing here paraphrases. Every string is printed
 * exactly as it was stored, because it was already checked against the measurements it
 * came from on the machine that wrote it: a claim carrying a number the input did not
 * contain was deleted before it was ever uploaded (analysis/narrative.py). Rewording it
 * on the phone would put a sentence in front of a person that nothing had verified.
 *
 * Every field is optional in practice. `verify` empties `archetype_line` and can empty
 * `how_you_work` outright when it takes a claim back, so an empty string is a normal
 * state and prints as nothing rather than as a blank heading.
 *
 * The prose sits on the canvas; the claims are rows in one surface each. What you are good
 * at and what it costs you are told apart by their labels, not by an amber rule on one of
 * them.
 */
export function NarrativeSection({ narrative }: { narrative: BuilderNarrative }) {
  const view = narrativeView(narrative);
  if (!view) return null;
  const { paragraphs, strengths, watchOuts, experiment, provenance } = view;

  const blocks: { key: string; label: string; body: ReactNode }[] = [];
  if (paragraphs.length > 0) {
    blocks.push({
      key: 'how',
      label: 'How you work',
      body: (
        <View style={{ gap: space.md }}>
          {paragraphs.map((p, i) => (
            <T key={`p${i}`} role="body">
              {p}
            </T>
          ))}
        </View>
      ),
    });
  }
  if (strengths.length > 0) blocks.push({ key: 'good', label: 'What you are good at', body: <Claims items={strengths} /> });
  if (watchOuts.length > 0) blocks.push({ key: 'cost', label: 'What it is costing you', body: <Claims items={watchOuts} /> });
  if (experiment.length > 0) {
    blocks.push({
      key: 'try',
      label: 'Try this next session',
      body: (
        // The same inset as the claims above it, so the three cards read as one column.
        <Surface padding={0} style={{ paddingHorizontal: layout.gutter, paddingVertical: space.tile }}>
          <T role="body">{experiment}</T>
        </Surface>
      ),
    });
  }

  return (
    <View style={{ gap: layout.sectionGap }}>
      {blocks.map((b, i) => (
        <Section key={b.key} label={b.label}>
          {b.body}
          {/* Said out loud, under the last block, because the alternative is a person
              wondering. The bar on inventing a figure is enforced by a check that runs
              after the model, not by asking it nicely, and the count of what that check
              caught is stored. */}
          {i === blocks.length - 1 ? (
            <T role="meta" tone="dim">
              {provenance}
            </T>
          ) : null}
        </Section>
      ))}
    </View>
  );
}

function Claims({ items }: { items: NarrativeClaim[] }) {
  return (
    <Surface padding={0}>
      {items.map((item, i) => (
        <View key={`c${i}`}>
          {i > 0 ? <Hairline inset={layout.gutter} /> : null}
          <View style={{ gap: space.xs, paddingHorizontal: layout.gutter, paddingVertical: space.tile }}>
            <T role="body">{item.text}</T>
            {/* The evidence is never optional on screen. A claim about somebody's habits
                with the number hidden reads exactly like a horoscope. */}
            {item.evidence.trim().length > 0 && (
              <T role="meta" tone="dim">
                {item.evidence}
              </T>
            )}
          </View>
        </View>
      ))}
    </Surface>
  );
}
