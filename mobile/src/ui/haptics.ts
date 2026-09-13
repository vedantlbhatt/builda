import * as Haptics from 'expo-haptics';

import { shouldFire, type HapticKind } from './hapticsGate';

export { HAPTIC_KINDS, type HapticKind } from './hapticsGate';

/**
 * The five haptics, as functions. The table (what each is for, and where never to call
 * one) is in `hapticsGate.ts`. Safe to call from a gesture's end through `runOnJS(select)()`.
 * Fire and forget: a device without a Taptic Engine rejects, and that is not an error.
 */
const last: Partial<Record<HapticKind, number>> = {};

function fire(kind: HapticKind, run: () => Promise<void>): void {
  const now = Date.now();
  if (!shouldFire(now, last[kind])) return;
  last[kind] = now;
  run().catch(() => {});
}

/** A value passed a step: carousel, harness tile toggle, card stack advance, segmented. */
export function select(): void {
  fire('select', () => Haptics.selectionAsync());
}

/** Something snapped home: a card settles, a name is committed with Return. */
export function snap(): void {
  fire('snap', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A commitment: "That's me" at the end of onboarding, exporting a share card. */
export function commit(): void {
  fire('commit', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** An outcome: pairing succeeded, the archetype revealed (once), a card saved. */
export function success(): void {
  fire('success', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A failure the person caused: a pairing code rejected. */
export function failure(): void {
  fire('failure', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

export const haptics: Record<HapticKind, () => void> = { select, snap, commit, success, failure };
