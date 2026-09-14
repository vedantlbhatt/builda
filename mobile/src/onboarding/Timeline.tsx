import type { SFSymbol } from 'expo-symbols';
import React, { useCallback } from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { AnimatedList, type AnimatedListItemInfo } from '../ui/bits/components/AnimatedList';
import { SHAPE } from '../ui/shape';
import { SymbolIcon } from '../ui/Symbol';
import { T } from '../ui/Text';
import { TIMELINE } from './flow';

export interface TimelineRow {
  symbol: SFSymbol;
  title: string;
  body: string;
}

export interface TimelineHue {
  fill: string;
  partner: string;
  /** The hue as a label: the first row's title. */
  text: string;
}

/**
 * What the notification step promises before the system asks, as facetune primes its trial
 * (appllama-top-paywall-screens, facetune.tsx): a timeline, in the order it happens to a session,
 * on facetune's geometry (32pt marks, a 3pt connector 52pt long, the words 25pt to the right of
 * the mark). The marks are filled with the builder's colour and the glyph in the band's ink; the
 * connector is the colour's partner tone, the dither's middle tone, so the line between the marks
 * is the same colour one step quieter. The first row's title is in the colour, as facetune sets
 * "Today" in its blue; the later rows are in the text colour.
 *
 * The rows are react-bits AnimatedList's (the kit's port, laid out in place): they rise 12pt from
 * 0.96 of their size, 40ms apart, their opacity snapping in, once, the first time they mount. The
 * step mounts them when its push has landed, so the arrival is seen.
 */
export function Timeline({ rows, hue }: { rows: readonly TimelineRow[]; hue: TimelineHue }) {
  const key = useCallback((r: TimelineRow) => r.title, []);
  const render = useCallback(
    ({ item, index }: AnimatedListItemInfo<TimelineRow>) => <Row row={item} first={index === 0} last={index === rows.length - 1} hue={hue} />,
    [rows.length, hue],
  );
  return <AnimatedList data={rows} keyExtractor={key} renderItem={render} scroll={false} edgeFades={false} />;
}

function Row({ row, first, last, hue }: { row: TimelineRow; first: boolean; last: boolean; hue: TimelineHue }) {
  return (
    <View style={{ flexDirection: 'row', gap: TIMELINE.textGap }} accessible accessibilityLabel={`${row.title}. ${row.body}`}>
      <View style={{ width: TIMELINE.mark, alignItems: 'center' }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: TIMELINE.mark,
            height: TIMELINE.mark,
            borderRadius: SHAPE.action,
            borderCurve: 'continuous',
            backgroundColor: hue.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SymbolIcon name={row.symbol} size={15} weight="bold" tone="onAccent" />
        </View>
        {!last ? (
          <View
            style={{
              width: TIMELINE.connector,
              height: TIMELINE.connectorLength,
              marginVertical: space.sm,
              borderRadius: SHAPE.action,
              borderCurve: 'continuous',
              backgroundColor: hue.partner,
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2, paddingTop: 5, paddingBottom: last ? 0 : space.md }}>
        <T role="headline" weight={700} style={first ? { color: hue.text } : undefined}>
          {row.title}
        </T>
        <T role="row" weight={400} tone="dim">
          {row.body}
        </T>
      </View>
    </View>
  );
}
