import React, { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Band, BandWords } from '../../src/insights/Band';
import { GrowBar } from '../../src/insights/Bars';
import { BandFigure, figure, GUTTER, Kicker, type, Words } from '../../src/insights/kit';
import { Num } from '../../src/insights/Num';
import { GROUND, SPECTRUM, type Hue } from '../../src/insights/palette';
import { Block, Section } from '../../src/insights/reveal';
import { HarnessLogo } from '../../src/pixel/HarnessLogo';
import { harnessHue } from '../../src/theme';
import { useAccent } from '../../src/theme/accent';
import { ChapterPage } from '../../src/you/ChapterPage';
import { doorHues, isRefused, REPORT_COMMAND, stackPage, type StackCategory, type StackItemLine, type ToolsMix } from '../../src/you/chapters';
import { useBuilderProfile, useToolsMix } from '../../src/you/hooks';
import { Arrive, ChapterSkeleton, ErrorChapter, RefusalChapter, SignedOutChapter, StaleLine } from '../../src/you/parts';

/** Items that arrive together as each group scrolls into view. */
const PER_BLOCK = 8;

/**
 * Your stack: what the work is made of.
 *
 *   the band        in this page's hue, the number of things counting up, and what they were
 *                   read from
 *   the tools       the coding tools your sessions came from, each with its real mark (the
 *                   owner's logos, `HarnessLogo`), counted over the sessions saved on this phone
 *   the categories  each a chapter of words: its name large in its own hue with its count, then
 *                   the things sessions used, each with an inline bar sized to how many (the way
 *                   Strava draws a bar inside each split). What no session used is one sentence
 *                   by what put it there, never a "0 sessions" line.
 *
 * Only catalog items reach the phone (a manifest's package names never leave the Mac).
 */
