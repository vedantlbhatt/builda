/**
 * The island's motion language (docs/motion.md): one object that grows to say more.
 *
 *   spec.ts      the numbers (the only place a spring lives)
 *   springs.ts   those numbers as Reanimated configs
 *   useMorph     one spring drives a container's size, radius and both content layers
 *   Face         the builder's creature with the state machine: glow, eyes, breath, blink
 *   Wheel        the drum of steps, active row centred and shimmering
 *   Shimmer      a band of light across the one active line
 *   RippleItem   stagger in, leave together
 *   Words        a sentence a word at a time, for news only
 *   Wash         a state painted into the black from one edge
 *   Aura         the ring around what an agent is driving right now, one per screen
 */
export * from './spec';
export { SPRING, EXIT } from './springs';
export { useMorph, lerpBox, type Box } from './useMorph';
export { Face } from './Face';
export { Wheel, type WheelRow } from './Wheel';
export { Shimmer } from './Shimmer';
export { RippleItem } from './Ripple';
export { Words } from './Words';
export { Wash, type WashFrom } from './Wash';
export { Aura } from './Aura';
export { stateColor, withAlpha, EYES_FOR, type FaceState, type Eyes } from './states';
