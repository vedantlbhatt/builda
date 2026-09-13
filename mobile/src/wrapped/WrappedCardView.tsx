/**
 * One Wrapped card, the anatomy of DESIGN-DIRECTION 6: the card fill at radius 28, a 1pt
 * dashed outline inset 8pt (the kit's Skia `DashedFrame`), three 6pt window dots, the
 * dithered header in amber on the top half, then the question (15/600 amber), the answer
 * (the 56/800 tabular hero) and one sentence (17/400 dim).
 *
 * Three sizes of the one card: `story` (the full width stack, 3:4), `grid` (the two column
 * overview: question and answer only, the sentence is a tap away) and `share` (4:5, the
 * 1080 by 1350 export, with the wordmark at its foot).
 *
 * FIRST REVEAL ONLY: the hero counts up, and cards 9 and 13 decrypt their quote, the first
 * time `play` is true for this card; after that, and under Reduce Motion, the kit components
 * just show the answer. Once a reveal has started it is never switched off mid flight (the
 * decrypt would freeze on a scrambled frame if it were).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { ReportWrappedCard } from '../generated/report';
import { layout, space } from '../theme';
import { CountUp, DashedFrame, DecryptedText, Dots, SHAPE, T, useColors } from '../ui';
import { WINDOW_DOT } from '../ui/shape';
import { artFor, seedOf, type ArtSources } from './art';
import { CardArt } from './CardArt';
import type { Face } from './face';

export type CardVariant = 'story' | 'grid' | 'share';

/** Out of sight, still laid out: nothing under it moves when it appears. */
const HELD = { opacity: 0 } as const;

const METRICS: Record<CardVariant, { pad: number; cell: number; gap: number; minArt: number }> = {
  story: { pad: space.lg, cell: 3, gap: space.sm, minArt: 72 },
  share: { pad: space.lg, cell: 3, gap: space.sm, minArt: 72 },
  grid: { pad: layout.tilePad, cell: 2, gap: space.xs, minArt: 48 },
};

/** A story card is 3:4 (in app); a share card 4:5 (`tokens.card.portrait`, 1080 by 1350). */
export const STORY_RATIO = 4 / 3;
export const SHARE_RATIO = 5 / 4;

export interface WrappedCardViewProps {
  card: ReportWrappedCard;
  face: Face;
  sources: ArtSources;
  width: number;
  height: number;
  variant: CardVariant;
  /** Start the first reveal now (the card reached the front, or scrolled into view). */
  play: boolean;
  /**
   * This card's first reveal is still ahead of it (or the phone has not read yet whether it
   * is). Its counted answer and its quote are held out of sight until the reveal starts, so
   * a card waiting behind the stack, or a grid card a frame before it counts as on screen,
   * never shows its final number and then drops to 0 to count up to it.
   */
  pending?: boolean;
  delay?: number;
  /** Once, when this card's first reveal starts. */
  onRevealed?: () => void;
  /** The content layer's style: the stack dims the cards behind the front one. */
  contentStyle?: StyleProp<ViewStyle>;
}

