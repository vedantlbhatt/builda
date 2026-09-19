/**
 * `spec.ts`'s springs as Reanimated configs. Import these in components; import `spec.ts` in
 * tests and anywhere that only needs the numbers.
 *
 * `reduceMotion: System` on every one: under Reduce Motion Reanimated jumps a spring to its end,
 * so every morph still reaches its final state and nothing oscillates.
 */
import { ReduceMotion, type WithSpringConfig, type WithTimingConfig, Easing } from 'react-native-reanimated';

import { CONTENT, EXIT_MS, ISLAND, POP, SNAP, WHEEL, type SpringSpec } from './spec';

function config(s: SpringSpec): WithSpringConfig {
  return {
    damping: s.damping,
    stiffness: s.stiffness,
    mass: s.mass,
    overshootClamping: false,
    // Tight thresholds: a loose one ends the spring on its last small swing and the box
    // visibly snaps the final point into place.
    restDisplacementThreshold: 0.001,
    restSpeedThreshold: 0.01,
    reduceMotion: ReduceMotion.System,
  };
}

export const SPRING = {
  island: config(ISLAND),
  content: config(CONTENT),
  pop: config(POP),
  wheel: config(WHEEL),
  snap: config(SNAP),
} as const;

/** Everything in a group leaving together: fast, eased, no spring (a spring on an exit lingers). */
export const EXIT: WithTimingConfig = {
  duration: EXIT_MS,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};
