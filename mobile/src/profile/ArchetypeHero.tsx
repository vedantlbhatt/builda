import React from 'react';
import { View } from 'react-native';

import { animalForArchetype, type Animal } from '../pixel/animals';
import { PixelAnimal } from '../pixel/PixelAnimal';
import { PixelSprite } from '../pixel/PixelSprite';
import { space } from '../theme';
import type { CorpusArchetype } from '../data/api';
import { PressableScale, T } from '../ui';
import { archetypeTitle, closestRule, ruleSentence } from './format';

/**
 * The top of the profile: a creature, a title, and the one measured rule that earned it.
 *
 * The rule is shown, always. An archetype with nothing under it is a horoscope, and this
 * one is a threshold on a single named metric, so saying which one costs a line and is
 * the difference between a claim and a result.
 *
 * When no rule met its threshold there is no archetype and none is invented. The hero
 * says what is missing instead, because "we do not know yet" is a true thing to say and
 * a guessed archetype is not.
 *
 * It sits on the canvas, not in a card: the creature and the name are the screen's one
 * `display`, and weight and size carry it. No amber outline and no amber title; the
 * creature is the colour here.
 */
export function ArchetypeHero({
  archetype,
  sessions,
  sentence,
  animal,
  onPressAnimal,
}: {
  archetype: CorpusArchetype | null;
  sessions: number;
  /**
   * The narrative's one line about what this label means for THIS person, when a
   * narrative exists and the number check did not take it back. Shown ABOVE the rule,
   * because the rule is the receipt and this is the claim. Absent is the normal state.
   */
  sentence?: string | null;
  /**
   * The creature to draw. Their own pick when they have made one, otherwise the one the
   * archetype earned. Passed in rather than derived here so this component keeps having
   * exactly one job.
   */
  animal?: Animal | null;
  /** Opens the picker. Absent on a card that is not the owner's own profile. */
  onPressAnimal?: () => void;
}) {
  const name = archetype?.name ?? null;
  const runners = (archetype?.runners_up ?? []).filter((r) => r.score !== null);
  const closest = archetype && !name ? closestRule(archetype.scores) : null;

  // The rule, verbatim from the server, or the reason there is none.
  const rule =
    (archetype && ruleSentence(archetype)) ??
    (closest
      ? `Nothing you do is extreme enough to name yet. Closest is ${archetypeTitle(
          closest.name
        )}: ${closest.rule}, ${closest.value} against ${closest.threshold}.`
      : archetype?.reason ?? 'Build a few more sessions and this fills in.');

  return (
    <View style={{ gap: space.md }}>
      {/* Bit, not an animal, when there is no type. Every animal in the pack IS an
          archetype, so drawing one here would say "quality guardian" in the picture
          while the words say "no type yet", and the picture is the part people read.
          Tapping the creature is how the picker is reached: it is the one thing on this
          screen that is purely theirs, so it is the one thing that presses. */}
      <PressableScale
        onPress={onPressAnimal}
        disabled={!onPressAnimal}
        accessibilityRole={onPressAnimal ? 'button' : 'image'}
        accessibilityLabel={onPressAnimal ? 'Change your creature' : undefined}
        hitSlop={space.sm}
        style={{ alignSelf: 'flex-start' }}
      >
        {name ? (
          <PixelAnimal animal={animal ?? animalForArchetype(name)} size={64} />
        ) : (
          <PixelSprite state="thinking" size={64} />
        )}
      </PressableScale>

      <View style={{ gap: space.xs }}>
        <T role="label" tone="dim">
          your builder type
        </T>
        <T role="display" tone={name ? 'text' : 'dim'} numberOfLines={2} accessibilityRole="header">
          {name ? archetypeTitle(name) : closest ? 'No clear type' : 'Not enough yet'}
        </T>
      </View>

      {sentence ? <T role="body">{sentence}</T> : null}

      <View style={{ gap: space.xs }}>
        <T role={sentence ? 'meta' : 'body'} tone={sentence ? 'dim' : 'text'}>
          {rule}
        </T>
        {name && archetype?.confidence !== null && archetype?.confidence !== undefined && (
          <T role="meta" tone="dim">
            {Math.round(archetype.confidence * 100)}% confidence over {sessions}{' '}
            {sessions === 1 ? 'session' : 'sessions'}
            {runners.length > 0
              ? `, next closest ${runners.map((r) => archetypeTitle(r.name)).join(' and ')}`
              : ''}
          </T>
        )}
      </View>
    </View>
  );
}
