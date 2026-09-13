import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { SessionAnalysis } from '../generated/analysis';
import { PixelSprite } from '../pixel/PixelSprite';
import { layout, space } from '../theme';
import { Bar, Hairline, Row, Section, Stat, StatGrid, Surface, SymbolIcon, T, useColors } from '../ui';
import { analysisFooter, celebrationFor, labelize, pct, SENSITIVE_WARNING } from './format';

/**
 * The model-written reading of a session, below the card and the numbers.
 *
 * SHORT ON PURPOSE (spec/analysis.v1.json, docs/analysis.md). The reading is a headline,
 * at most two sentences and up to three highlights; the long blocks this screen used to
 * render (features, work mix, pivots, friction) were removed from the schema because
 * nobody read them. The corpus numbers people actually want (planning ratio, steer rate,
 * velocity, archetype) are COMPUTED and live on the profile, not here.
 *
 * Every section is still skipped when the model left it empty: the spec's honesty rule
 * says a field the model could not ground is null/empty, never guessed, and an empty card
 * would turn that silence into a claim. Nothing here is computed; this view only lays out
 * what the analysis already says.
 *
 * States are words (DESIGN-DIRECTION 9): the outcome and the archetype are a value over a
 * label, the way every other number on the screen is, not a coloured chip.
 */

/** How long Bit cheers beside a shipped headline before settling into a still idle pose. */
export const CELEBRATION_MS = 3000;

