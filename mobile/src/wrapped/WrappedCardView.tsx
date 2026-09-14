/**
 * One Wrapped card, in the house style (design-refs/HOUSE-STYLE.md): the whole card is a full
 * bleed band in its own hue, the question and the answer in dark ink, the answer HUGE, one
 * sentence, and under them the card's own data printed in the hue's three levels and alive
 * (`DataField`), with the builder's creature printed where the art has room.
 *
 *   StoryCard  story   the full height card in the story stack. It PLAYS the first time it
 *                      reaches the front: the question arrives word by word (react-bits
 *                      SplitText), a counted answer counts up from 0 in SF Pro Black (the
 *                      analysis page's `Num` on its reveal clock), a word answer flips in on a
 *                      departures board (react-bits SplitFlapText), the rest of the answer and
 *                      the sentence rise in (`BandWords`), the art prints itself and breathes,
 *                      the creature prints, blinks and gestures. A card seen before (per report,
 *                      `reveal.ts`) is simply there. Reduce Motion: at rest behind a 150 ms fade.
 *              share   the 4:5 export (1080 by 1350): the same card, still, with the wordmark.
 *   GridCard           the small card in the grid: its hue, the question, the answer, the art,
 *                      still.
 *
 * Nothing the card says is ever cut: the answer is fitted to the width, every other line wraps,
 * and if the words would squeeze the art under its floor, the answer gives way (`SQUEEZE`).
 * A refused card draws its refusal where the answer would be, as a sentence: never a 0, never a
 * dash, and its art is its seeded field thinned and still, so absence reads as absence.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { BandWords } from '../insights/Band';
import { fitSize, type NumSpec } from '../insights/format';
import { figure } from '../insights/kit';
import { ease, phase } from '../insights/motion';
import { Num } from '../insights/Num';
import { Block, RevealPage, Section, START_HOLD_MS, useClock, usePageReveal } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { MONO_FAMILY, type Hue } from '../theme';
import { PixelBlast } from '../ui/bits/backgrounds/PixelBlast';
import { SplitFlapText } from '../ui/bits/text/SplitFlapText';
import { SplitText } from '../ui/bits/text/SplitText';
import { fitCells, type Field } from '../ui/dithering';
import { useReduceMotion } from '../ui/motion';
import { SHAPE } from '../ui/shape';
import { artFor, artInset, fieldOf, seedOf } from './art';
import { PrintedCreature, StillCreature } from './Creature';
import { DataField } from './DataField';
import type { DeckItem } from './deckItems';
import { creatureSpot, printAxis } from './field';
import {
  CARD_TYPE,
  HERO_WEIGHT,
  nextSqueeze,
  ON_BAND,
  SQUEEZE,
  STAGE,
  STORY_COPY,
  flapLayout,
  gridLabel,
  heroOf,
  type CardType,
  type CardVariant,
  type StoryHero,
} from './story';

/** The 3pt grain, whole device pixels at @2x and @3x (tokens.dither.cell). */
const CELL = tokens.dither.cell;
/** The creature peeking in at the top right: 32pt, whole 2pt pixels (creatures come in 16s). */
const PEEK = 32;
/** The grid's grain: its cards are small. */
const GRID_CELL = 2;

type Motion = 'play' | 'still';

export interface StoryCardProps {
  item: DeckItem;
  hue: Hue;
  animal: Animal;
  width: number;
  height: number;
  variant: CardVariant;
  /** 1 based, for the corner: "07". */
  number: number;
  /** On top, and allowed to play (story only). */
  front?: boolean;
  /** Its first reveal happened already: read once, at mount; the card is simply there. */
  revealed?: boolean;
  /** Once, when its first reveal starts. */
  onPlayed?: () => void;
  /** Where the finger advanced the deck, in the card's points: the art's one ripple starts there. */
  ripple?: { x: number; y: number } | null;
  /** The stack dims the words and the art of the cards behind the front one (never the band). */
  contentStyle?: StyleProp<ViewStyle>;
}

