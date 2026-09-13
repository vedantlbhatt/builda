/**
 * 06, money and burn: what the tokens would cost at API list prices, with the owner's own
 * question answered right under the number, in words; the cost by model as a donut that sweeps
 * in; every token as one bar of its buckets; the spend on sessions with no commit; and where the
 * tokens that changed nothing went. Plain, never a scolding: a stretch that wrote nothing is
 * described by what it was doing.
 *
 * Long press the dollar figure to hide every dollar on the page ($•••), the same mask the money
 * page keeps, and again to bring them back.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { maskDollars, MASKED_DOLLARS } from '../../you/numbers';
import { Band, BandWords } from '../Band';
import { GrowBar, StackBar } from '../Bars';
import { Donut } from '../Charts';
import { BandFigure, figure, GUTTER, Kicker, Refusal, Swatch, type, Words } from '../kit';
import { isRefused, NOT_WHAT_YOU_PAY, type MoneyModel } from '../model';
import { Num } from '../Num';
import { GROUND, ON_HUE, SPECTRUM, type HueName } from '../palette';
import { Block, Section } from '../reveal';

const HUE = SPECTRUM.ember;

/** A model family keeps one hue wherever it is drawn; a second row of one family takes the partner. */
const FAMILY_HUE: Record<string, HueName> = { opus: 'iris', fable: 'tide', sonnet: 'cobalt', haiku: 'brass', mythos: 'orchid' };

/** Each model's colour, in the order given: the family's ink, then its partner for a second row of it. */
export function modelColors(families: string[]): string[] {
  const seen = new Map<string, number>();
  return families.map((f) => {
    const k = seen.get(f) ?? 0;
    seen.set(f, k + 1);
    const hue = SPECTRUM[FAMILY_HUE[f] ?? 'heather'];
    return k === 0 ? hue.ink : hue.partner;
  });
}

/** The four token buckets: the bulk in the chapter's ink, the rest in hues far from it. */
export const BUCKET_COLOR: Record<string, string> = {
  cache_read: HUE.ink,
  cache_write: SPECTRUM.brass.ink,
  output: SPECTRUM.tide.ink,
  input: GROUND.text,
};

export function MoneySection({ money, width, masked, onToggleMask }: { money: MoneyModel; width: number; masked: boolean; onToggleMask: () => void }) {
  const inner = width - GUTTER * 2;
  const b = money.body;
  const say = (s: string) => (masked ? maskDollars(s) : s);
  return (
    <Section style={styles.section}>
      <Band hue={HUE} index="06" title="Money and burn">
        {isRefused(b) ? (
          <BandWords delay={300}>
            <Refusal onHue>{b.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <Pressable
              onLongPress={onToggleMask}
              delayLongPress={450}
              accessibilityRole="button"
              accessibilityLabel={masked ? 'Dollar amounts hidden' : `${b.usd.final} ${b.label}`}
              accessibilityHint="Long press to hide or show dollar amounts"
            >
              {masked ? (
                <BandWords delay={200}>
                  <Text allowFontScaling={false} style={figure(88, ON_HUE)}>
                    {MASKED_DOLLARS}
                  </Text>
                </BandWords>
              ) : (
                <BandFigure spec={b.usd} width={inner} max={96} delay={200} />
              )}
            </Pressable>
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                {b.label}
              </Text>
            </BandWords>
            <BandWords delay={440}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, { marginTop: 8 }]}>
                {NOT_WHAT_YOU_PAY}
              </Text>
            </BandWords>
          </>
        )}
      </Band>

      {!isRefused(b) && b.models.length > 0 ? (
        <Block style={styles.block}>
          <Kicker>what each model would cost</Kicker>
          <ModelDonut models={b.models} masked={masked} />
        </Block>
      ) : null}

      {!isRefused(b) && b.tokens ? (
        <Block style={styles.block}>
          <Kicker>every token</Kicker>
          <View style={styles.bigLine}>
            <Num spec={b.tokens.total} textStyle={figure(44, GROUND.text)} delay={40} />
            <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flexShrink: 1 }]}>
              {b.tokens.label}
            </Text>
          </View>
          <StackBar height={16} delay={140} segments={b.tokens.buckets.map((x) => ({ key: x.key, value: x.tokens, color: BUCKET_COLOR[x.key] ?? GROUND.dim }))} />
          <View style={styles.legend}>
            {b.tokens.buckets.map((x) => (
              <View key={x.key} style={styles.legendLine}>
                <Swatch color={BUCKET_COLOR[x.key] ?? GROUND.dim} />
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {x.label}
                </Text>
                <Text allowFontScaling={false} style={type.dim}>
                  {x.text}
                </Text>
              </View>
            ))}
          </View>
        </Block>
      ) : null}

      {!isRefused(b) && (b.perHour || b.without) ? (
        <Block style={styles.block}>
          {b.perHour ? (
            <View style={styles.bigLine}>
              {masked ? (
                <Text allowFontScaling={false} style={figure(40, HUE.ink)}>
                  {MASKED_DOLLARS}
                </Text>
              ) : (
                <Num spec={b.perHour} textStyle={figure(40, HUE.ink)} delay={40} />
              )}
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                an active hour
              </Text>
            </View>
          ) : null}
          {b.without ? (
            <View style={{ marginTop: 14, gap: 8 }}>
              <Words style={type.body}>{say(b.without.sentence)}</Words>
              {b.without.share !== null ? <GrowBar frac={b.without.share} color={HUE.ink} height={8} delay={200} /> : null}
            </View>
          ) : null}
          {b.unpriced ? <Words style={[type.meta, styles.caption]}>{b.unpriced}</Words> : null}
        </Block>
      ) : null}

      {money.burn ? (
        <Block style={styles.block}>
          <Kicker>tokens that changed nothing</Kicker>
          <BurnBody burn={money.burn} ink={HUE.ink} />
        </Block>
      ) : null}
    </Section>
  );
}

