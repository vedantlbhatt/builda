/**
 * The island, inside the app.
 *
 * iOS never shows an app's own Live Activity while that app is in front, so inside Builda the
 * island is drawn here: a black shape fused to the hardware island at its own frame, growing out
 * of it and back. Leave the app and the system island carries the same thing on (the Live
 * Activity, `targets/widget`); come back and this one picks it up. One object in two bodies
 * (docs/motion.md).
 *
 * THE CHOREOGRAPHY is the notch kit's, measured off its clip: one spring (`ISLAND`) drives width,
 * height and radius together; the outgoing content is gone by 0.28 of the morph and grows as it
 * leaves; the incoming content arrives from 0.34, hanging 5 points down into place. Content is laid
 * out at its FINAL size and clipped by the growing box, so nothing reflows while the box moves.
 *
 * WHAT A FINGER DOES. A compact island expands on a tap; an expanded one opens the thing it is
 * about. A toast opens its thing at once. A tap anywhere else, or seven seconds untouched, folds
 * it back. It never takes typing.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';

import { useIslandHost } from '../desktop/islandHost';
import { islandOf } from './hardware';
import { tokens } from '../generated/tokens';
import { Face, RippleItem, Wash, Wheel, Words, stateColor, useMorph, withAlpha, RAIL_STAGGER_MS } from '../motion';
import { useAccent } from '../theme/accent';
import { select } from '../ui/haptics';
import {
  boxFor,
  crewDots,
  crewLead,
  dropSteps,
  earLabel,
  lead,
  minutesLabel,
  restingMode,
  spoken,
  type Activity,
  type HardwareIsland,
  type Mode,
} from './model';
import { island, useIslandActivities } from './store';
import { startIslandDemo } from './demo';

const INK = '#F5F1EA';
const DIM = 'rgba(245,241,234,0.56)';
const FAINT = 'rgba(245,241,234,0.34)';
const SANS = { fontFamily: undefined as string | undefined };
const AMBER = tokens.spectrum.hues.amber.dark;
const ADD = tokens.data.add.dark;
const DEL = tokens.data.del.dark;

/** Untouched for this long, an expanded island folds back. */
const FOLD_MS = 7000;
/**
 * A desktop window's island hangs this far below the window's top edge: clear of the edge it grows
 * out of, and above a page's large title (which starts 10 points further down).
 */
const DESK_TOP = 8;
/** The strip a desktop toast is centred in: wider than the widest toast (382) with room to spare. */
const DESK_SPAN = 440;
/** The crew's wheel steps to the next session this often while expanded. */
const CREW_STEP_MS = 2400;