export function AnalysisView({
  analysis: a,
  still = false,
}: {
  analysis: SessionAnalysis;
  /**
   * Keep Bit still: another creature on the screen may move (a running session's live bar),
   * and a screen animates one creature at most (DESIGN-DIRECTION 3.5). No cheer either: a
   * checkpoint analysis of a session still running has nothing finished to cheer.
   */
  still?: boolean;
}) {
  const highlights = a.highlights ?? [];
  const dimensions = a.dimensions ?? [];
  const moves = a.decision_patterns ?? [];
  const growth = a.growth_edge ?? [];
  const tags = a.tags ?? [];
  const style = a.build_style;
  const prompting = a.prompting;
  // At most one Bit per card. A shipped session gets the cheer beside its headline; any
  // other outcome gets the quiet idle pose beside the archetype. Two mascots in one
  // section would make him the subject of the analysis rather than a companion to it.
  const celebration = still ? null : celebrationFor(a);

  return (
    <>
      <Section label="Analysis">
        <Surface style={{ gap: space.tile }}>
          {a.headline ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <T role="title" style={{ flex: 1 }}>
                {a.headline}
              </T>
              {celebration ? <CelebrationSprite /> : null}
            </View>
          ) : null}
          {a.summary ? <T role="body">{a.summary}</T> : null}
          {highlights.length > 0 && <Bullets items={highlights} />}
          {(a.outcome || a.archetype) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile, marginTop: space.xs }}>
              {a.outcome ? <Stat value={labelize(a.outcome)} label="outcome" style={{ flex: 1 }} /> : null}
              {a.archetype ? <Stat value={labelize(a.archetype)} label="archetype" style={{ flex: 1 }} /> : null}
              {a.archetype && !celebration ? <PixelSprite state="idle" size={32} fps={2} paused={still} /> : null}
            </View>
          )}
        </Surface>
      </Section>

      {style && (
        <Section label="How you built it">
          <Surface padding={0}>
            <Row title="Planning" value={labelize(style.planning)} hairline />
            <Row title="Iteration" value={labelize(style.iteration)} hairline />
            <Row title="Steering" value={labelize(style.steering)} hairline />
            <Row title="Verification" value={labelize(style.verification)} hairline />
            <Row title="Scope" value={labelize(style.scope_control)} />
          </Surface>
          {style.architecture_note ? (
            <T role="meta" tone="dim">
              {style.architecture_note}
            </T>
          ) : null}
        </Section>
      )}

      {dimensions.length > 0 && (
        <Section label="Dimensions">
          <Surface style={{ gap: space.md }}>
            {dimensions.map((d) => (
              <View key={d.dimension} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                  <T role="row" style={{ flex: 1 }}>
                    {labelize(d.dimension)}
                  </T>
                  <T role="row">{Math.round(d.score)}</T>
                </View>
                <Bar progress={d.score / 100} />
                {d.rationale ? (
                  <T role="meta" tone="dim">
                    {d.rationale}
                  </T>
                ) : null}
              </View>
            ))}
          </Surface>
        </Section>
      )}

      {moves.length > 0 && (
        <Section label="Your moves">
          <Surface padding={0}>
            {moves.map((m, i) => (
              <View key={`${m.pattern}-${i}`}>
                {i > 0 ? <Hairline inset={layout.gutter} /> : null}
                <View style={{ gap: space.xs, paddingHorizontal: layout.gutter, paddingVertical: space.tile }}>
                  <T role="row">{m.pattern}</T>
                  {m.prompt_excerpt ? <Quote text={m.prompt_excerpt} /> : null}
                  {m.effect ? (
                    <T role="meta" tone="dim">
                      {m.effect}
                    </T>
                  ) : null}
                </View>
              </View>
            ))}
          </Surface>
        </Section>
      )}

      {prompting && (
        <Section label="Prompting">
          <Surface style={{ gap: space.md }}>
            <View style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                <T role="row" style={{ flex: 1 }}>
                  Specificity
                </T>
                <T role="row">{Math.round(prompting.specificity)}</T>
              </View>
              <Bar progress={prompting.specificity / 100} />
            </View>
            <StatGrid
              items={[
                { value: labelize(prompting.tone), label: 'tone' },
                { value: pct(prompting.correction_share), label: 'corrections' },
                { value: pct(prompting.question_share), label: 'questions' },
              ]}
            />
            {prompting.note ? (
              <T role="meta" tone="dim">
                {prompting.note}
              </T>
            ) : null}
          </Surface>
        </Section>
      )}

      {growth.length > 0 && (
        <Section label="Growth edge">
          <Surface>
            <Bullets items={growth} />
          </Surface>
        </Section>
      )}

      {tags.length > 0 && (
        <Section label="Tags">
          <Surface>
            {/* Words, not chips: a row of outlined pills reads as a form to fill in. */}
            <T role="row">{tags.join('  ·  ')}</T>
          </Surface>
        </Section>
      )}

      <View style={{ gap: space.sm }}>
        <T role="meta" tone="dim">
          {analysisFooter(a)}
        </T>
        {a.contains_sensitive ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <SymbolIcon name="exclamationmark.triangle" size={15} tone="text" />
            <T role="meta" weight={600} style={{ flex: 1 }}>
              {SENSITIVE_WARNING}
            </T>
          </View>
        ) : null}
      </View>
    </>
  );
}

/** A short list with plain bullets in `textDim`: the bullet is punctuation, not decoration. */
function Bullets({ items }: { items: readonly string[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {items.map((h, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
          <T role="body" tone="dim">
            {'•'}
          </T>
          <T role="body" style={{ flex: 1 }}>
            {h}
          </T>
        </View>
      ))}
    </View>
  );
}

/**
 * A prompt, verbatim: a 2pt rule in the hairline colour and the words in quotes. The rule
 * is neutral on purpose; an amber one would spend the accent on punctuation.
 */
export function Quote({ text, lines }: { text: string; lines?: number }) {
  const c = useColors();
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: c.border, paddingLeft: space.sm }}>
      <T role="meta" style={{ fontStyle: 'italic' }} numberOfLines={lines}>
        {`“${text}”`}
      </T>
    </View>
  );
}

/**
 * One cheer, then stillness. Mounts celebrating, and after CELEBRATION_MS switches to a
 * paused idle frame: the headline is the thing to read, and a mascot that keeps bouncing
 * beside it for the whole scroll is a distraction, not a reward.
 */
function CelebrationSprite() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, []);
  return <PixelSprite state={done ? 'idle' : 'celebrating'} size={48} fps={4} paused={done} />;
}
