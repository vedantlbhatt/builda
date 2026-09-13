import React, { useEffect } from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { DecryptedText, StatGrid, T, useReduceMotion } from '../ui';
import { sourceLine, type ArchetypeView } from './archetype';
import { useFirstReveal } from './hooks';

/**
 * The builder type at the top of the You tab: the name in the `hero` role, the rule under it,
 * two or three of the numbers that earned it, and where it was scored.
 *
 * The name decrypts ONCE, the first time this account's tab shows this type (DESIGN-DIRECTION
 * 3.5: text effects in two places, and this is one), and lands with the one success haptic the
 * design gives the reveal. After that, and under Reduce Motion, it is just the name. The type
 * changing is a new first view.
 *
 * An archetype with nothing under it is a horoscope (the old hero's rule): the rule and its
 * numbers are always shown, and a bar that was never measured says so beside its number.
 */
export function ArchetypeReveal({ view, sentence }: { view: ArchetypeView; sentence?: string | null }) {
  const reduce = useReduceMotion();
  const { phase, revealed } = useFirstReveal(view.state === 'refused' ? null : view.id);

  // Reduce Motion lands the name at once, and DecryptedText then never reports an end: the
  // first view still counts, and still gets its one haptic.
  useEffect(() => {
    if (reduce && phase === 'play') revealed();
  }, [reduce, phase, revealed]);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.xs }}>
        <T role="label" tone="dim">
          your builder type
        </T>
        {view.state === 'refused' ? (
          <T role="title" tone="dim" accessibilityRole="header">
            {view.display}
          </T>
        ) : phase === 'unknown' ? (
          // Holds the name's space while the saved reveal is read, so it never shows in full
          // and then scrambles.
          <T role="hero" numberOfLines={2} style={{ opacity: 0 }} importantForAccessibility="no-hide-descendants">
            {view.display}
          </T>
        ) : (
          <DecryptedText
            text={view.display}
            role="hero"
            numberOfLines={2}
            play={phase === 'play' && !reduce}
            onEnd={revealed}
          />
        )}
      </View>

      {sentence ? <T role="body">{sentence}</T> : null}
      {view.line ? (
        <T role={sentence ? 'meta' : 'body'} tone={sentence ? 'dim' : 'text'}>
          {view.line}
        </T>
      ) : null}
      {view.evidence.length > 0 ? <StatGrid items={view.evidence} /> : null}
      <T role="meta" tone="dim">
        {sourceLine(view)}
      </T>
    </View>
  );
}
