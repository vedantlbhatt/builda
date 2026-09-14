/**
 * Every ported react-bits component in this folder on one scrolling page, in the spectrum, for
 * the verify step's screenshots and a finger to try them. Dev only: a route that mounts it
 * belongs to whoever owns `app/`, and it is deliberately not in the barrel (Metro does not tree
 * shake). The data is fixed, so two screenshots of one build match.
 *
 *   <ComponentsGallery />                       every section
 *   <ComponentsGallery section="pixel" />       one, for a focused screenshot
 *   <ComponentsGallery scheme="light" />        the light column
 *
 * The components are ported from react-bits by David Haz, MIT + Commons Clause (Copyright (c)
 * 2026 David Haz; the full notice is in each component's header; used as part of this
 * application, not redistributed). This page only shows them.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { HarnessGlyph } from '../../../pixel/HarnessGlyph';
import { HARNESS_MARKS } from '../../../pixel/harness';
import { ANIMALS, type Animal } from '../../../pixel/animals';
import { PixelAnimal, PixelAnimalIcon } from '../../../pixel/PixelAnimal';
import { creatureHue, harnessHue, hue as hueOf, layout, space, type HueName, type Scheme } from '../../../theme';
import { Button } from '../../Button';
import { SchemeProvider, useColors, useScheme } from '../../scheme';
import { SHAPE } from '../../shape';
import { T } from '../../Text';
import { AnimatedList } from './AnimatedList';
import { BounceCards } from './BounceCards';
import { CardSwap, type CardSwapHandle } from './CardSwap';
import { Carousel } from './Carousel';
import { MagicBento, type BentoItem } from './MagicBento';
import { PixelCard } from './PixelCard';
import { ProfileCard } from './ProfileCard';
import { SpotlightCard } from './SpotlightCard';
import { Stack } from './Stack';
import { Stepper } from './Stepper';
import { TiltedCard } from './TiltedCard';

export const COMPONENT_SECTIONS = [
  'profile',
  'pixel',
  'carousel',
  'stepper',
  'spotlight',
  'tilted',
  'cardSwap',
  'stack',
  'bounce',
  'bento',
  'list',
] as const;

export type ComponentSection = (typeof COMPONENT_SECTIONS)[number];

export interface ComponentsGalleryProps {
  section?: ComponentSection;
  scheme?: Scheme;
  /** Wrap in a ScrollView. Default true; false to embed in a host's own scroll. */
  scroll?: boolean;
}

export function ComponentsGallery({ section, scheme = 'dark', scroll = true }: ComponentsGalleryProps) {
  return (
    <SchemeProvider scheme={scheme}>
      <Body section={section} scroll={scroll} />
    </SchemeProvider>
  );
}

/** Five Wrapped style faces: a question in the card's hue, the answer, one sentence. */
const FACES: readonly { hue: HueName; creature: Animal; question: string; answer: string; line: string }[] = [
  { hue: 'ember', creature: 'fox', question: 'How many agents do you run?', answer: '3 at once', line: 'Most of the time, one leads.' },
  { hue: 'brass', creature: 'bee', question: 'How much did you ship?', answer: '229k lines', line: 'Across 1,000 commits.' },
  { hue: 'tide', creature: 'whale', question: 'How do you work?', answer: 'In dialogue', line: 'A back and forth with the agent.' },
  { hue: 'iris', creature: 'octopus', question: 'Your longest session?', answer: '16h 00m', line: 'The deepest stretch.' },
  { hue: 'orchid', creature: 'cat', question: 'Your go to prompt?', answer: '5 times', line: 'The same words, coming back.' },
];