/**
 * Where the tokens that changed nothing went: the floor as one bar of three parts (nothing
 * written, cannot judge, wrote something) and what those stretches were doing, one bar a cause.
 * Said as shares and never as a fault. The Money page draws the same block in its own chapter's
 * ink, so it lives here once.
 */
export function BurnBody({ burn, ink }: { burn: NonNullable<MoneyModel['burn']>; ink: string }) {
  if (isRefused(burn)) return <Refusal>{burn.refusal}</Refusal>;
  return (
    <>
      <Words style={type.lead}>{burn.line}</Words>
      <View style={{ marginTop: 12 }}>
        <StackBar
          height={16}
          delay={100}
          segments={[
            { key: 'barren', value: burn.share, color: ink },
            { key: 'unread', value: burn.unreadableShare ?? 0, color: GROUND.dim },
            { key: 'rest', value: Math.max(0, 1 - burn.share - (burn.unreadableShare ?? 0)), color: GROUND.border },
          ]}
        />
      </View>
      <View style={styles.legend}>
        <LegendLine color={ink} text="stretches where nothing was written, tested or committed" />
        {burn.unreadableShare ? <LegendLine color={GROUND.dim} text="stretches the transcripts cannot judge" /> : null}
        <LegendLine color={GROUND.border} text="stretches that wrote, tested or committed something" />
      </View>
      {burn.unreadableLine ? <Words style={[type.meta, styles.caption]}>{burn.unreadableLine}</Words> : null}
      {burn.causes.length ? (
        <View style={{ marginTop: 18, gap: 14 }}>
          <Text allowFontScaling={false} style={type.label}>
            what those stretches were doing
          </Text>
          {burn.causes.map((c, i) => (
            <View key={c.key} style={{ gap: 6 }}>
              <View style={styles.causeHead}>
                <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: GROUND.text, flex: 1 }]}>
                  {c.label}
                </Text>
                <Text allowFontScaling={false} style={[type.lead, { color: ink }]}>
                  {c.text}
                </Text>
              </View>
              <GrowBar frac={c.share} color={ink} height={6} delay={200 + i * 90} />
              <Words style={type.meta}>{c.stretches}</Words>
            </View>
          ))}
          <Words style={type.meta}>Causes overlap, so these shares are never added up.</Words>
        </View>
      ) : null}
    </>
  );
}

function ModelDonut({ models, masked }: { models: Extract<MoneyModel['body'], { models: unknown }>['models']; masked: boolean }) {
  const colors = modelColors(models.map((m) => m.family));
  return (
    <View style={styles.donutRow}>
      <Donut size={132} stroke={22} delay={60} slices={models.map((m, i) => ({ key: m.key, value: m.usd, color: colors[i]! }))} />
      <View style={{ flex: 1, gap: 12 }}>
        {models.map((m, i) => (
          <View key={m.key} style={{ gap: 1 }}>
            <View style={styles.modelHead}>
              <Swatch color={colors[i]!} />
              <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flex: 1 }]} numberOfLines={1}>
                {m.name}
              </Text>
              <Text allowFontScaling={false} style={[type.lead, { fontVariant: ['tabular-nums'] }]}>
                {masked ? MASKED_DOLLARS : m.text}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={[type.meta, { marginLeft: 20 }]}>
              {masked ? maskDollars(m.meta) : m.meta}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function LegendLine({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.legendLine}>
      <Swatch color={color} />
      <Text maxFontSizeMultiplier={1.4} style={[type.meta, { color: GROUND.text, flex: 1 }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  caption: { marginTop: 10 },
  bigLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, marginBottom: 10 },
  legend: { marginTop: 12, gap: 8 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  causeHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
});
