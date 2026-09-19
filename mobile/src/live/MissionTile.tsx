/**
 * One running session in mission control, printed as a small band in its crew creature's hue
 * (HOUSE-STYLE, "chapters, not cards"; DESIGN-V2 2.2, "every session is its own builder"). The
 * tile IS the colour: a square block of the hue that prints itself cell by cell when it arrives,
 * everything on it in the dark ink (`ON_HUE`, 5.2:1 or better on every hue), the creature printed
 * bottom right, the tool's real logo on an ink stamp top left.
 *
 *   [logo] builder                         the owner's harness mark, the repository in full (it wraps)
 *   Stuck on the same failing command      the ONE sentence, the engine's, aged to now
 *   for six minutes
 *   (o) circling                           a drawn glyph and a word (Linear's status language)
 *   28m                                    counted up on arrival, then moving with the clock
 *   11 files                     [crab]    (Robinhood: numbers that move, tabular, no chrome)
 *   ▀▀▀▀▀▀▀▀▀▀▀· · · · ·                   elapsed over typical, solid then dotted (Flighty's
 *                                          arc: flown solid, remaining dashed), only when honest
 *
 * Three sizes, so the grid is never a wall of equal boxes: the `lead` (who needs you most) spans
 * the width with its sentence set large; the rest are `half` tiles two to a row; an unpaired last
 * one is `wide`. The one that needs you is wrapped in a StarBorder comet in its own hue and its
 * creature is the only one on the screen that moves. A stale tile (the Mac stopped reporting)
 * loses its colour: the hue means live, so a tile nobody can vouch for is printed on the warm
 * dark instead, with its creature still in its ink and the time its numbers were taken.
 *
 * Every word and number is `mission.tileModel`'s; this file only sets them.
 */
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  measure,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { commas } from '../copy/numbers';
import { formatWith, fitSize, type NumFormat } from '../insights/format';
import { COUNT_MS, DRAW_MS, ease, phase } from '../insights/motion';
import { GROUND, ON_HUE } from '../insights/palette';
import { Block, RevealPage, Section, useClock, usePageReveal, useReducedSV } from '../insights/reveal';
import { ARM_FALLBACK_MS } from '../insights/RevealScroll';
import type { Animal } from '../pixel/animals';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { creatureHue, MONO_FAMILY, radius, type Hue } from '../theme';
import { T, useReduceMotion } from '../ui';
import { EASE } from '../ui/motion';
import { VERDICT_PATHS, VERDICT_VIEWBOX, verdictDash, verdictStroke } from '../ui/verdicts';
import { Aura, Face, Wash } from '../motion';
import { morphOpen } from '../motion/MorphNav';
import { springAt } from '../motion/spec';
import { FACE_FOR_TILE } from '../island/feeds';
import { fitWords, stateLayout, STATE_GAP, tileMeasures, VARIANT, type TileVariant, type VariantSpec } from './fit';
import { elapsedLabel, landedCommits, landedParts, TILE_MAX_SCALE, type TileModel, type TileVerdict } from './mission';

// ------------------------------------------------------------------ type

/**
 * Words set on a band: SF Pro, tight, tabular, in one ink. Sizes live in `VARIANT` and nowhere
 * else, the way the analysis page's live in its kit (`insights/kit.tsx`).
 */
export function inked(size: number, weight: TextStyle['fontWeight'], color: string, lineHeight: number = Math.round(size * 1.2)): TextStyle {
  return {
    fontSize: size,
    lineHeight,
    fontWeight: weight,
    letterSpacing: size >= 20 ? -Math.round(size * 0.025 * 10) / 10 : -0.1,
    color,
    fontVariant: ['tabular-nums'],
  };
}

export type { TileVariant } from './fit';

/** The inks a tile draws with: the dark ink on its hue, or the warm neutrals when it is stale. */
interface Inks {
  fill: string;
  text: string;
  dim: string;
  /** The creature's own colour: dark ink on the hue, its hue on the warm dark. */
  creature: string;
  /** What a monochrome harness logo takes on its ink stamp. */
  stamp: string;
}

/**
 * The tile is the warm dark card now, not a slab of the hue (docs/motion.md, the pixel diet: a
 * full screen of hue-filled bands was most of why every screen looked alike). The hue lives where
 * it means something: the creature, its glow in the run's state, and a wash of it coming in from
 * the creature's corner. A stale tile loses the wash and the glow, and goes a step up in grey.
 */