function Body({ section, scroll }: { section?: ComponentSection; scroll: boolean }) {
  const c = useColors();
  const { width: screen } = useWindowDimensions();
  const content = Math.min(screen, 440) - layout.gutter * 2;
  const show = (s: ComponentSection) => section === undefined || section === s;

  const page = (
    <View style={{ paddingHorizontal: layout.gutter, paddingVertical: space.lg, gap: layout.sectionGap, backgroundColor: c.bg }}>
      {show('profile') ? (
        <Block title="ProfileCard" note="this is you: your creature on its field, leaning toward your finger">
          <ProfileCard creature="fox" name="Ada" archetype="the firefighter: you run toward what is on fire" width={content} />
        </Block>
      ) : null}
      {show('pixel') ? <PixelBlock width={content} /> : null}
      {show('carousel') ? <CarouselBlock width={content} /> : null}
      {show('stepper') ? <StepperBlock /> : null}
      {show('spotlight') ? <SpotlightBlock width={content} /> : null}
      {show('tilted') ? (
        <Block title="TiltedCard" note="hold and move: it leans, a stepped glare sweeps with it">
          <TiltedCard width={content} height={Math.round(content * 0.62)} glare floating>
            <Face face={FACES[1]!} width={content} height={Math.round(content * 0.62)} />
          </TiltedCard>
        </Block>
      ) : null}
      {show('cardSwap') ? <CardSwapBlock width={content} /> : null}
      {show('stack') ? (
        <Block title="Stack" note="throw the top card, or tap it: it tucks under the pile">
          <View style={{ alignItems: 'center', paddingVertical: space.lg }}>
            <Stack
              count={4}
              width={Math.round(content * 0.7)}
              height={Math.round(content * 0.9)}
              randomRotation
              labelFor={(i) => FACES[i]!.question}
              renderCard={(i) => <Face face={FACES[i]!} width={Math.round(content * 0.7)} height={Math.round(content * 0.9)} />}
            />
          </View>
        </Block>
      ) : null}
      {show('bounce') ? <BounceBlock width={content} /> : null}
      {show('bento') ? <BentoBlock width={content} /> : null}
      {show('list') ? <ListBlock /> : null}
    </View>
  );
  return scroll ? <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }}>{page}</ScrollView> : page;
}

function Block({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.tile }}>
      <View style={{ gap: space.xs }}>
        <T role="title">{title}</T>
        <T role="meta" tone="dim">
          {note}
        </T>
      </View>
      {children}
    </View>
  );
}

function Face({ face, width, height }: { face: (typeof FACES)[number]; width: number; height: number }) {
  const c = useColors();
  const scheme = useScheme();
  const tone = hueOf(face.hue, scheme);
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: c.card,
        borderRadius: SHAPE.wrapped,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: c.border,
        padding: space.lg,
        justifyContent: 'space-between',
      }}
    >
      <PixelAnimalIcon animal={face.creature} size={32} scheme={scheme} />
      <View style={{ gap: space.xs }}>
        <T role="meta" weight={600} style={{ color: tone.text }}>
          {face.question}
        </T>
        <T role="title" numberOfLines={1} adjustsFontSizeToFit>
          {face.answer}
        </T>
        <T role="meta" tone="dim" numberOfLines={2}>
          {face.line}
        </T>
      </View>
    </View>
  );
}

function PixelBlock({ width }: { width: number }) {
  const scheme = useScheme();
  const [creature, setCreature] = useState<Animal>('fox');
  const [tools, setTools] = useState<string[]>(['claude_code']);
  const tile = Math.floor((width - 2 * layout.tileGap) / 3);
  return (
    <Block title="PixelCard" note="the fill grows out of your finger in square cells">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap }}>
        {ANIMALS.slice(0, 6).map((a) => (
          <PixelCard
            key={a}
            hue={creatureHue(a, scheme).name}
            selected={creature === a}
            onPress={() => setCreature(a)}
            width={tile}
            height={tile}
            accessibilityLabel={a}
          >
            {(f) => (
              <View style={{ flex: 1, justifyContent: 'space-between' }}>
                <PixelAnimalIcon animal={a} size={32} scheme={scheme} tone={f.filled ? 'selected' : 'idle'} />
                <T role="meta" weight={600} style={{ color: f.text }}>
                  {a}
                </T>
              </View>
            )}
          </PixelCard>
        ))}
        {HARNESS_MARKS.slice(0, 3).map((m) => {
          const on = tools.includes(m.id);
          const tone = harnessHue(m.id, scheme);
          if (!tone) return null;
          return (
            <PixelCard
              key={m.id}
              hue={tone.name}
              selected={on}
              onPress={() => setTools((t) => (on ? t.filter((x) => x !== m.id) : [...t, m.id]))}
              width={tile}
              height={tile}
              accessibilityLabel={m.name}
            >
              {(f) => (
                <View style={{ flex: 1, justifyContent: 'space-between' }}>
                  <HarnessGlyph harness={m.harnesses[0]!} size={32} color={f.ink} />
                  <T role="meta" weight={600} numberOfLines={1} style={{ color: f.text }}>
                    {m.name}
                  </T>
                </View>
              )}
            </PixelCard>
          );
        })}
      </View>
    </Block>
  );
}

