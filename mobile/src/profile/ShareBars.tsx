import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { Bar, T } from '../ui';

export interface Share {
  label: string;
  share: number;
  detail?: string;
}

/** The least a bar shows, so the smallest share in the list is a mark rather than nothing. */
const MIN_FILL = 0.02;

/**
 * A short ranked list of shares, drawn as bars.
 *
 * Bars are scaled to the LARGEST share in the list, not to 1.0. These lists are truncated
 * to the top few, so they never sum to 1, and a bar that filled a fifth of the row when
 * the item is the biggest thing in the corpus would read as "barely used".
 *
 * Every bar is amber: a share is the progress family, and a second hue per list (the teal
 * this used for tools) read as a meaning the list does not have.
 */
export function ShareBars({ items, mono = false }: { items: Share[]; mono?: boolean }) {
  const top = Math.max(...items.map((i) => i.share), 0.0001);
  return (
    <View style={{ gap: space.tile }}>
      {items.map((it) => (
        <View key={it.label} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
            <T role={mono ? 'mono' : 'row'} style={{ flex: 1 }} numberOfLines={1}>
              {it.label}
            </T>
            <T role="meta" tone="dim">
              {Math.round(it.share * 100)}%{it.detail ? ` · ${it.detail}` : ''}
            </T>
          </View>
          <Bar progress={Math.max(MIN_FILL, it.share / top)} />
        </View>
      ))}
    </View>
  );
}
