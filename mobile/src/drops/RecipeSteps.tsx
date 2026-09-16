/**
 * A recipe drop, cooked: everything it said, in the order you need it.
 *
 * The owner asked for this by name: "if its a recipe video find all the ingredients, the
 * quantity, the steps, and make like a UI that shows the recipe step by step". It is also the
 * control case for the whole feature (`docs/drops.md`): if Builda cannot get "3 cloves garlic,
 * minced" right, it has no business claiming it got "install the skill from this repo" right.
 *
 * TWO HALVES, and the second one is the point:
 *
 *   the ingredients   a ledger. Quantity in mono on the left at a fixed width so the column of
 *                     amounts lines up and can be read down; the ingredient in the reader's
 *                     type; what is done to it, dim, after a comma. A quantity the video never
 *                     gave prints as "as needed" and NEVER as a number: an invented amount is
 *                     the one output here that ruins something.
 *   the steps         one at a time, full bleed, with the step's own number set huge behind it.
 *                     You are holding a phone with wet hands; a list of twelve numbered lines is
 *                     not a thing you can cook from. Swipe or tap forward, and a step that
 *                     carries a time shows it.
 *
 * WHERE IT CAME FROM IS PRINTED. When the method was found on the web rather than published by
 * the video (`drops/recipe.py`), the page it came from is named under the ingredients. A
 * stranger's recipe passed off as the creator's is the same class of error as an invented
 * package name.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { dropHue } from '../theme';
import { Hairline } from '../ui/Hairline';
import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import type { Recipe } from '../generated/drops';

export function RecipeSteps({ recipe }: { recipe: Recipe }) {
  const foundUrl = recipe.found_url ?? null;
  const c = useColors();
  const hue = dropHue('recipe')!;
  const [step, setStep] = useState(0);
  const steps = recipe.steps ?? [];
  const at = steps[step];

  return (
    <View>
      <View style={styles.headRow}>
        <T role="label" style={{ color: hue.ink, letterSpacing: 1.2 }}>
          INGREDIENTS
        </T>
        <T role="mono" style={{ color: c.textFaint }}>
          {[recipe.serves ? `serves ${recipe.serves}` : null, recipe.total_minutes ? `${recipe.total_minutes} min` : null]
            .filter(Boolean)
            .join('  ·  ')}
        </T>
      </View>

      {(recipe.ingredients ?? []).map((ing, i) => (
        <View key={`${ing.item}.${i}`}>
          {i > 0 ? <Hairline /> : null}
          <View style={styles.ing}>
            <T role="mono" style={[styles.qty, { color: ing.quantity ? c.text : c.textFaint }]}>
              {ing.quantity ?? 'as needed'}
            </T>
            <T role="row" style={styles.item}>
              {ing.item}
              {ing.note ? <T role="meta" style={{ color: c.textDim }}>{`, ${ing.note}`}</T> : null}
            </T>
          </View>
        </View>
      ))}

      {(recipe.equipment ?? []).length ? (
        <T role="meta" style={{ color: c.textDim, marginTop: 12 }}>
          {`You will need: ${(recipe.equipment ?? []).join(', ')}`}
        </T>
      ) : null}

      {foundUrl ? (
        <T role="meta" style={{ color: c.textFaint, marginTop: 10 }}>
          {`The video named the dish and gave no method. This is from ${hostOf(foundUrl)}.`}
        </T>
      ) : null}

      {steps.length ? (
        <>
          <View style={[styles.headRow, { marginTop: 28 }]}>
            <T role="label" style={{ color: hue.ink, letterSpacing: 1.2 }}>
              METHOD
            </T>
            <T role="mono" style={{ color: c.textFaint }}>
              {`${step + 1} of ${steps.length}`}
            </T>
          </View>

          {/* One step, full width, with its number set huge behind it. Tap the right half to go
              on, the left half to go back: a thumb on a phone propped against a bag of flour. */}
          <View style={styles.stage}>
            <T role="hero" style={[styles.ghost, { color: c.raised }]}>
              {String(step + 1)}
            </T>
            <Animated.View key={step} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
              <T role="title" style={{ color: c.text }}>
                {at?.text ?? ''}
              </T>
              {at?.minutes ? (
                <T role="mono" style={{ color: hue.ink, marginTop: 10 }}>
                  {`${at.minutes} min`}
                </T>
              ) : null}
            </Animated.View>
          </View>

          <View style={styles.steps}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous step"
              disabled={step === 0}
              onPress={() => {
                select();
                setStep((s) => Math.max(0, s - 1));
              }}
              style={styles.half}
            >
              <T role="label" style={{ color: step === 0 ? c.textFaint : c.textDim }}>
                BACK
              </T>
            </Pressable>
            <View style={styles.pips}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    { backgroundColor: i === step ? hue.ink : c.border },
                  ]}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next step"
              disabled={step >= steps.length - 1}
              onPress={() => {
                select();
                setStep((s) => Math.min(steps.length - 1, s + 1));
              }}
              style={[styles.half, styles.right]}
            >
              <T
                role="label"
                style={{ color: step >= steps.length - 1 ? c.textFaint : hue.ink }}
              >
                NEXT
              </T>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function hostOf(url: string): string {
  const m = /^https:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  ing: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 9 },
  // A fixed column, so the amounts read down as a column rather than as ragged prose.
  qty: { width: 92 },
  item: { flex: 1 },
  stage: { minHeight: 132, justifyContent: 'center', paddingVertical: 12 },
  ghost: { position: 'absolute', right: -4, top: -18, opacity: 0.9 },
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  half: { paddingVertical: 12, paddingRight: 24 },
  right: { paddingRight: 0, paddingLeft: 24 },
  pips: { flexDirection: 'row', flex: 1, justifyContent: 'center', gap: 6 },
  pip: { width: 6, height: 6, borderRadius: 3, borderCurve: 'continuous' },
});
