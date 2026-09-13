/**
 * The five haptics and the one rule that keeps them punctuation (DESIGN-DIRECTION 3.6).
 * Pure, so the tests can hold the table; `haptics.ts` does the calling.
 *
 * | kind    | when                                                                  | call                        |
 * |---------|-----------------------------------------------------------------------|-----------------------------|
 * | select  | a value passes a step: carousel, harness tile, card stack, segmented   | selectionAsync()            |
 * | snap    | something snaps home: card settles, name committed, refresh threshold | impactAsync(Light)          |
 * | commit  | a commitment: "That's me" at the end of onboarding, exporting a card   | impactAsync(Medium)         |
 * | success | an outcome: pairing succeeded, archetype revealed (once), card saved   | notificationAsync(Success)  |
 * | failure | a failure the person caused: pairing code rejected                     | notificationAsync(Error)    |
 *
 * Never on scroll, on count-up ticks, on live data updates, in loops, on creature frames,
 * or per keystroke. One per action, on the same frame as the visual. Heavy is unused.
 */
export type HapticKind = 'select' | 'snap' | 'commit' | 'success' | 'failure';

export const HAPTIC_KINDS: readonly HapticKind[] = ['select', 'snap', 'commit', 'success', 'failure'];

/**
 * Two haptics of one kind closer than this are one action firing twice (a double-wired
 * handler, a re-render loop), so the second is dropped. 60ms is under the fastest real
 * repeat (a carousel flicked through steps ticks at ~80ms) and over one frame.
 */
export const HAPTIC_MIN_GAP_MS = 60;

export function shouldFire(now: number, last: number | undefined, minGap: number = HAPTIC_MIN_GAP_MS): boolean {
  return last === undefined || now - last >= minGap;
}