export function StoryCard(props: StoryCardProps) {
  // Decided once: a card that starts to play and is then marked revealed must not swap its
  // whole tree for the still one mid count.
  const still = useRef(props.variant === 'share' || props.revealed === true).current;
  return still ? <CardBody {...props} motion="still" armed={false} /> : <PlayedCard {...props} />;
}

/** The analysis page's reveal clock, driven by the stack instead of a scroll: it plays when the card is armed. */
function PlayedCard(props: StoryCardProps) {
  const reduce = useReduceMotion();
  const page = usePageReveal(reduce);
  const [armed, setArmed] = useState(false);
  const onPlayed = useRef(props.onPlayed);
  onPlayed.current = props.onPlayed;
  useEffect(() => {
    // Every block of this page is "in view": the stack, not a scroll, says when it plays.
    page.viewport.value = 1_000_000;
  }, [page]);
  useEffect(() => {
    if (!props.front || armed) return;
    page.armed.value = 1;
    setArmed(true);
    onPlayed.current?.();
  }, [props.front, armed, page]);
  return (
    <RevealPage page={page}>
      <Section style={{ width: props.width, height: props.height }}>
        <Block enter={false} style={styles.fill}>
          <CardBody {...props} motion="play" armed={armed} />
        </Block>
      </Section>
    </RevealPage>
  );
}