/** A tile's corners: the container radius, like every card on the dark ground. */
const TILE_RADIUS = radius.md;

function inksFor(hue: Hue, stale: boolean): Inks {
  if (stale) return { fill: GROUND.raised, text: GROUND.text, dim: GROUND.dim, creature: hue.ink, stamp: GROUND.text };
  return { fill: GROUND.card, text: GROUND.text, dim: GROUND.dim, creature: hue.ink, stamp: hue.ink };
}

// ------------------------------------------------------------------ the print

/**
 * A block arriving: the ground covers it and draws back UP from its foot on the island spring,
 * so the fill grows down from the top the way every band does now (`insights/Band.tsx`). It used
 * to PRINT, cell by cell in a random order through a shader, which was the same half second of
 * pixels as every band on nine screens (docs/motion.md, the pixel diet).
 */
/** Kept for callers timing their words after the block has arrived. */
export const PRINT_MS = 440;

export function PrintMask({ width, height, delay, ground = GROUND.bg }: { width: number; height: number; delay: number; ground?: string }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const [done, setDone] = useState(false);
  const cover = useAnimatedStyle(() => {
    const p = reduced.value ? 1 : Math.max(0, springAt(clock.value - delay));
    // Overshoot past 1 would uncover nothing more; clamp so the cover never grows back.
    return { height: height * (1 - Math.min(1, p)) };
  });
  useAnimatedReaction(
    () => clock.value >= delay + PRINT_MS,
    (over, was) => {
      if (over && !was) runOnJS(setDone)(true);
    },
  );
  if (done || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: ground }, cover]} />
    </View>
  );
}

/** Words on a printed block fade up once its cells have landed (`insights/Band.BandWords`). */
export function Arrive({ delay, children, style }: { delay: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const fade = useAnimatedStyle(() => {
    const p = ease(phase(clock.value, delay, 360));
    return { opacity: p, transform: [{ translateY: reduced.value ? 0 : (1 - p) * 6 }] };
  });
  return <Animated.View style={[fade, style]}>{children}</Animated.View>;
}

// ------------------------------------------------------------------ numbers that move

// `text` rides the native prop path, as in `insights/Num.tsx` and the kit's CountUp.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** A figure's frames: the elapsed clock ("0m" to "1h 05m"), or a count with fixed words around it. */
export type LiveFigure = { kind: 'elapsed' } | { kind: 'count'; prefix?: string; suffix?: string };

/** How long a live number takes to move to a new value (a file touched, a minute ticking over). */
const MOVE_MS = 520;

/**
 * A number that counts up from 0 the first time its block plays (the house rule, `insights/Num`),
 * then MOVES whenever the value does: 11 files to 14 counts through 12 and 13 on the page's curve
 * (Robinhood's numbers that move: the figure changes in place, tabular, never a flash). At rest it
 * shows `final`, the copy helper's string, so the resting number is always the one the rest of the
 * app says. Every frame is written on the UI thread; nothing re-renders React while it moves.
 * Reduce Motion: the value, at rest, no count.
 */
export function LiveNum({
  value,
  final,
  figure,
  textStyle,
  delay = 0,
  accessibilityLabel,
  style,
}: {
  value: number;
  final: string;
  figure: LiveFigure;
  textStyle: TextStyle;
  delay?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const clock = useClock();
  const reducedSV = useReducedSV();
  const reduce = useReduceMotion();
  const shown = useSharedValue(0);
  const target = useSharedValue(value);
  const rest = useSharedValue(final);
  const started = useSharedValue(0);

  const elapsed = figure.kind === 'elapsed';
  const prefix = figure.kind === 'count' ? (figure.prefix ?? '') : '';
  const suffix = figure.kind === 'count' ? (figure.suffix ?? '') : '';
  const fmt: NumFormat = useMemo(() => ({ kind: 'fixed', decimals: 0, grouping: true, prefix, suffix }), [prefix, suffix]);

  useEffect(() => {
    target.value = value;
    rest.value = final;
    if (started.value) shown.value = reduce ? value : withTiming(value, { duration: MOVE_MS, easing: EASE });
  }, [value, final, reduce, target, rest, started, shown]);

  useAnimatedReaction(
    () => clock.value >= delay,
    (go) => {
      if (!go || started.value) return;
      started.value = 1;
      shown.value = reducedSV.value ? target.value : withTiming(target.value, { duration: COUNT_MS, easing: EASE });
    },
  );

  // What React renders follows the count, `insights/Num`'s rule: the first frame while the count
  // is ahead of it, the resting string once it has landed. React re-renders this tile on every
  // clock tick, and each commit hands the input React's own text back; with "0" there, a number
  // that had counted up to 1 went back to "0" at the next tick and nothing on the UI thread wrote
  // it again, because its shared values had stopped moving. FOUND IN THE DEFECTS PASS
  // (2026-09-14): the Sessions band read "0 needs you" over "1 running", and the Now band "0
  // running" over "1 not updating", with the model's figure 1 both times.
  const [rested, setRested] = useState(false);
  useAnimatedReaction(
    () => started.value === 1 && Math.abs(shown.value - target.value) < 0.0005,
    (now, before) => {
      if (now && !before) runOnJS(setRested)(true);
    },
  );
  // And never left waiting on a clock that does not reach its delay: by the time the count would
  // have finished, the number is at rest.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!started.value) {
        started.value = 1;
        shown.value = target.value;
      }
      setRested(true);
    }, delay + COUNT_MS + 400);
    return () => clearTimeout(t);
  }, [delay, started, shown, target]);

  const animatedProps = useAnimatedProps(() => {
    const v = shown.value;
    const text = Math.abs(v - target.value) < 0.0005 ? rest.value : elapsed ? elapsedLabel(v) : formatWith(fmt, v);
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });

  const startsAt = elapsed ? elapsedLabel(0) : formatWith(fmt, 0);
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? final} style={style}>
      {/* Holds the resting width and height, so nothing beside the number moves while it counts. */}
      <T allowFontScaling={false} importantForAccessibility="no" accessibilityElementsHidden style={[textStyle, styles.sizer]}>
        {final}
      </T>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        allowFontScaling={false}
        scrollEnabled={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        underlineColorAndroid="transparent"
        defaultValue={rested ? final : startsAt}
        animatedProps={animatedProps}
        style={[StyleSheet.absoluteFill, textStyle, styles.input]}
      />
    </View>
  );
}

