/**
 * When each part of the page plays: the first time it scrolls into view, once per mount.
 *
 * The page is one scroll view. `RevealPage` keeps the scroll offset and the viewport height in
 * shared values; each `Section` records where it sits in the content; each `Block` inside a
 * section records where it sits in the section. A block's clock (`useClock`) starts the first
 * frame its top edge is `TRIGGER` points above the bottom of the screen, and runs linearly to
 * `SECTION_CLOCK_MS` on the UI thread. Every number and mark in the block reads that clock, so
 * a chart at the bottom of a tall section draws when IT arrives, not when its heading did, and
 * the top of the page plays on open because it is already in view.
 *
 * Reduce Motion: the clock jumps to its end the moment the block arrives and the block fades in
 * over 150 ms, so everything appears at rest, once, and nothing moves.
 *
 * Blocks must be direct children of a `Section`, and sections direct children of the scroll
 * content: each position is read from `onLayout`, which is relative to the parent.
 */
import { modeOf, motionFor, PIXEL_MOTIONS, takeOrder, type PixelMotion } from '../motion/pixelMotion';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ease, ENTER_MS, REDUCED_FADE_MS, RISE, SECTION_CLOCK_MS } from './motion';

/** How far above the bottom edge a block's top has to come before it plays. */
export const TRIGGER = 56;
/** How long a block waits after it arrives before its clock starts. */
export const START_HOLD_MS = 90;

interface Page {
  scrollY: SharedValue<number>;
  viewport: SharedValue<number>;
  reduced: SharedValue<number>;
  /**
   * 0 until the screen has finished arriving (the push has landed and the first sections are
   * mounted), then 1. Nothing plays before it, so a count up never runs under a transition or
   * through the frames a heavy mount holds the UI thread for, and lands before anyone saw it.
   */
  armed: SharedValue<number>;
  /**
   * How many numbers on this page have counted up (docs/motion.md, "The pixels stay"): a number
   * moves ONCE per screen, the first one to play, which is the screen's headline; every other
   * figure is set still and fades in with its block. Fifty numbers each counting from zero as you
   * scroll was the "numbers all look the same" the owner named.
   */
  counted: SharedValue<number>;
}

const PageCtx = createContext<Page | null>(null);

/** The page's count of numbers that have counted up, or null outside a page. */
export function usePageCounted(): SharedValue<number> | null {
  return useContext(PageCtx)?.counted ?? null;
}
const SectionCtx = createContext<SharedValue<number> | null>(null);
const ClockCtx = createContext<SharedValue<number> | null>(null);
const LandedCtx = createContext(false);

/** The scroll offset and viewport the whole page reveals against. */
export function usePageReveal(reduced: boolean): Page {
  const scrollY = useSharedValue(0);
  const viewport = useSharedValue(0);
  const reducedSV = useSharedValue(reduced ? 1 : 0);
  const armed = useSharedValue(0);
  const counted = useSharedValue(0);
  useEffect(() => {
    reducedSV.value = reduced ? 1 : 0;
  }, [reduced, reducedSV]);
  return useMemo(() => ({ scrollY, viewport, reduced: reducedSV, armed, counted }), [scrollY, viewport, reducedSV, armed, counted]);
}

/**
 * The pixel orders already taken on this page (`motion/pixelMotion.ts`): a band starts from its
 * own name's order and moves on to the next free one, so two chapters of one page never print the
 * same way (Build and Shipping both hashed to `rise`). Filled in render order, which is the page's
 * reading order, once per band per mount.
 */
const OrdersCtx = createContext<Set<number> | null>(null);

export function RevealPage({ page, children }: { page: Page; children: ReactNode }) {
  const taken = useRef<Set<number>>(new Set()).current;
  return (
    <PageCtx.Provider value={page}>
      <OrdersCtx.Provider value={taken}>{children}</OrdersCtx.Provider>
    </PageCtx.Provider>
  );
}

/** This band's order on its page: its own from its name, or the next one nobody here has used. */
export function usePageOrder(own: number, count: number): number {
  const taken = useContext(OrdersCtx);
  const got = useRef<number | null>(null);
  if (got.current === null) got.current = taken ? takeOrder(taken, own, count) : own;
  return got.current;
}

/** A drawn field's order on its page (a grid of cells, not a band): from its name, distinct here. */
export function useFieldMotion(key: string): PixelMotion {
  return PIXEL_MOTIONS[usePageOrder(modeOf(motionFor(key)), PIXEL_MOTIONS.length)]!;
}

/** A chapter of the page. Its children that play are `Block`s. */
export function Section({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const top = useSharedValue(Number.POSITIVE_INFINITY);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      top.value = e.nativeEvent.layout.y;
    },
    [top],
  );
  return (
    <SectionCtx.Provider value={top}>
      <Animated.View onLayout={onLayout} style={style}>
        {children}
      </Animated.View>
    </SectionCtx.Provider>
  );
}

export interface BlockProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Fade and rise in as it plays (default). A band that draws its own entrance says false. */
  enter?: boolean;
  /** Delay the fade, in ms, so a band's pixels land before its words. */
  enterDelay?: number;
}