function CardBody({
  item,
  hue,
  animal,
  width,
  height,
  variant,
  number,
  front = false,
  ripple,
  contentStyle,
  motion,
  armed,
}: StoryCardProps & { motion: Motion; armed: boolean }) {
  const ty = CARD_TYPE[variant];
  const inner = width - ty.pad * 2;
  const hero = useMemo(() => heroOf(item.face, item.card), [item]);
  const answered = item.face.answered;
  const isType = item.card.id === 'builder_type' && answered;
  const reduce = useReduceMotion();
  // The art breathes whenever a story card is in front, seen before or not (only its entrance
  // is first reveal only). A refusal's art is absence, so it never moves; nor does the export.
  const live = variant === 'story' && front && !reduce;
  const artStill = variant === 'share' || reduce || !answered;

  // The words are measured once laid out; if they would squeeze the art under its floor, the
  // answer steps down (never the question, never a sentence), and the art takes what is left.
  const [squeeze, setSqueeze] = useState(0);
  const [wordsH, setWordsH] = useState(0);
  const onWords = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      setWordsH(h);
      setSqueeze((s) => nextSqueeze(s, height, h, ty.minArt));
    },
    [height, ty.minArt],
  );
  const k = SQUEEZE[squeeze] ?? 1;

  const [art, setArt] = useState<{ w: number; h: number } | null>(null);
  const onArt = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setArt((b) => (b && Math.abs(b.w - w) < 0.5 && Math.abs(b.h - h) < 0.5 ? b : { w, h }));
  }, []);

  // Card 2's staircase keeps the card's inner margin (`art.artInset`); every other card's art runs to its edges.
  const inset = artInset(item.card.id, ty.pad);
  const box = art && art.h - inset >= CELL * 8 ? fitCells(art.w - inset * 2, art.h - inset, CELL) : null;
  const aspect = box ? Math.round((box.width / Math.max(1, box.height)) * 10) / 10 : null;
  const spec = useMemo(() => (aspect === null ? null : artFor(item.card, item.sources, aspect)), [item, aspect]);
  const field = useMemo(
    () => (spec && box && !isType ? fieldOf(spec, box.cols, box.rows, { faded: !answered }) : null),
    // `box` is rebuilt every render; its cols and rows are what the field depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, box?.cols, box?.rows, isType, answered],
  );
  const spot = useMemo(() => (field ? creatureSpot(field, CELL, ty.creature) : null), [field, ty.creature]);

  // Where the creature stands: card one's art is the creature; otherwise an empty corner of
  // the art; else beside a counted answer that leaves room; else it peeks in at the top right
  // (Duolingo's "in the corner, peeking in"), in a row that is always its height, so no
  // placement can move the layout that decides the placement.
  const creatureSize = ty.creature[ty.creature.length - 1]!;
  const heroCreature =
    !isType && field !== null && spot === null && hero.kind === 'count' ? heroRoom(hero.spec, inner, ty, k) >= creatureSize + 12 : false;
  const peek = !isType && field !== null && spot === null && !heroCreature;

  return (
    <View style={[styles.band, { width, height, backgroundColor: hue.ink }]}>
      <Animated.View style={[styles.fill, contentStyle]}>
        <View onLayout={onWords} style={{ paddingHorizontal: ty.pad, paddingTop: ty.pad - 2, paddingBottom: ty.artGap, gap: ty.gap }}>
          <View style={[styles.indexRow, { height: PEEK }]}>
            <Text allowFontScaling={false} style={[styles.index, { fontSize: ty.index }]}>
              {String(number).padStart(2, '0')}
            </Text>
            <View style={styles.indexEnd}>
              {peek ? <Creature animal={animal} size={PEEK} motion={motion} lively={answered} /> : null}
              {variant === 'share' ? (
                <Text allowFontScaling={false} style={[styles.wordmark, { fontSize: ty.index + 2 }]}>
                  {STORY_COPY.wordmark}
                </Text>
              ) : null}
            </View>
          </View>
          <Question text={item.face.question} ty={ty} motion={motion} armed={armed} />
          <View style={heroCreature ? styles.heroRow : null}>
            <View style={heroCreature ? styles.heroCell : null}>
              <Hero
                hero={hero}
                ty={ty}
                k={k}
                inner={heroCreature ? inner - creatureSize - 12 : inner}
                maxBoard={height * ty.boardShare * k}
                surface={hue.ink}
                seed={seedOf(item.card.id)}
                motion={motion}
                armed={armed}
              />
            </View>
            {heroCreature ? <Creature animal={animal} size={creatureSize} motion={motion} lively /> : null}
          </View>
          {hero.kind !== 'refusal' && item.face.tail ? (
            <Rise motion={motion} delay={STAGE.tail}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.tail, { fontSize: ty.tail, lineHeight: ty.tailLine }]}>
                {item.face.tail}
              </Text>
            </Rise>
          ) : null}
          {item.face.sentence ? (
            <Rise motion={motion} delay={STAGE.sentence}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.sentence, { fontSize: ty.sentence, lineHeight: ty.sentenceLine }]}>
                {item.face.sentence}
              </Text>
            </Rise>
          ) : null}
          {item.face.note ? (
            <Rise motion={motion} delay={STAGE.note}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.note, { fontSize: ty.note, lineHeight: ty.noteLine }]}>
                {item.face.note}
              </Text>
            </Rise>
          ) : null}
        </View>

        <View style={styles.fill} onLayout={onArt}>
          {art && box && isType ? (
            <TypeArt
              width={art.w}
              height={art.h}
              hue={hue}
              animal={animal}
              seed={seedOf(item.card.value_id ?? item.card.id)}
              creatureMax={Math.min(192, Math.floor((art.h - 16) / 16) * 16, Math.floor((art.w * 0.6) / 16) * 16)}
              motion={motion}
              live={live}
            />
          ) : null}
          {art && box && field && spec ? (
            <View style={[styles.fieldBox, { left: (art.w - box.width) / 2, top: art.h - inset - box.height, width: box.width, height: box.height }]}>
              <Field
                field={field}
                width={box.width}
                height={box.height}
                hue={hue}
                axis={printAxis(spec)}
                motion={motion}
                live={live && !artStill}
                still={artStill}
                ripple={ripple ? { x: ripple.x - (art.w - box.width) / 2, y: ripple.y - wordsH - (art.h - inset - box.height) } : null}
                seed={(seedOf(item.card.id) % 97) + 3}
              />
              {spot ? (
                <View style={[styles.spot, { left: spot.x, top: spot.y }]}>
                  <Creature animal={animal} size={spot.size} motion={motion} lively={answered} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

/** Points left beside a counted answer at its fitted size. */
function heroRoom(spec: NumSpec, inner: number, ty: CardType, k: number): number {
  const size = heroSize(spec.final, inner, ty, k);
  // `fitSize` with no clamp is the width's worth of ems: invert it for this text's width.
  const ems = (1000 * 0.94) / Math.max(1, fitSize(spec.final, 1000, 1_000_000, 0));
  return inner - ems * size;
}

function heroSize(final: string, inner: number, ty: CardType, k: number): number {
  return fitSize(final, inner * 0.97, Math.round(ty.heroMax * k), Math.round(ty.heroMin * k));
}

// ─── the words ──────────────────────────────────────────────────────────────────────────

function Question({ text, ty, motion, armed }: { text: string; ty: CardType; motion: Motion; armed: boolean }) {
  const look = useMemo<TextStyle>(
    () => ({ fontSize: ty.question, lineHeight: ty.questionLine, fontWeight: '700', letterSpacing: -0.3 }),
    [ty.question, ty.questionLine],
  );
  if (motion === 'still') {
    return (
      <Text maxFontSizeMultiplier={1.3} style={[look, { color: ON_BAND }]} accessibilityRole="header">
        {text}
      </Text>
    );
  }
  return (
    <SplitText
      text={text}
      by="words"
      textStyle={look}
      color={ON_BAND}
      maxFontSizeMultiplier={1.3}
      play={armed}
      delay={START_HOLD_MS + STAGE.question}
      accessibilityRole="header"
    />
  );
}

/** Rises in off the card's clock (the band's words), or is simply there. */
function Rise({ motion, delay, children }: { motion: Motion; delay: number; children: ReactNode }) {
  if (motion === 'still') return <View>{children}</View>;
  return <BandWords delay={delay}>{children}</BandWords>;
}

// ─── the answer ─────────────────────────────────────────────────────────────────────────

function Hero({
  hero,
  ty,
  k,
  inner,
  maxBoard,
  surface,
  seed,
  motion,
  armed,
}: {
  hero: StoryHero;
  ty: CardType;
  k: number;
  inner: number;
  maxBoard: number;
  surface: string;
  seed: number;
  motion: Motion;
  armed: boolean;
}) {
  if (hero.kind === 'count') {
    const size = heroSize(hero.spec.final, inner, ty, k);
    return motion === 'play' ? (
      <HeroNum spec={hero.spec} size={size} delay={STAGE.hero} />
    ) : (
      <Text allowFontScaling={false} style={figure(size, ON_BAND, HERO_WEIGHT)}>
        {hero.spec.final}
      </Text>
    );
  }
  if (hero.kind === 'refusal') {
    return (
      <Rise motion={motion} delay={STAGE.hero}>
        <View style={styles.refusal}>
          <View style={styles.refusalMark} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.refusalText, { fontSize: ty.refusal, lineHeight: ty.refusalLine }]}>
            {hero.text}
          </Text>
        </View>
      </Rise>
    );
  }
  const quote = hero.kind === 'quote';
  const layout = flapLayout(hero.text, inner, {
    maxSize: Math.round(ty.flapMax * k),
    minSize: Math.round((quote ? ty.quoteMin : ty.flapMin) * k),
    maxLines: quote ? ty.quoteLines : ty.flapLines,
    maxHeight: maxBoard,
  });
  if (!layout) {
    // Too long for the board at any size worth reading: the words as a paragraph, whole.
    const look: TextStyle = { fontSize: ty.refusal, lineHeight: ty.refusalLine, fontWeight: '700', letterSpacing: -0.3 };
    return motion === 'play' ? (
      <SplitText text={hero.text} by="words" textStyle={look} color={ON_BAND} maxFontSizeMultiplier={1.2} play={armed} delay={START_HOLD_MS + STAGE.hero} />
    ) : (
      <Text maxFontSizeMultiplier={1.2} style={[look, { color: ON_BAND }]}>
        {hero.text}
      </Text>
    );
  }
  const look: TextStyle = { fontFamily: MONO_FAMILY, fontSize: layout.size, lineHeight: layout.lineHeight, fontWeight: '800', letterSpacing: 0 };
  return motion === 'play' ? (
    <BoardPlay lines={layout.lines} look={look} surface={surface} seed={seed} armed={armed} />
  ) : (
    <View accessible accessibilityLabel={layout.lines.join(' ')}>
      {layout.lines.map((line, i) => (
        <Text key={i} allowFontScaling={false} style={[look, { color: ON_BAND }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** A counted answer: SF Pro Black (Strava's hero stat), from 0 to the answer's own spelling. */
function HeroNum({ spec, size, delay }: { spec: NumSpec; size: number; delay: number }) {
  const clock = useClock();
  // Out of sight until the count starts, so a card waiting behind the stack never shows 0.
  const fade = useAnimatedStyle(() => ({ opacity: ease(phase(clock.value, Math.max(0, delay - 160), 260)) }));
  return (
    <Animated.View style={fade}>
      <Num spec={spec} textStyle={figure(size, ON_BAND, HERO_WEIGHT)} delay={delay} />
    </Animated.View>
  );
}

/** The departures board: each line flips in after the one above it. */
function BoardPlay({ lines, look, surface, seed, armed }: { lines: string[]; look: TextStyle; surface: string; seed: number; armed: boolean }) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!armed) return;
    if (reduce) {
      setShown(lines.length);
      return;
    }
    const timers = lines.map((_, i) =>
      setTimeout(() => setShown((s) => Math.max(s, i + 1)), START_HOLD_MS + STAGE.hero + i * STAGE.boardLine),
    );
    return () => timers.forEach(clearTimeout);
  }, [armed, reduce, lines]);
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={lines.join(' ')}>
      {lines.map((line, i) => (
        // Each line holds its height before it flips in: an inline board gives its blank
        // tiles back, and the art under it must not move when the words arrive.
        <View key={i} style={{ height: look.lineHeight }}>
          <SplitFlapText
            text={i < shown ? line : ''}
            padTo={line.length}
            textStyle={look}
            color={ON_BAND}
            surface={surface}
            allowFontScaling={false}
            seed={seed + i}
          />
        </View>
      ))}
    </View>
  );
}

// ─── the art ────────────────────────────────────────────────────────────────────────────

function Field({
  field,
  width,
  height,
  hue,
  axis,
  motion,
  live,
  still,
  ripple,
  seed,
}: {
  field: Field;
  width: number;
  height: number;
  hue: Hue;
  axis: 0 | 1 | 2;
  motion: Motion;
  live: boolean;
  still: boolean;
  ripple: { x: number; y: number } | null;
  seed: number;
}) {
  if (motion === 'still') {
    // Printed already: no develop, but in front it still breathes.
    return (
      <DataField field={field} cell={CELL} width={width} height={height} ink={ON_BAND} partner={hue.partner} axis={axis} live={live} still={still} ripple={ripple} seed={seed} />
    );
  }
  return <PlayedField field={field} width={width} height={height} hue={hue} axis={axis} live={live} still={still} ripple={ripple} seed={seed} />;
}

function PlayedField({
  field,
  width,
  height,
  hue,
  axis,
  live,
  still,
  ripple,
  seed,
}: {
  field: Field;
  width: number;
  height: number;
  hue: Hue;
  axis: 0 | 1 | 2;
  live: boolean;
  still: boolean;
  ripple: { x: number; y: number } | null;
  seed: number;
}) {
  const develop = usePrint();
  return (
    <DataField
      field={field}
      cell={CELL}
      width={width}
      height={height}
      ink={ON_BAND}
      partner={hue.partner}
      axis={axis}
      develop={develop}
      live={live}
      still={still}
      ripple={ripple}
      seed={seed}
    />
  );
}

/** The art's print, off the card's reveal clock. */
function usePrint(): SharedValue<number> {
  const clock = useClock();
  return useDerivedValue(() => ease(phase(clock.value, STAGE.art, STAGE.artMs)));
}

/**
 * Card one's art is the builder: their creature, printed large, standing in a slow field of
 * react-bits PixelBlast clouds in the band's own tones, kept clear round it (PixelBlast's
 * `clear`, the way Bit stands in the Now tab's empty state).
 */
function TypeArt({
  width,
  height,
  hue,
  animal,
  seed,
  creatureMax,
  motion,
  live,
}: {
  width: number;
  height: number;
  hue: Hue;
  animal: Animal;
  seed: number;
  creatureMax: number;
  motion: Motion;
  live: boolean;
}) {
  const size = Math.max(48, creatureMax);
  const x = Math.round((width - size) / 2 / CELL) * CELL;
  const y = Math.max(0, height - size - 12);
  const clear = { x, y, width: size, height: size };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {motion === 'play' ? (
        <PlayedBlast width={width} height={height} hue={hue} seed={seed} clear={clear} live={live} />
      ) : (
        // Printed already; in front of the story it still drifts, on the share card it holds.
        <PixelBlast
          width={width}
          height={height}
          ink={ON_BAND}
          partner={hue.partner}
          paper="transparent"
          density={1.1}
          edgeFade={0.35}
          seed={seed % 60}
          clear={clear}
          paused={!live}
        />
      )}
      <View style={[styles.spot, { left: x, top: y }]}>
        <Creature animal={animal} size={size} motion={motion} lively at={STAGE.art + 120} />
      </View>
    </View>
  );
}

function PlayedBlast({
  width,
  height,
  hue,
  seed,
  clear,
  live,
}: {
  width: number;
  height: number;
  hue: Hue;
  seed: number;
  clear: { x: number; y: number; width: number; height: number };
  live: boolean;
}) {
  const develop = usePrint();
  return (
    <PixelBlast
      width={width}
      height={height}
      ink={ON_BAND}
      partner={hue.partner}
      paper="transparent"
      density={1.1}
      edgeFade={0.35}
      seed={seed % 60}
      clear={clear}
      reveal={develop}
      paused={!live}
    />
  );
}

function Creature({ animal, size, motion, lively, at }: { animal: Animal; size: number; motion: Motion; lively: boolean; at?: number }) {
  if (motion === 'still') return <StillCreature animal={animal} size={size} color={ON_BAND} />;
  return <PrintedCreature animal={animal} size={size} color={ON_BAND} lively={lively} at={at} />;
}

// ─── the grid's small card ──────────────────────────────────────────────────────────────

const GRID_PAD = 12;

/**
 * A card in the grid: its band, its number, the question, the answer set large, and its art,
 * still. The whole deck at a glance, fifteen hues.
 */
export function GridCard({ item, hue, width, height, number }: { item: DeckItem; hue: Hue; width: number; height: number; number: number }) {
  const inner = width - GRID_PAD * 2;
  const hero = useMemo(() => heroOf(item.face, item.card), [item]);
  const [art, setArt] = useState<{ w: number; h: number } | null>(null);
  const onArt = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setArt((b) => (b && Math.abs(b.w - w) < 0.5 && Math.abs(b.h - h) < 0.5 ? b : { w, h }));
  }, []);
  const inset = artInset(item.card.id, GRID_PAD);
  const box = art && art.h - inset >= GRID_CELL * 6 ? fitCells(art.w - inset * 2, art.h - inset, GRID_CELL) : null;
  const aspect = box ? Math.round((box.width / Math.max(1, box.height)) * 10) / 10 : null;
  const spec = useMemo(() => (aspect === null ? null : artFor(item.card, item.sources, aspect)), [item, aspect]);
  const field = useMemo(
    () => (spec && box ? fieldOf(spec, box.cols, box.rows, { faded: !item.face.answered }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, box?.cols, box?.rows, item.face.answered],
  );

  return (
    <View style={[styles.gridBand, { width, height, backgroundColor: hue.ink }]}>
      <View style={{ paddingHorizontal: GRID_PAD, paddingTop: GRID_PAD - 2, gap: 4 }}>
        <Text allowFontScaling={false} style={[styles.index, { fontSize: 11 }]}>
          {String(number).padStart(2, '0')}
        </Text>
        <Text maxFontSizeMultiplier={1.2} numberOfLines={3} style={styles.gridQuestion}>
          {item.face.question}
        </Text>
        <GridAnswer hero={hero} label={gridLabel(hero, item.face)} inner={inner} />
      </View>
      <View style={styles.fill} onLayout={onArt}>
        {art && box && field && spec ? (
          <View style={[styles.fieldBox, { left: (art.w - box.width) / 2, top: art.h - inset - box.height }]}>
            <DataField field={field} cell={GRID_CELL} width={box.width} height={box.height} ink={ON_BAND} partner={hue.partner} axis={printAxis(spec)} live={false} still seed={1} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function GridAnswer({ hero, label, inner }: { hero: StoryHero; label: string | null; inner: number }) {
  if (hero.kind === 'count') {
    const size = fitSize(hero.spec.final, inner, 44, 18);
    return (
      <View>
        <Text allowFontScaling={false} style={figure(size, ON_BAND, HERO_WEIGHT)}>
          {hero.spec.final}
        </Text>
        {/* What the number counts, as the story card says it under its own. */}
        {label ? (
          <Text maxFontSizeMultiplier={1.2} numberOfLines={2} style={styles.gridLabel}>
            {label}
          </Text>
        ) : null}
      </View>
    );
  }
  if (hero.kind === 'refusal') {
    return (
      <Text maxFontSizeMultiplier={1.2} numberOfLines={4} style={styles.gridRefusal}>
        {hero.text}
      </Text>
    );
  }
  return (
    <Text allowFontScaling={false} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.gridWords}>
      {hero.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  band: { borderRadius: SHAPE.wrapped, borderCurve: 'continuous', overflow: 'hidden' },
  gridBand: { borderRadius: SHAPE.container, borderCurve: 'continuous', overflow: 'hidden' },
  indexRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  indexEnd: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  index: { fontFamily: MONO_FAMILY, fontWeight: '600', color: ON_BAND, opacity: 0.62, fontVariant: ['tabular-nums'] },
  wordmark: { fontWeight: '800', letterSpacing: 0.2, color: ON_BAND },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  heroCell: { flexShrink: 1 },
  tail: { fontWeight: '600', letterSpacing: -0.2, color: ON_BAND },
  sentence: { fontWeight: '500', color: ON_BAND, opacity: 0.82 },
  note: { fontWeight: '500', color: ON_BAND, opacity: 0.7 },
  refusal: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  refusalMark: { width: 4, alignSelf: 'stretch', marginVertical: 3, backgroundColor: ON_BAND },
  refusalText: { flex: 1, fontWeight: '700', letterSpacing: -0.3, color: ON_BAND },
  fieldBox: { position: 'absolute' },
  spot: { position: 'absolute' },
  gridQuestion: { fontSize: 12, lineHeight: 15, fontWeight: '600', color: ON_BAND },
  gridWords: { fontSize: 20, lineHeight: 22, fontWeight: '800', letterSpacing: -0.4, color: ON_BAND },
  gridRefusal: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: ON_BAND },
  gridLabel: { fontSize: 13, lineHeight: 16, fontWeight: '700', letterSpacing: -0.1, color: ON_BAND, marginTop: 1 },
});