export default function StackScreen() {
  const { width } = useWindowDimensions();
  const { load, refresh, refreshing } = useBuilderProfile();
  const tools = useToolsMix();
  const accent = useAccent();
  const data = load.kind === 'ready' ? load.data : null;
  const page = useMemo(() => (data ? stackPage(data) : null), [data]);
  const hue = SPECTRUM[doorHues(accent.name).stack];
  const inner = width - GUTTER * 2;
  const body = page?.body ?? null;

  return (
    <ChapterPage title="Your stack" chapters={1} ready={page !== null && accent.ready} refreshing={refreshing} onRefresh={load.kind === 'signedOut' ? null : () => void refresh()}>
      {(stage) => (
        <>
          <View style={styles.lead}>
            {load.kind === 'signedOut' ? <SignedOutChapter what="stack" /> : null}
            {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={() => void refresh()} /> : null}
            {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
          </View>

          {load.kind === 'loading' ? <ChapterSkeleton /> : null}

          {page && body && isRefused(body) ? (
            <RefusalChapter hue={hue} index="01" title="What it is made of" refusal={body.refusal} command={page.notSent ? REPORT_COMMAND : null} />
          ) : null}

          {body && !isRefused(body) ? (
            <>
              <Section>
                <Band hue={hue} index="01" title="What it is made of">
                  <View style={styles.side}>
                    <BandFigure spec={body.total} width={inner * 0.4} max={112} min={56} delay={200} label={`${body.total.final} things`} />
                    <View style={styles.sideWords}>
                      <BandWords delay={320}>
                        <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                          things your work is made of
                        </Text>
                      </BandWords>
                    </View>
                  </View>
                  <BandWords delay={420}>
                    <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
                      {body.summary}
                    </Text>
                  </BandWords>
                </Band>
                {tools ? <Tools mix={tools} /> : null}
              </Section>

              {stage >= 1 ? body.groups.map((g) => <Category key={g.key} group={g} />) : null}

              {stage >= 1 && body.cutNote ? (
                <Section style={styles.category}>
                  <Block style={styles.block}>
                    <Words style={type.meta}>{body.cutNote}</Words>
                  </Block>
                </Section>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

/** The coding tools, each with its real mark, its sessions counting up, and its share as a bar in its hue. */
function Tools({ mix }: { mix: ToolsMix }) {
  return (
    <Block style={styles.block}>
      <Kicker>what you build with</Kicker>
      <View style={styles.tools}>
        {mix.tools.map((t, i) => {
          const ink = harnessHue(t.key)?.ink ?? GROUND.text;
          return (
            <View key={t.key} style={styles.tool} accessible accessibilityLabel={`${t.name}, ${t.sessions.final} ${t.count === 1 ? 'session' : 'sessions'}`}>
              <Arrive delay={60 + i * 90}>
                <HarnessLogo harness={t.harness} size={36} color={GROUND.text} />
              </Arrive>
              <View style={styles.toolWords}>
                <View style={styles.toolHead}>
                  <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.flex]}>
                    {t.name}
                  </Text>
                  <Num spec={t.sessions} textStyle={figure(28, ink)} delay={120 + i * 90} />
                </View>
                <GrowBar frac={t.share} color={ink} height={8} delay={160 + i * 90} />
              </View>
            </View>
          );
        })}
      </View>
      <Words style={[type.meta, styles.caption]}>{mix.basis}</Words>
    </Block>
  );
}

/** One category as a chapter of words: its name large in its hue, its count, then its things. */
function Category({ group }: { group: StackCategory }) {
  const h: Hue = SPECTRUM[group.hue];
  const chunks: StackItemLine[][] = [];
  for (let i = 0; i < group.items.length; i += PER_BLOCK) chunks.push(group.items.slice(i, i + PER_BLOCK));
  return (
    <Section style={styles.category}>
      <Block style={styles.block}>
        <View style={styles.catHead} accessibilityRole="header">
          <Text maxFontSizeMultiplier={1.3} style={[styles.catName, { color: h.ink }]}>
            {group.label}
          </Text>
          <Num spec={group.count} textStyle={figure(30, h.ink)} delay={60} />
        </View>
      </Block>
      {chunks.map((c) => (
        <Block key={c[0]!.id} style={styles.items}>
          {c.map((it, i) => (
            <Item key={it.id} item={it} ink={h.ink} i={i} />
          ))}
        </Block>
      ))}
      {group.named.length ? (
        <Block style={styles.named}>
          {group.named.map((line) => (
            <Words key={line} style={type.dim}>
              {line}
            </Words>
          ))}
        </Block>
      ) : null}
    </Section>
  );
}

function Item({ item, ink, i }: { item: StackItemLine; ink: string; i: number }) {
  return (
    <Arrive delay={i * 60} style={styles.item}>
      <View style={styles.itemHead}>
        <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.flex]}>
          {item.name}
        </Text>
        {item.value ? (
          <Text allowFontScaling={false} style={[type.dim, styles.value]}>
            {item.value}
          </Text>
        ) : null}
      </View>
      <GrowBar frac={item.share} color={ink} height={6} delay={80 + i * 60} />
      <Words style={type.meta}>{item.meta}</Words>
    </Arrive>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 18, gap: 10 },
  side: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  sideWords: { flex: 1, paddingBottom: 14 },
  note: { marginTop: 8 },
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  caption: { marginTop: 14 },
  tools: { gap: 18 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  toolWords: { flex: 1, gap: 6 },
  toolHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  flex: { flex: 1 },
  category: { marginTop: 22 },
  catHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  catName: { ...figure(30, GROUND.text), lineHeight: 34, letterSpacing: -0.7 },
  items: { paddingHorizontal: GUTTER, marginTop: 4 },
  named: { paddingHorizontal: GUTTER, marginTop: 10, gap: 8 },
  item: { paddingVertical: 10, gap: 6 },
  itemHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  value: { color: GROUND.text, fontVariant: ['tabular-nums'] },
});
