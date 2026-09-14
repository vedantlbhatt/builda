/**
 * The react-bits effect ports (DESIGN-V2-COLOUR-MOTION.md 4.4), each with its still under
 * Reduce Motion and David Haz's notice in its header. Colour comes in as a hue name or a
 * resolved `Hue` from `theme.ts`, never a hex; timings are the kit's (`motionSpec.ts`) and
 * the effect numbers are in `spec.ts`.
 *
 *   ClickSpark, SparkBurst      sparks on a commitment, or at a point (a commit landing)
 *   StarBorder                  the comet round the one tile that needs you
 *   GlareHover                  the stepped press sheen on a card
 *   AnimatedContent, Rise,
 *   FadeContent, Stagger        entrances on the kit's timings and stagger
 *   PixelSwap                   one Skia picture into another, cell by cell
 *   PixelTransition             cells cover a view, the view changes, cells uncover
 *   Magnet                      a primary button leaning toward the thumb
 *   LogoLoop, HarnessLoop       a drifting row of marks; the harness glyphs in their hues
 *
 * The gallery (`EffectsGallery.tsx`) is deliberately NOT exported here, for the same reason
 * `KitGallery` is not in `src/ui/index.ts`: Metro does not tree shake.
 */
export { ClickSpark, SparkBurst, type ClickSparkHandle, type ClickSparkProps, type SparkBurstProps, type SparkOptions } from './ClickSpark';
export { StarBorder, type StarBorderProps } from './StarBorder';
export { GlareHover, type GlareHoverProps } from './GlareHover';
export { AnimatedContent, FadeContent, Rise, Stagger, type AnimatedContentProps, type FadeContentProps, type StaggerProps } from './AnimatedContent';
export { PixelSwap, type PixelSwapProps } from './PixelSwap';
export { PixelTransition, type PixelTransitionProps } from './PixelTransition';
export { Magnet, type MagnetProps } from './Magnet';
export { HarnessLoop, LogoLoop, type HarnessLoopProps, type LogoLoopProps, type LoopItem } from './LogoLoop';

export { EFFECTS, type EffectsSpec } from './spec';
export { inkOf, type HueProp } from './hue';
export { useEffectActive, useTouchObserver, type TouchHandlers } from './runtime';
export { entrancePlan, exitPlan, staggerTotalMs, type EntranceOptions, type EntrancePlan } from './entrance';
export { SWAP_PATTERNS, type SwapPattern } from './swap';
export { cometStage } from './comet';
