/**
 * 02, time: the streak as the one big number, the days as a contribution grid that fills in on
 * a diagonal wave in the amber ramp, the hour you build most and your night share on a 24 hour
 * dial whose arcs sweep in, then your longest session, your deep ones and your commit streak.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../Band';
import { DayClock } from '../Charts';
import { BandFigure, figure, GUTTER, Kicker, Ledger, Refusal, type, Words } from '../kit';
import { isRefused, type TimeModel } from '../model';
import { Num } from '../Num';
import { GRAPH_LEVELS, GROUND, ON_HUE, SPECTRUM } from '../palette';
import { CountMarks, PixelField, type PixelCell } from '../Pixels';
import { arrivalMs } from '../../motion/pixelMotion';
import { Block, Section, useFieldMotion } from '../reveal';

const HUE = SPECTRUM.amber;

export function TimeSection({ time, width }: { time: TimeModel; width: number }) {
  const inner = width - GUTTER * 2;
  const s = time.streak;
  return (
    <Section style={styles.section}>
      <Band hue={HUE} index="02" title="Time">
        {isRefused(s) ? (
          <BandWords delay={300}>
            <Refusal onHue>{s.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <View style={styles.figureRow}>
              {s.num ? (
                <BandFigure spec={s.num} width={inner * 0.5} max={104} delay={200} label={`${s.num.final} ${s.unit}`} />
              ) : (
                <BandWords delay={260}>
                  <Text style={[figure(44, ON_HUE), { letterSpacing: -1 }]}>{s.display}</Text>
                </BandWords>
              )}
              {s.unit ? (
                <BandWords delay={320}>
                  <Text allowFontScaling={false} style={styles.unit}>
                    {s.unit}
                  </Text>
                </BandWords>
              ) : null}
            </View>
            {s.num ? (
              <View style={{ marginTop: 10 }}>
                <CountMarks n={s.num.value} width={inner} color={ON_HUE} delay={200} />
              </View>
            ) : null}
            {s.sentence ? (
              <BandWords delay={400}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                  {s.sentence}
                </Text>
              </BandWords>
            ) : null}
          </>
        )}
      </Band>

      <Block style={styles.block}>
        <Kicker>every day, by hours at it</Kicker>
        {isRefused(time.grid) ? <Refusal>{time.grid.refusal}</Refusal> : <DayGrid grid={time.grid} width={inner} />}
        {!isRefused(time.grid) ? <Words style={[type.meta, styles.caption]}>{time.grid.caption}</Words> : null}
      </Block>

      <Block style={styles.block}>
        <Kicker>when in the day</Kicker>
        {time.clock.peakHour === null && time.clock.nightShare === null ? (
          <View style={{ gap: 8 }}>
            {time.clock.refusals.map((r) => (
              <Refusal key={r}>{r}</Refusal>
            ))}
          </View>
        ) : (
          <View style={styles.clockRow}>
            <DayClock size={Math.min(210, Math.floor(inner * 0.58))} peakHour={time.clock.peakHour} night={time.clock.nightShare !== null} ink={HUE.ink} partner={HUE.partner} delay={60} />
            <View style={styles.clockWords}>
              {time.clock.peak ? (
                <View>
                  <Num spec={time.clock.peak} textStyle={figure(40, HUE.ink)} delay={410} duration={950} />
                  <Words style={type.dim}>you build most</Words>
                </View>
              ) : null}
              {time.clock.night ? (
                <View>
                  <Num spec={time.clock.night} textStyle={figure(40, GROUND.text)} delay={320} duration={900} />
                  <Words style={type.dim}>of your active time is between 10pm and 4am</Words>
                </View>
              ) : null}
            </View>
          </View>
        )}
        {time.clock.basis ? <Words style={[type.meta, styles.caption]}>{time.clock.basis}</Words> : null}
        {time.clock.refusals.length > 0 && (time.clock.peakHour !== null || time.clock.nightShare !== null) ? (
          <View style={{ gap: 8, marginTop: 12 }}>
            {time.clock.refusals.map((r) => (
              <Refusal key={r}>{r}</Refusal>
            ))}
          </View>
        ) : null}
      </Block>

      {time.ledger.length > 0 ? (
        <Block style={styles.block}>
          <Ledger items={time.ledger} color={HUE.ink} size={44} delay={40} />
        </Block>
      ) : null}

      {time.notes.length > 0 ? (
        <Block style={[styles.block, { gap: 6 }]}>
          {time.notes.map((n) => (
            <Words key={n} style={type.body}>
              {n}
            </Words>
          ))}
        </Block>
      ) : null}
    </Section>
  );
}

function DayGrid({ grid, width }: { grid: Extract<TimeModel['grid'], { cells: unknown }>; width: number }) {
  // Wider cells take a wider gap, so a short history still reads as a grid of squares.
  const GAP = grid.weeks <= 10 ? 6 : 3;
  const cell = Math.floor((width - GAP * (grid.weeks - 1)) / grid.weeks);
  const w = cell * grid.weeks + GAP * (grid.weeks - 1);
  const h = cell * 7 + GAP * 6;
  // The grid's own arrival (a wave was every grid's); the span the diagonal wave took.
  const motion = useFieldMotion('day grid');
  const span = (grid.weeks + 6) * 30;
  const cells: PixelCell[] = useMemo(
    () =>
      grid.cells.map((c) => ({
        x: c.col * (cell + GAP),
        y: c.row * (cell + GAP),
        w: cell,
        h: cell,
        color: c.before ? GROUND.border : (GRAPH_LEVELS[Math.min(c.level, GRAPH_LEVELS.length - 1)] ?? GRAPH_LEVELS[0]!),
        outline: c.before,
        ring: c.today ? GROUND.text : undefined,
        delay: arrivalMs(motion, c.col, c.row, grid.weeks, 7, 40, span),
      })),
    [grid.cells, grid.weeks, cell, GAP, motion, span],
  );
  return (
    <View>
      <PixelField cells={cells} width={w} height={h} duration={380} accessibilityLabel={`Days of the last ${grid.weeks} weeks, coloured by hours`} />
      <View style={{ height: 18, width: w }}>
        {grid.months.map((m) => (
          <Text key={`${m.col}${m.label}`} allowFontScaling={false} style={[styles.month, { left: m.col * (cell + GAP) }]}>
            {m.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, marginTop: 2 },
  unit: { fontSize: 24, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4, color: ON_HUE },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  caption: { marginTop: 10 },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  clockWords: { flex: 1, gap: 18 },
  month: { position: 'absolute', top: 5, fontSize: 11, fontWeight: '600', color: GROUND.faint },
});