/**
 * One unit that plays when it arrives: its children read its clock through `useClock`. Fades
 * and rises `RISE` points over `ENTER_MS` as it starts (react-bits AnimatedContent, below).
 *
 * The entrance is a port of react-bits `Animations/AnimatedContent/AnimatedContent.tsx` by
 * David Haz, MIT + Commons Clause (Copyright (c) 2026 David Haz; the notice is in
 * `src/ui/digits.ts`; used as part of this application, not redistributed). Changes: a scroll
 * position read on the UI thread instead of GSAP's ScrollTrigger, the page's curve instead of
 * power3, a 10 point rise instead of 100, and once per mount, never on the way back out.
 */
export function Block({ children, style, enter = true, enterDelay = 0 }: BlockProps) {
  const page = useContext(PageCtx);
  const sectionTop = useContext(SectionCtx);
  if (!page || !sectionTop) throw new Error('Block needs a RevealPage and a Section around it');

  const localY = useSharedValue(Number.POSITIVE_INFINITY);
  const clock = useSharedValue(0);
  const shown = useSharedValue(0);
  const started = useSharedValue(0);

  // The resting state must never depend on an animation finishing: a timing cancelled under it
  // (a reload while it runs, the app sent to the background mid count) would leave a number
  // frozen half way. Once a block has started, it is put at rest by this time whatever happened.
  //
  // The same timer flips `landed`, a React value its marks read through `useLanded` and draw
  // their resting shape from, with no shared value in between. FOUND IN THE CAPTURE (2026-09-14,
  // 21-analysis-17 and -29): under a saturated render server two slopes kept the frame drawn
  // about 860 ms into their clock, where the strong ease out has the line looking whole and the
  // end dot has not begun, and nothing ever asked the canvas to draw again. A static prop change
  // is a new render, so the picture at rest cannot depend on the last animated frame arriving.
  const landing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [landed, setLanded] = useState(false);
  const land = useCallback(() => {
    if (landing.current) return;
    landing.current = setTimeout(() => {
      if (clock.value < SECTION_CLOCK_MS) clock.value = SECTION_CLOCK_MS;
      if (shown.value < 1) shown.value = 1;
      setLanded(true);
    }, START_HOLD_MS + SECTION_CLOCK_MS + 400);
  }, [clock, shown]);
  useEffect(
    () => () => {
      if (landing.current) clearTimeout(landing.current);
    },
    [],
  );

  useAnimatedReaction(
    () => {
      const top = sectionTop.value + localY.value;
      if (!page.armed.value || !Number.isFinite(top) || page.viewport.value <= 0) return 0;
      return page.scrollY.value + page.viewport.value - TRIGGER > top ? 1 : 0;
    },
    (visible) => {
      if (!visible || started.value) return;
      started.value = 1;
      runOnJS(land)();
      if (page.reduced.value) {
        clock.value = SECTION_CLOCK_MS;
        shown.value = withTiming(1, { duration: REDUCED_FADE_MS });
        return;
      }
      // A short hold before the clock starts: the frames right after a block lays out are the
      // ones a mount can stall, and a clock that ran through them would skip its own start.
      clock.value = withDelay(START_HOLD_MS, withTiming(SECTION_CLOCK_MS, { duration: SECTION_CLOCK_MS, easing: Easing.linear }));
      shown.value = withDelay(START_HOLD_MS + enterDelay, withTiming(1, { duration: ENTER_MS, easing: Easing.linear }));
    },
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      localY.value = e.nativeEvent.layout.y;
    },
    [localY],
  );

  const animated = useAnimatedStyle(() => {
    if (!enter) return { opacity: page.reduced.value ? shown.value : 1 };
    if (page.reduced.value) return { opacity: shown.value, transform: [{ translateY: 0 }] };
    // Colour enters by position, not by opacity (DESIGN-V2 1.3: a hue half faded over the warm
    // ground is a brown frame): the block snaps in over the first third of its entrance and
    // spends the rest rising into place.
    return {
      opacity: Math.min(1, shown.value * 3),
      transform: [{ translateY: (1 - ease(shown.value)) * RISE }],
    };
  });

  return (
    <ClockCtx.Provider value={clock}>
      <LandedCtx.Provider value={landed}>
        <Animated.View onLayout={onLayout} style={[animated, style]}>
          {children}
        </Animated.View>
      </LandedCtx.Provider>
    </ClockCtx.Provider>
  );
}

/**
 * True once the block this sits in has come to rest (its clock is at the end, whatever happened
 * to the animation). A mark drawn from the clock draws its resting shape from props when this is
 * true, so the last frame is a render, not a frame the render server may have dropped. False
 * outside a `Block`.
 */
export function useLanded(): boolean {
  return useContext(LandedCtx);
}

/** The clock of the block this sits in: 0 until it plays, then up to `SECTION_CLOCK_MS`. */
export function useClock(): SharedValue<number> {
  const clock = useContext(ClockCtx);
  if (!clock) throw new Error('useClock needs a Block around it');
  return clock;
}

/** The block's clock, or null outside one: for a printed surface drawn still (a share card). */
export function useOptionalClock(): SharedValue<number> | null {
  return useContext(ClockCtx);
}

/** Whether the page is under Reduce Motion, as a shared value (1 or 0). */
export function useReducedSV(): SharedValue<number> {
  const page = useContext(PageCtx);
  if (!page) throw new Error('useReducedSV needs a RevealPage around it');
  return page.reduced;
}

/** The page's Reduce Motion flag, or null outside a page (a share card). */
export function useOptionalReducedSV(): SharedValue<number> | null {
  return useContext(PageCtx)?.reduced ?? null;
}
