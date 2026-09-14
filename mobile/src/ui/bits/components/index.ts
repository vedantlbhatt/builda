/**
 * The react-bits components, ported to React Native with Gesture Handler, Reanimated and Skia
 * (DESIGN-V2-COLOUR-MOTION 4.3). Every one carries David Haz's notice (react-bits, MIT +
 * Commons Clause, used as part of this application only) and says what changed in its port.
 *
 *   CardSwap       three faces fanned; one swap when it comes into view, then rest
 *   Stack          a pile; the top card follows the finger, leans, and a throw tucks it under
 *   BounceCards    a hand that fans open with a bounce and spreads around the finger
 *   AnimatedList   rows that enter once, inserts that push, a row highlight, dithered edges
 *   TiltedCard     leans toward the finger on a spring, with an optional stepped glare
 *   SpotlightCard  a pool of pixels in the card's hue under the finger
 *   PixelCard      the selected fill grows out of the finger in square cells
 *   MagicBento     a bento of tiles sharing one light, the tile under the finger leaning
 *   ProfileCard    "this is you": creature on a slow field in its hue, name, archetype
 *   Stepper        onboarding's bars, or react-bits' circles with a drawn check
 *   Carousel       slides turned away on a dragged track, dots under it
 *
 * The pure rules behind them (`geometry`, `fills`, `lists`, `spec`) import no React Native, so
 * `__tests__/bitsComponents.test.ts` holds them. The demo page is NOT exported here (Metro does
 * not tree shake): import it from './ComponentsGallery' directly.
 */
export { AnimatedList, type AnimatedListItemInfo, type AnimatedListProps } from './AnimatedList';
export { BounceCards, type BounceCardsProps } from './BounceCards';
export { CardSwap, MAX_FACES, type CardSwapHandle, type CardSwapProps } from './CardSwap';
export { Carousel, type CarouselHandle, type CarouselProps, type CarouselSlideState } from './Carousel';
export { MagicBento, type BentoItem, type MagicBentoProps } from './MagicBento';
export { PixelCard, type PixelCardFace, type PixelCardProps } from './PixelCard';
export { ProfileCard, type ProfileCardProps } from './ProfileCard';
export { SpotlightCard, type SpotlightCardProps } from './SpotlightCard';
export { Stack, type StackCardState, type StackHandle, type StackProps } from './Stack';
export { Stepper, type StepperProps } from './Stepper';
export { TiltedCard, type TiltedCardProps } from './TiltedCard';

export { EdgeDither, HueField, PixelFillLayer, SpotlightLayer, useAmbientClock } from './layers';
export { AMBIENT, BENTO, BOUNCE, CARD_SWAP, CAROUSEL, LIST, PIXEL, PROFILE, SPOT, STACK, STEPPER, TILT } from './spec';
