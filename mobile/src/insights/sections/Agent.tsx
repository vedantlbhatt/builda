/**
 * 04, with your agent: how often you change course, as the big number; the working style; your
 * prompt length on a ruler that shows where terse ends and a written brief begins; prompts a
 * session and tool calls a prompt; and the five dimensions as five bars in their five hues.
 *
 * 05, agents: the most helper agents at one moment, every agent that ran as one square in its
 * type's hue, and how much of the stretch had one running.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Band, BandWords } from '../Band';
import { GrowBar } from '../Bars';
import { BandFigure, figure, GUTTER, Kicker, Ledger, Refusal, Swatch, type, Words, type LedgerItem } from '../kit';
import type { NumSpec } from '../format';
import { isRefused, type AgentsModel, type AgentWorkModel } from '../model';
import { ease, phase } from '../motion';
import { Num } from '../Num';
import { DIMENSION_HUE, GROUND, ON_HUE, SPECTRUM, type HueName } from '../palette';
import { CountMarks, PixelField, type PixelCell } from '../Pixels';
import { Block, Section, useClock } from '../reveal';

const WORK = SPECTRUM.heather;
const AGENTS = SPECTRUM.brass;

// ------------------------------------------------------------------ 04

export function AgentWorkSection({ work, width }: { work: AgentWorkModel; width: number }) {
  const inner = width - GUTTER * 2;
  const s = work.steer;
  const ledger: LedgerItem[] = [];
  if (!isRefused(work.perSession)) {
    ledger.push({ key: 'per', num: work.perSession.num, label: 'prompts a session', note: work.perSession.median });
    if (work.perSession.toolCalls) ledger.push({ key: 'calls', num: work.perSession.toolCalls, label: 'tool calls for every prompt you send' });
  }
  if (!isRefused(work.clean)) ledger.push({ key: 'clean', num: work.clean.num, label: 'of instructions landed clean', note: work.clean.sentence });

  return (
    <Section style={styles.section}>
      <Band hue={WORK} index="04" title="With your agent">
        {isRefused(s) ? (
          <BandWords delay={300}>
            <Refusal onHue>{s.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <BandFigure spec={s.num} width={inner} max={104} delay={200} label={`${s.num.final} ${s.caption}`} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {s.caption}
              </Text>
            </BandWords>
            {s.sentence ? (
              <BandWords delay={440}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                  {s.sentence}
                </Text>
              </BandWords>
            ) : null}
          </>
        )}
      </Band>

      <Block style={styles.block}>
        <Kicker>how you work it</Kicker>
        {isRefused(work.style) ? (
          <Refusal>{work.style.refusal}</Refusal>
        ) : (
          <>
            <Words style={type.heading}>{work.style.display}</Words>
            {work.style.sentence ? <Words style={[type.dim, { marginTop: 4 }]}>{work.style.sentence}</Words> : null}
          </>
        )}
        {work.autonomy ? (
          <View style={[styles.inlineFigure, { marginTop: 16 }]}>
            <Num spec={work.autonomy} textStyle={figure(32, WORK.ink)} delay={200} />
            <Text maxFontSizeMultiplier={1.4} style={[type.dim, { flex: 1, color: GROUND.text }]}>
              of your active time, the agent ran with nobody there
            </Text>
          </View>
        ) : null}
      </Block>

      <Block style={styles.block}>
        <Kicker>prompt length, in words</Kicker>
        {isRefused(work.prompt) ? (
          <Refusal>{work.prompt.refusal}</Refusal>
        ) : (
          <>
            <Words style={type.heading}>{work.prompt.label}</Words>
            <PromptRuler
              width={inner}
              mean={work.prompt.meanValue}
              median={work.prompt.medianValue}
              meanSpec={work.prompt.mean}
              medianSpec={work.prompt.median}
              terse={work.prompt.terse}
              brief={work.prompt.brief}
            />
            <Words style={[type.meta, styles.caption]}>{work.prompt.sentence}</Words>
          </>
        )}
      </Block>

      {ledger.length ? (
        <Block style={styles.block}>
          <Ledger items={ledger} color={WORK.ink} size={40} delay={40} />
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>the five dimensions</Kicker>
        {isRefused(work.dimensions) ? (
          <>
            <Refusal>{work.dimensions.refusal}</Refusal>
            <View style={styles.dimKey}>
              {(Object.keys(DIMENSION_HUE) as (keyof typeof DIMENSION_HUE)[]).map((d) => (
                <View key={d} style={styles.dimKeyItem}>
                  <Swatch color={SPECTRUM[DIMENSION_HUE[d]].ink} hollow />
                  <Text allowFontScaling={false} style={type.meta}>
                    {d.replace(/_/g, ' ')}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={{ gap: 14 }}>
              {work.dimensions.rows.map((r, i) => {
                const h = SPECTRUM[r.hue as HueName];
                return (
                  <View key={r.key} style={{ gap: 6 }}>
                    <View style={styles.dimHead}>
                      <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1 }]}>
                        {r.label}
                      </Text>
                      <Text allowFontScaling={false} style={type.meta}>
                        {r.trend}
                      </Text>
                      <Num spec={r.mean} textStyle={figure(22, h.ink)} delay={120 + i * 110} />
                    </View>
                    <GrowBar frac={r.value / 100} color={h.ink} height={10} delay={120 + i * 110} />
                  </View>
                );
              })}
            </View>
            <Words style={[type.meta, styles.caption]}>{work.dimensions.basis}</Words>
            {work.dimensions.archetypeLine ? <Words style={[type.meta, styles.caption]}>{work.dimensions.archetypeLine}</Words> : null}
          </>
        )}
        {work.tags ? <Words style={[type.dim, styles.caption]}>{work.tags}</Words> : null}
        {work.patterns.map((p) => (
          <View key={p.text} style={styles.pattern}>
            <Words style={[type.dim, { color: GROUND.text }]}>{p.text}</Words>
            <Words style={type.meta}>{`"${p.example}"`}</Words>
          </View>
        ))}
      </Block>
    </Section>
  );
}

/**
 * Where your prompts fall on a ruler of words: under 10 reads as terse, 40 and up as a written
 * brief (the Wrapped card's own bars), the zone your median lands in lit, and two markers, the
 * median and the average, that slide in from zero while their numbers count.
 */
