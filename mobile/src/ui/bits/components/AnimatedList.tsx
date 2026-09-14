/**
 * AnimatedList: a list whose rows rise in once, staggered, on the first load; whose new rows
 * slide in at the top and push the rest down; whose rows highlight under a finger; and whose
 * scroll edges dissolve into the surface by pixels. The decisions feed, the Sessions list and
 * the Stack page's tool rows (DESIGN-V2 3.2 and 4.3, row 14).
 *
 * Ported from react-bits `Components/AnimatedList/AnimatedList.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port:
 * - Rows enter ONCE. react-bits re-animates a row from scale 0.7 every time it scrolls back
 *   into view (`useInView`, `once: false`); the skill forbids entrances on recycled rows and
 *   on refresh. Here the first load staggers (40ms apart, the eighth on as a block), rising
 *   12pt from 0.96 over 300ms on `EASE` with the opacity snapping in under 120ms; a new row
 *   above every row already shown slides in from above while the rest move down on the
 *   `SNAP` layout spring; nothing else ever enters (`planEntrances` in lists.ts).
 * - The press highlight is the kit's row rule: `raised` in 120ms, out at 0.7x, never a scale.
 *   `selectedKey` holds it, as react-bits' `selectedIndex` does. Arrow key navigation is gone.
 * - The edge "gradients" (a linear gradient to the page colour over 50 and 100px, faded by
 *   scroll) are dithered bands of the surface colour at 3pt cells, strengthened by the same
 *   50pt of scroll: a row at the edge breaks into cells rather than dimming, so a creature
 *   there is never its hue at half opacity (`EDGE_SKSL`). Gradients are banned here.
 * - Virtualised (Reanimated's FlatList) when it scrolls; `scroll={false}` lays the rows out in a
 *   plain view for a list that lives inside a screen's own ScrollView.
 *
 * Reduce Motion: rows fade in over 150ms without moving; inserts and moves jump; the edges and
 * the highlight stay (neither is motion).
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { haptics, type HapticKind } from '../../haptics';
import { EASE, exitMs, REDUCED_FADE, SNAP, T, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { SHAPE, type ShapeName } from '../../shape';
import type { SurfaceLevel } from '../../Surface';
import { EdgeDither } from './layers';
import { edgeStrengths, entranceAt, planEntrances, type Entrance } from './lists';
import { LIST } from './spec';

export interface AnimatedListItemInfo<T> {
  item: T;
  index: number;
  /** Held highlighted (`selectedKey`). */
  selected: boolean;
}

export interface AnimatedListProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: AnimatedListItemInfo<T>) => ReactNode;
  /** Makes each row pressable, with the `raised` highlight. */
  onItemPress?: (item: T, index: number) => void;
  onItemLongPress?: (item: T, index: number) => void;
  /** The row held highlighted. */
  selectedKey?: string | null;
  /** Fired with a row's press. Default none (a list row that pushes needs no haptic). */
  haptic?: HapticKind;
  /** Virtualised and scrolling (default), or laid out in place for a parent ScrollView. */
  scroll?: boolean;
  /** Dithered scroll edges. Default on when it scrolls. */
  edgeFades?: boolean;
  /** What the edges dissolve into: the list's own background. Default `bg`. */
  surface?: SurfaceLevel;
  /** Space between rows. Default 0 (rows with hairlines). */
  itemGap?: number;
  /** Round the highlight for rows that are tiles. Default square (edge to edge rows). */
  rowShape?: ShapeName;
  ListHeaderComponent?: FlatListProps<T>['ListHeaderComponent'];
  ListFooterComponent?: FlatListProps<T>['ListFooterComponent'];
  ListEmptyComponent?: FlatListProps<T>['ListEmptyComponent'];
  onEndReached?: FlatListProps<T>['onEndReached'];
  refreshControl?: FlatListProps<T>['refreshControl'];
  /** `automatic` when this list is the screen's root scroll under a native header. */
  contentInsetAdjustmentBehavior?: ScrollViewProps['contentInsetAdjustmentBehavior'];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/** The rows move to their new places on the kit's settle spring (Reanimated jumps under Reduce Motion). */
const MOVE = LinearTransition.springify(SNAP.duration).dampingRatio(SNAP.dampingRatio);

function riseFrom(delay: number, from: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const move = { duration: LIST.enterMs, easing: EASE };
    return {
      initialValues: { opacity: 0, transform: [{ translateY: from }, { scale: LIST.fromScale }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: LIST.fadeMs, easing: EASE })),
        transform: [{ translateY: withDelay(delay, withTiming(0, move)) }, { scale: withDelay(delay, withTiming(1, move)) }],
      },
    };
  };
}

function enteringFor(e: Entrance, reduce: boolean) {
  if (e.kind === 'none') return undefined;
  if (reduce) return FadeIn.duration(REDUCED_FADE).reduceMotion(ReduceMotion.Never);
  // First load rises from below; an insert comes down from above, into the room it pushes open.
  return riseFrom(e.delay, e.kind === 'insert' ? -LIST.risePt : LIST.risePt);
}

