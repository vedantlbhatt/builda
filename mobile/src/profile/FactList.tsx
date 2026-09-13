import React from 'react';
import { View } from 'react-native';

import type { CorpusFact } from '../data/api';
import { layout, space } from '../theme';
import { Hairline, Surface, T } from '../ui';

/**
 * The ranked one-line facts, most unusual first.
 *
 * The server writes the whole sentence, including its number, because the number and the
 * wording have to agree ("4 in 10 prompts" is not "0.429") and splitting that decision
 * across two languages is how they stop agreeing. The screen's only job is to make the
 * ranking visible: the first fact is the loudest thing true about this person, so it is
 * the one in full-strength semibold, and the rest step down to `textDim` rather than all
 * shouting at once. The ranking is carried by weight and tone; no accent is spent on it.
 */
export function FactList({ facts, limit = 6 }: { facts: CorpusFact[]; limit?: number }) {
  const shown = facts.slice(0, limit);
  if (shown.length === 0) {
    return (
      <T role="meta" tone="dim">
        Nothing stands out yet. A few more sessions and this fills in.
      </T>
    );
  }
  return (
    <Surface padding={0}>
      {shown.map((f, i) => (
        <View key={f.id}>
          {i > 0 ? <Hairline inset={layout.gutter} /> : null}
          <View style={{ paddingHorizontal: layout.gutter, paddingVertical: space.tile }}>
            {i === 0 ? (
              <T role="headline">{f.text}</T>
            ) : (
              <T role="row" weight={400} tone="dim">
                {f.text}
              </T>
            )}
          </View>
        </View>
      ))}
    </Surface>
  );
}
