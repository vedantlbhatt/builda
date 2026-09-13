import React from 'react';
import { View } from 'react-native';

import type { BuilderProfile } from '../data/api';
import { PixelBadge } from '../pixel/PixelBadge';
import { space } from '../theme';
import { Quote } from '../analysis/AnalysisView';
import { Bar, Hairline, T } from '../ui';
import {
  BUILDER_PROFILE_PENDING,
  archetypeLine,
  builderProfileFooter,
  dimensionRows,
  meanLabel,
  topPatterns,
  topTags,
  trendLabel,
} from './builderProfile';

/**
 * "How you build": the person read across their analysed sessions. The body of a card;
 * the screen gives it the section label and the surface.
 *
 * Every number is the server's aggregate, shown with the count it stands on. `null`
 * means fewer than three analysed sessions in the window, and the card says so through
 * Bit rather than drawing five empty bars that would read as five zeros.
 */
export function BuilderProfileCard({ profile }: { profile: BuilderProfile | null }) {
  if (!profile) {
    return <PixelBadge state="thinking" text={BUILDER_PROFILE_PENDING} style={{ padding: 0 }} />;
  }

  const rows = dimensionRows(profile);
  const archetype = archetypeLine(profile);
  const tags = topTags(profile);
  const patterns = topPatterns(profile);

  return (
    <View style={{ gap: space.md }}>
      {rows.length > 0 && (
        <View style={{ gap: space.md }}>
          {rows.map((d) => {
            const trend = trendLabel(d.trend);
            return (
              <View key={d.dimension} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                  <T role="row" style={{ flex: 1 }}>
                    {d.label}
                  </T>
                  {trend ? (
                    <T role="meta" tone="dim">
                      {trend}
                    </T>
                  ) : null}
                  <T role="row">{meanLabel(d.mean)}</T>
                </View>
                <Bar progress={d.mean / 100} />
              </View>
            );
          })}
        </View>
      )}

      {(archetype || tags.length > 0) && <Hairline />}

      {archetype ? <Labelled label="archetype" value={archetype} /> : null}

      {/* Words, not chips. The count is how many sessions carried the tag. */}
      {tags.length > 0 ? (
        <Labelled label="tags" value={tags.map((t) => `${t.tag} ×${t.sessions}`).join('   ')} />
      ) : null}

      {patterns.length > 0 && (
        <View style={{ gap: space.tile }}>
          {patterns.map((p) => (
            <Pattern key={p.pattern} pattern={p.pattern} sessions={p.sessions} example={p.example} />
          ))}
        </View>
      )}

      <T role="meta" tone="dim">
        {builderProfileFooter(profile)}
      </T>
    </View>
  );
}

function Labelled({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <T role="label" tone="dim">
        {label}
      </T>
      <T role="row">{value}</T>
    </View>
  );
}

function Pattern({ pattern, sessions, example }: { pattern: string; sessions: number; example: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <T role="row">
        {pattern}
        <T role="row" tone="dim" weight={400}>
          {`  ${sessions} session${sessions === 1 ? '' : 's'}`}
        </T>
      </T>
      {example ? <Quote text={example} lines={2} /> : null}
    </View>
  );
}
