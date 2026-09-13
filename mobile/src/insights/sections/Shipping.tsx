/**
 * 03, shipping: lines added as the one big number; the diff as one bar that grows out from the
 * split, removed in red to the left and added in green to the right; commits split by whether
 * an agent was in the room (the strip's amber for the agent, its teal for you alone); languages
 * as one bar of parts that grow in order; and what kind of work it was.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../Band';
import { DiffBar, GrowBar, StackBar } from '../Bars';
import { BandFigure, figure, GUTTER, Kicker, Refusal, Swatch, type, Words } from '../kit';
import { isRefused, type ShippingModel } from '../model';
import { Num } from '../Num';
import { categorical, DATA, GROUND, SPECTRUM } from '../palette';
import { Block, Section } from '../reveal';

const HUE = SPECTRUM.tide;

export function ShippingSection({ shipping, width }: { shipping: ShippingModel; width: number }) {
  const inner = width - GUTTER * 2;
  const d = shipping.diff;
  const c = shipping.commits;
  const L = shipping.languages;
  const k = shipping.kind;
  return (
    <Section style={styles.section}>
      <Band hue={HUE} index="03" title="Shipping">
        {isRefused(d) ? (
          <BandWords delay={300}>
            <Refusal onHue>{d.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            {d.added ? <BandFigure spec={d.added} width={inner} max={92} delay={200} label={`${d.added.final} lines added`} /> : null}
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {d.added ? 'lines the agent added' : 'no added lines were counted'}
                {d.removed ? `, and ${d.removed.final.replace(/^-/, '')} it removed` : ''}
              </Text>
            </BandWords>
          </>
        )}
      </Band>

      {!isRefused(d) ? (
        <Block style={styles.block}>
          <Kicker>the diff</Kicker>
          <View style={styles.diffLabels}>
            {d.removed ? <Num spec={d.removed} textStyle={figure(24, DATA.del)} delay={60} /> : <View />}
            {d.added ? <Num spec={d.added} textStyle={figure(24, DATA.add)} delay={60} /> : null}
          </View>
          <DiffBar addedShare={d.addedShare} add={DATA.add} del={DATA.del} delay={80} />
          <Words style={[type.meta, styles.caption]}>{d.basis}</Words>
          {d.note ? <Words style={[type.meta, styles.caption]}>{d.note}</Words> : null}
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>commits</Kicker>
        {isRefused(c) ? (
          <Refusal>{c.refusal}</Refusal>
        ) : (
          <>
            <View style={styles.bigLine}>
              <Num spec={c.total} textStyle={figure(48, GROUND.text)} delay={40} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                commits
              </Text>
            </View>
            <StackBar
              height={16}
              delay={160}
              segments={[
                { key: 'assisted', value: c.assisted, color: DATA.agent },
                { key: 'alone', value: c.alone, color: DATA.human },
              ]}
            />
            <View style={styles.legend}>
              <LegendLine color={DATA.agent} text={c.assistedText} />
              <LegendLine color={DATA.human} text={c.aloneText} />
            </View>
            <Words style={[type.meta, styles.caption]}>{c.sentence}</Words>
          </>
        )}
      </Block>

      <Block style={styles.block}>
        <Kicker>languages, by lines added</Kicker>
        {isRefused(L) ? (
          <Refusal>{L.refusal}</Refusal>
        ) : (
          <>
            <StackBar
              height={22}
              delay={40}
              step={90}
              segments={L.rows.map((r, i) => ({ key: r.name, value: r.share, color: r.other ? GROUND.faint : categorical(i).ink }))}
            />
            <View style={styles.rows}>
              {L.rows.map((r, i) => (
                <View key={r.name} style={styles.langRow}>
                  <Swatch color={r.other ? GROUND.faint : categorical(i).ink} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.langName]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Num spec={r.lines} textStyle={styles.langLines} delay={120 + i * 70} duration={800} />
                  <Text allowFontScaling={false} style={[type.meta, styles.langShare]}>
                    {r.shareText}
                  </Text>
                </View>
              ))}
            </View>
            <Words style={[type.meta, styles.caption]}>{L.total}</Words>
            {L.note ? <Words style={[type.meta, styles.caption]}>{L.note}</Words> : null}
          </>
        )}
      </Block>

      <Block style={styles.block}>
        <Kicker>what kind of work</Kicker>
        {isRefused(k) ? (
          <Refusal>{k.refusal}</Refusal>
        ) : (
          <>
            <Words style={type.heading}>{k.display}</Words>
            {k.sentence ? <Words style={[type.dim, { marginTop: 4 }]}>{k.sentence}</Words> : null}
            <View style={styles.roles}>
              {k.roles.map((r, i) => (
                <View key={r.key} style={{ gap: 5 }}>
                  <View style={styles.roleHead}>
                    <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text }]}>
                      {r.label}
                    </Text>
                    <Text allowFontScaling={false} style={type.meta}>
                      {r.text}
                    </Text>
                  </View>
                  <GrowBar frac={k.roles[0] ? r.lines / k.roles[0].lines : 0} color={i === 0 ? HUE.ink : HUE.partner} height={6} delay={100 + i * 80} />
                </View>
              ))}
            </View>
            {k.kinds ? <Words style={[type.meta, styles.caption]}>{k.kinds}</Words> : null}
          </>
        )}
      </Block>
    </Section>
  );
}

function LegendLine({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.legendLine}>
      <Swatch color={color} />
      <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  caption: { marginTop: 10 },
  diffLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  bigLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 10 },
  legend: { marginTop: 12, gap: 8 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rows: { marginTop: 14 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GROUND.border,
  },
  langName: { flex: 1 },
  langLines: { fontSize: 17, fontWeight: '700', color: GROUND.text, fontVariant: ['tabular-nums'] },
  langShare: { width: 58, textAlign: 'right' },
  roles: { marginTop: 16, gap: 12 },
  roleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
});
