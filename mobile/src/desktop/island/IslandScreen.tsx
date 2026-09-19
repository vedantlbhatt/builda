/**
 * The desktop island: one black object at the top of the screen that grows to say more
 * (docs/motion.md). It is the page the desktop shell's island window loads (`/island`), on a
 * transparent, always-on-top, click-through window; `model.ts` decides what it says and how big
 * it is, this file only moves it.
 *
 * THE MOTION IS THE KIT'S. One progress value per morph on the ISLAND spring (damping 17,
 * stiffness 210): width and height ride it past their targets and back, the radius rides it
 * clamped so the corners never wobble. The content lags its container: the outgoing layer is gone
 * by 0.28 and scales UP as it leaves, the incoming one arrives from 0.34, rising 5 points out of
 * 0.92. Nothing slides in. Hover opens it; leaving folds it after a beat (`LEAVE_GRACE_MS`).
 *
 * The window is bigger than the pill and ignores the mouse everywhere but the pill: the frame
 * reports the pill's box (`bridge.island.setFrame`) and the shell lets clicks through the rest.
 */
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { roleStyle } from '../../ui/typeStyle';
import { desktopBridge } from '../bridge';
import { Face } from './Face';
import {
  boxFor,
  crewLeadOf,
  dropSteps,
  expandedHeight,
  hrefOf,
  isSampleKind,
  spoken,
  type Activity,
  type IslandBox,
  type Mode,
  type Notch,
} from './model';
import { CONTENT_IN, CONTENT_OUT, IN_RISE, IN_SCALE, ISLAND, LEAVE_GRACE_MS, OUT_SCALE, phase, springConfig } from './motion';
import { ADD, AMBER, DIM, FAINT, INK, ISLAND_BLACK, stateInk, withAlpha } from './palette';
import { useIsland } from './useIsland';
import { Wheel } from './Wheel';
import { Words } from './Words';