export function AnimatedList<T>({
  data,
  keyExtractor,
  renderItem,
  onItemPress,
  onItemLongPress,
  selectedKey = null,
  haptic,
  scroll = true,
  edgeFades = true,
  surface = 'bg',
  itemGap = 0,
  rowShape,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  onEndReached,
  refreshControl,
  contentInsetAdjustmentBehavior,
  contentContainerStyle,
  style,
}: AnimatedListProps<T>) {
  const c = useColors();
  const reduce = useReduceMotion();

  // Who enters is decided against the keys the last commit showed, never mid render.
  const keys = useMemo(() => data.map((item, i) => keyExtractor(item, i)), [data, keyExtractor]);
  const joined = JSON.stringify(keys);
  const shown = useRef<string[] | null>(null);
  const loadedAt = useRef<number | null>(null);
  const plan = useMemo(
    () => planEntrances(shown.current, keys),
    // `keys` is fresh every render; `joined` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joined],
  );
  useEffect(() => {
    if (keys.length === 0) return;
    if (loadedAt.current === null) loadedAt.current = Date.now();
    shown.current = keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  const entranceOf = useCallback(
    (key: string) => entranceAt(plan.get(key), loadedAt.current === null ? 0 : Date.now() - loadedAt.current),
    [plan],
  );

  const press = useCallback(
    (item: T, index: number) => {
      if (haptic) haptics[haptic]();
      onItemPress?.(item, index);
    },
    [haptic, onItemPress],
  );

  const row = (item: T, index: number, key: string) => (
    <ListRow
      key={key}
      entrance={entranceOf(key)}
      reduce={reduce}
      selected={selectedKey === key}
      highlight={c.raised}
      radius={rowShape ? SHAPE[rowShape] : 0}
      gap={index > 0 ? itemGap : 0}
      layout={scroll ? undefined : MOVE}
      onPress={onItemPress ? () => press(item, index) : undefined}
      onLongPress={onItemLongPress ? () => onItemLongPress(item, index) : undefined}
    >
      {renderItem({ item, index, selected: selectedKey === key })}
    </ListRow>
  );

  // ─── the edges ───
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  const topEdge = useSharedValue(0);
  const bottomEdge = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      contentH.value = e.contentSize.height;
      viewH.value = e.layoutMeasurement.height;
      const s = edgeStrengths(scrollY.value, contentH.value, viewH.value);
      // Written only when they change, so a still edge never redraws its canvas.
      if (s.top !== topEdge.value) topEdge.value = s.top;
      if (s.bottom !== bottomEdge.value) bottomEdge.value = s.bottom;
    },
  });
  const measure = useCallback(
    (content?: number, view?: number) => {
      if (content !== undefined) contentH.value = content;
      if (view !== undefined) viewH.value = view;
      const s = edgeStrengths(scrollY.value, contentH.value, viewH.value);
      topEdge.value = s.top;
      bottomEdge.value = s.bottom;
    },
    [contentH, viewH, scrollY, topEdge, bottomEdge],
  );

  if (!scroll) {
    return (
      <View style={style}>
        {ListHeaderComponent ? renderSlot(ListHeaderComponent) : null}
        {data.length === 0 && ListEmptyComponent ? renderSlot(ListEmptyComponent) : null}
        {data.map((item, i) => row(item, i, keys[i]!))}
        {ListFooterComponent ? renderSlot(ListFooterComponent) : null}
      </View>
    );
  }

  const edges = edgeFades && box.w > 0;
  return (
    <View
      style={[{ flex: 1 }, style]}
      onLayout={(e) => {
        onLayout(e);
        measure(undefined, e.nativeEvent.layout.height);
      }}
    >
      <Animated.FlatList
        data={data as T[]}
        keyExtractor={(item: T, i: number) => keyExtractor(item, i)}
        renderItem={({ item, index }: ListRenderItemInfo<T>) => row(item, index, keys[index] ?? keyExtractor(item, index))}
        itemLayoutAnimation={MOVE}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_w: number, h: number) => measure(h, undefined)}
        contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        onEndReached={onEndReached}
        refreshControl={refreshControl}
        contentContainerStyle={contentContainerStyle}
      />
      {edges ? (
        <>
          <EdgeDither width={box.w} height={LIST.edgeTop} color={c[surface]} strength={topEdge} fromBottom={false} />
          <EdgeDither
            width={box.w}
            height={LIST.edgeBottom}
            color={c[surface]}
            strength={bottomEdge}
            fromBottom
            style={{ top: box.h - LIST.edgeBottom }}
          />
        </>
      ) : null}
    </View>
  );
}

function renderSlot(slot: React.ComponentType | React.ReactElement | null | undefined): ReactNode {
  if (!slot) return null;
  if (React.isValidElement(slot)) return slot;
  const C = slot as React.ComponentType;
  return <C />;
}

const ListRow = memo(function ListRow({
  entrance,
  reduce,
  selected,
  highlight,
  radius,
  gap,
  layout,
  onPress,
  onLongPress,
  children,
}: {
  entrance: Entrance;
  reduce: boolean;
  selected: boolean;
  highlight: string;
  radius: number;
  gap: number;
  layout?: typeof MOVE;
  onPress?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  // Read once, at mount: a row that re-renders never enters again.
  const [entering] = useState(() => enteringFor(entrance, reduce));
  const hl = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    hl.value = withTiming(selected ? 1 : 0, { duration: selected ? T.press : exitMs(T.press), easing: EASE });
  }, [selected, hl]);
  const lift = useAnimatedStyle(() => ({ opacity: hl.value }));

  const body = (
    <>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: highlight, borderRadius: radius, borderCurve: 'continuous' }, lift]}
      />
      {children}
    </>
  );

  return (
    <Animated.View entering={entering} layout={layout} style={gap > 0 ? { marginTop: gap } : undefined}>
      {onPress || onLongPress ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          onPressIn={() => {
            hl.value = withTiming(1, { duration: T.press, easing: EASE });
          }}
          onPressOut={() => {
            hl.value = withTiming(selected ? 1 : 0, { duration: exitMs(T.press), easing: EASE });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected }}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Animated.View>
  );
});