// ------------------------------------------------------------------ drawn marks

/** The verdict glyphs (`ui/verdicts.ts`, Linear's drawn status language) in any ink: 2 pt at any size. */
export function InkVerdict({ verdict, size, color }: { verdict: TileVerdict; size: number; color: string }) {
  const spec = VERDICT_PATHS[verdict];
  const stroke = verdictStroke(size);
  return (
    <Svg width={size} height={size} viewBox={`-1 -1 ${VERDICT_VIEWBOX} ${VERDICT_VIEWBOX}`} accessibilityElementsHidden>
      <Path
        d={spec.d}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={spec.dashed ? verdictDash(stroke) : undefined}
        fill="none"
      />
    </Svg>
  );
}

type StateMark = 'finished' | 'starting' | 'quiet' | 'stale';

/**
 * The states that are not verdicts, drawn in the same box and stroke so a row of tiles reads as
 * one family: finished a check, starting an empty ring (Linear's "todo"), quiet two bars (the
 * output stopped), stale three dots (nothing is arriving).
 */
function StateGlyph({ mark, size, color }: { mark: StateMark; size: number; color: string }) {
  const stroke = verdictStroke(size);
  return (
    <Svg width={size} height={size} viewBox={`-1 -1 ${VERDICT_VIEWBOX} ${VERDICT_VIEWBOX}`} accessibilityElementsHidden>
      {mark === 'finished' ? (
        <Path d="M2.8 8.6 L6.6 12.4 L13.4 4" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : mark === 'starting' ? (
        <Circle cx={8} cy={8} r={5.6} stroke={color} strokeWidth={stroke} fill="none" />
      ) : mark === 'quiet' ? (
        <Path d="M5.5 3.5 L5.5 12.5 M10.5 3.5 L10.5 12.5" stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
      ) : (
        <Path d="M2.5 8 L2.6 8 M8 8 L8.1 8 M13.5 8 L13.6 8" stroke={color} strokeWidth={stroke * 1.25} strokeLinecap="round" fill="none" />
      )}
    </Svg>
  );
}

/**
 * The tool's real mark (the owner's logos, `pixel/HarnessLogo.tsx`) on a small stamp of the dark
 * ink. Claude's terracotta, Codex's and Gemini's colours keep their brand colours, which read on
 * the ink where they would not on every hue; the monochrome marks take the tile's own hue, so
 * the stamp is a printed negative of the tile.
 */
export function HarnessStamp({ harness, size, color }: { harness: string; size: number; color: string }) {
  const box = size + 8;
  return (
    <View style={[styles.stamp, { width: box, height: box }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <HarnessLogo harness={harness} size={size} color={color} />
    </View>
  );
}

/**
 * Elapsed over the repository's typical run along a block's foot: the part that has run in solid
 * ink, the rest dotted a cell at a time (Flighty's live arc: flown solid, remaining dashed). It
 * draws on from the left when its block plays and then moves only when the number does. Null
 * track draws nothing: no ETA is not an empty bar.
 */
export function FootTrack({ track, width, height, color, delay }: { track: number; width: number; height: number; color: string; delay: number }) {
  const clock = useClock();
  const to = useSharedValue(track);
  useEffect(() => {
    to.value = withTiming(track, { duration: MOVE_MS, easing: EASE });
  }, [track, to]);
  const fill = useAnimatedStyle(() => ({ width: width * to.value * ease(phase(clock.value, delay, DRAW_MS)) }));
  if (width <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.foot, { height }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth={height} strokeDasharray={[height, height]} />
      </Svg>
      <Animated.View style={[{ height, backgroundColor: color }, fill]} />
    </View>
  );
}

// ------------------------------------------------------------------ the tile

export interface MissionTileProps {
  model: TileModel;
  /** The session's crew creature (`mission.crewCreatures`): its hue is the tile's. */
  creature: Animal;
  /** The top "needs you" tile on current data: the comet, and the one creature that moves. */
  animate: boolean;
  variant: TileVariant;
  width: number;
  minHeight: number;
  /** Where this tile falls in the grid's print, ms on its block's clock. */
  delay?: number;
  /** Stable across renders (the grid's one callback), so a tick redraws no tile that did not change. */
  /** `morph` is true when the tile grew into the page and the push should not slide. */
  onOpen?: (id: string, morph?: boolean) => void;
}

/** How far the aura's glow runs outside the tile: in the 12 pt gap, clear of the neighbour. */
const COMET_OUT = 5;

function MissionTileImpl({ model: m, creature, animate, variant, width, minHeight, delay = 0, onOpen }: MissionTileProps) {
  const v = VARIANT[variant];
  const hue = useMemo(() => creatureHue(creature), [creature]);
  const ink = inksFor(hue, m.stale);
  const reduce = useReduceMotion();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
  }, []);

  // The pixel spotlight under the finger is gone with the rest of the print (the pixel diet); a
  // press is the tile giving a hair under the thumb, and a tap grows it into the page.
  const gesture = useMemo(() => Gesture.Manual().enabled(false), []);

  // The tile grows into the session's page (`motion/MorphNav.tsx`): its own view, its own fill.
  const tileRef = useRef<View>(null);
  const onPress = useCallback(() => {
    if (!onOpen) return;
    morphOpen(tileRef.current, () => onOpen(m.id, true), { color: ink.fill, radius: TILE_RADIUS, ground: GROUND.bg }, `/session/${m.id}`);
  }, [onOpen, m.id, ink.fill]);
  const trackH = m.track !== null ? v.track : 0;
  const { inner, lower: lowerWidth, repo: repoWidth, headGap } = tileMeasures(variant, width);
  const wordsAt = delay + PRINT_MS * 0.55;
  // No word on a tile is broken inside itself (`fit.ts`): each line is set no larger than the
  // size at which its widest word fits its measure, at the reader's text size as the tile caps it.
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(TILE_MAX_SCALE, Math.max(1, fontScale));
  const repoSize = fitWords(m.repo, repoWidth, v.repo, 'mono', scale);
  const sentenceSize = fitWords(m.sentence, inner, v.sentence, 'sans', scale);
  const sentenceLh = Math.round((v.sentenceLh * sentenceSize) / v.sentence);
  const footWords = m.unreviewed ? 'not looked at yet' : m.eta;
  const footSize = footWords ? fitWords(footWords, lowerWidth, v.eta, 'sans', scale) : v.eta;

  const tile = (
    <GestureDetector gesture={gesture}>
      <Animated.View collapsable={false} style={styles.grow}>
        <Pressable
          onPress={onOpen ? onPress : undefined}
          accessibilityRole="button"
          accessibilityLabel={m.label}
          accessibilityHint="Opens the session"
          testID={`mission-tile-${m.id}`}
          // A press settles the tile a hair smaller, the way a printed card gives under a thumb
          // (`insights/Band.tsx`). Scale, not opacity: a hue at partial opacity reads brown.
          style={({ pressed }) => [styles.grow, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View
            ref={tileRef}
            onLayout={onLayout}
            style={[styles.tile, { width, minHeight, padding: v.pad, paddingBottom: v.pad + trackH, backgroundColor: ink.fill }]}
          >
            {/* Sized from the props until the tile has laid out, so its first frame is already
                covered: a flash of the whole colour before the print would be the print undone. */}
            {/* The run's hue, painted in from the creature's corner: a wash, never a fill. */}
            {!m.stale ? <Wash color={hue.ink} from="right" strength={0.2} /> : null}

            <Arrive delay={wordsAt} style={{ gap: v.gap }}>
              <View style={[styles.head, { gap: headGap }]}>
                <HarnessStamp harness={m.harness} size={v.logo} color={ink.stamp} />
                {/* The repository in full, however long: it wraps between words and after a
                    hyphen, it never ellipsizes ("pr…epo" was the bug) and it never breaks a
                    word. "private repo" is two words and says so. */}
                <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={[inked(repoSize, '600', ink.text), styles.repo]}>
                  {m.repo}
                </T>
              </View>
              <Animated.View key={m.sentence} entering={reduce ? undefined : FadeIn.duration(180)}>
                <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(sentenceSize, variant === 'half' ? '700' : '800', m.stale ? ink.dim : ink.text, sentenceLh)}>
                  {m.sentence}
                </T>
              </Animated.View>
            </Arrive>

            <View style={styles.spacer} />

            <Arrive delay={wordsAt + 60} style={{ paddingRight: v.creature + 6, gap: variant === 'half' ? 4 : 6, marginTop: v.gap }}>
              <StateRow m={m} v={v} ink={ink} width={lowerWidth} scale={scale} />
              <Figures m={m} v={v} ink={ink} variant={variant} width={variant === 'half' ? lowerWidth : lowerWidth / 2 - 8} scale={scale} delay={delay + 320} />
              {/* The line under the numbers says only what is honest: the ETA when the engine
                  answered, since when a wait began, when a stale row's numbers were taken, or
                  that a finished turn has not been looked at. A refused ETA says nothing here. */}
              {footWords && (m.unreviewed || footWords !== 'no ETA yet') ? (
                <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={inked(footSize, '600', ink.dim)}>
                  {footWords}
                </T>
              ) : null}
            </Arrive>

            <View pointerEvents="none" style={[styles.creature, { right: v.pad - 4, bottom: v.pad - 4 + trackH }]}>
              {/* The island's face: its eyes and its glow say the state before a word does. Only
                  the lead tile breathes and blinks; a grid of blinking creatures is noise. */}
              <Face animal={creature} state={m.stale ? 'sleep' : FACE_FOR_TILE[m.kind]} ink={ink.creature} size={v.creature} glow={!m.stale} alive={animate} />
            </View>

            {m.track !== null && box.w > 0 ? <FootTrack track={m.track} width={box.w} height={trackH} color={ink.text} delay={delay + 380} /> : null}
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );

  return (
    <Block enter={false} style={styles.grow}>
      {animate && !m.stale ? (
        // The aura: on this screen it means "an agent is driving this one, and it wants you".
        <View style={styles.grow}>
          {tile}
          <Aura radius={TILE_RADIUS} />
        </View>
      ) : (
        tile
      )}
    </Block>
  );
}

/**
 * The drawn state and its word. The word is the information; the glyph is how a glance finds it.
 * The word sits beside the glyph, set smaller if it must be to stay whole, or under the glyph with
 * the row's whole measure when beside it would be too small to read at a glance (`fit.stateLayout`).
 */
function StateRow({ m, v, ink, width, scale }: { m: TileModel; v: VariantSpec; ink: Inks; width: number; scale: number }) {
  let glyph: ReactNode = null;
  let text: string | null = null;
  if (m.stale) {
    glyph = <StateGlyph mark="stale" size={v.glyph} color={ink.dim} />;
    text = 'not updating';
  } else if (m.kind === 'needsYou') {
    glyph = <SymbolView name="hand.raised.fill" tintColor={ink.text} size={v.glyph} style={{ width: v.glyph, height: v.glyph }} />;
    text = 'needs you';
  } else if (m.kind === 'finished') {
    glyph = <StateGlyph mark="finished" size={v.glyph} color={ink.text} />;
    text = 'finished';
  } else if (m.verdict) {
    glyph = <InkVerdict verdict={m.verdict} size={v.glyph} color={ink.text} />;
    text = m.verdict;
  } else if (m.stateWord) {
    glyph = <StateGlyph mark="starting" size={v.glyph} color={ink.text} />;
    text = m.stateWord;
  } else if (m.kind === 'stalled') {
    glyph = <StateGlyph mark="quiet" size={v.glyph} color={ink.text} />;
    text = 'quiet';
  }
  if (!text) return null;
  const fit = stateLayout(text, width, v.glyph, STATE_GAP, v.state, scale);
  const word = inked(fit.size, '800', m.stale ? ink.dim : ink.text);
  return (
    <View style={fit.stacked ? styles.stateStacked : styles.state}>
      {glyph}
      <T maxFontSizeMultiplier={TILE_MAX_SCALE} style={[word, styles.shrink]}>
        {text}
      </T>
    </View>
  );
}

/**
 * The counted figures. A working tile: how long it has run and how many files it touched. A
 * finished one: what it landed, lines with their signs and commits (a hyphen before a number is
 * a sign, `copy/plain.hasDash` agrees). The half tile has room for one big number, so the second
 * is a line under it; the lead and the wide set both large, each with its word under it.
 */
function Figures({ m, v, ink, variant, width, scale, delay }: { m: TileModel; v: VariantSpec; ink: Inks; variant: TileVariant; width: number; scale: number; delay: number }) {
  const color = m.stale ? ink.dim : ink.text;
  const caption = inked(v.caption, '700', ink.dim);
  if (m.kind === 'finished' && m.landed) {
    const p = landedParts(m.landed);
    const commits = landedCommits(m.landed);
    const lines = [p.add, p.del].filter((x): x is string => x !== null).join(' ') || p.none;
    if (!lines && !commits) return null;
    const size = lines ? fitSize(lines, width, v.figure, 18) : v.figure;
    return (
      <View style={styles.figures}>
        {lines ? (
          <View>
            {p.add || p.del ? (
              <View style={styles.row}>
                {p.add ? (
                  <LiveNum value={m.landed.added ?? 0} final={p.add} figure={{ kind: 'count', prefix: '+' }} textStyle={inked(size, '800', color)} delay={delay} />
                ) : null}
                {p.add && p.del ? <View style={{ width: Math.round(size * 0.28) }} /> : null}
                {p.del ? (
                  <LiveNum value={m.landed.removed ?? 0} final={p.del} figure={{ kind: 'count', prefix: '-' }} textStyle={inked(size, '800', color)} delay={delay + 90} />
                ) : null}
              </View>
            ) : (
              <T style={inked(size, '800', color)}>{lines}</T>
            )}
            {variant !== 'half' ? <T style={caption}>lines</T> : null}
          </View>
        ) : null}
        {commits ? (
          <T style={variant === 'half' ? inked(fitWords(commits, width, v.eta + 1, 'sans', scale), '700', color) : caption}>{commits}</T>
        ) : null}
      </View>
    );
  }

  // A stale tile does not count the clock on: "52m so far" is a claim about now, and nothing has
  // arrived to vouch for it. Its file count stays, as the engine last took it ("as of" says when).
  const elapsedText = m.elapsedMin !== null && !m.stale ? elapsedLabel(m.elapsedMin * 60) : null;
  const filesText = m.files !== null ? commas(m.files) : null;
  const filesWord = m.files === 1 ? 'file' : 'files';
  if (!elapsedText && !filesText) return null;

  if (variant === 'half') {
    const size = elapsedText ? fitSize(elapsedText, width, v.figure, 20) : v.figure;
    return (
      <View>
        {elapsedText ? (
          <LiveNum value={m.elapsedMin! * 60} final={elapsedText} figure={{ kind: 'elapsed' }} textStyle={inked(size, '800', color, Math.round(size * 1.08))} delay={delay} accessibilityLabel={`${elapsedText} so far`} />
        ) : null}
        {filesText ? (
          <View style={styles.row}>
            <LiveNum value={m.files!} final={filesText} figure={{ kind: 'count' }} textStyle={inked(v.eta + 1, '800', color)} delay={delay + 120} accessibilityLabel={`${filesText} ${filesWord} touched`} />
            <T style={inked(v.eta + 1, '700', color)}>{` ${filesWord}`}</T>
          </View>
        ) : null}
      </View>
    );
  }

  const size = Math.min(
    elapsedText ? fitSize(elapsedText, width, v.figure, 22) : v.figure,
    filesText ? fitSize(filesText, width, v.figure, 22) : v.figure,
  );
  return (
    <View style={[styles.row, { gap: 22, alignItems: 'flex-start' }]}>
      {elapsedText ? (
        <View>
          <LiveNum value={m.elapsedMin! * 60} final={elapsedText} figure={{ kind: 'elapsed' }} textStyle={inked(size, '800', color, Math.round(size * 1.06))} delay={delay} accessibilityLabel={`${elapsedText} so far`} />
          <T style={caption}>so far</T>
        </View>
      ) : null}
      {filesText ? (
        <View>
          <LiveNum value={m.files!} final={filesText} figure={{ kind: 'count' }} textStyle={inked(size, '800', color, Math.round(size * 1.06))} delay={delay + 120} accessibilityLabel={`${filesText} ${filesWord} touched`} />
          <T style={caption}>{filesWord}</T>
        </View>
      ) : null}
    </View>
  );
}

/** Redrawn only when something it shows changes: the grid re-renders on a five second clock. */
export const MissionTile = React.memo(
  MissionTileImpl,
  (a, b) =>
    a.model.key === b.model.key &&
    a.animate === b.animate &&
    a.creature === b.creature &&
    a.variant === b.variant &&
    a.width === b.width &&
    a.minHeight === b.minHeight &&
    a.delay === b.delay &&
    a.onOpen === b.onOpen,
);

// ------------------------------------------------------------------ outside a chaptered page

/**
 * A reveal page for a printed block that lives outside a chaptered scroll view (the live bar on
 * the session screen, the Sessions tab's doorway), so it prints and counts on the same clock as
 * everything else. It plays once the block has sat still on screen for three frames (a push has
 * landed), the rule `insights/RevealScroll.tsx` holds a whole page to, and after
 * `ARM_FALLBACK_MS` whatever happened.
 */
export function StandaloneReveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { width: screenW } = useWindowDimensions();
  const ref = useAnimatedRef<Animated.View>();
  const still = useSharedValue(0);
  const lastX = useSharedValue(Number.NaN);
  const watch = useFrameCallback(() => {
    if (page.armed.value) return;
    const box = measure(ref);
    if (box && box.width > 0 && box.pageX > -1 && box.pageX < screenW) {
      still.value = Math.abs(box.pageX - lastX.value) < 0.5 ? still.value + 1 : 0;
      lastX.value = box.pageX;
      if (still.value >= 3) {
        page.viewport.value = 1e9;
        page.armed.value = 1;
      }
    } else {
      still.value = 0;
    }
  }, true);
  const stop = useCallback(() => watch.setActive(false), [watch]);
  useAnimatedReaction(
    () => page.armed.value,
    (armed) => {
      if (armed) runOnJS(stop)();
    },
  );
  useEffect(() => {
    const t = setTimeout(() => {
      page.viewport.value = 1e9;
      page.armed.value = 1;
    }, ARM_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [page]);
  return (
    <RevealPage page={page}>
      <Animated.View ref={ref} collapsable={false} style={style}>
        <Section>{children}</Section>
      </Animated.View>
    </RevealPage>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  comet: { margin: -COMET_OUT, padding: COMET_OUT },
  clip: { overflow: 'hidden' },
  tile: { flexGrow: 1, overflow: 'hidden', borderRadius: TILE_RADIUS, borderCurve: 'continuous' },
  head: { flexDirection: 'row', alignItems: 'center' },
  repo: { flex: 1, fontFamily: MONO_FAMILY },
  stamp: { borderRadius: radius.xs, borderCurve: 'continuous', backgroundColor: ON_HUE, alignItems: 'center', justifyContent: 'center' },
  spacer: { flexGrow: 1 },
  state: { flexDirection: 'row', alignItems: 'center', gap: STATE_GAP },
  stateStacked: { alignItems: 'flex-start', gap: 4 },
  shrink: { flexShrink: 1 },
  figures: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  creature: { position: 'absolute' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  sizer: { opacity: 0 },
  input: { padding: 0, margin: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: 'transparent' },
});
