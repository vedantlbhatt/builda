/**
 * The Wrapped story view: the fifteen cards as a fanned stack of four, the front card thrown
 * aside to reach the next (DESIGN-DIRECTION 6, "Story view and the stack").
 *
 * The motion is Appllama's animated-card-stack (MIT; the notice and every number are in
 * `deck.ts`), with the two changes the design asks for: the front card follows the finger,
 * and a release is handed to the `SHEET` spring with the finger's velocity. The drag the
 * card follows is react-bits Stack's idea (David Haz, MIT + Commons Clause; the notice is in
 * `src/ui/digits.ts`); none of its code or its numbers are used here. A throw commits
 * by `throwOf` (24pt mostly sideways, or 800pt/s); a tap on the right of the stack advances,
 * a tap on its left third goes back (the reverse of the same path), and VoiceOver's
 * increment and decrement do both. One `selectionAsync` per advance, on the frame it starts.
 *
 * Four views, one per slot, are always mounted; a card keeps its slot, so the card that
 * leaves the front is recycled as the card four behind it, swapping its content while it is
 * behind the stack (at the z swap), which is also when the stack's order changes. Every
 * transform is a shared value on the UI thread; React only owns which card is in which view
 * and their order.
 *
 * Reduce Motion: no finger follow and no flight; an advance swaps the front card and fades
 * it in over 150ms.
 *
 * The front card's own views take touches (`box-none` on its slot), so the card can wear
 * react-bits TiltedCard (it leans toward the finger) and GlareHover (a sheen crosses it on
 * press): both only WATCH a touch, never take it, so the stack's pan and tap still decide. Every
 * advance reports where the finger was (`onAdvance`), for the ClickSpark and the art's ripple.
 */
