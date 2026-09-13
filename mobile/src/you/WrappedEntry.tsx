import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { QUESTIONS } from '../copy/catalog';
import { capital } from '../copy/numbers';
import { renderCard } from '../copy/wrapped';
import type { Profile } from '../data/api';
import type { ReportWrappedCard } from '../generated/report';
import { space } from '../theme';
import { DashedFrame, DitherField, Dots, PressableScale, SHAPE, SymbolIcon, T, useColors } from '../ui';
import { activityGrid } from './pages';

/** Weeks of active hours the header dithers: the quarter the contribution grid shows. */
const WEEKS = 17;
/** The dithered band's height: the card's top, under the window dots. */
const ART_HEIGHT = 72;

/**
 * The way into Wrapped, drawn as its first card (DESIGN-DIRECTION 6's anatomy): the 28pt card
 * with the dashed outline and the window dots, an amber dither on top, the question in amber,
 * the answer under it and its one sentence. The dither is this person's own last seventeen weeks
 * of active hours, not an illustration, so the card is theirs before it is opened.
 *
 * With the Mac's Wrapped deck, the card is its first card as the deck renders it
 * (`src/copy/wrapped.ts renderCard`), refusal included. Without it, the question and the type
 * the hero above shows. It presses like a card (scale 0.97) and opens the story over the tabs.
 */
export function WrappedEntry({
  card,
  answer,
  line,
  graph,
}: {
  /** The deck's `builder_type` card, when the Mac sent the deck. */
  card: ReportWrappedCard | null;
  /** Without the deck: the builder type, as the hero says it. */
  answer: string | null;
  /** "13 of 15 questions answered", or null when the Mac has not sent the deck. */
  line: string | null;
  graph: Profile['graph'] | null;
}) {
  const router = useRouter();
  const c = useColors();
  const [width, setWidth] = useState(0);
  const grid = useMemo(() => activityGrid(graph ?? [], WEEKS), [graph]);
  const rendered = useMemo(() => (card ? renderCard(card) : null), [card]);
  const question = rendered?.question ?? QUESTIONS.builder_type;
  const display = rendered ? rendered.display : answer;
  const sentence = rendered ? (rendered.sentence ?? (rendered.refusal ? capital(rendered.refusal) : null)) : null;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };

  return (
    <PressableScale
      onPress={() => router.push('/wrapped')}
      accessibilityLabel={`Wrapped. ${question}${display ? ` ${display}.` : ''}`}
      accessibilityHint="Opens the fifteen cards"
    >
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: SHAPE.wrapped,
          borderCurve: 'continuous',
          padding: space.lg,
          gap: space.md,
        }}
      >
        <DashedFrame />
        <View style={{ gap: space.tile }} onLayout={onLayout}>
          <Dots />
          {width > 0 && graph && graph.length > 0 ? (
            <DitherField width={width} height={ART_HEIGHT} grid={grid} cell={2} />
          ) : (
            <View style={{ height: ART_HEIGHT }} />
          )}
        </View>
        <View style={{ gap: space.xs }}>
          <T role="row" tone="accent" numberOfLines={2}>
            {question}
          </T>
          {display ? (
            <T role="title" numberOfLines={2}>
              {display}
            </T>
          ) : null}
          {sentence ? (
            <T role="meta" tone="dim" numberOfLines={3}>
              {sentence.endsWith('.') ? sentence : `${sentence}.`}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
            <T role="meta" tone="dim" style={{ flex: 1 }} numberOfLines={1}>
              {line ?? 'fifteen questions about how you build'}
            </T>
            <SymbolIcon name="chevron.right" size={13} weight="semibold" tone="faint" />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}
