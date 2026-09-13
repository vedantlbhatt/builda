import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { human } from '../copy/numbers';
import { timeOfDay } from '../copy/time';
import type { SessionDetail } from '../data/api';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { HARNESS_LOGOS } from '../pixel/harnessLogos';
import { TimelineStrip } from '../strip/TimelineStrip';
import { decodeMarks } from '../strip/decode';
import { colors, duration, MONO_FAMILY, type Scheme } from '../theme';
import { useAccent } from '../theme/accent';

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
 */

export interface CardModel {
  repoName: string | null;
  startedAt: number;
  activeSeconds: number;
  wallSeconds: number;
  title: string | null;
  choreTitle: boolean;
  prompts: number;
  filesTouched: number;
  agentLines: number;
  commits: number;
  tokensReported: boolean;
  totalTokens: number;
  modelName: string | null;
  agentLineBucket: string;
  attribConfidence: string;
  isPersonalRecord: boolean;
  strip: string;
  marks: number[][];
  shortCode: string;
  harness: string;
}

const CHORE_PATTERN =
  /^(Check|Run|Debug the|Disable|Enable|List|Add file|Say|Clarify|Analyze|Toggle)\b/;

const BUCKET_COPY: Record<string, string> = {
  almost_all_agent: 'Nearly every line came from',
  nine_in_ten: '9 of every 10 lines came from',
  three_in_four: '3 of every 4 lines came from',
  about_half: 'About half the lines came from',
  mostly_you: 'Most of these lines are yours',
};

/**
 * The most remarkable TRUE fact available, in a fixed order of interest.
 *
 * Neither obvious option works alone. A duration is evaluable but not remarkable, and the
 * harness's own title is usually a chore-log entry — reading all 82 on the reference
 * machine turned up "Check backend service running on port 5001" and "Say hi in three
 * words". Leading with either produces a card that reads like a screenshotted ticket.
 */
export function headline(m: CardModel): string {
  if (m.isPersonalRecord) return `${duration(m.activeSeconds)}, longest session yet`;

  if (
    m.attribConfidence !== 'none' &&
    m.agentLineBucket !== 'unknown' &&
    m.agentLines >= 200 &&
    m.modelName
  ) {
    const copy = BUCKET_COPY[m.agentLineBucket];
    if (copy) {
      // "at least" is not decoration: human edits are counted as events with no line
      // count, so this is a lower bound. The hedge is also the more impressive phrasing.
      return m.agentLineBucket === 'mostly_you'
        ? copy
        : `${copy} ${m.modelName}, at least`;
    }
  }

  if (m.commits >= 5) return `${m.commits} commits`;
  if (m.agentLines >= 1000) return `+${m.agentLines.toLocaleString()} lines`;
  if (m.activeSeconds >= 2700) return `${duration(m.activeSeconds)} in one sitting`;
  if (m.title && !m.choreTitle && m.title.length <= 60) return m.title;
  return duration(m.activeSeconds);
}

export function toCardModel(s: SessionDetail, shortCode: string): CardModel {
  const stats = (s.stats ?? {}) as Record<string, number | string | boolean | null>;
  const models = (stats.models as { model_id: string }[] | undefined) ?? [];
  const rawModel = models[0]?.model_id ?? null;

  const started = new Date(s.started_at).getTime() / 1000;
  const ended = new Date(s.ended_at).getTime() / 1000;

  return {
    repoName: s.repo_name,
    startedAt: started,
    activeSeconds: s.active_seconds,
    wallSeconds: Math.max(ended - started, s.active_seconds),
    title: s.title,
    choreTitle: s.title ? CHORE_PATTERN.test(s.title) : false,
    prompts: Number(stats.human_prompt_count ?? 0),
    filesTouched: Number(stats.files_touched ?? 0),
    agentLines: Number(stats.lines_added_agent ?? 0),
    commits: Number(stats.commit_count ?? 0),
    tokensReported: Boolean(stats.tokens_reported),
    totalTokens:
      Number(stats.tok_in ?? 0) +
      Number(stats.tok_out ?? 0) +
      Number(stats.tok_cache_read ?? 0) +
      Number(stats.tok_cache_w5m ?? 0) +
      Number(stats.tok_cache_w1h ?? 0),
    modelName: shortModelName(rawModel),
    agentLineBucket: String(stats.agent_line_bucket ?? 'unknown'),
    attribConfidence: String(stats.attrib_confidence ?? 'none'),
    isPersonalRecord: false,
    strip: s.strip?.cols ?? '',
    marks: s.strip?.marks ?? [],
    shortCode,
    harness: s.harness,
  };
}

/** "claude-opus-5[1m]" -> "Opus 5". The suffix is preserved on the wire, not on a card. */
function shortModelName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.split('[')[0] ?? raw;
  s = s.replace('claude-', '');
  return s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

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
        <Text style={{ ...mono, fontSize: 30 * s, fontWeight: '600', color: c.text }}>{model.repoName ?? 'private repo'}</Text>
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
        <Text style={{ fontSize: 26 * s, fontWeight: '800', letterSpacing: -0.3 * s, color: c.text }}>builder</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...mono, fontSize: 22 * s }}>{model.shortCode}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'baseline' },
});
