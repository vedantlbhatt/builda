/**
 * BACK, the pips, NEXT: the one control you press over and over while cooking.
 *
 * PINNED TO THE SHEET, not set in the scroll under the step.
 *
 * It used to sit below the stage, in the flow, and tapping NEXT brought the next step to the top
 * of the scroller — which moved NEXT. A control that walks away from your thumb every time you
 * use it is the wrong control, and this is the one you use with wet hands, eleven times, without
 * looking. So the step scrolls and the control does not.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';

export interface StepPagerProps {
  count: number;
  step: number;
  ink: string;
  onStep: (next: number) => void;
}

export function StepPager({ count, step, ink, onStep }: StepPagerProps) {
  const c = useColors();
  const go = (next: number) => {
    select();
    onStep(next);
  };
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous step"
        disabled={step === 0}
        hitSlop={12}
        onPress={() => go(Math.max(0, step - 1))}
        style={styles.half}
      >
        <T role="label" style={{ color: step === 0 ? c.textFaint : c.textDim, letterSpacing: 1.4 }}>
          BACK
        </T>
      </Pressable>

      <View style={styles.pips}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[styles.pip, { backgroundColor: i === step ? ink : c.border }]} />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next step"
        disabled={step >= count - 1}
        hitSlop={12}
        onPress={() => go(Math.min(count - 1, step + 1))}
        style={[styles.half, styles.right]}
      >
        <T role="label" style={{ color: step >= count - 1 ? c.textFaint : ink, letterSpacing: 1.4 }}>
          NEXT
        </T>
      </Pressable>
    </View>
  );
}

/** The bar it sits in, at the foot of the sheet. */
export function StepBar({ children, bottom }: { children: React.ReactNode; bottom: number }) {
  return (
    <View style={[styles.bar, { paddingBottom: 12 + bottom }]}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.ground]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  half: { paddingVertical: 10, paddingRight: 24 },
  right: { paddingRight: 0, paddingLeft: 24 },
  pips: { flexDirection: 'row', flex: 1, justifyContent: 'center', gap: 6 },
  pip: { width: 6, height: 6, borderRadius: 3, borderCurve: 'continuous' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    overflow: 'hidden',
  },
  ground: { backgroundColor: 'rgba(12,10,9,0.94)' },
});
