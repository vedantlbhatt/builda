/**
 * Every effect port on one scrolling page, for the verify step's screenshots and for trying
 * each one with a finger. Dev only, like `KitGallery`: a route that mounts it belongs to
 * whoever owns `app/`, and it is not exported from the effects barrel (Metro does not tree
 * shake).
 *
 *   <EffectsGallery />                     every block
 *   <EffectsGallery section="comet" />     one block, for a focused screenshot
 *
 * Not a port: it only composes the ports in this folder.
 */
import { AlphaType, ColorType, ImageShader, Skia, ColorShader, FilterMode, MipmapMode, type SkImage } from '@shopify/react-native-skia';
import React, { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { ANIMAL_FRAMES } from '../../../pixel/animals';
import { GRID, type Frame } from '../../../pixel/frames';
import { PixelAnimal } from '../../../pixel/PixelAnimal';
import { cardHue, creatureHue, hue, layout, space, type Scheme } from '../../../theme';
import { Button } from '../../Button';
import { SchemeProvider, useColors } from '../../scheme';
import { Section } from '../../Section';
import { SHAPE } from '../../shape';
import { Surface } from '../../Surface';
import { T } from '../../Text';
import { AnimatedContent, Stagger } from './AnimatedContent';
import { ClickSpark, SparkBurst } from './ClickSpark';
import { GlareHover } from './GlareHover';
import { HarnessLoop } from './LogoLoop';
import { Magnet } from './Magnet';
import { PixelSwap } from './PixelSwap';
import { PixelTransition } from './PixelTransition';
import { StarBorder } from './StarBorder';

export const EFFECTS_GALLERY_SECTIONS = ['spark', 'comet', 'glare', 'enter', 'swap', 'transition', 'magnet', 'loop'] as const;
export type EffectsGallerySection = (typeof EFFECTS_GALLERY_SECTIONS)[number];

export interface EffectsGalleryProps {
  section?: EffectsGallerySection;
  /** Default dark, the app's scheme. */
  scheme?: Scheme;
  /** Wrap in a ScrollView. Default true. */
  scroll?: boolean;
}

export function EffectsGallery({ section, scheme = 'dark', scroll = true }: EffectsGalleryProps) {
  return (
    <SchemeProvider scheme={scheme}>
      <Body section={section} scroll={scroll} />
    </SchemeProvider>
  );
}

function Body({ section, scroll }: { section?: EffectsGallerySection; scroll: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const content = Math.min(width, 440) - layout.gutter * 2;
  const show = (id: EffectsGallerySection) => section === undefined || section === id;
  const blocks = (
    <View style={{ gap: space.section, paddingHorizontal: layout.gutter, paddingVertical: space.lg }}>
      {show('spark') ? <SparkBlock /> : null}
      {show('comet') ? <CometBlock width={content} /> : null}
      {show('glare') ? <GlareBlock width={content} /> : null}
      {show('enter') ? <EnterBlock /> : null}
      {show('swap') ? <SwapBlock /> : null}
      {show('transition') ? <TransitionBlock width={content} /> : null}
      {show('magnet') ? <MagnetBlock /> : null}
      {show('loop') ? <LoopBlock /> : null}
    </View>
  );
  if (!scroll) return <View style={{ backgroundColor: c.bg }}>{blocks}</View>;
  return <ScrollView style={{ backgroundColor: c.bg }}>{blocks}</ScrollView>;
}

function Block({ id, label, note, children }: { id: EffectsGallerySection; label: string; note: string; children: ReactNode }) {
  return (
    <Section testID={`fx-${id}`} label={label} gap={space.tile}>
      <T role="meta" tone="dim">
        {note}
      </T>
      {children}
    </Section>
  );
}

// ─── spark ─────────────────────────────────────────────────────────────────────────────

function SparkBlock() {
  const c = useColors();
  const [commits, setCommits] = useState(0);
  const tide = creatureHue('whale');
  return (
    <Block id="spark" label="click spark" note="On a commitment only. Tap Share, or land a commit on the strip.">
      <ClickSpark>
        <Button label="Share" haptic="commit" onPress={() => {}} />
      </ClickSpark>
      <View style={{ height: space.xl, justifyContent: 'center' }}>
        <View style={{ height: 3, backgroundColor: c.border }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none">
          <SparkBurst x={120} y={space.xl / 2} hue={tide} playKey={commits} />
        </View>
      </View>
      <Button kind="secondary" label="Land a commit" onPress={() => setCommits((n) => n + 1)} />
    </Block>
  );
}

// ─── comet ─────────────────────────────────────────────────────────────────────────────

function CometBlock({ width }: { width: number }) {
  const [key, setKey] = useState(0);
  const tile = (width - layout.tileGap) / 2;
  return (
    <Block id="comet" label="star border" note="Three laps round the one tile that needs you, then the edge stays lit.">
      <View style={{ flexDirection: 'row', gap: layout.tileGap }}>
        <StarBorder playKey={key}>
          <MockTile width={tile} creature="fox" sentence="Waiting on your answer about the auth migration." needsYou />
        </StarBorder>
        <MockTile width={tile} creature="whale" sentence="Converging on the parser fix, tests green." />
      </View>
      <Button kind="secondary" label="Needs you again" onPress={() => setKey((k) => k + 1)} />
    </Block>
  );
}

function MockTile({ width, creature, sentence, needsYou = false }: { width: number; creature: 'fox' | 'whale'; sentence: string; needsYou?: boolean }) {
  return (
    <Surface level="card" style={{ width, height: 188, justifyContent: 'space-between' }}>
      <T role="meta" tone={needsYou ? 'accent' : 'dim'} weight={needsYou ? 600 : undefined}>
        {needsYou ? 'needs you' : '22m'}
      </T>
      <T role="row" numberOfLines={4}>
        {sentence}
      </T>
      <View style={{ alignItems: 'flex-end' }}>
        <PixelAnimal animal={creature} size={48} paused={!needsYou} />
      </View>
    </Surface>
  );
}

// ─── glare ─────────────────────────────────────────────────────────────────────────────

function GlareBlock({ width }: { width: number }) {
  const c = useColors();
  const w = Math.min(width, 260);
  const h = Math.round((w * 4) / 3);
  const inkHue = cardHue('prompt_length', 'architect');
  return (
    <Block id="glare" label="glare hover" note="Press the card: one stepped band crosses it.">
      <GlareHover radius={SHAPE.wrapped} style={{ width: w }}>
        <View
          style={{
            width: w,
            height: h,
            backgroundColor: c.card,
            borderRadius: SHAPE.wrapped,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: c.border,
            padding: space.lg,
            justifyContent: 'flex-end',
            gap: space.sm,
          }}
        >
          <T role="row" style={{ color: inkHue.text }}>
            How long are your prompts?
          </T>
          <T role="display">108 words</T>
          <T role="body" tone="dim">
            Mostly conversational.
          </T>
        </View>
      </GlareHover>
    </Block>
  );
}

// ─── entrances ─────────────────────────────────────────────────────────────────────────

function EnterBlock() {
  const [trigger, setTrigger] = useState(0);
  const rows = ['lantern', 'tramline', 'quillwork', 'orchard', 'scratchpad'];
  return (
    <Block id="enter" label="animated content" note="Rows rise 8pt, 40ms apart, once. Replay to see it again.">
      <View style={{ gap: space.sm }}>
        <Stagger trigger={trigger} duration={240}>
          {rows.map((r) => (
            <Surface key={r} level="card" padding={layout.tilePad}>
              <T role="mono">{r}</T>
            </Surface>
          ))}
        </Stagger>
      </View>
      <AnimatedContent trigger={trigger} delay={360} distance={0}>
        <T role="meta" tone="dim">
          and a line that only fades
        </T>
      </AnimatedContent>
      <Button kind="secondary" label="Replay" onPress={() => setTrigger((t) => t + 1)} />
    </Block>
  );
}

// ─── pixel swap ────────────────────────────────────────────────────────────────────────

/** A creature frame as a 16 by 16 image: its ink on the card, nearest sampled when drawn. */
function frameImage(frame: Frame, ink: string, paper: string): SkImage | null {
  const channels = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const on = channels(ink);
  const off = channels(paper);
  const bytes = new Uint8Array(GRID * GRID * 4);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const ch = frame[y]?.[x] ?? '.';
      const px = ch === '.' ? off : on;
      const i = (y * GRID + x) * 4;
      bytes[i] = px[0];
      bytes[i + 1] = px[1];
      bytes[i + 2] = px[2];
      bytes[i + 3] = 255;
    }
  }
  return Skia.Image.MakeImage({ width: GRID, height: GRID, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(bytes), GRID * 4);
}

function SwapBlock() {
  const c = useColors();
  const [active, setActive] = useState(false);
  // 12pt a creature pixel, so every swap cell is exactly one pixel of the creature.
  const size = GRID * 12;
  const fox = useMemo(() => frameImage(ANIMAL_FRAMES.fox[0]!, creatureHue('fox').ink, c.card), [c.card]);
  const octopus = useMemo(() => frameImage(ANIMAL_FRAMES.octopus[0]!, creatureHue('octopus').ink, c.card), [c.card]);
  const rect = { x: 0, y: 0, width: size, height: size };
  const sampling = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };
  return (
    <Block id="swap" label="pixel swap" note="Tap Swap: the fox turns into the octopus cell by cell, in a spiral.">
      <PixelSwap
        width={size}
        height={size}
        active={active}
        first={fox ? <ImageShader image={fox} fit="fill" rect={rect} sampling={sampling} /> : <ColorShader color={c.card} />}
        second={octopus ? <ImageShader image={octopus} fit="fill" rect={rect} sampling={sampling} /> : <ColorShader color={hue('iris').ink} />}
        style={{ borderRadius: SHAPE.container, borderCurve: 'continuous', overflow: 'hidden' }}
      />
      <Button kind="secondary" label="Swap" onPress={() => setActive((a) => !a)} />
    </Block>
  );
}

// ─── pixel transition ──────────────────────────────────────────────────────────────────

function TransitionBlock({ width }: { width: number }) {
  const [story, setStory] = useState(false);
  const face = (title: string, line: string) => (
    <Surface level="card" style={{ width, height: 200, justifyContent: 'flex-end', gap: space.xs }}>
      <T role="title">{title}</T>
      <T role="meta" tone="dim">
        {line}
      </T>
    </Surface>
  );
  return (
    <Block id="transition" label="pixel transition" note="Cells in the card's coral cover the grid, the story comes up under them.">
      <PixelTransition active={story} hue="coral" first={face('Grid', 'fifteen cards, two columns')} second={face('Story', 'one card at a time')} />
      <Button kind="secondary" label="Switch" onPress={() => setStory((s) => !s)} />
    </Block>
  );
}

// ─── magnet ────────────────────────────────────────────────────────────────────────────

function MagnetBlock() {
  return (
    <Block id="magnet" label="magnet" note="Hold the button and slide: it leans toward your thumb, 6pt at most.">
      <Magnet>
        <ClickSpark>
          <Button label="That's me" haptic="commit" onPress={() => {}} />
        </ClickSpark>
      </Magnet>
    </Block>
  );
}

// ─── logo loop ─────────────────────────────────────────────────────────────────────────

function LoopBlock() {
  return (
    <Block id="loop" label="logo loop" note="The seven tools in their hues. A finger on the row stops it.">
      <HarnessLoop names />
    </Block>
  );
}