function PromptRuler({
  width,
  mean,
  median,
  meanSpec,
  medianSpec,
  terse,
  brief,
}: {
  width: number;
  mean: number;
  median: number;
  meanSpec: NumSpec;
  medianSpec: NumSpec;
  terse: number;
  brief: number;
}) {
  const top = Math.ceil(Math.max(brief * 1.5, mean * 1.3, median * 1.3) / 10) * 10;
  const x = (v: number) => Math.min(1, Math.max(0, v / top)) * width;
  const zone = median < terse ? 0 : median < brief ? 1 : 2;
  const zones = [
    { key: 'terse', from: 0, to: terse, label: 'terse' },
    { key: 'conv', from: terse, to: brief, label: 'conversational' },
    { key: 'brief', from: brief, to: top, label: 'briefs' },
  ];
  const close = Math.abs(x(mean) - x(median)) < 70;
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ height: close ? 96 : 60 }}>
        <Marker x={x(median)} spec={medianSpec} label="median" delay={120} lift={0} />
        <Marker x={x(mean)} spec={meanSpec} label="average" delay={220} lift={close ? 36 : 0} />
      </View>
      <View style={{ flexDirection: 'row', height: 12, gap: 2 }}>
        {zones.map((z, i) => (
          <View key={z.key} style={{ flexGrow: z.to - z.from, flexBasis: 0, backgroundColor: i === zone ? WORK.partner : GROUND.border }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 6 }}>
        {zones.map((z, i) => (
          <Text
            key={z.key}
            allowFontScaling={false}
            numberOfLines={1}
            style={[type.meta, { flexGrow: z.to - z.from, flexBasis: 0, color: i === zone ? GROUND.text : GROUND.faint }]}
          >
            {z.label}
          </Text>
        ))}
      </View>
      <View style={{ height: 16 }}>
        {[0, terse, brief, top].map((t) => (
          <Text key={t} allowFontScaling={false} style={[styles.tickLabel, { left: Math.min(width - 24, Math.max(0, x(t) - (t === 0 ? 0 : 12))) }]}>
            {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Marker({ x, spec, label, delay, lift }: { x: number; spec: NumSpec; label: string; delay: number; lift: number }) {
  const clock = useClock();
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x * ease(phase(clock.value, delay, 950)) }] }));
  return (
    <Animated.View style={[styles.marker, style]}>
      <View style={{ marginLeft: -1, alignItems: 'flex-start', paddingBottom: lift }}>
        <Num spec={spec} textStyle={figure(26, WORK.ink)} delay={delay} duration={950} />
        <Text allowFontScaling={false} style={[type.meta, { marginTop: -2 }]}>
          {label}
        </Text>
      </View>
      <View style={[styles.markerLine, { height: 16 + lift }]} />
    </Animated.View>
  );
}

// ------------------------------------------------------------------ 05

const TYPE_HUES: HueName[] = ['brass', 'tide', 'orchid', 'cobalt', 'ember', 'iris'];

export function AgentsSection({ agents, width }: { agents: AgentsModel; width: number }) {
  const inner = width - GUTTER * 2;
  const b = agents.body;
  return (
    <Section style={styles.section}>
      <Band hue={AGENTS} index="05" title="Agents">
        {isRefused(b) ? (
          <BandWords delay={300}>
            <Refusal onHue>{b.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <View style={styles.peakRow}>
              <BandFigure spec={b.peak} width={inner * 0.4} max={120} delay={200} label={`${b.peak.final} helper agents at once, at the peak`} />
              <View style={{ flex: 1, paddingBottom: 18 }}>
                <CountMarks n={b.peak.value} width={inner * 0.55} color={ON_HUE} delay={200} />
              </View>
            </View>
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                helper agents at the same moment, at the peak
              </Text>
            </BandWords>
            <BandWords delay={440}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                {b.line}
              </Text>
            </BandWords>
          </>
        )}
      </Band>

      {!isRefused(b) ? (
        <>
          <Block style={styles.block}>
            <Kicker>every agent that ran, one square each</Kicker>
            <AgentSquares types={b.types} width={inner} />
            <View style={styles.legend}>
              {b.types.map((t, i) => (
                <View key={t.name} style={styles.legendLine}>
                  <Swatch color={t.name === 'type not recorded' ? GROUND.faint : SPECTRUM[TYPE_HUES[i % TYPE_HUES.length]!].ink} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text allowFontScaling={false} style={[type.dim, { fontVariant: ['tabular-nums'] }]}>
                    {t.text}
                  </Text>
                </View>
              ))}
            </View>
            {b.waste ? <Words style={[type.meta, styles.caption]}>{b.waste}</Words> : null}
          </Block>
          <Block style={styles.block}>
            <Ledger
              items={[
                { key: 'parallel', num: b.parallel, label: 'at once, on average, while any were running' },
                { key: 'work', num: b.work, label: 'of agent work between them', note: b.busy },
              ]}
              color={AGENTS.ink}
              size={40}
              delay={40}
            />
          </Block>
        </>
      ) : null}

      {agents.sessionsAtOnce ? (
        <Block style={styles.block}>
          <Kicker>sessions side by side</Kicker>
          <Words style={type.heading}>{agents.sessionsAtOnce.display}</Words>
          {agents.sessionsAtOnce.sentence ? <Words style={[type.dim, { marginTop: 4 }]}>{agents.sessionsAtOnce.sentence}</Words> : null}
        </Block>
      ) : null}
    </Section>
  );
}

function AgentSquares({ types, width }: { types: { name: string; agents: number }[]; width: number }) {
  const total = types.reduce((s, t) => s + t.agents, 0);
  const cols = total <= 52 ? 13 : total <= 140 ? 20 : 26;
  const gap = cols === 13 ? 5 : 3;
  const size = Math.floor((width - gap * (cols - 1)) / cols);
  const cells: PixelCell[] = useMemo(() => {
    const out: PixelCell[] = [];
    let i = 0;
    types.forEach((t, ti) => {
      const color = t.name === 'type not recorded' ? GROUND.faint : SPECTRUM[TYPE_HUES[ti % TYPE_HUES.length]!].ink;
      for (let k = 0; k < t.agents && i < cols * 14; k++, i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        out.push({ x: col * (size + gap), y: row * (size + gap), w: size, h: size, color, delay: 60 + i * 22 });
      }
    });
    return out;
  }, [types, cols, size, gap]);
  const rows = Math.ceil(Math.min(total, cols * 14) / cols);
  const h = rows * size + Math.max(0, rows - 1) * gap;
  return (
    <View>
      <PixelField cells={cells} width={cols * size + (cols - 1) * gap} height={h} duration={360} accessibilityLabel={`${total} helper agents`} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  caption: { marginTop: 10 },
  peakRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  inlineFigure: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  marker: { position: 'absolute', left: 0, bottom: 0, alignItems: 'flex-start' },
  markerLine: { width: 2, backgroundColor: WORK.ink, marginLeft: -1 },
  tickLabel: { position: 'absolute', top: 2, fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
  dimHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  dimKey: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14 },
  dimKeyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pattern: { marginTop: 12, gap: 2 },
  legend: { marginTop: 14, gap: 8 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
