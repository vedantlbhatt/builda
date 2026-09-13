import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { space } from '../theme';
import type { Tone } from './scheme';
import { T } from './Text';

export interface StatItem {
  /**
   * The number, already product formatted ("1.4M", "38k", "$4.99", "16h 00m"), or null when
   * it was refused. A refused number is a sentence (`refusal`), never 0 or a placeholder.
   */
  value: string | null;
  /** Lower case: "tokens", "lines", "commits". */
  label: string;
  /** Why there is no number, in one short line. Shown in place of a null value. */
  refusal?: string;
  /** `add` or `del` for lines added and removed; otherwise `text`. Never `accent`. */
  tone?: Extract<Tone, 'text' | 'add' | 'del' | 'human'>;
}

export interface StatProps extends StatItem {
  /** `headline` (17/700) in a grid; `display` for the one big number on a screen. */
  emphasis?: 'headline' | 'display';
  style?: StyleProp<ViewStyle>;
}

/** A value over its label: Strava's stat, tabular, flat, no chrome. */
export function Stat({ value, label, refusal, tone = 'text', emphasis = 'headline', style }: StatProps) {
  return (
    <View
      accessible
      accessibilityLabel={value === null ? `${label}: ${refusal ?? 'not available'}` : `${label}: ${value}`}
      style={[{ gap: space.xs }, style]}
    >
      {value === null ? (
        <T role="meta" tone="dim" numberOfLines={2}>
          {refusal ?? 'not measured'}
        </T>
      ) : (
        <T role={emphasis} tone={tone} weight={emphasis === 'headline' ? 700 : undefined} numberOfLines={1}>
          {value}
        </T>
      )}
      {/* Two lines before it truncates: a label that wraps under its number still says
          what the number is; one cut to "days you shipp..." does not. */}
      <T role="label" tone="dim" numberOfLines={2}>
        {label}
      </T>
    </View>
  );
}

export interface StatGridProps {
  items: readonly StatItem[];
  /** Default 3: the 3-up grid. */
  columns?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Stats in rows of `columns`, equal widths, 12pt apart. A short last row keeps its columns
 * where they are instead of stretching, so a value always sits over the one above it.
 */
export function StatGrid({ items, columns = 3, style }: StatGridProps) {
  const rows: (StatItem | null)[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    const row: (StatItem | null)[] = items.slice(i, i + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return (
    <View style={[{ gap: space.md }, style]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: space.tile }}>
          {row.map((item, i) => (
            <View key={i} style={{ flex: 1 }}>
              {item ? <Stat {...item} /> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
