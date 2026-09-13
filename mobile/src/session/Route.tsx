/**
 * The session's route: its strip at the page's width, traced left to right and then still
 * (`strip/StripDraw.tsx`), the clock it started at under its left end and the one it stopped at
 * under its right (Strava's start and end markers, design-md/fitness/strava: "12pt circle ... at
 * the route start, filled at the route end"), and the key in words with each class's share.
 *
 * The key sits under the strip and outside the card on purpose: a route map does not explain its
 * own encoding, the page around it does (the card stays legend free, `RecapCard.tsx`).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GUTTER, Kicker, Refusal, Swatch, type, Words } from '../insights/kit';
import { GROUND } from '../insights/palette';
import { Block, useClock } from '../insights/reveal';
import type { SessionDetail } from '../data/api';
import { decodeMarks } from '../strip/decode';
import { legendOf } from '../strip/layout';
import { StripDraw } from '../strip/StripDraw';
import { colors } from '../theme';
import { clockLabel } from './when';

const strip = colors('dark').strip;

/** The trace waits for the band above it to finish printing (`Band.PRINT_MS`, 560 ms). */
const ROUTE_AT = 480;

export function Route({ session, width, endNote }: { session: SessionDetail; width: number; endNote: string | null }) {
  const inner = width - GUTTER * 2;
  const s = session.strip;
  const live = (session.state ?? 'final') === 'live';
  return (
    <Block style={styles.block}>
      <Kicker>the shape of it</Kicker>
      {s ? <Drawn session={session} width={inner} live={live} /> : <Refusal>This session predates the detail your editor keeps. Its hours still count.</Refusal>}
      {endNote ? <Words style={[type.meta, styles.note]}>{`${endNote}.`}</Words> : null}
    </Block>
  );
}

function Drawn({ session, width, live }: { session: SessionDetail; width: number; live: boolean }) {
  const clock = useClock();
  const s = session.strip!;
  const marks = React.useMemo(() => decodeMarks(s.marks), [s.marks]);
  const legend = React.useMemo(() => legendOf(s.cols), [s.cols]);
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at);
  return (
    <View>
      <StripDraw preset="hero" cols={s.cols} marks={marks} spanMs={Math.max(1, s.t1_ms - s.t0_ms)} width={width} clock={clock} delay={ROUTE_AT} sweepMs={1000} />
      <View style={styles.ends}>
        <Text allowFontScaling={false} style={[type.mono, styles.end]}>
          {Number.isFinite(start) ? clockLabel(start) : ''}
        </Text>
        <Text allowFontScaling={false} style={[type.mono, styles.end]}>
          {live ? 'now' : Number.isFinite(end) ? clockLabel(end) : ''}
        </Text>
      </View>
      <View style={styles.legend}>
        {legend.map((l) => (
          <View key={l.klass} style={styles.key}>
            <Swatch color={strip[l.klass]} size={9} />
            <Text maxFontSizeMultiplier={1.4} style={type.meta}>
              {l.label}
              {l.share ? <Text style={styles.share}>{` ${l.share}`}</Text> : null}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: GUTTER, marginTop: 26 },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  end: { color: GROUND.dim },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginTop: 14 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  share: { color: GROUND.text, fontVariant: ['tabular-nums'] },
  note: { marginTop: 12 },
});
