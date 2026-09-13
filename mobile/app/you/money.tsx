import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Band, BandWords } from '../../src/insights/Band';
import { DiffBar, StackBar } from '../../src/insights/Bars';
import { Donut } from '../../src/insights/Charts';
import { figure, GUTTER, Kicker, Ledger, Refusal, Swatch, type, Words, type LedgerItem } from '../../src/insights/kit';
import { NOT_WHAT_YOU_PAY } from '../../src/insights/model';
import { Num } from '../../src/insights/Num';
import { DATA, GROUND, HUE_NAMES, SPECTRUM, type Hue, type HueName } from '../../src/insights/palette';
import { Block, Section } from '../../src/insights/reveal';
import { BUCKET_COLOR, BurnBody, modelColors } from '../../src/insights/sections/Money';
import { FLOW_TITLE, FlowChapter, flowHue, flowPaint } from '../../src/money/FlowChapter';
import { moneyFlow, projectHuesApart, withFlowFigures } from '../../src/money/flow';
import { preferredHue, PROJECT_HUES, projectHues } from '../../src/projects/model';
import { useNicknames } from '../../src/projects/nicknames';
import { typeRoles } from '../../src/theme';
import { useAccent } from '../../src/theme/accent';
import { ChapterPage } from '../../src/you/ChapterPage';
import { doorHues, isRefused, moneyPage, REPORT_COMMAND, type MoneyLedgerRow, type MoneyModelRow, type MoneyPage } from '../../src/you/chapters';
import { useBuilderProfile, useMoneyMask } from '../../src/you/hooks';
import { MASKED_DOLLARS, maskDollars } from '../../src/you/numbers';
import { ChapterSkeleton, DollarFigure, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../../src/you/parts';

/**
 * Chapter one wears its door's hue on the You tab (ember, the burn, as money does on the analysis
 * page, unless the builder's own creature is ember); chapter three wears heather.
 */
const WHERE = SPECTRUM.heather;

/**
 * Money, as three chapters (design-refs/HOUSE-STYLE.md):
 *
 *   01 what it would cost   an ember band that prints itself, the dollar figure counting up huge
 *                           with its sign set small (Cash App's balance), and right under it, in
 *                           dark ink, the owner's own question answered: what these tokens would
 *                           cost at Anthropic's API list prices, and that a subscription pays the
 *                           plan, not this. Then the day the prices were read. Under the band the
 *                           tokens and the dollars an active hour as lines of print, the token
 *                           buckets as one bar, the lines added in green and removed in red with
 *                           the diff drawn from its split, and the cost by model as a ring that
 *                           sweeps in with the top model's share at its centre (Revolut's
 *                           allocation ring: 14 pt stroke, a 22 to 26 pt figure over a small
 *                           caption, a hairline legend).
 *   02 how it flowed        the owner's pick: the money Sankey (`src/money/`), tokens into models
 *                           into projects into how each session ended, the stretches that changed
 *                           nothing splitting off in grey. It prints itself left to right; a tap
 *                           follows one stream. Every flow is a number the report carries, and
 *                           each join it does not carry is a sentence, never an invented split.
 *   03 where it went        a heather band with what went to sessions that ended with no commit,
 *                           its share of every dollar as a bar, and the tokens that changed
 *                           nothing, cause by cause. Plain sentences, never a scolding.
 *
 * Long press the dollar figure to hide every dollar on the page ($•••), and again to bring them
 * back; the choice is kept on this phone and shared with the You tab.
 */
export default function MoneyScreen() {
  const { width } = useWindowDimensions();
  const { load, refresh, refreshing } = useBuilderProfile();
  const mask = useMoneyMask();
  const accent = useAccent();
  const nicknames = useNicknames();
  const costName = doorHues(accent.name).money;
  const cost = SPECTRUM[costName];
  const data = load.kind === 'ready' ? load.data : null;
  const page = useMemo(() => (data ? moneyPage(data) : null), [data]);

  // The flow wears every project's own hue from the Projects tab, stepped past any hue a model in
  // it wears (`projectHuesApart`), and its band a hue nobody in it or beside it wears.
  const projectHue = useMemo(() => {
    const models = modelColors((page?.models ?? []).map((m) => m.family))
      .map((ink) => HUE_NAMES.find((h) => SPECTRUM[h].ink === ink || SPECTRUM[h].partner === ink))
      .filter((h): h is HueName => !!h);
    const hues = data?.report?.projects ? projectHuesApart(projectHues(data.report.projects.projects), PROJECT_HUES, models) : {};
    return (key: string): HueName => hues[key] ?? preferredHue(key);
  }, [data, page]);
  const paint = useMemo(() => flowPaint(cost, projectHue), [cost, projectHue]);
  const flow = useMemo(() => (data && page ? moneyFlow(data, page, paint, nicknames) : null), [data, page, paint, nicknames]);
  // The ring in chapter 01 reads each model exactly as the flow does (`withFlowFigures`).
  const ringModels = useMemo(() => (page ? withFlowFigures(page.models, flow) : []), [page, flow]);
  const flowHueName = useMemo(() => {
    const inside = flow && !isRefused(flow) ? flow.nodes.map((x) => HUE_NAMES.find((h) => SPECTRUM[h].ink === x.hue.ink || SPECTRUM[h].partner === x.hue.ink)) : [];
    return flowHue([accent.name, costName, 'heather', ...inside.filter((h): h is HueName => !!h)]);
  }, [flow, accent.name, costName]);

  return (
    <ChapterPage title="Money" chapters={2} ready={load.kind === 'ready'} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
      {(stage) => (
        <>
          <View style={styles.lead}>
            {load.kind === 'signedOut' ? <SignedOutChapter what="money view" /> : null}
            {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
            {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
            {page?.scope ? <Words style={type.dim}>{page.scope}</Words> : null}
          </View>

          {load.kind === 'loading' ? <ChapterSkeleton /> : null}
          {load.kind === 'ready' && !page ? (
            <RefusalChapter
              hue={cost}
              index="01"
              title="What it would cost"
              refusal="Your Mac prices the work and sends it with its report, which has not arrived yet."
              command={REPORT_COMMAND}
            />
          ) : null}

          {page ? (
            <>
              <CostChapter page={page} models={ringModels} cost={cost} width={width} masked={mask.masked} onToggleMask={mask.toggle} />
              {stage >= 1 && flow ? (
                isRefused(flow) ? (
                  // A spacer beside the chapter, never a wrapper: a Section reads its place from its parent.
                  <>
                    <View style={styles.spacer} />
                    <RefusalChapter hue={SPECTRUM[flowHueName]} index="02" title={FLOW_TITLE} refusal={flow.refusal} command={REPORT_COMMAND} />
                  </>
                ) : (
                  <FlowChapter flow={flow} hue={SPECTRUM[flowHueName]} index="02" width={width} masked={mask.masked} />
                )
              ) : null}
              {stage >= 2 ? <WhereChapter page={page} width={width} masked={mask.masked} index={flow ? '03' : '02'} /> : null}
            </>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

// ------------------------------------------------------------------ 01

function CostChapter({ page, models, cost, width, masked, onToggleMask }: { page: MoneyPage; models: MoneyModelRow[]; cost: Hue; width: number; masked: boolean; onToggleMask: () => void }) {
  const inner = width - GUTTER * 2;
  const h = page.hero;
  const lines = page.lines;
  return (
    <Section>
      <Band hue={cost} index="01" title="What it would cost">
        {isRefused(h) ? (
          <BandWords delay={300}>
            <Refusal onHue>{h.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <Pressable
              onLongPress={onToggleMask}
              delayLongPress={450}
              accessibilityRole="button"
              accessibilityLabel={masked ? `Dollar amount hidden. ${NOT_WHAT_YOU_PAY}` : `${h.usd.final}. ${NOT_WHAT_YOU_PAY}`}
              accessibilityHint={masked ? 'Long press to show the dollar amounts' : 'Long press to hide the dollar amounts'}
              accessibilityActions={[{ name: 'longpress', label: masked ? 'Show dollars' : 'Hide dollars' }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'longpress') onToggleMask();
              }}
              style={styles.hero}
            >
              <DollarFigure digits={h.digits} masked={masked} width={inner} max={124} min={64} delay={200} label={h.usd.final} />
            </Pressable>
            <BandWords delay={380}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandCaption, styles.answer]}>
                {NOT_WHAT_YOU_PAY}
              </Text>
            </BandWords>
            <BandWords delay={470}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.read]}>
                {h.read}
              </Text>
            </BandWords>
          </>
        )}
      </Band>

      {page.bought.length ? (
        <Block style={styles.block}>
          <Kicker>what it bought</Kicker>
          <Ledger items={page.bought.map((r) => ledgerItem(r, masked, cost.ink))} color={cost.ink} size={44} delay={40} />
          {page.buckets.length ? (
            <>
              <View style={styles.barGap}>
                <StackBar height={16} delay={240} segments={page.buckets.map((x) => ({ key: x.key, value: x.tokens, color: bucketColor(x.key, cost) }))} />
              </View>
              <View style={styles.legend}>
                {page.buckets.map((x) => (
                  <LegendLine key={x.key} color={bucketColor(x.key, cost)} text={x.label} value={x.text} />
                ))}
              </View>
            </>
          ) : null}
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>what it wrote</Kicker>
        {isRefused(lines) ? (
          <Refusal>{lines.refusal}</Refusal>
        ) : (
          <>
            <Ledger items={lines.rows.map((r) => ledgerItem(r, masked, cost.ink))} color={DATA.add} size={44} delay={40} />
            {lines.addedShare !== null ? (
              <View style={styles.barGap}>
                <DiffBar addedShare={lines.addedShare} add={DATA.add} del={DATA.del} delay={260} />
              </View>
            ) : null}
            {lines.caption ? <Words style={[type.meta, styles.caption]}>{lines.caption}</Words> : null}
          </>
        )}
      </Block>

      {page.models.length ? (
        <Block style={styles.block}>
          <Kicker>what each model would cost</Kicker>
          <ModelRing models={models} masked={masked} width={inner} />
          {page.modelsNote ? <Words style={[type.meta, styles.caption]}>{page.modelsNote}</Words> : null}
        </Block>
      ) : null}
    </Section>
  );
}

function ledgerItem(r: MoneyLedgerRow, masked: boolean, ink: string): LedgerItem {
  return {
    key: r.key,
    num: r.num,
    label: r.label,
    note: r.note ?? null,
    color: r.tone === 'add' ? DATA.add : r.tone === 'del' ? DATA.del : ink,
    shown: masked && r.dollars ? MASKED_DOLLARS : undefined,
  };
}

/** The token buckets in the analysis page's colours, the bulk in this chapter's own ink. */
function bucketColor(key: string, cost: Hue): string {
  return key === 'cache_read' ? cost.ink : (BUCKET_COLOR[key] ?? GROUND.dim);
}

/**
 * The cost by model: a ring that sweeps in from 12 o'clock, one arc a model in its family's hue
 * (the analysis page's colours), the biggest share counting up at its centre over the model's
 * name, and the models named beside it with their dollars counting up in the same hue.
 */
function ModelRing({ models, masked, width }: { models: MoneyModelRow[]; masked: boolean; width: number }) {
  const colors = modelColors(models.map((m) => m.family));
  const size = Math.min(172, Math.floor(width * 0.46));
  const top = models[0]!;
  return (
    <View>
      <View style={styles.ringRow}>
        <View style={{ width: size, height: size }}>
          <Donut size={size} stroke={14} delay={60} slices={models.map((m, i) => ({ key: m.key, value: m.usd, color: colors[i]! }))} />
          <View style={[StyleSheet.absoluteFill, styles.ringCentre]} pointerEvents="none">
            {top.shareNum ? (
              <Num spec={top.shareNum} textStyle={figure(26, GROUND.text)} delay={260} />
            ) : (
              <Text allowFontScaling={false} style={figure(18, GROUND.text)}>
                {top.shareText}
              </Text>
            )}
            <Text allowFontScaling={false} numberOfLines={1} style={styles.ringCaption}>
              {top.name}
            </Text>
          </View>
        </View>
        <View style={styles.ringLegend}>
          {models.map((m, i) => (
            <View key={m.key} style={styles.modelLine}>
              <View style={styles.modelHead}>
                <Swatch color={colors[i]!} />
                <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[type.lead, styles.modelName]}>
                  {m.name}
                </Text>
              </View>
              {masked ? (
                <Text allowFontScaling={false} style={figure(26, colors[i]!)}>
                  {MASKED_DOLLARS}
                </Text>
              ) : (
                <Num spec={m.num} textStyle={figure(26, colors[i]!)} delay={180 + i * 90} />
              )}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.modelMeta}>
        {models.map((m) => (
          <Text key={m.key} maxFontSizeMultiplier={1.6} style={type.meta}>
            <Text style={styles.metaName}>{m.name}</Text>
            {/* "a commit" never breaks from its number: a lone "commit" on a line reads as a word. */}
            {`  ${(masked ? maskDollars(m.meta) : m.meta).replace(/ a commit$/, ' a commit')}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 02

function WhereChapter({ page, width, masked, index }: { page: MoneyPage; width: number; masked: boolean; index: string }) {
  const inner = width - GUTTER * 2;
  const w = page.without;
  if (!w && !page.burn && !page.unpriced) return null;
  const burnLine = page.burn && !isRefused(page.burn) ? page.burn.line : null;
  return (
    <Section style={styles.chapter}>
      <Band hue={WHERE} index={index} title="Where it went">
        {w && !isRefused(w) ? (
          <>
            <DollarFigure digits={w.digits} masked={masked} width={inner} max={104} min={56} delay={200} label={`${w.usd.final} ${w.rest}`} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {w.rest}
              </Text>
            </BandWords>
            <BandWords delay={450}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.read]}>
                A session that ends without a commit can still be the one that found the bug.
              </Text>
            </BandWords>
          </>
        ) : w ? (
          <BandWords delay={300}>
            <Refusal onHue>{w.refusal}</Refusal>
          </BandWords>
        ) : (
          <BandWords delay={300}>
            <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
              {burnLine ?? 'Where the tokens went, stretch by stretch.'}
            </Text>
          </BandWords>
        )}
      </Band>

      {w && !isRefused(w) && w.share !== null ? (
        <Block style={styles.block}>
          <Kicker>of every dollar</Kicker>
          <StackBar
            height={16}
            delay={80}
            segments={[
              { key: 'none', value: w.share, color: WHERE.ink },
              { key: 'rest', value: Math.max(0, 1 - w.share), color: GROUND.border },
            ]}
          />
          <View style={styles.legend}>
            <LegendLine color={WHERE.ink} text="sessions that ended with no commit" />
            <LegendLine color={GROUND.border} text="every other priced session" />
          </View>
        </Block>
      ) : null}

      {page.burn ? (
        <Block style={styles.block}>
          <Kicker>tokens that changed nothing</Kicker>
          <BurnBody burn={page.burn} ink={WHERE.ink} />
        </Block>
      ) : null}

      {page.unpriced ? (
        <Block style={styles.block}>
          <Words style={type.meta}>{page.unpriced}</Words>
        </Block>
      ) : null}
    </Section>
  );
}

function LegendLine({ color, text, value }: { color: string; text: string; value?: string }) {
  return (
    <View style={styles.legendLine}>
      <Swatch color={color} />
      <Text maxFontSizeMultiplier={1.4} style={[type.dim, styles.legendText]}>
        {text}
      </Text>
      {value ? (
        <Text allowFontScaling={false} style={[type.dim, styles.legendValue]}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 18, gap: 10 },
  hero: { alignSelf: 'flex-start' },
  answer: { marginTop: 6 },
  read: { marginTop: 6 },
  chapter: { marginTop: 56 },
  spacer: { height: 56 },
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  barGap: { marginTop: 14 },
  caption: { marginTop: 12 },
  legend: { marginTop: 12, gap: 8 },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { flex: 1, color: GROUND.text },
  legendValue: { fontVariant: ['tabular-nums'] },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  ringCentre: { alignItems: 'center', justifyContent: 'center' },
  ringCaption: { fontSize: typeRoles.meta.size, lineHeight: 16, fontWeight: '600', color: GROUND.dim, marginTop: 2, maxWidth: 110 },
  ringLegend: { flex: 1, gap: 14 },
  modelLine: { gap: 0 },
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelName: { flex: 1 },
  modelMeta: { marginTop: 18, gap: 6 },
  metaName: { color: GROUND.text, fontWeight: '600' },
});