function parseNotch(nw?: string, nh?: string): Notch | null {
  const w = Number(nw);
  const h = Number(nh);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

/** A layer of content: what one activity says at one size. Keyed so a change is a new layer. */
interface Layer {
  key: string;
  activity: Activity;
  mode: Mode;
}

export function IslandScreen() {
  const params = useLocalSearchParams<{ sample?: string; nw?: string; nh?: string; expand?: string }>();
  const notch = useMemo(() => parseNotch(params.nw, params.nh), [params.nw, params.nh]);
  const sample = isSampleKind(params.sample) ? params.sample : null;
  const pinned = params.expand === '1';
  const { activity } = useIsland(sample);
  const { width: winW } = useWindowDimensions();

  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIn = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(true);
  }, []);
  const onOut = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), LEAVE_GRACE_MS);
  }, []);

  const mode: Mode = !activity ? 'hidden' : hovered || pinned ? 'expanded' : 'compact';
  const target = boxFor(mode, notch, expandedHeight(activity, notch));

  // ---- the box: one progress value, from the box it was to the box it is going to
  const p = useSharedValue(1);
  const fromW = useSharedValue(target.w);
  const fromH = useSharedValue(target.h);
  const fromR = useSharedValue(target.r);
  const toW = useSharedValue(target.w);
  const toH = useSharedValue(target.h);
  const toR = useSharedValue(target.r);
  const last = useRef<IslandBox>(target);

  useEffect(() => {
    const was = last.current;
    if (was.w === target.w && was.h === target.h && was.r === target.r) return;
    last.current = target;
    // Start from wherever the box is NOW, mid-flight included, so an interrupted morph bends.
    const k = p.value;
    fromW.value = fromW.value + (toW.value - fromW.value) * k;
    fromH.value = fromH.value + (toH.value - fromH.value) * k;
    fromR.value = fromR.value + (toR.value - fromR.value) * Math.min(1, Math.max(0, k));
    toW.value = target.w;
    toH.value = target.h;
    toR.value = target.r;
    p.value = 0;
    p.value = withSpring(1, springConfig(ISLAND));
  }, [target.w, target.h, target.r, p, fromW, fromH, fromR, toW, toH, toR, target]);

  const boxStyle = useAnimatedStyle(() => {
    const k = p.value;
    const w = Math.max(0, fromW.value + (toW.value - fromW.value) * k);
    const h = Math.max(0, fromH.value + (toH.value - fromH.value) * k);
    const r = fromR.value + (toR.value - fromR.value) * Math.min(1, Math.max(0, k));
    return { width: w, height: h, borderBottomLeftRadius: r, borderBottomRightRadius: r, borderTopLeftRadius: notch ? 0 : r, borderTopRightRadius: notch ? 0 : r };
  });

  // ---- the content: the layer on screen and the one leaving
  const [layers, setLayers] = useState<{ current: Layer | null; leaving: Layer | null }>({ current: null, leaving: null });
  useEffect(() => {
    const key = activity ? `${activity.id}|${mode}` : 'none';
    setLayers((l) => {
      if ((l.current?.key ?? 'none') === key) return activity && l.current ? { ...l, current: { ...l.current, activity } } : l;
      return { leaving: l.current, current: activity ? { key, activity, mode } : null };
    });
  }, [activity, mode]);
  useEffect(() => {
    if (!layers.leaving) return;
    const t = setTimeout(() => setLayers((l) => ({ ...l, leaving: null })), 700);
    return () => clearTimeout(t);
  }, [layers.leaving]);

  // ---- the window: only the pill takes the mouse
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    if (mode === 'hidden') {
      bridge.island.setFrame({ hit: null });
      return;
    }
    const pad = 6;
    bridge.island.setFrame({ hit: { x: Math.round((winW - target.w) / 2) - pad, y: 0, width: Math.round(target.w) + pad * 2, height: Math.round(target.h) + pad } });
  }, [mode, target.w, target.h, winW]);

  const open = useCallback(() => {
    if (!activity) return;
    const href = hrefOf(activity);
    const bridge = desktopBridge();
    if (bridge) bridge.openMain(href);
  }, [activity]);

  const wash = activity ? washOf(activity) : null;

  return (
    <View style={styles.window} pointerEvents="box-none">
      <Pressable
        onHoverIn={onIn}
        onHoverOut={onOut}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={spoken(activity)}
        style={styles.anchor}
        {...({ dataSet: { buildaNowash: 'true' } } as object)}
      >
        <Animated.View style={[styles.pill, !notch && mode !== 'hidden' ? styles.floating : null, boxStyle]}>
          {wash ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} /> : null}
          {layers.leaving ? <Content layer={layers.leaving} p={p} leaving notch={notch} /> : null}
          {layers.current ? <Content layer={layers.current} p={p} leaving={false} notch={notch} /> : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

/** A state's colour laid INTO the black, faintly, never a tinted rectangle over it. */
function washOf(a: Activity): string | null {
  switch (a.kind) {
    case 'needsYou':
      return withAlpha(AMBER, 0.1);
    case 'shipped':
      return withAlpha(ADD, 0.1);
    case 'drop':
      return withAlpha(stateInk('reading'), 0.06);
    case 'crew':
      return null;
  }
}

function Content({ layer, p, leaving, notch }: { layer: Layer; p: SharedValue<number>; leaving: boolean; notch: Notch | null }) {
  const style = useAnimatedStyle(() => {
    if (leaving) {
      const t = phase(p.value, CONTENT_OUT);
      return { opacity: 1 - t, transform: [{ scale: 1 + (OUT_SCALE - 1) * t }] };
    }
    const t = phase(p.value, CONTENT_IN);
    return { opacity: t, transform: [{ translateY: IN_RISE * (1 - t) }, { scale: IN_SCALE + (1 - IN_SCALE) * t }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {layer.mode === 'expanded' ? <Expanded a={layer.activity} notch={notch} /> : <Compact a={layer.activity} notch={notch} />}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ compact

function Compact({ a, notch }: { a: Activity; notch: Notch | null }) {
  const face = faceOf(a);
  return (
    <View style={[styles.compact, { paddingHorizontal: notch ? 10 : 12 }]}>
      <Face animal={face.animal} state={face.state} size={notch ? 18 : 20} />
      {/* The middle is the notch's on a notched Mac; everywhere else it has room for a few words. */}
      {notch ? <View style={styles.flex} /> : <Text numberOfLines={1} style={[styles.middle, { color: DIM }]}>{middleOf(a)}</Text>}
      <Ear a={a} />
    </View>
  );
}

function Ear({ a }: { a: Activity }) {
  switch (a.kind) {
    case 'needsYou':
      return <Text style={[styles.mono, { color: AMBER }]}>{a.since ? shortSince(a.since) : 'you'}</Text>;
    case 'crew':
      return (
        <View style={styles.dots}>
          {a.members.slice(0, 4).map((m) => (
            <View key={m.sessionId} style={[styles.dot, { backgroundColor: stateInk(m.state === 'sleep' ? 'sleep' : m.state) }]} />
          ))}
        </View>
      );
    case 'drop':
      return <Text style={[styles.mono, { color: stateInk('reading') }]}>{a.phase === 'planned' ? `${a.moves}` : a.phase === 'refused' ? 'no' : 'reading'}</Text>;
    case 'shipped':
      return <Text style={[styles.mono, { color: ADD }]}>shipped</Text>;
  }
}

function middleOf(a: Activity): string {
  switch (a.kind) {
    case 'needsYou':
      return `${a.repo} needs you`;
    case 'crew':
      return a.members.length === 1 ? a.members[0]!.repo : `${a.members.length} running`;
    case 'drop':
      return a.title ?? a.host;
    case 'shipped':
      return a.repo;
  }
}

/** "waiting since 9:41" is the tile's line; the ear has room for "9:41". */
function shortSince(since: string): string {
  const m = /(\d{1,2}:\d{2}(?:\s?[ap]m)?)/i.exec(since);
  return m ? m[1]! : since;
}

function faceOf(a: Activity): { animal: Parameters<typeof Face>[0]['animal']; state: Parameters<typeof Face>[0]['state'] } {
  switch (a.kind) {
    case 'needsYou':
      return { animal: a.animal, state: 'waiting' };
    case 'crew': {
      const l = crewLeadOf(a.members);
      return { animal: l?.animal ?? 'cat', state: l?.state ?? 'working' };
    }
    case 'drop':
      return { animal: 'whale', state: a.phase === 'refused' ? 'error' : a.phase === 'planned' ? 'done' : 'reading' };
    case 'shipped':
      return { animal: a.animal, state: 'done' };
  }
}

// ------------------------------------------------------------------ expanded

function Expanded({ a, notch }: { a: Activity; notch: Notch | null }) {
  const face = faceOf(a);
  return (
    <View style={[styles.expanded, { paddingTop: notch ? notch.height + 6 : 14 }]}>
      <View style={styles.head}>
        <Face animal={face.animal} state={face.state} size={28} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.kicker, { color: kickerInk(a) }]}>
            {kickerOf(a)}
          </Text>
          <Text numberOfLines={1} style={[styles.title, { color: INK }]}>
            {titleOf(a)}
          </Text>
        </View>
        <Text style={[styles.open, { color: FAINT }]}>open</Text>
      </View>
      <View style={styles.body}>
        <Body a={a} />
      </View>
    </View>
  );
}

function kickerOf(a: Activity): string {
  switch (a.kind) {
    case 'needsYou':
      return a.since ? `Waiting on you, ${shortSince(a.since)}` : 'Waiting on you';
    case 'crew':
      return a.members.length === 1 ? 'Running' : `${a.members.length} running`;
    case 'drop':
      return a.phase === 'planned' ? 'Read' : a.phase === 'refused' ? 'Could not read it' : 'Reading';
    case 'shipped':
      return 'Shipped';
  }
}

function kickerInk(a: Activity): string {
  if (a.kind === 'needsYou') return AMBER;
  if (a.kind === 'shipped') return ADD;
  if (a.kind === 'drop') return stateInk('reading');
  return FAINT;
}

function titleOf(a: Activity): string {
  switch (a.kind) {
    case 'needsYou':
    case 'shipped':
      return a.repo;
    case 'crew':
      return a.members.length === 1 ? a.members[0]!.repo : a.members.map((m) => m.repo).slice(0, 3).join(', ');
    case 'drop':
      return a.title ?? a.host;
  }
}

function Body({ a }: { a: Activity }) {
  switch (a.kind) {
    case 'needsYou':
      return (
        <Text numberOfLines={2} style={[styles.sentence, { color: DIM }]}>
          {a.sentence}
        </Text>
      );
    case 'shipped':
      return <Words text={a.summary} style={[styles.sentence, { color: DIM }]} />;
    case 'crew':
      return (
        <Wheel
          // One run: its repo is already the title, so the row is what it is doing.
          rows={a.members.slice(0, 3).map((m) => ({
            key: m.sessionId,
            text: a.members.length === 1 ? m.sentence : `${m.repo}  ${m.sentence}`,
            corner: m.corner,
            ink: stateInk(m.state),
          }))}
          index={0}
        />
      );
    case 'drop': {
      const s = dropSteps(a);
      return (
        <View>
          <Wheel rows={s.rows.map((text, i) => ({ key: String(i), text, corner: null, ink: stateInk('reading') }))} index={s.index} />
          {a.firstMove ? (
            <Text numberOfLines={1} style={[styles.move, { color: INK }]}>
              {a.firstMove}
            </Text>
          ) : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: 'transparent', alignItems: 'center' },
  anchor: { alignItems: 'center' },
  pill: { backgroundColor: ISLAND_BLACK, overflow: 'hidden', borderCurve: 'continuous' },
  floating: { boxShadow: `0 10px 30px ${withAlpha(ISLAND_BLACK, 0.45)}` } as object,
  flex: { flex: 1, minWidth: 0 },
  compact: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  middle: { ...roleStyle('meta'), flex: 1, minWidth: 0 },
  mono: { ...roleStyle('mono') },
  dots: { flexDirection: 'row', flexWrap: 'wrap', width: 16, gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, borderCurve: 'continuous' },
  expanded: { flex: 1, paddingHorizontal: 18, paddingBottom: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kicker: { ...roleStyle('label') },
  title: { ...roleStyle('headline') },
  open: { ...roleStyle('label') },
  body: { flex: 1 },
  sentence: { ...roleStyle('meta') },
  move: { ...roleStyle('row'), marginTop: 6 },
});