import React, { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { floatShadow } from '../theme';
import { REDUCED_TIMING, SHEET, SNAP, select, SHAPE, useReduceMotion } from '../ui';
import {
  BACK_CONTENT_OPACITY,
  EXIT_SIDE,
  RUBBER_BAND,
  SLOTS,
  TRANSITION_MS,
  Z_SWAP_PROGRESS,
  cardInSlot,
  depthOf,
  dragPose,
  incomingContentOpacity,
  incomingPose,
  outgoingContentOpacity,
  outgoingPose,
  progressAtDistance,
  progressVelocity,
  releasedOutgoingPose,
  restPose,
  slotOf,
  throwOf,
  type Pose,
  type SlotIndex,
} from './deck';

/** A tap on this share of the stack's width, from the left, goes back (the Stories rule). */
export const BACK_TAP_SHARE = 0.3;
/** How far the next card lifts toward the front while the front one is dragged a full width. */
const NEXT_LIFT = 0.15;

export interface SlotRender {
  /** This view is the front card. */
  front: boolean;
  /** The content layer's style: hidden behind the front, brightening as it comes forward. */
  contentStyle: StyleProp<ViewStyle>;
}

export interface StoryStackProps {
  count: number;
  /** The card on top when the stack mounts. */
  initial: number;
  /** The box the stack lays out in; cards are centred in it and may fan past its edges. */
  boxWidth: number;
  boxHeight: number;
  /** One card's size. */
  width: number;
  height: number;
  /** A new card reached the front (at the z swap, not when the motion settles). */
  onFrontChange: (index: number) => void;
  renderCard: (index: number, slot: SlotRender) => ReactNode;
  /** What VoiceOver reads for the front card. */
  labelFor: (index: number) => string;
  /** A finger moved the deck on, at (`x`, `y`) in the stack's box. Not under VoiceOver or Reduce Motion. */
  onAdvance?: (x: number, y: number) => void;
}

interface Shared {
  mode: SharedValue<number>;
  p: SharedValue<number>;
  outSlot: SharedValue<number>;
  inSlot: SharedValue<number>;
  side: SharedValue<number>;
  from: SharedValue<number>;
  dragged: SharedValue<number>;
  release: SharedValue<Pose>;
  recycles: SharedValue<number>;
  frontSlot: SharedValue<number>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  fade: SharedValue<number>;
}

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function StoryStack({ count, initial, boxWidth, boxHeight, width, height, onFrontChange, renderCard, labelFor, onAdvance }: StoryStackProps) {
  const reduce = useReduceMotion();
  const start = Math.max(0, Math.min(count - 1, initial));

  // React owns the content and the order; the shared values own every pixel of motion.
  const [front, setFront] = useState(start);
  const [override, setOverride] = useState<{ slot: SlotIndex; card: number } | null>(null);
  const frontRef = useRef(start);

  const mode = useSharedValue(0);
  const p = useSharedValue(0);
  const outSlot = useSharedValue(-1);
  const inSlot = useSharedValue(-1);
  const side = useSharedValue(1);
  const from = useSharedValue(0);
  const dragged = useSharedValue(0);
  const release = useSharedValue<Pose>({ x: 0, y: 0, scale: 1, rotation: 0 });
  const recycles = useSharedValue(1);
  const frontSlot = useSharedValue<number>(slotOf(start));
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const fade = useSharedValue(1);
  // One stable object: shared values never change identity, and a gesture rebuilt on every
  // render would be handed to the detector while a finger is down.
  const s = useMemo<Shared>(
    () => ({ mode, p, outSlot, inSlot, side, from, dragged, release, recycles, frontSlot, dx, dy, fade }),
    [mode, p, outSlot, inSlot, side, from, dragged, release, recycles, frontSlot, dx, dy, fade],
  );
  const frontIdx = useSharedValue(start);
  const tracking = useSharedValue(0);

  const onFrontRef = useRef(onFrontChange);
  onFrontRef.current = onFrontChange;
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;
  const advanced = useCallback((x: number, y: number) => onAdvanceRef.current?.(x, y), []);

  const swapped = useCallback((index: number) => {
    frontRef.current = index;
    setFront(index);
    setOverride(null);
    onFrontRef.current(index);
  }, []);

  const backStarted = useCallback((card: number, slot: number) => {
    setOverride({ slot: slot as SlotIndex, card });
  }, []);

  // Under Reduce Motion an advance is a swap and a fade, run from JS.
  const reducedStep = useCallback(
    (by: number) => {
      const next = frontRef.current + by;
      if (next < 0 || next >= count) return;
      frontIdx.value = next;
      s.frontSlot.value = slotOf(next);
      s.fade.value = 0;
      s.fade.value = withTiming(1, REDUCED_TIMING);
      select();
      swapped(next);
    },
    [count, frontIdx, s.frontSlot, s.fade, swapped],
  );

  // The z swap: the outgoing card passes behind, a new card is in front. Content and order
  // follow on the JS thread; the front slot moves here, on the frame it happens.
  useAnimatedReaction(
    () => {
      const m = s.mode.value;
      if (m === 0) return 0;
      const swap = Z_SWAP_PROGRESS[s.outSlot.value as SlotIndex] ?? Z_SWAP_PROGRESS[0];
      return (m === 1 ? s.p.value >= swap : s.p.value <= swap) ? m : 0;
    },
    (now, prev) => {
      if (now === 0 || now === prev) return;
      if (now === 1) {
        s.frontSlot.value = s.inSlot.value;
        frontIdx.value = frontIdx.value + 1;
      } else {
        s.frontSlot.value = s.outSlot.value;
        frontIdx.value = frontIdx.value - 1;
      }
      runOnJS(swapped)(frontIdx.value);
    },
  );

  const settle = useCallback(() => {
    'worklet';
    s.mode.value = 0;
    s.p.value = 0;
    s.dragged.value = 0;
    s.dx.value = 0;
    s.dy.value = 0;
  }, [s.mode, s.p, s.dragged, s.dx, s.dy]);

  const forward = useCallback(
    (thrown: number, velocity: number): boolean => {
      'worklet';
      if (s.mode.value !== 0 || frontIdx.value >= count - 1) return false;
      const slot = s.frontSlot.value as SlotIndex;
      const exit = thrown === 0 ? EXIT_SIDE[slot] : thrown;
      const fromDrag = thrown !== 0;
      const pose = dragPose(s.dx.value, s.dy.value, width);
      const startAt = fromDrag && Math.sign(s.dx.value) === exit ? progressAtDistance(slot, exit, s.dx.value, width) : 0;
      s.release.value = pose;
      s.outSlot.value = slot;
      s.inSlot.value = (slot + 1) % SLOTS;
      s.side.value = exit;
      s.from.value = startAt;
      s.dragged.value = fromDrag ? 1 : 0;
      s.recycles.value = frontIdx.value + SLOTS < count ? 1 : 0;
      s.p.value = startAt;
      s.mode.value = 1;
      s.p.value = fromDrag
        ? withSpring(1, { ...SHEET, velocity: progressVelocity(slot, exit, startAt, velocity, width) }, (done) => {
            if (done) settle();
          })
        : withTiming(1, { duration: TRANSITION_MS, easing: Easing.linear }, (done) => {
            if (done) settle();
          });
      runOnJS(select)();
      return true;
    },
    [count, frontIdx, s, settle, width],
  );

  const back = useCallback(() => {
    'worklet';
    if (s.mode.value !== 0 || frontIdx.value <= 0) return;
    const slot = s.frontSlot.value as SlotIndex;
    const returning = ((slot + SLOTS - 1) % SLOTS) as SlotIndex;
    s.outSlot.value = returning;
    s.inSlot.value = slot;
    s.side.value = EXIT_SIDE[returning];
    s.from.value = 0;
    s.dragged.value = 0;
    s.recycles.value = 1;
    s.p.value = 1;
    s.mode.value = -1;
    runOnJS(backStarted)(frontIdx.value - 1, returning);
    s.p.value = withTiming(0, { duration: TRANSITION_MS, easing: Easing.linear }, (done) => {
      if (done) settle();
    });
    runOnJS(select)();
  }, [backStarted, frontIdx, s, settle]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-24, 24])
      .onStart(() => {
        // Mid transition the stack is not grabbable; a finger lands on the next rest.
        tracking.value = s.mode.value === 0 ? 1 : 0;
      })
      .onUpdate((e) => {
        if (tracking.value !== 1 || reduce) return;
        const last = frontIdx.value >= count - 1;
        s.dx.value = last ? e.translationX * RUBBER_BAND : e.translationX;
        s.dy.value = e.translationY;
      })
      .onEnd((e) => {
        if (tracking.value !== 1) return;
        tracking.value = 0;
        const thrown = throwOf({ dx: e.translationX, dy: e.translationY, vx: e.velocityX, vy: e.velocityY });
        if (thrown !== 0 && frontIdx.value < count - 1) {
          if (reduce) runOnJS(reducedStep)(1);
          else if (forward(thrown, e.velocityX)) runOnJS(advanced)(e.x, e.y);
          return;
        }
        s.dx.value = withSpring(0, { ...SNAP, velocity: e.velocityX });
        s.dy.value = withSpring(0, { ...SNAP, velocity: e.velocityY });
      });
    const tap = Gesture.Tap()
      .maxDuration(260)
      .onEnd((e, ok) => {
        if (!ok) return;
        const goBack = e.x < boxWidth * BACK_TAP_SHARE;
        if (reduce) runOnJS(reducedStep)(goBack ? -1 : 1);
        else if (goBack) back();
        else if (forward(0, 0)) runOnJS(advanced)(e.x, e.y);
      });
    return Gesture.Race(pan, tap);
  }, [advanced, back, boxWidth, count, forward, frontIdx, reduce, reducedStep, s.dx, s.dy, s.mode, tracking]);

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') {
        if (reduce) reducedStep(1);
        else runOnUI(forward)(0, 0);
      }
      if (e.nativeEvent.actionName === 'decrement') {
        if (reduce) reducedStep(-1);
        else runOnUI(back)();
      }
    },
    [back, forward, reduce, reducedStep],
  );

  const left = (boxWidth - width) / 2;
  const top = (boxHeight - height) / 2;
  const slots: SlotIndex[] = [0, 1, 2, 3];

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ width: boxWidth, height: boxHeight, overflow: 'visible' }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={labelFor(front)}
        accessibilityValue={{ text: `${front + 1} of ${count}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        {slots.map((slot) => {
          const card = override && override.slot === slot ? override.card : cardInSlot(slot, front, count);
          const depth = depthOf(slot, front);
          return (
            <Slot
              key={slot}
              slot={slot}
              shared={s}
              width={width}
              height={height}
              left={left}
              top={top}
              depth={depth}
              render={(contentStyle) => (card === null ? null : renderCard(card, { front: depth === 0, contentStyle }))}
              cardKey={card}
            />
          );
        })}
      </View>
    </GestureDetector>
  );
}

function Slot({
  slot,
  shared: s,
  width,
  height,
  left,
  top,
  depth,
  render,
  cardKey,
}: {
  slot: SlotIndex;
  shared: Shared;
  width: number;
  height: number;
  left: number;
  top: number;
  depth: number;
  render: (contentStyle: StyleProp<ViewStyle>) => ReactNode;
  cardKey: number | null;
}) {
  const place = useAnimatedStyle(() => {
    const m = s.mode.value;
    let pose: Pose;
    let opacity = 1;
    if (m !== 0 && slot === s.outSlot.value) {
      pose =
        m === 1 && s.dragged.value === 1
          ? releasedOutgoingPose(slot, s.p.value, s.side.value, width, s.release.value, s.from.value)
          : outgoingPose(slot, s.p.value, s.side.value, width);
      const swap = Z_SWAP_PROGRESS[slot];
      // A card with nothing four behind it leaves for good: gone by the time it would tuck.
      if (m === 1 && s.recycles.value === 0) opacity = 1 - clamp01((s.p.value - 0.3) / (swap - 0.3));
      // Going back, the returning card emerges from behind the stack.
      if (m === -1) opacity = clamp01((1 - s.p.value) / 0.25);
    } else if (m !== 0 && slot === s.inSlot.value) {
      pose = incomingPose(slot, s.p.value, width);
    } else if (slot === s.frontSlot.value) {
      pose = dragPose(s.dx.value, s.dy.value, width);
      opacity = s.fade.value;
    } else {
      pose = restPose(slot, width);
      if (m === 0 && slot === (s.frontSlot.value + 1) % SLOTS) {
        // The next card rises a little under a drag, so the throw has somewhere to go.
        const k = Math.min(1, Math.abs(s.dx.value) / Math.max(1, width)) * NEXT_LIFT;
        pose = { x: pose.x * (1 - k), y: pose.y * (1 - k), scale: pose.scale + (1 - pose.scale) * k, rotation: pose.rotation * (1 - k) };
      }
    }
    return {
      opacity,
      transform: [{ translateX: pose.x }, { translateY: pose.y }, { rotate: `${pose.rotation}deg` }, { scale: pose.scale }],
    };
  });

  const content = useAnimatedStyle(() => {
    const m = s.mode.value;
    let o = BACK_CONTENT_OPACITY;
    if (m !== 0 && slot === s.outSlot.value) {
      const swap = Z_SWAP_PROGRESS[slot];
      o = m === 1 ? outgoingContentOpacity(s.p.value, swap) : 1 - (1 - BACK_CONTENT_OPACITY) * clamp01(s.p.value / swap);
    } else if (m !== 0 && slot === s.inSlot.value) {
      o = incomingContentOpacity(s.p.value);
    } else if (slot === s.frontSlot.value) {
      o = 1;
    }
    return { opacity: o };
  });

  return (
    <Animated.View
      // The front card's own views watch the finger (TiltedCard, GlareHover); the rest never do.
      pointerEvents={depth === 0 ? 'box-none' : 'none'}
      style={[
        {
          position: 'absolute',
          left,
          top,
          width,
          height,
          zIndex: SLOTS - depth,
          borderRadius: SHAPE.wrapped,
          borderCurve: 'continuous',
        },
        // The one shadow, on the card a finger moves (DESIGN-DIRECTION 3.4).
        depth === 0 ? { boxShadow: floatShadow } : null,
        place,
      ]}
    >
      <React.Fragment key={cardKey === null ? 'none' : String(cardKey)}>{render(content)}</React.Fragment>
    </Animated.View>
  );
}
