import type { SFSymbol } from 'expo-symbols';
import React from 'react';
import { View } from 'react-native';

import { colors, space } from '../theme';
import { SHAPE } from '../ui/shape';
import { SymbolIcon } from '../ui/Symbol';
import { T } from '../ui/Text';

const c = colors('dark');

/** The priming rows' geometry (facetune's trial timeline: 32pt circles on a 3pt connector, rows about 90pt apart). */
const CIRCLE = 32;
const CONNECTOR = 3;

export interface TimelineRow {
  symbol: SFSymbol;
  title: string;
  body: string;
}

/**
 * What the notification step promises, before the system asks (DESIGN-DIRECTION 4, "Stay in
 * the loop"): three rows on one connector. Chrome glyphs are SF Symbols in `raised` circles,
 * the connector is the `border` grey and runs circle to circle, touching both, so it reads as
 * one line through the three; the amber on this screen is the Continue under it.
 */
export function Timeline({ rows }: { rows: readonly TimelineRow[] }) {
  return (
    <View>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        return (
          <View key={r.title}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ width: CIRCLE, alignItems: 'center' }}>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: CIRCLE,
                    height: CIRCLE,
                    borderRadius: SHAPE.action,
                    borderCurve: 'continuous',
                    backgroundColor: c.raised,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SymbolIcon name={r.symbol} size={15} weight="semibold" tone="text" />
                </View>
                {!last && (
                  <View
                    style={{
                      width: CONNECTOR,
                      flex: 1,
                      minHeight: space.lg,
                      backgroundColor: c.border,
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1, gap: 2, paddingTop: 5, paddingBottom: last ? 0 : space.xl }}>
                <T role="headline">{r.title}</T>
                <T role="row" weight={400} tone="dim">
                  {r.body}
                </T>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
