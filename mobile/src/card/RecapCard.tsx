import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { human } from '../copy/numbers';
import { timeOfDay } from '../copy/time';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { HARNESS_LOGOS } from '../pixel/harnessLogos';
import { TimelineStrip } from '../strip/TimelineStrip';
import { decodeMarks } from '../strip/decode';
import { colors, duration, MONO_FAMILY, type Scheme } from '../theme';
import { useAccent } from '../theme/accent';
import { CARD_FOOT, headline, type CardModel } from './model';

/**
 * The share card, on the phone.
 *
 * Mirrors `RecapCardView.swift`: same superlative ladder, same layout order, same
 * omissions. The two exist separately because the Mac renders SwiftUI and the phone
 * renders React Native, and that duplication is the real cost of the split — mitigated by
 * the shared spec, the shared fixtures, and the cross-language tests, but any layout
 * change is still two edits.
 *
 * What is deliberately absent, in both:
 *  - COST. Structurally impossible for Cursor, wrong by construction on a subscription,
 *    and a fourth thing competing for the half-second a stranger gives a screenshot.
 *  - A LEGEND. A route map does not explain its own encoding; the moment an artifact
 *    does, it is a chart rather than an identity.
 *
 * On the phone it is set in the house style (design-refs/HOUSE-STYLE.md), the layout unchanged:
 * the headline and the figures in the heavy, tight, tabular type every band figure uses, the
 * repository and the clocks in mono as the rest of the session page sets them, the tool as its
 * real mark (`HarnessLogo`) rather than a bordered chip, and the wordmark's square in the
 * builder's colour, their creature's (`useAccent`). FOUND IN THE FINAL CAPTURE (2026-09-13): it
 * was the one thing left in the retired amber (`surface.accent`) at the foot of every session,
 * in the type from before the rebuild. The strip keeps its data colours: those are the spec's.
 *
 * THE FOOT says Builda, the product's name since the owner renamed it (brief.md, "Owner, 10:50"),
 * and under the card's own figures the product's one line about itself, never an address: it
 * said "builder" beside "builder.dev/s/78b653", a link on a domain the product does not have to a
 * page that does not exist (the server has no public session route). FOUND IN THE CAPTURE PASS
 * (2026-09-14). The header names a private project as the Projects tab does, by the number this
 * phone gave it, never by the owner's own name for it: the naming field promises only this phone
 * knows that, and a card leaves the phone (`copy/repoLabel`, the outside reach).
 */

export { CARD_FOOT, headline, toCardModel, type CardModel } from './model';

const HARNESS_LABEL: Record<string, string> = {
  claude_code: 'Claude Code',
  cursor_ide: 'Cursor',
  cursor_agent: 'cursor-agent',
  codex: 'Codex',
  gemini_cli: 'Gemini CLI',
  cline: 'Cline',
  opencode: 'opencode',
  aider: 'Aider',
};

interface Props {
  model: CardModel;
  width: number;
  scheme?: Scheme;
  /** The wordmark's square. Default the builder's colour, their creature's hue. */
  accent?: string;
}

/** The house figure (`insights/kit.figure`) at the card's scale: heavy, tight, tabular. */
function cardFigure(size: number, color: string) {
  return { fontSize: size, fontWeight: '800' as const, letterSpacing: -Math.round(size * 0.035 * 100) / 100, color, fontVariant: ['tabular-nums' as const] };
}

/** 16:9, matching the Mac's 1600x900. Captured at pixelRatio 2. */
export function RecapCard({ model, width, scheme = 'dark', accent }: Props) {
  const c = colors(scheme);
  const theme = useAccent();
  const mark = accent ?? theme.ink;
  const height = width * (900 / 1600);
  const s = width / 1600;
  const date = new Date(model.startedAt * 1000);
  const mono = { fontFamily: MONO_FAMILY, color: c.textDim, fontVariant: ['tabular-nums' as const] };

  const stats: [string, string][] = [[duration(model.activeSeconds), 'active']];
  if (model.commits > 0) stats.push([`${model.commits}`, 'commits']);
  if (model.agentLines > 0) stats.push([`+${model.agentLines.toLocaleString()}`, 'lines']);
  if (model.filesTouched > 0) stats.push([`${model.filesTouched}`, 'files']);
  stats.push([`${model.prompts}`, model.prompts === 1 ? 'prompt' : 'prompts']);
  // Tokens only when the harness reports them. Cursor never does, and a "0" there reads
  // as a bug in Builda rather than as a fact about Cursor.
  if (model.tokensReported) stats.push([human(model.totalTokens), 'tokens']);

  const stripWidth = width - 152 * s;

  return (
    <View style={[styles.card, { width, height, backgroundColor: c.card, padding: 76 * s }]}>
      <View style={[styles.header, { alignItems: 'center' }]}>
        <Text style={{ ...mono, fontSize: 30 * s, fontWeight: '600', color: c.text }}>{model.repoLabel}</Text>
        <Text style={{ fontSize: 26 * s, fontWeight: '500', color: c.textDim, marginLeft: 16 * s }}>
          {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
        <View style={{ flex: 1 }} />
        {HARNESS_LOGOS[model.harness] ? (
          <View style={{ marginRight: 10 * s }}>
            <HarnessLogo harness={model.harness} size={Math.round(32 * s)} color={c.text} />
          </View>
        ) : null}
        <Text style={{ fontSize: 26 * s, fontWeight: '600', color: c.text }}>
          {HARNESS_LABEL[model.harness] ?? model.harness}
          {model.modelName ? <Text style={{ fontWeight: '500', color: c.textDim }}>{`  ${model.modelName}`}</Text> : null}
        </Text>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ ...cardFigure(84 * s, c.text), lineHeight: Math.round(84 * s * 1.08) }} numberOfLines={2} adjustsFontSizeToFit>
          {headline(model)}
        </Text>
      </View>

      <View style={{ marginBottom: 40 * s }}>
        {model.strip ? (
          <TimelineStrip
            cols={model.strip}
            marks={decodeMarks(model.marks)}
            spanMs={Math.max(1, model.wallSeconds * 1000)}
            preset="hero"
            scheme={scheme}
            width={stripWidth}
          />
        ) : null}
        <View style={[styles.header, { marginTop: 14 * s }]}>
          <Text style={{ ...mono, fontSize: 24 * s }}>{timeOfDay(date.getTime())}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...mono, fontSize: 24 * s }}>
            {duration(model.activeSeconds)} active · {duration(model.wallSeconds)} elapsed
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...mono, fontSize: 24 * s }}>{timeOfDay((model.startedAt + model.wallSeconds) * 1000)}</Text>
        </View>
      </View>

      <View style={styles.header}>
        {stats.map(([value, label]) => (
          <View key={label} style={{ flex: 1 }}>
            <Text style={cardFigure(44 * s, c.text)}>{value}</Text>
            <Text style={{ fontSize: 22 * s, fontWeight: '500', color: c.textDim }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.header, { marginTop: 'auto', alignItems: 'center' }]}>
        <View style={{ width: 16 * s, height: 16 * s, backgroundColor: mark, marginRight: 10 * s }} />
        <Text style={{ fontSize: 26 * s, fontWeight: '800', letterSpacing: -0.3 * s, color: c.text }}>Builda</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...mono, fontSize: 22 * s }}>{CARD_FOOT}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'baseline' },
});