export function WrappedCardView({
  card,
  face,
  sources,
  width,
  height,
  variant,
  play,
  pending = false,
  delay = 0,
  onRevealed,
  contentStyle,
}: WrappedCardViewProps) {
  const c = useColors();
  const m = METRICS[variant];
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Once a reveal has begun it stays begun for this card's life: a parent that marks the
  // card revealed and re-renders must not switch the count or the decrypt off mid flight.
  const started = useRef(false);
  if (play) started.current = true;
  const playing = started.current;
  const revealedRef = useRef(onRevealed);
  revealedRef.current = onRevealed;
  useEffect(() => {
    if (play) revealedRef.current?.();
  }, [play]);

  // The header's aspect decides how many weeks the activity grid shows (square days); a
  // tenth is fine enough that a rotation of the phone never recomputes it twice.
  const aspect = box ? Math.round((box.w / Math.max(1, box.h)) * 10) / 10 : null;
  const spec = useMemo(() => (aspect === null ? null : artFor(card, sources, aspect)), [card, sources, aspect]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - w) > 0.5 || Math.abs(box.h - h) > 0.5) setBox({ w, h });
  };

  // The header owns the top half of the card, under the dots, and gives way to the text
  // when an answer runs long, never below `minArt`.
  const artMax = Math.max(m.minArt, Math.floor(height / 2 - m.pad - WINDOW_DOT.size - space.tile));

  return (
    <View
      accessible
      accessibilityLabel={face.label}
      style={{
        width,
        height,
        backgroundColor: c.card,
        borderRadius: SHAPE.wrapped,
        borderCurve: 'continuous',
        padding: m.pad,
        overflow: 'hidden',
      }}
    >
      <DashedFrame />
      <Animated.View style={[{ flex: 1, justifyContent: 'space-between' }, contentStyle]}>
        <View style={{ flexShrink: 1, gap: space.tile }}>
          <Dots />
          <View onLayout={onLayout} style={{ height: artMax, minHeight: m.minArt, flexShrink: 1 }}>
            {box && spec ? <CardArt spec={spec} width={box.w} height={box.h} cell={m.cell} faded={!face.answered} /> : null}
          </View>
        </View>
        <View style={{ gap: m.gap, paddingTop: variant === 'grid' ? space.sm : space.md }}>
          <T role="row" tone="accent" numberOfLines={2}>
            {face.question}
          </T>
          <Answer face={face} variant={variant} play={playing} hidden={pending && !playing} delay={delay} />
          {variant === 'share' ? (
            <T role="label" tone="faint" style={{ marginTop: space.sm }}>
              Builda
            </T>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

function Answer({
  face,
  variant,
  play,
  hidden,
  delay,
}: {
  face: Face;
  variant: CardVariant;
  play: boolean;
  /** Hold the counted answer and the quote out of sight: their reveal has not started. */
  hidden: boolean;
  delay: number;
}) {
  const grid = variant === 'grid';
  const held = hidden ? HELD : null;

  if (!face.answered) {
    // The refusal is the answer: a sentence from the data, where the number would be.
    return (
      <T
        role={grid ? 'meta' : 'title'}
        tone={grid ? 'dim' : 'text'}
        numberOfLines={grid ? 4 : 5}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {face.refusal}
      </T>
    );
  }

  const quote = face.quote === null ? null : `“${face.quote}”`;
  return (
    <>
      {quote !== null ? (
        face.decrypt ? (
          <DecryptedText
            text={quote}
            role={grid ? 'row' : 'title'}
            play={play}
            seed={seedOf(face.id)}
            numberOfLines={grid ? 2 : 4}
            style={held}
          />
        ) : (
          <T role={grid ? 'row' : 'title'} numberOfLines={grid ? 2 : 4}>
            {quote}
          </T>
        )
      ) : null}

      {face.hero?.kind === 'count' ? (
        <CountUp
          to={face.hero.to}
          decimals={face.hero.decimals}
          grouping={face.hero.grouping}
          prefix={face.hero.prefix}
          suffix={face.hero.suffix}
          role={grid ? 'title' : 'hero'}
          play={play}
          delay={delay}
          style={held}
        />
      ) : null}
      {face.hero?.kind === 'words' ? (
        <T role={grid ? 'headline' : 'hero'} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.55}>
          {face.hero.text}
        </T>
      ) : null}

      {face.tail !== null ? (
        <T
          role={grid ? 'meta' : quote !== null ? 'headline' : 'title'}
          tone={grid ? 'dim' : 'text'}
          numberOfLines={grid ? 1 : 2}
        >
          {face.tail}
        </T>
      ) : null}

      {!grid && face.sentence !== null ? (
        <T role="body" tone="dim" numberOfLines={3}>
          {face.sentence}
        </T>
      ) : null}
      {!grid && face.note !== null ? (
        <T role="meta" tone="dim" numberOfLines={2}>
          {face.note}
        </T>
      ) : null}
    </>
  );
}