function CarouselBlock({ width }: { width: number }) {
  const scheme = useScheme();
  const [at, setAt] = useState(0);
  return (
    <Block title="Carousel" note={`drag or flick: ${ANIMALS[at]}, ${at + 1} of ${ANIMALS.length}`}>
      <Carousel
        items={ANIMALS}
        width={width}
        height={176}
        itemWidth={Math.round(width * 0.56)}
        loop
        onIndexChange={setAt}
        labelFor={(a) => a}
        accessibilityLabel="Creature"
        renderItem={(a, _i, { active }) => (
          <View
            style={{
              flex: 1,
              borderRadius: SHAPE.container,
              borderCurve: 'continuous',
              backgroundColor: creatureHue(a, scheme).fill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {active ? (
              <PixelAnimal animal={a} size={64} scheme={scheme} tone="selected" />
            ) : (
              <PixelAnimalIcon animal={a} size={64} scheme={scheme} tone="selected" />
            )}
          </View>
        )}
      />
    </Block>
  );
}

function StepperBlock() {
  const [step, setStep] = useState(1);
  return (
    <Block title="Stepper" note="the bar fills on the settle spring; the circles draw their check">
      <View style={{ gap: space.md }}>
        <Stepper steps={4} current={step} />
        <Stepper steps={4} current={step} variant="circles" onStepPress={setStep} />
        <Button label="Continue" onPress={() => setStep((s) => (s + 1) % 4)} />
      </View>
    </Block>
  );
}

function SpotlightBlock({ width }: { width: number }) {
  const half = (width - layout.tileGap) / 2;
  const tiles: readonly { hue: HueName; creature: Animal; repo: string; line: string }[] = [
    { hue: 'tide', creature: 'whale', repo: 'lantern', line: 'Rewriting the auth middleware.' },
    { hue: 'orchid', creature: 'cat', repo: 'tramline', line: 'Stuck on one failing import.' },
  ];
  return (
    <Block title="SpotlightCard" note="press and slide: a pool of pixels in the tile's hue">
      <View style={{ flexDirection: 'row', gap: layout.tileGap }}>
        {tiles.map((t) => (
          <SpotlightCard key={t.repo} hue={t.hue} onPress={() => {}} style={{ width: half }} accessibilityLabel={t.repo}>
            <View style={{ height: 132, justifyContent: 'space-between' }}>
              <T role="mono" tone="dim">
                {t.repo}
              </T>
              <T role="row" numberOfLines={3}>
                {t.line}
              </T>
              <View style={{ alignItems: 'flex-end' }}>
                <PixelAnimalIcon animal={t.creature} size={32} />
              </View>
            </View>
          </SpotlightCard>
        ))}
      </View>
    </Block>
  );
}

function CardSwapBlock({ width }: { width: number }) {
  const ref = useRef<CardSwapHandle>(null);
  const w = Math.round(width * 0.62);
  const h = Math.round(w * 0.72);
  return (
    <Block title="CardSwap" note="one swap when it arrives, then it rests; swap again to see it">
      <View style={{ gap: space.md }}>
        <CardSwap
          ref={ref}
          count={3}
          width={w}
          height={h}
          accessibilityLabel="Your Wrapped"
          onPress={() => ref.current?.swap()}
          renderFace={(i) => <Face face={FACES[i]!} width={w} height={h} />}
        />
        <Button label="Swap" kind="secondary" onPress={() => ref.current?.swap()} />
      </View>
    </Block>
  );
}

function BounceBlock({ width }: { width: number }) {
  const [round, setRound] = useState(0);
  const card = Math.round(width * 0.42);
  return (
    <Block title="BounceCards" note="the hand fans open; hold it and slide to spread it">
      <View style={{ gap: space.md }}>
        <BounceCards
          count={5}
          containerWidth={width}
          containerHeight={card + 64}
          cardWidth={card}
          cardHeight={card}
          replayKey={round}
          labelFor={(i) => FACES[i]!.question}
          onPress={() => {}}
          renderCard={(i) => <Face face={FACES[i]!} width={card} height={card} />}
        />
        <Button label="Play again" kind="secondary" onPress={() => setRound((r) => r + 1)} />
      </View>
    </Block>
  );
}

function BentoBlock({ width }: { width: number }) {
  const scheme = useScheme();
  const items = useMemo<BentoItem[]>(
    () =>
      FACES.slice(0, 5).map((f, i) => ({
        key: f.question,
        hue: f.hue,
        span: i === 0 ? 2 : 1,
        rows: i === 3 ? 2 : 1,
        accessibilityLabel: `${f.question} ${f.answer}`,
        children: (
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            <PixelAnimalIcon animal={f.creature} size={32} scheme={scheme} />
            <View>
              <T role="meta" weight={600} numberOfLines={1} style={{ color: hueOf(f.hue, scheme).text }}>
                {f.question}
              </T>
              <T role="headline" weight={700} numberOfLines={1}>
                {f.answer}
              </T>
            </View>
          </View>
        ),
      })),
    [scheme],
  );
  return (
    <Block title="MagicBento" note="one light across the grid; the tile under your finger leans">
      <MagicBento items={items} width={width} />
    </Block>
  );
}

interface Decision {
  id: string;
  creature: Animal;
  title: string;
  meta: string;
}

const DECISIONS: readonly Decision[] = [
  { id: 'd1', creature: 'fox', title: 'Kept the retry inside the client', meta: 'lantern, 2m ago' },
  { id: 'd2', creature: 'whale', title: 'Moved the cache key to the session id', meta: 'lantern, 9m ago' },
  { id: 'd3', creature: 'bee', title: 'Dropped the second parser', meta: 'tramline, 21m ago' },
  { id: 'd4', creature: 'owl', title: 'Split the migration in two', meta: 'tramline, 40m ago' },
];

const MORE: readonly Decision[] = [
  { id: 'd5', creature: 'octopus', title: 'Pinned the SDK to 53', meta: 'lantern, just now' },
  { id: 'd6', creature: 'crab', title: 'Wrote the test before the fix', meta: 'lantern, just now' },
];

function ListBlock() {
  const c = useColors();
  const [rows, setRows] = useState<Decision[]>([...DECISIONS]);
  const [picked, setPicked] = useState<string | null>(null);
  const add = useCallback(() => {
    setRows((r) => {
      const next = MORE.find((m) => !r.some((x) => x.id === m.id));
      return next ? [next, ...r] : r;
    });
  }, []);
  return (
    <Block title="AnimatedList" note="rows enter once; a new one slides in at the top">
      <View style={{ gap: space.md }}>
        <View style={{ backgroundColor: c.card, borderRadius: SHAPE.container, borderCurve: 'continuous', overflow: 'hidden' }}>
          <AnimatedList
            data={rows}
            scroll={false}
            keyExtractor={(d) => d.id}
            selectedKey={picked}
            onItemPress={(d) => setPicked(d.id)}
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile, paddingHorizontal: layout.tilePad, paddingVertical: space.tile }}>
                <PixelAnimalIcon animal={item.creature} size={32} />
                <View style={{ flex: 1 }}>
                  <T role="row" numberOfLines={1}>
                    {item.title}
                  </T>
                  <T role="meta" tone="dim">
                    {item.meta}
                  </T>
                </View>
              </View>
            )}
          />
        </View>
        <Button label="Add a decision" kind="secondary" onPress={add} />
      </View>
    </Block>
  );
}