export function Island() {
  const acts = useIslandActivities();
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_ISLAND_DEMO === '1') startIslandDemo();
  }, []);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const accent = useAccent();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Null on a phone (a constant), so everything below is the phone's island exactly.
  const host = useIslandHost();
  const desk = host?.kind === 'pane';
  const hardware = islandOf(width, insets.top);
  // A desktop window has no camera: a zero height "hardware island" under the top edge, so a toast
  // grows out of a line and its words need no room under a camera.
  const hw: HardwareIsland = desk
    ? { x: host.centerX, y: DESK_TOP, width: 120, height: 0 }
    : (hardware ?? { x: width / 2, y: Math.max(14, insets.top / 2), width: 120, height: 34 });

  // On a desktop only the passing beats: the standing states belong to the desktop island.
  const shown = useMemo(() => (desk ? acts.filter((a) => restingMode(a) === 'toast') : acts), [acts, desk]);
  const top = lead(shown);
  const mode: Mode = top ? (expanded && canExpand(top) ? 'expanded' : restingMode(top)) : 'hidden';

  // Minutes only, so a quarter minute tick is enough and costs nothing. The clock is read again
  // whenever the activity changes, or a wait that began after the last tick reads "now" for up
  // to fifteen seconds (it did: the first "2m" waiting read "now").
  useEffect(() => {
    if (!top) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [top]);

  useEffect(() => island.onExpand(() => setExpanded(true)), []);

  // No haptic when news arrives here: the house rule (ui/hapticsGate.ts) is never on a live data
  // update, and everything the island shows on its own is one. The system island's own alert
  // (the Live Activity's alertConfiguration) is what buzzes a phone in a pocket.

  // Seven seconds untouched folds it back; so does the activity going away.
  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => setExpanded(false), FOLD_MS);
    return () => clearTimeout(t);
  }, [expanded, top?.id]);
  useEffect(() => {
    if (!top) setExpanded(false);
  }, [top]);

  const expandedH = top ? expandedHeight(top) : 172;
  const target = boxFor(mode, width, hw, expandedH);
  const contentKey = `${top?.kind ?? 'none'}:${top?.id ?? ''}:${mode}:${phaseKey(top)}`;
  const { box, contentIn, contentOut } = useMorph(target, contentKey);

  // The outgoing layer: what was showing, frozen at the size it was laid out at.
  const [layers, setLayers] = useState<{ cur: Frozen; prev: Frozen | null }>({ cur: { a: top, mode, box: target, key: contentKey }, prev: null });
  const lastKey = useRef(contentKey);
  useEffect(() => {
    if (lastKey.current === contentKey) {
      setLayers((l) => ({ ...l, cur: { a: top, mode, box: target, key: contentKey } }));
      return;
    }
    lastKey.current = contentKey;
    setLayers((l) => ({ prev: l.cur, cur: { a: top, mode, box: target, key: contentKey } }));
    const t = setTimeout(() => setLayers((l) => ({ ...l, prev: null })), 420);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, top, target.w, target.h]);

  const open = (a: Activity) => {
    select();
    setExpanded(false);
    switch (a.kind) {
      case 'needsYou':
      case 'shipped':
        router.push(`/session/${a.sessionId}`);
        return;
      case 'crew':
        router.push(a.members.length === 1 ? `/session/${a.members[0]!.sessionId}` : '/live');
        return;
      case 'drop':
        router.push(`/drop/${a.dropId}`);
        return;
      case 'demo':
        router.push(`/ship/${encodeURIComponent(a.projectKey)}` as never);
        return;
      case 'notice':
        return;
    }
  };

  const onPress = () => {
    if (!top) return;
    if (mode === 'compact') {
      select();
      setExpanded(true);
    } else open(top);
  };

  const wash = top ? washFor(top) : null;
  const visible = mode !== 'hidden' || hardware !== null;

  if (host?.kind === 'off') return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* The system island hides the status bar while it is big; so does this one, or the clock
          and the battery are drawn on top of the words. */}
      <StatusBar style="light" hidden={mode === 'toast' || mode === 'expanded'} animated />
      {mode === 'expanded' ? <Pressable accessibilityLabel="Close the island" style={StyleSheet.absoluteFill} onPress={() => setExpanded(false)} /> : null}
      <View pointerEvents="box-none" style={[styles.anchor, { top: hw.y - hw.height / 2 }, desk ? { left: hw.x - DESK_SPAN / 2, right: undefined, width: DESK_SPAN } : null]}>
        <Pressable
          disabled={mode === 'hidden'}
          onPress={onPress}
          // FOUND ON THE SIMULATOR: a compact island is ENTIRELY inside the status bar's strip
          // (11 to 48 points on a 54 point inset), and iOS gives a touch there to the status bar
          // for scroll to top, never to the app, so a tap on the compact island did nothing. The
          // touch area reaches 22 points below the strip, under the island, where nothing else
          // on any screen takes a tap (the large titles start at the gutter, the back button and
          // the gear sit outside the island's width).
          hitSlop={mode === 'compact' ? { top: 0, bottom: 22, left: 6, right: 6 } : undefined}
          accessibilityRole="button"
          accessibilityLabel={spoken(top, now)}
          accessibilityElementsHidden={mode === 'hidden'}
          importantForAccessibility={mode === 'hidden' ? 'no-hide-descendants' : 'yes'}
        >
          <Animated.View style={[styles.island, { opacity: visible ? 1 : 0 }, box]}>
            <Wash color={wash?.color ?? null} from={wash?.from ?? 'top'} strength={wash?.strength ?? 0.34} to={wash?.to} />
            {layers.prev && layers.prev.a ? (
              <Animated.View pointerEvents="none" style={[styles.layer, contentOut]}>
                <Placed box={layers.prev.box}>
                  <Content a={layers.prev.a} mode={layers.prev.mode} now={now} accentInk={accent.ink} onOpen={open} camera={!desk} />
                </Placed>
              </Animated.View>
            ) : null}
            {top ? (
              <Animated.View style={[styles.layer, contentIn]}>
                <Placed box={target}>
                  <Content a={top} mode={mode} now={now} accentInk={accent.ink} onOpen={open} camera={!desk} />
                </Placed>
              </Animated.View>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

interface Frozen {
  a: Activity | null;
  mode: Mode;
  box: { w: number; h: number; r: number };
  key: string;
}

/** Content laid out at its final size, centred in a box that may still be growing. */
function Placed({ box, children }: { box: { w: number; h: number }; children: React.ReactNode }) {
  return <View style={{ position: 'absolute', top: 0, left: '50%', marginLeft: -box.w / 2, width: box.w, height: box.h }}>{children}</View>;
}

function canExpand(a: Activity): boolean {
  return a.kind === 'crew' || a.kind === 'needsYou' || a.kind === 'demo';
}

function expandedHeight(a: Activity): number {
  switch (a.kind) {
    case 'crew':
      // The camera's 44 points, the card's three lines, and the island's own bottom margin.
      return a.members.length > 1 ? 150 : 132;
    case 'needsYou':
      return 150;
    case 'demo':
      return 128;
    default:
      return 150;
  }
}

/** A change of phase inside one activity re-runs the morph (a drop going from reading to planned). */
function phaseKey(a: Activity | null): string {
  if (!a) return '';
  if (a.kind === 'drop') return a.phase;
  if (a.kind === 'demo') return a.ready ? 'ready' : 'cutting';
  return '';
}

function washFor(a: Activity): { color: string; from: 'top' | 'bottom' | 'left' | 'right'; strength?: number; to?: string } | null {
  switch (a.kind) {
    case 'needsYou':
      return { color: AMBER, from: 'top', strength: 0.3 };
    case 'shipped':
      return { color: ADD, from: 'left', strength: 0.32 };
    case 'drop':
      if (a.phase === 'refused') return { color: DEL, from: 'bottom', strength: 0.26 };
      if (a.phase === 'planned' && a.hue) return { color: a.hue, from: 'left', strength: 0.3 };
      return { color: stateColor('reading', INK), from: 'left', strength: 0.16 };
    case 'demo':
      return a.ready ? { color: ADD, from: 'left', strength: 0.28 } : null;
    case 'notice':
      return a.state === 'error' ? { color: DEL, from: 'bottom', strength: 0.3 } : null;
    default:
      return null;
  }
}

function Content({
  a,
  mode,
  now,
  accentInk,
  onOpen,
  camera,
}: {
  a: Activity;
  mode: Mode;
  now: number;
  accentInk: string;
  onOpen: (a: Activity) => void;
  /** False on a desktop window: no camera, so a toast's words start at its top. */
  camera: boolean;
}) {
  const flat = camera ? null : styles.toastFlat;
  switch (a.kind) {
    case 'crew':
      return mode === 'expanded' ? <CrewExpanded a={a} now={now} /> : <CrewCompact a={a} now={now} />;
    case 'needsYou':
      return mode === 'expanded' ? <WaitingExpanded a={a} now={now} onOpen={onOpen} /> : <WaitingCompact a={a} now={now} />;
    case 'drop':
      return <DropToast a={a} flat={flat} />;
    case 'shipped':
      return <ShippedToast a={a} flat={flat} />;
    case 'demo':
      return <DemoContent a={a} mode={mode} />;
    case 'notice':
      return <NoticeToast a={a} accentInk={accentInk} flat={flat} />;
  }
}

// ─── compact: two ears either side of the hardware island ──────────────────────────────────────

function Ears({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <View style={styles.ears}>
      <View style={styles.ear}>{left}</View>
      <View style={[styles.ear, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

function CrewCompact({ a, now }: { a: Extract<Activity, { kind: 'crew' }>; now: number }) {
  const l = crewLead(a.members);
  if (!l) return null;
  const dots = crewDots(a.members);
  return (
    <Ears
      left={<Face animal={l.animal} state={l.state} ink={l.ink} size={20} />}
      right={
        a.members.length > 1 ? (
          <View style={styles.dots}>
            {dots.map((ink, i) => (
              <RippleItem key={`${i}.${ink}`} i={i} per={RAIL_STAGGER_MS}>
                <View style={[styles.dot, { backgroundColor: ink }]} />
              </RippleItem>
            ))}
          </View>
        ) : (
          <Text numberOfLines={1} style={[styles.mono, { color: DIM }]}>{l.startedMs ? earLabel(now - l.startedMs) : ''}</Text>
        )
      }
    />
  );
}

function WaitingCompact({ a, now }: { a: Extract<Activity, { kind: 'needsYou' }>; now: number }) {
  return (
    <Ears
      left={<Face animal={a.animal} state="waiting" ink={a.ink} size={20} />}
      right={<Text numberOfLines={1} style={[styles.mono, { color: AMBER }]}>{earLabel(now - a.sinceMs)}</Text>}
    />
  );
}

// ─── expanded ─────────────────────────────────────────────────────────────────────────────────

function CrewExpanded({ a, now }: { a: Extract<Activity, { kind: 'crew' }>; now: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (a.members.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % a.members.length), CREW_STEP_MS);
    return () => clearInterval(t);
  }, [a.members.length]);
  const { width: screenW } = useWindowDimensions();
  const cur = a.members[Math.min(i, a.members.length - 1)];
  if (!cur) return null;
  // The repo is its own line and the wheel carries only what each run is doing, so neither is
  // cut: "Private project 2 · Running a command" did not fit one line of an island.
  const rows = a.members.map((m) => ({ key: m.sessionId, text: m.sentence }));
  const wheelW = screenW - 16 - 28 - 24 - 56 - (a.members.length > 1 ? 50 : 0);
  return (
    <View style={styles.expandedRow}>
      <View style={[styles.card, { flex: 1 }]}>
        <Face animal={cur.animal} state={cur.state} ink={cur.ink} size={44} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text numberOfLines={1} style={[styles.kicker, { color: FAINT }]}>
            {`${a.members.length === 1 ? 'Running' : `${a.members.length} running`}${cur.startedMs ? ` · ${minutesLabel(now - cur.startedMs)}` : ''}`}
          </Text>
          <Text numberOfLines={1} style={[styles.title, { color: INK }]}>
            {cur.repo}
          </Text>
          <Wheel rows={rows} index={Math.min(i, rows.length - 1)} width={wheelW} rowHeight={20} visible={1} textStyle={styles.wheelText} dim={DIM} bright={INK} />
        </View>
      </View>
      {a.members.length > 1 ? (
        <View style={styles.rail}>
          {a.members.slice(0, 4).map((m, k) => (
            <RippleItem key={m.sessionId} i={k} per={RAIL_STAGGER_MS}>
              <Face animal={m.animal} state={m.state} ink={m.ink} size={16} glow={false} alive={false} />
            </RippleItem>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function WaitingExpanded({ a, now, onOpen }: { a: Extract<Activity, { kind: 'needsYou' }>; now: number; onOpen: (a: Activity) => void }) {
  return (
    <View style={styles.expandedRow}>
      <View style={[styles.card, { flex: 1 }]}>
        <Face animal={a.animal} state="waiting" ink={a.ink} size={44} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.kicker, { color: AMBER }]}>{`Waiting on you · ${minutesLabel(now - a.sinceMs)}`}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: INK }]}>
            {a.repo}
          </Text>
          <Text numberOfLines={2} style={[styles.body, { color: DIM }]}>
            {a.sentence}
          </Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => onOpen(a)} style={styles.openButton}>
        <Text style={[styles.buttonText, { color: '#141210' }]}>Open</Text>
      </Pressable>
    </View>
  );
}

// ─── toasts ──────────────────────────────────────────────────────────────────────────────────

type Flat = typeof styles.toastFlat | null;

function DropToast({ a, flat }: { a: Extract<Activity, { kind: 'drop' }>; flat: Flat }) {
  const steps = dropSteps(a);
  return (
    <View style={[styles.toast, flat]}>
      {a.thumbnail ? (
        <Image source={{ uri: a.thumbnail }} style={styles.poster} contentFit="cover" />
      ) : (
        <View style={[styles.poster, { backgroundColor: a.hue ? withAlpha(a.hue, 0.28) : 'rgba(255,255,255,0.08)' }]} />
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text numberOfLines={1} style={[styles.kicker, { color: FAINT }]}>
          {a.title ?? a.host}
        </Text>
        <Wheel rows={steps.rows} index={steps.index} width={220} rowHeight={20} visible={1} textStyle={styles.wheelText} dim={DIM} bright={INK} shimmer={a.phase !== 'planned' && a.phase !== 'refused'} />
      </View>
      {a.phase === 'planned' ? <Text style={[styles.chev, { color: DIM }]}>›</Text> : null}
    </View>
  );
}

function ShippedToast({ a, flat }: { a: Extract<Activity, { kind: 'shipped' }>; flat: Flat }) {
  return (
    <View style={[styles.toast, flat]}>
      <Face animal={a.animal} state="done" ink={a.ink} size={32} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.kicker, { color: ADD }]}>Shipped</Text>
        <Words text={a.summary} style={[styles.body, { color: INK }]} />
      </View>
    </View>
  );
}

function NoticeToast({ a, accentInk, flat }: { a: Extract<Activity, { kind: 'notice' }>; accentInk: string; flat: Flat }) {
  return (
    <View style={[styles.toast, flat]}>
      <Face animal={a.animal} state={a.state} ink={a.ink || accentInk} size={32} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Words text={a.text} style={[styles.body, { color: INK }]} />
      </View>
    </View>
  );
}

function DemoContent({ a, mode }: { a: Extract<Activity, { kind: 'demo' }>; mode: Mode }) {
  const p = a.progress ?? 0;
  if (mode === 'compact') {
    return (
      <Ears
        left={<View style={[styles.demoDot, { backgroundColor: a.ready ? ADD : INK }]} />}
        right={
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((a.ready ? 1 : p) * 100)}%`, backgroundColor: a.ready ? ADD : INK }]} />
          </View>
        }
      />
    );
  }
  return (
    <View style={[styles.expandedRow, { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center' }]}>
      <Text style={[styles.kicker, { color: a.ready ? ADD : FAINT }]}>{a.ready ? 'Demo ready' : 'Cutting a demo'}</Text>
      <Text numberOfLines={1} style={[styles.title, { color: INK }]}>
        {a.title}
      </Text>
      <View style={[styles.track, { width: '100%', marginTop: 10 }]}>
        <View style={[styles.fill, { width: `${Math.round((a.ready ? 1 : p) * 100)}%`, backgroundColor: a.ready ? ADD : INK }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  island: {
    backgroundColor: '#000',
    borderCurve: 'continuous',
    overflow: 'hidden',
    // The system island has no border; its edge is the screen's black against the app's colour.
    // A soft shadow under the expanded shape keeps it on top of the content it covers.
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  layer: { ...StyleSheet.absoluteFillObject },
  ears: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11 },
  ear: { width: 34, alignItems: 'flex-start', justifyContent: 'center' },
  dots: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2, alignContent: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 1.5, borderCurve: 'continuous' },
  mono: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], ...SANS },
  expandedRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingTop: 44, paddingBottom: 14, paddingHorizontal: 14, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 10, minWidth: 0 },
  rail: { width: 40, borderRadius: 20, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 10, alignItems: 'center', gap: 6 },
  kicker: { fontSize: 12, fontWeight: '600', letterSpacing: 0.1 },
  title: { fontSize: 17, fontWeight: '700', marginTop: 1 },
  body: { fontSize: 14, lineHeight: 19 },
  wheelText: { fontSize: 14, fontWeight: '500' },
  openButton: { height: 40, paddingHorizontal: 18, borderRadius: 20, borderCurve: 'continuous', backgroundColor: AMBER, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
  toast: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 34, paddingBottom: 6 },
  // The same toast with no camera above its words: 6 top and bottom in a 58 point box.
  toastFlat: { paddingTop: 6 },
  poster: { width: 32, height: 46, borderRadius: 7, borderCurve: 'continuous' },
  chev: { fontSize: 26, fontWeight: '300', marginLeft: 6 },
  demoDot: { width: 8, height: 8, borderRadius: 4, borderCurve: 'continuous' },
  track: { width: 30, height: 4, borderRadius: 2, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, borderCurve: 'continuous' },
});
