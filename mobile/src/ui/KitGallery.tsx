/**
 * Every kit component in every state, on one scrolling page, for the verify step's
 * screenshots. Dev only: a route that mounts it belongs to whoever owns `app/`.
 *
 *   <KitGallery />                      the whole page
 *   <KitGallery section="dither" />     one block, for a focused screenshot
 *   <KitGallery scheme="light" />       the light column (widgets and the Lock Screen)
 *
 * The data is seeded, so two screenshots of the same build are identical.
 */
import { FractalNoise } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import type { ReportWrappedCard, WrappedCard } from '../generated/report';
import { tokens } from '../generated/tokens';
import { HarnessGlyph, HarnessLabel } from '../pixel/HarnessGlyph';
import { HarnessPicker } from '../pixel/HarnessPicker';
import { HARNESS_MARKS, type Harness } from '../pixel/harness';
import { ANIMALS, type Animal } from '../pixel/animals';
import { PixelCard } from './bits/components/PixelCard';
import { ComponentsGallery } from './bits/components/ComponentsGallery';
import { EffectsGallery } from './bits/effects/EffectsGallery';
import { BlurText, GradientText, RotatingText, ShinyText, Shuffle, SplitFlapText, SplitText, TextType } from './bits/text';
import { DotGrid, FieldDither, Grainient, PixelBlast, Radar, Silk, Topography, type BackgroundName } from './bits/backgrounds';
import { creatureTileInks, type TileState } from '../pixel/palette';
import { PixelAnimal, PixelAnimalIcon } from '../pixel/PixelAnimal';
import { PixelIcon } from '../pixel/PixelSprite';
import { archetypeHue, cardHue, creatureHue, harnessHue, HUE_NAMES, layout, space, typeRoles, type CreatureId, type HueName, type Scheme } from '../theme';
import { artFor, type ArtSources } from '../wrapped/art';
import { CardArt } from '../wrapped/CardArt';
import { SAMPLE_SOURCES, SAMPLE_WRAPPED } from '../wrapped/sample';
import { Button } from './Button';
import { Counter } from './Counter';
import { CountUp } from './CountUp';
import { DashedFrame } from './DashedFrame';
import { DecryptedText } from './DecryptedText';
import { mulberry32 } from './decrypt';
import { Dither, DitherField, fieldImage } from './Dither';
import { fieldFromFunction } from './dithering';
import { Dots } from './Dots';
import { haptics, HAPTIC_KINDS } from './haptics';
import { PressableScale } from './PressableScale';
import { Ring } from './Ring';
import { Row } from './Row';
import { SchemeProvider, useColors, useScheme } from './scheme';
import { Section } from './Section';
import { SHAPE, WINDOW_DOT } from './shape';
import { StatGrid, type StatItem } from './Stat';
import { Surface } from './Surface';
import { SymbolIcon } from './Symbol';
import { T } from './Text';
import { ROLES } from './typeStyle';
import { VERDICTS, VerdictGlyph, VerdictLabel } from './VerdictGlyph';

/**
 * The react-bits ports, one gallery section each (`section="clickspark"`). Each is drawn by the
 * gallery of the group that ported it, so the demo is the porter's own; `bits` is the index.
 */
export const BITS_SECTIONS = [
  // Animations
  'clickspark',
  'starborder',
  'glarehover',
  'animatedcontent',
  'pixelswap',
  'pixeltransition',
  'magnet',
  'logoloop',
  // Components
  'profilecard',
  'pixelcard',
  'carousel',
  'stepper',
  'spotlightcard',
  'tiltedcard',
  'cardswap',
  'stack',
  'bouncecards',
  'magicbento',
  'animatedlist',
  // TextAnimations
  'splittext',
  'blurtext',
  'shuffle',
  'texttype',
  'rotatingtext',
  'splitflaptext',
  'shinytext',
  'gradienttext',
  // Backgrounds
  'fielddither',
  'pixelblast',
  'silk',
  'grainient',
  'radar',
  'topography',
  'dotgrid',
] as const;

export type BitsSection = (typeof BITS_SECTIONS)[number];

export const GALLERY_SECTIONS = [
  'colour',
  'spectrum',
  'creatures',
  'harness',
  'type',
  'surfaces',
  'rows',
  'stats',
  'buttons',
  'symbols',
  'progress',
  'verdicts',
  'numbers',
  'dither',
  'wrapped',
  'haptics',
  'light',
  'bits',
  ...BITS_SECTIONS,
] as const;

export type GallerySection = (typeof GALLERY_SECTIONS)[number];

export interface KitGalleryProps {
  /** Render one block only. Default: all of them. */
  section?: GallerySection;
  /** Default dark, the app's scheme. */
  scheme?: Scheme;
  /** Seed for the sample data. Default 7. */
  seed?: number;
  /** Wrap in a ScrollView. Default true; false to embed in a host's own scroll. */
  scroll?: boolean;
}

export function KitGallery({ section, scheme = 'dark', seed = 7, scroll = true }: KitGalleryProps) {
  return (
    <SchemeProvider scheme={scheme}>
      <GalleryBody section={section} seed={seed} scroll={scroll} />
    </SchemeProvider>
  );
}

function GalleryBody({ section, seed, scroll }: { section?: GallerySection; seed: number; scroll: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const content = Math.min(width, 440) - layout.gutter * 2;
  const data = useMemo(() => sampleData(seed), [seed]);
  const show = (s: GallerySection) => section === undefined || section === s;

  const blocks = (
    <View style={styles.page}>
      {show('colour') ? <ColourBlock /> : null}
      {show('spectrum') ? <SpectrumBlock /> : null}
      {show('creatures') ? <CreaturesBlock width={content} /> : null}
      {show('harness') ? <HarnessBlock /> : null}
      {show('type') ? <TypeBlock /> : null}
      {show('surfaces') ? <SurfacesBlock /> : null}
      {show('rows') ? <RowsBlock /> : null}
      {show('stats') ? <StatsBlock /> : null}
      {show('buttons') ? <ButtonsBlock /> : null}
      {show('symbols') ? <SymbolsBlock /> : null}
      {show('progress') ? <ProgressBlock /> : null}
      {show('verdicts') ? <VerdictsBlock /> : null}
      {show('numbers') ? <NumbersBlock /> : null}
      {show('dither') ? <DitherBlock width={content} data={data} /> : null}
      {show('wrapped') ? <WrappedBlock width={content} data={data} /> : null}
      {show('haptics') ? <HapticsBlock /> : null}
      {show('light') ? <LightBlock /> : null}
      {section === undefined || section === 'bits' ? <BitsIndex /> : null}
      {isBitsSection(section) ? <BitsBlock id={section} /> : null}
    </View>
  );

  if (!scroll) return <View style={{ backgroundColor: c.bg }}>{blocks}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scroll}
    >
      {blocks}
    </ScrollView>
  );
}

// ─── sample data ───────────────────────────────────────────────────────────────────────

interface SampleData {
  /** 7 days by 20 weeks, activity levels 0..5 over 5. */
  grid: number[][];
  /** One session's activity, 160 samples. */
  strip: number[];
}

function sampleData(seed: number): SampleData {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 20 }, (_, w) => {
      const r = rnd();
      const weekday = d > 0 && d < 6 ? 0.15 : -0.1;
      const ramp = w / 40;
      const v = r + weekday + ramp;
      return v < 0.55 ? 0 : Math.min(5, Math.ceil((v - 0.55) * 9)) / 5;
    }),
  );
  const strip = Array.from({ length: 160 }, (_, i) => {
    const wave = 0.5 + 0.4 * Math.sin(i / 11) * Math.cos(i / 29);
    return Math.max(0, Math.min(1, wave + (rnd() - 0.5) * 0.25));
  });
  return { grid, strip };
}

// ─── blocks ────────────────────────────────────────────────────────────────────────────

function Block({ id, label, note, children }: { id: GallerySection; label: string; note?: string; children: ReactNode }) {
  return (
    <Section testID={`kit-${id}`} label={label} gap={space.tile}>
      {note ? (
        <T role="meta" tone="dim">
          {note}
        </T>
      ) : null}
      {children}
    </Section>
  );
}

function Spec({ children }: { children: ReactNode }) {
  return (
    <T role="mono" tone="faint" numberOfLines={1}>
      {children}
    </T>
  );
}

function ColourBlock() {
  const c = useColors();
  const groups: [string, [string, string][]][] = [
    ['surfaces', [['bg', c.bg], ['card', c.card], ['raised', c.raised], ['border', c.border]]],
    ['text', [['text', c.text], ['textDim', c.textDim], ['textFaint', c.textFaint], ['onAccent', c.onAccent]]],
    ['accent and data', [['accent', c.accent], ['pressed', c.accentPressed], ['add', c.data.add], ['del', c.data.del]]],
  ];
  return (
    <Block id="colour" label="colour" note="One action colour, one warm grey family, three data hues that are never chrome. Identity wears the spectrum below.">
      {groups.map(([name, swatches]) => (
        <View key={name} style={{ gap: space.sm }}>
          <T role="label" tone="faint">
            {name}
          </T>
          <View style={styles.swatchRow}>
            {swatches.map(([label, hex]) => (
              <View key={label} style={styles.swatch}>
                <View
                  style={{
                    height: 40,
                    borderRadius: SHAPE.mark,
                    borderCurve: 'continuous',
                    backgroundColor: hex,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                />
                <T role="meta" numberOfLines={1}>
                  {label}
                </T>
                <Spec>{hex}</Spec>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Block>
  );
}

/** Who first wears each hue: Bit amber, then the animal the spectrum gives it. */
const WEARER: Record<HueName, CreatureId> = Object.fromEntries(
  (Object.entries(tokens.spectrum.creature) as [CreatureId, HueName][]).map(([creature, hue]) => [hue, creature]),
) as Record<HueName, CreatureId>;

/** A creature at a size, Bit through his sprite and every animal through its own. */
function CreatureMark({ creature, size, tone }: { creature: CreatureId; size: number; tone?: 'rest' | 'idle' | 'selected' | 'faint' }) {
  return creature === 'bit' ? <PixelIcon state="idle" size={size} tone={tone} /> : <PixelAnimalIcon animal={creature} size={size} tone={tone} />;
}

function SpectrumBlock() {
  const c = useColors();
  return (
    <Block
      id="spectrum"
      label="spectrum"
      note="Nine hues for identity: an ink, a partner for the dither's middle tone, and a solid fill with dark ink. Never chrome, never a tinted chip."
    >
      <View style={styles.hueGrid}>
        {HUE_NAMES.map((name) => {
          const h = c.hues[name];
          return (
            <View key={name} style={styles.hueCell}>
              <View style={styles.hueBar}>
                <View style={{ flex: 2, backgroundColor: h.ink }} />
                <View style={{ flex: 1, backgroundColor: h.partner }} />
              </View>
              <View style={styles.inline}>
                <CreatureMark creature={WEARER[name]} size={16} />
                <T role="meta" weight={600} numberOfLines={1} style={{ color: h.text }}>
                  {name}
                </T>
              </View>
              <Spec>{h.ink}</Spec>
            </View>
          );
        })}
      </View>
      <View style={styles.inline}>
        {HUE_NAMES.map((name) => (
          <View key={name} style={[styles.fillChip, { backgroundColor: c.hues[name].fill }]}>
            <T role="label" style={{ color: c.hues[name].onFill }}>
              Aa
            </T>
          </View>
        ))}
      </View>
      <Spec>fill, dark ink on it: 5.2:1 or better</Spec>
    </Block>
  );
}

const CREATURES: readonly CreatureId[] = ['bit', ...ANIMALS];

/** A creature picker tile: the kit's PixelCard in the creature's hue, the harness picker's rule. */
function CreatureTile({ creature, state, width, onPress }: { creature: Animal; state: TileState; width: number; onPress: () => void }) {
  const scheme = useScheme();
  const rest = creatureTileInks(creature, state === 'missing' ? 'missing' : 'idle', scheme);
  const lit = creatureTileInks(creature, 'selected', scheme);
  return (
    <PixelCard hue={creatureHue(creature).name} selected={state === 'selected'} onPress={onPress} width={width} height={88} accessibilityLabel={creature}>
      {(face) => {
        const inks = face.filled ? lit : rest;
        return (
          <View style={{ gap: space.xs }}>
            <PixelAnimalIcon animal={creature} size={32} tone={face.filled ? 'selected' : state === 'missing' ? 'faint' : 'idle'} />
            <T role="meta" weight={600} style={{ color: inks.name }}>
              {creature}
            </T>
            <T role="label" style={{ color: inks.status }}>
              {face.filled ? 'selected' : state}
            </T>
          </View>
        );
      }}
    </PixelCard>
  );
}

function CreaturesBlock({ width }: { width: number }) {
  const [picked, setPicked] = useState<Animal>('owl');
  const tileW = Math.floor((width - space.tile * 2) / 3);
  const trio: Animal[] = ['fox', 'owl', 'whale'];
  return (
    <Block id="creatures" label="creatures" note="One ink per creature. The same grid, the same weight, the same eyes: only the ink differs.">
      <View style={styles.creatureRow}>
        {CREATURES.map((cr) => (
          <CreatureMark key={cr} creature={cr} size={32} />
        ))}
      </View>
      <Spec>rest: each in its own hue, 16x16 cells at 2pt</Spec>
      <View style={styles.inline}>
        <PixelAnimal key={picked} animal={picked} size={64} />
        <View style={{ flex: 1, gap: space.xs }}>
          <T role="headline" style={{ color: creatureHue(picked).text }}>
            the {picked}
          </T>
          <T role="meta" tone="dim">
            The one creature on this page that moves.
          </T>
        </View>
      </View>
      <View style={styles.tileRow}>
        {trio.map((a) => (
          <CreatureTile key={a} creature={a} width={tileW} state={a === picked ? 'selected' : a === 'whale' && picked !== 'whale' ? 'missing' : 'idle'} onPress={() => setPicked(a)} />
        ))}
      </View>
      <Spec>tiles: idle, selected, missing</Spec>
    </Block>
  );
}

const PICKER_FOUND: Partial<Record<Harness, number>> = {
  claude_code: 212,
  codex: 18,
  cursor_ide: 40,
  cursor_agent: 17,
  gemini_cli: 0,
  cline: 3,
  opencode: 0,
  aider: 1,
};

function HarnessBlock() {
  const [tools, setTools] = useState<Harness[]>(['claude_code', 'cursor_ide', 'cursor_agent']);
  return (
    <Block
      id="harness"
      label="harness glyphs"
      note="Where the harness is the object it wears its hue. Beside a session it stays dim: the session's creature carries that row's one hue."
    >
      <View style={styles.inline}>
        {HARNESS_MARKS.map((m) => (
          <HarnessGlyph key={m.id} harness={m.harnesses[0]!} size={32} labelled />
        ))}
      </View>
      <Surface style={{ gap: space.sm }}>
        <HarnessLabel harness="claude_code" />
        <HarnessLabel harness="codex" />
        <HarnessLabel harness="aider" />
        <Spec>a tools row: the glyph in its hue</Spec>
        <View style={styles.inline}>
          <PixelAnimalIcon animal="whale" size={16} />
          <T role="row">lantern</T>
          <HarnessLabel harness="claude_code" ink="dim" />
        </View>
        <Spec>a session row: the glyph stays dim</Spec>
      </Surface>
      <HarnessPicker selected={tools} onChange={setTools} found={PICKER_FOUND} />
      <Spec>the picker: tap a tile, it fills with its hue</Spec>
    </Block>
  );
}

const TYPE_SAMPLES: Record<(typeof ROLES)[number], string> = {
  hero: '108 words',
  display: '$4.99',
  title: 'Your longest session',
  headline: 'Stuck on the same failing import',
  body: 'Mostly conversational. You work in dialogue with the agent.',
  row: 'lantern',
  meta: 'Claude Code, 22m, 14 files',
  label: 'lines added',
  mono: 'claude-opus-5 ~/src/lantern',
};

function TypeBlock() {
  return (
    <Block id="type" label="type" note="Nine roles. SF Pro for words, SF Mono for machine data. Every number is tabular.">
      {ROLES.map((role) => {
        const r = typeRoles[role];
        return (
          <View key={role} style={{ gap: space.xs }}>
            <T role={role} numberOfLines={2}>
              {TYPE_SAMPLES[role]}
            </T>
            <Spec>
              {role} {r.size}/{r.weight}/{r.tracking} line {r.line} {r.maxScale === 1 ? 'fixed' : `scales to ${r.maxScale}x`}
            </Spec>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: space.lg }}>
        <T role="meta" tone="accent" weight={600}>
          needs you
        </T>
        <T role="meta" tone="add" weight={600}>
          +420
        </T>
        <T role="meta" tone="del" weight={600}>
          -88
        </T>
        <T role="meta" tone="human" weight={600}>
          3 commits
        </T>
      </View>
    </Block>
  );
}

function SurfacesBlock() {
  return (
    <Block id="surfaces" label="surfaces" note="Depth is a one step lift and a hairline. One shadow, only for things that float.">
      <Surface level="bg" hairline style={{ gap: space.tile }}>
        <Spec>bg, radius 18</Spec>
        <Surface level="card" style={{ gap: space.tile }}>
          <Spec>card, radius 18, 1pt border</Spec>
          <Surface level="raised" shape="inner">
            <Spec>raised, inner radius 12</Spec>
          </Surface>
        </Surface>
      </Surface>
      <Surface level="card" floating>
        <T role="row">Saved to Photos</T>
        <T role="meta" tone="dim">
          floating: the one shadow token
        </T>
      </Surface>
    </Block>
  );
}

function RowsBlock() {
  const [picked, setPicked] = useState(1);
  return (
    <Block id="rows" label="rows" note="Rows highlight to raised when pressed. They never scale.">
      <Surface padding={0}>
        <Row title="Sessions" meta="212 found on this Mac" chevron onPress={() => {}} hairline
          leading={<SymbolIcon name="clock" />} />
        <Row title="lantern" monoTitle meta="Claude Code" value="1h 42m" onPress={() => {}} hairline
          leading={<SymbolIcon name="folder" />} />
        <Row title="Notifications" value="on" chevron onPress={() => {}} hairline
          leading={<SymbolIcon name="bell" />} />
        <Row title="Remote control" meta="not in this version" disabled onPress={() => {}} hairline
          leading={<SymbolIcon name="lock" tone="faint" />} />
        <Row title="Read only row" meta="no press, no chevron" />
      </Surface>
      <Surface padding={0}>
        {['Newest first', 'Longest first', 'Most commits'].map((label, i, all) => (
          <Row
            key={label}
            title={label}
            selected={picked === i}
            haptic="select"
            onPress={() => setPicked(i)}
            hairline={i < all.length - 1}
            trailing={picked === i ? <SymbolIcon name="checkmark" tone="text" weight="semibold" /> : null}
          />
        ))}
      </Surface>
    </Block>
  );
}

const STATS: StatItem[] = [
  { value: '1.4M', label: 'tokens' },
  { value: '$12.40', label: 'api list price' },
  { value: '16h 00m', label: 'longest session' },
  { value: '+2,450', label: 'lines added', tone: 'add' },
  { value: '-318', label: 'lines removed', tone: 'del' },
  { value: null, label: 'commits', refusal: 'two sessions overlapped' },
];

function StatsBlock() {
  return (
    <Block id="stats" label="stats" note="Value over label, three up. A refused number is a sentence.">
      <Section
        label="this week"
        trailing={<Button kind="secondary" size="compact" block={false} label="See all" onPress={() => {}} />}
      >
        <Surface>
          <StatGrid items={STATS} />
        </Surface>
      </Section>
    </Block>
  );
}

function ButtonsBlock() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setBusy(false), 1600);
    return () => clearTimeout(id);
  }, [busy]);
  return (
    <Block id="buttons" label="buttons" note="Actions are capsules. Press scales to 0.97 over 120ms.">
      <Button label="Continue" onPress={() => setBusy(true)} busy={busy} busyLabel="Connecting" />
      <Button label="Continue" disabled />
      <Button label="Not now" kind="secondary" onPress={() => {}} />
      <View style={{ flexDirection: 'row', gap: space.tile }}>
        <Button label="Export" size="compact" block={false} haptic="commit" onPress={() => {}} />
        <Button label="Cancel" size="compact" kind="secondary" block={false} onPress={() => {}} />
      </View>
      <PressableScale onPress={() => {}} accessibilityLabel="A pressable card">
        <Surface style={{ gap: space.xs }}>
          <T role="headline">A card that presses</T>
          <T role="meta" tone="dim">
            hold it: 0.97 in, a spring home
          </T>
        </Surface>
      </PressableScale>
    </Block>
  );
}

function SymbolsBlock() {
  const names = ['chevron.right', 'clock', 'bell', 'folder', 'square.and.arrow.up', 'checkmark', 'xmark', 'hand.raised.fill'] as const;
  return (
    <Block id="symbols" label="symbols" note="SF Symbols for all chrome: regular at 17 in rows, semibold in the tab bar.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        {names.map((n) => (
          <SymbolIcon key={n} name={n} tone={n === 'hand.raised.fill' ? 'accent' : 'dim'} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'center' }}>
        <SymbolIcon name="square.grid.2x2" weight="semibold" size={22} tone="text" />
        <SymbolIcon name="person.crop.circle" weight="semibold" size={22} tone="faint" />
        <Spec>tab bar: semibold, active in text</Spec>
      </View>
    </Block>
  );
}

function ProgressBlock() {
  const [live, setLive] = useState(0.35);
  useEffect(() => {
    const id = setInterval(() => setLive((p) => (p >= 1.1 ? 0.2 : p + 0.15)), 1800);
    return () => clearInterval(id);
  }, []);
  const rings: [number | null, string][] = [
    [0, 'just started'],
    [0.72, 'about 18m left'],
    [1.3, 'running longer than usual'],
    [null, 'no ETA yet'],
  ];
  return (
    <Block id="progress" label="progress" note="Elapsed over typical. No ETA is a dotted track, never a spinner.">
      <View style={{ flexDirection: 'row', gap: space.tile }}>
        {rings.map(([p, caption]) => (
          <View key={caption} style={{ flex: 1, alignItems: 'flex-start', gap: space.sm }}>
            <Ring progress={p}>
              <T role="label" tone="text">
                {p === null ? '3' : Math.min(99, Math.round(p * 100)).toString()}
              </T>
            </Ring>
            <T role="meta" tone="dim" numberOfLines={3}>
              {caption}
            </T>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
        <Ring progress={live} size={24} />
        <Ring progress={null} size={24} />
        <Spec>minimal 24pt; the left one glides</Spec>
      </View>
    </Block>
  );
}

function VerdictsBlock() {
  return (
    <Block id="verdicts" label="verdicts" note="A drawn glyph and the word.">
      <View style={{ gap: space.sm }}>
        {VERDICTS.map((v) => (
          <VerdictLabel key={v} verdict={v} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'center' }}>
        {VERDICTS.map((v) => (
          <View key={v} style={{ flexDirection: 'row', gap: space.tile, alignItems: 'center' }}>
            <VerdictGlyph verdict={v} size={16} />
            <VerdictGlyph verdict={v} size={24} tone="text" />
          </View>
        ))}
      </View>
    </Block>
  );
}

function NumbersBlock() {
  const [files, setFiles] = useState(14);
  const [cost, setCost] = useState(3.42);
  const [replay, setReplay] = useState(0);
  const rnd = useMemo(() => mulberry32(11), []);
  useEffect(() => {
    const id = setInterval(() => {
      setFiles((f) => f + 1 + Math.floor(rnd() * 3));
      setCost((v) => Math.round((v + 0.07 + rnd() * 0.4) * 100) / 100);
    }, 1600);
    return () => clearInterval(id);
  }, [rnd]);
  return (
    <Block id="numbers" label="numbers" note="Live numbers roll. A number seen for the first time counts up once. A text effect finishes within 1.2s.">
      <Surface style={{ gap: space.tile }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ gap: space.xs }}>
            <Counter value={files} suffix=" files" />
            <T role="label" tone="dim">
              rolls on a SNAP spring
            </T>
          </View>
          <View style={{ gap: space.xs, alignItems: 'flex-end' }}>
            <Counter value={cost} decimals={2} prefix="$" role="headline" weight={700} />
            <T role="label" tone="dim">
              api list price
            </T>
          </View>
        </View>
        <View style={{ gap: space.xs }}>
          <Counter value={1204} role="headline" weight={700} />
          <T role="label" tone="dim">
            has never rolled: every column at rest since mount
          </T>
        </View>
      </Surface>
      <Surface style={{ gap: space.tile }}>
        <CountUp key={`c${replay}`} to={229367} role="display" />
        <T role="meta" tone="dim">
          lines across 1,000 commits and PRs worked
        </T>
        <DecryptedText key={`d${replay}`} text="Generalist" role="title" seed={replay + 3} />
        <T role="meta" tone="dim">
          No single working pattern dominates.
        </T>
        <Button label="Replay" kind="secondary" size="compact" block={false} onPress={() => setReplay((r) => r + 1)} />
      </Surface>
    </Block>
  );
}

function DitherBlock({ width, data }: { width: number; data: SampleData }) {
  const c = useColors();
  const inner = width - layout.tilePad * 2;
  const sphere = useMemo(
    () =>
      fieldImage(
        fieldFromFunction(120, 60, (u, v) => {
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 2 * 0.5 * 2;
          const d = Math.sqrt(dx * dx * 4 + dy * dy);
          if (d > 0.92) return 0;
          const light = Math.max(0, 1 - Math.hypot(dx * 2 + 0.5, dy + 0.4) * 0.6);
          return 1 - light * 0.9;
        }),
      ),
    [],
  );
  return (
    <Block id="dither" label="dither" note="One texture: ordered Bayer 8x8 or a 45 degree halftone. Amber unless a hue is given.">
      <Surface style={{ gap: space.tile }}>
        <DitherField width={inner} height={squareGridHeight(inner, data.grid)} grid={data.grid} cell={2} gap={1} accessibilityLabel="Activity, 20 weeks" />
        <Spec>grid: 20 weeks of real levels, cell 2</Spec>
        <DitherField width={inner} height={48} series={data.strip} shape="band" cell={2} />
        <Spec>series band: a session strip</Spec>
        <DitherField width={inner} height={48} series={data.strip} shape="area" cell={2} />
        <Spec>series area: checker fill, solid edge</Spec>
      </Surface>
      <View style={{ flexDirection: 'row', gap: space.tile }}>
        <Surface style={{ flex: 1, gap: space.sm }}>
          <Dither width={(inner - space.tile) / 2} height={72} image={sphere} fit="fill" />
          <Spec>image, bayer</Spec>
        </Surface>
        <Surface style={{ flex: 1, gap: space.sm }}>
          <Dither width={(inner - space.tile) / 2} height={72} image={sphere} fit="fill" mode="halftone" cell={4} />
          <Spec>image, halftone</Spec>
        </Surface>
      </View>
      <Surface style={{ gap: space.sm }}>
        <Dither width={inner} height={72} ink={c.hues.tide.ink}>
          <FractalNoise freqX={0.018} freqY={0.03} octaves={4} seed={2} />
        </Dither>
        <Spec>child shader: fractal noise, in tide</Spec>
      </Surface>
    </Block>
  );
}

const TILT = [-1.5, 1, -0.5, 1.5];

/** The height at which a grid's data cells come out square for `width`. */
function squareGridHeight(width: number, grid: number[][]): number {
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 1);
  return Math.floor((width / cols) * grid.length);
}

/** The sample deck, with its builder type, so cards two and three know card one's hue. */
const GALLERY_SOURCES: ArtSources = {
  ...SAMPLE_SOURCES,
  archetype: SAMPLE_WRAPPED.cards.find((c) => c.id === 'builder_type')?.value_id ?? null,
};

function sampleCard(id: WrappedCard): ReportWrappedCard {
  return SAMPLE_WRAPPED.cards.find((c) => c.id === id)!;
}

interface GalleryCard {
  id: WrappedCard;
  question: string;
  answer: number;
  suffix: string;
  sentence: string;
}

const BIG_CARD: GalleryCard = { id: 'prompt_length', question: 'How long are your prompts?', answer: 108, suffix: ' words', sentence: 'Mostly conversational.' };

const SMALL_CARDS: GalleryCard[] = [
  { id: 'agents_at_once', question: 'How many agents do you run?', answer: 3, suffix: ' at once', sentence: 'Three at the same moment.' },
  { id: 'streak', question: 'Your longest streak?', answer: 29, suffix: ' days', sentence: 'Straight, shipping something.' },
  { id: 'time_put_in', question: 'How much time did you put in?', answer: 129, suffix: ' hours', sentence: 'Across 55 sessions.' },
  { id: 'cryptic_prompt', question: 'Your most cryptic prompt?', answer: 10, suffix: ' letters', sentence: 'Somehow the agent knew.' },
];

function WrappedBlock({ width }: { width: number; data: SampleData }) {
  const small = (width - space.tile) / 2;
  return (
    // Share cards keep the dark palette in both schemes, so a screenshot looks the same.
    <SchemeProvider scheme="dark">
      <Block
        id="wrapped"
        label="wrapped card"
        note="Radius 28, dashed outline inset 8, window dots. Each card wears its own hue: the header in three levels, paper, partner and ink."
      >
        <WrappedCard width={width} card={BIG_CARD} />
        {[0, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row', gap: space.tile }}>
            {SMALL_CARDS.slice(row, row + 2).map((card, i) => (
              <View key={card.id} style={{ transform: [{ rotate: `${TILT[row + i]}deg` }] }}>
                <WrappedCard width={small} compact card={card} />
              </View>
            ))}
          </View>
        ))}
      </Block>
    </SchemeProvider>
  );
}

function WrappedCard({ width, card, compact = false }: { width: number; card: GalleryCard; compact?: boolean }) {
  const c = useColors();
  const height = Math.round((width * 4) / 3);
  const pad = compact ? layout.tilePad : space.lg;
  const art = width - pad * 2;
  // The dithered header owns the top half of the card, under the window dots.
  const header = Math.floor(height / 2 - pad - WINDOW_DOT.size - space.tile);
  const spec = useMemo(() => artFor(sampleCard(card.id), GALLERY_SOURCES, art / Math.max(1, header)), [card.id, art, header]);
  const tone = c.hues[spec.hue ?? cardHue(card.id, GALLERY_SOURCES.archetype).name];
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: c.card,
        borderRadius: SHAPE.wrapped,
        borderCurve: 'continuous',
        padding: pad,
        justifyContent: 'space-between',
      }}
    >
      <DashedFrame />
      <View style={{ gap: space.tile }}>
        <Dots />
        <CardArt spec={spec} width={art} height={header} cell={compact ? 2 : 3} />
      </View>
      <View style={{ gap: compact ? space.xs : space.sm }}>
        <T role="row" numberOfLines={2} style={{ color: tone.text }}>
          {card.question}
        </T>
        <CountUp to={card.answer} suffix={card.suffix} role={compact ? 'title' : 'hero'} />
        <T role={compact ? 'meta' : 'body'} tone="dim" numberOfLines={2}>
          {card.sentence}
        </T>
      </View>
    </View>
  );
}

function HapticsBlock() {
  return (
    <Block id="haptics" label="haptics" note="Five, one per action, on the same frame as the visual. Never on scroll or in loops.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg }}>
        {HAPTIC_KINDS.map((k) => (
          <Button key={k} label={k} kind="secondary" size="compact" block={false} onPress={() => haptics[k]()} />
        ))}
      </View>
    </Block>
  );
}

/**
 * The light column. The app ships dark, but widgets and the Lock Screen render light, so the
 * light values in tokens.json have to be real: the same parts, drawn on the light canvas.
 * Amber here is a fill with ink on it or a mark, never text (1.7:1 on this canvas).
 */
function LightBlock() {
  return (
    <Block id="light" label="light" note="The same parts on the light canvas, for widgets and the Lock Screen.">
      <SchemeProvider scheme="light">
        <LightPanel />
      </SchemeProvider>
    </Block>
  );
}

function LightPanel() {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: SHAPE.container,
        borderCurve: 'continuous',
        padding: layout.tilePad,
        gap: space.tile,
      }}
    >
      <Surface padding={0}>
        <Row title="lantern" monoTitle meta="Claude Code" value="22m" chevron onPress={() => {}} hairline
          leading={<SymbolIcon name="folder" />} />
        <Row title="Notifications" value="on" chevron onPress={() => {}} leading={<SymbolIcon name="bell" />} />
      </Surface>
      <Surface>
        <StatGrid items={STATS.slice(0, 5).concat([{ value: null, label: 'commits', refusal: 'two sessions overlapped' }])} />
      </Surface>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Ring progress={0.72}>
          <T role="label">72</T>
        </Ring>
        <Ring progress={null} />
        <View style={{ gap: space.xs }}>
          <VerdictLabel verdict="circling" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: WINDOW_DOT.size, height: WINDOW_DOT.size, borderRadius: SHAPE.mark, borderCurve: 'continuous', backgroundColor: c.accent }} />
            <T role="meta" weight={600}>
              needs you
            </T>
          </View>
        </View>
      </View>
      <View style={styles.creatureRow}>
        {CREATURES.map((cr) => (
          <CreatureMark key={cr} creature={cr} size={32} />
        ))}
      </View>
      <View style={styles.inline}>
        {HARNESS_MARKS.map((m) => (
          <HarnessGlyph key={m.id} harness={m.harnesses[0]!} size={32} />
        ))}
      </View>
      <Spec>light: each hue's 3:1 mark tone</Spec>
      <HarnessPicker selected={LIGHT_TOOLS} onChange={() => {}} />
      <Spec>light tiles: the text tone on raised</Spec>
      <Button label="Continue" onPress={() => {}} />
      <Button label="Not now" kind="secondary" onPress={() => {}} />
    </View>
  );
}

const LIGHT_TOOLS: Harness[] = ['codex', 'cline'];

// ─── bits: the react-bits ports ────────────────────────────────────────────────────────

interface BitsEntry {
  /** The component, as react-bits names it. */
  name: string;
  /** Where the original lives under `react-bits/src/ts-default/`. */
  from: string;
  /** Where Builda uses it. */
  use: string;
  /** The porter's own demo of it. */
  demo: () => ReactNode;
}

/** Each port's demo is the block its group's gallery draws for it, without that gallery's scroll. */
const BITS: Record<BitsSection, BitsEntry> = {
  clickspark: {
    name: 'ClickSpark',
    from: 'Animations/ClickSpark',
    use: 'commitments: Share, Export, pairing, a commit landing live',
    demo: () => <EffectsGallery section="spark" scroll={false} />,
  },
  starborder: {
    name: 'StarBorder',
    from: 'Animations/StarBorder',
    use: 'the one mission tile that needs you',
    demo: () => <EffectsGallery section="comet" scroll={false} />,
  },
  glarehover: {
    name: 'GlareHover',
    from: 'Animations/GlareHover',
    use: 'press sheen on Wrapped cards and the share preview',
    demo: () => <EffectsGallery section="glare" scroll={false} />,
  },
  animatedcontent: {
    name: 'AnimatedContent',
    from: 'Animations/AnimatedContent, Animations/FadeContent',
    use: 'Rise and Stagger: section and list entrances',
    demo: () => <EffectsGallery section="enter" scroll={false} />,
  },
  pixelswap: {
    name: 'PixelSwap',
    from: 'Animations/PixelSwap',
    use: 'the archetype reveal: the field becomes the creature',
    demo: () => <EffectsGallery section="swap" scroll={false} />,
  },
  pixeltransition: {
    name: 'PixelTransition',
    from: 'Animations/PixelTransition',
    use: 'hello to name; the Wrapped grid to the story',
    demo: () => <EffectsGallery section="transition" scroll={false} />,
  },
  magnet: {
    name: 'Magnet',
    from: 'Animations/Magnet',
    use: 'a primary button leaning toward the thumb',
    demo: () => <EffectsGallery section="magnet" scroll={false} />,
  },
  logoloop: {
    name: 'LogoLoop',
    from: 'Animations/LogoLoop',
    use: 'HarnessLoop: the harness glyphs in their hues',
    demo: () => <EffectsGallery section="loop" scroll={false} />,
  },
  profilecard: {
    name: 'ProfileCard',
    from: 'Components/ProfileCard',
    use: 'this is you: the end of onboarding, the You page share',
    demo: () => <ComponentsGallery section="profile" scroll={false} />,
  },
  pixelcard: {
    name: 'PixelCard',
    from: 'Components/PixelCard',
    use: 'the selected creature and harness tiles, filling in their hue',
    demo: () => <ComponentsGallery section="pixel" scroll={false} />,
  },
  carousel: {
    name: 'Carousel',
    from: 'Components/Carousel',
    use: 'the creature step and the icon picker',
    demo: () => <ComponentsGallery section="carousel" scroll={false} />,
  },
  stepper: {
    name: 'Stepper',
    from: 'Components/Stepper',
    use: 'onboarding progress',
    demo: () => <ComponentsGallery section="stepper" scroll={false} />,
  },
  spotlightcard: {
    name: 'SpotlightCard',
    from: 'Components/SpotlightCard',
    use: 'press on mission tiles and the You hero: a pool of pixels',
    demo: () => <ComponentsGallery section="spotlight" scroll={false} />,
  },
  tiltedcard: {
    name: 'TiltedCard',
    from: 'Components/TiltedCard',
    use: 'the share preview and the ProfileCard',
    demo: () => <ComponentsGallery section="tilted" scroll={false} />,
  },
  cardswap: {
    name: 'CardSwap',
    from: 'Components/CardSwap',
    use: "the You page's Wrapped entry",
    demo: () => <ComponentsGallery section="cardSwap" scroll={false} />,
  },
  stack: {
    name: 'Stack',
    from: 'Components/Stack',
    use: 'the Wrapped story',
    demo: () => <ComponentsGallery section="stack" scroll={false} />,
  },
  bouncecards: {
    name: 'BounceCards',
    from: 'Components/BounceCards',
    use: 'the Wrapped cover fan and its end',
    demo: () => <ComponentsGallery section="bounce" scroll={false} />,
  },
  magicbento: {
    name: 'MagicBento',
    from: 'Components/MagicBento',
    use: 'a tile grid with one shared light',
    demo: () => <ComponentsGallery section="bento" scroll={false} />,
  },
  animatedlist: {
    name: 'AnimatedList',
    from: 'Components/AnimatedList',
    use: 'the decisions feed, the Sessions list, the Stack page rows',
    demo: () => <ComponentsGallery section="list" scroll={false} />,
  },
  splittext: {
    name: 'SplitText',
    from: 'TextAnimations/SplitText',
    use: 'the hello, Wrapped questions, the archetype rule',
    demo: () => <TextDemo id="splittext" />,
  },
  blurtext: {
    name: 'BlurText',
    from: 'TextAnimations/BlurText',
    use: 'a title coming into focus a word at a time',
    demo: () => <TextDemo id="blurtext" />,
  },
  shuffle: {
    name: 'Shuffle',
    from: 'TextAnimations/Shuffle',
    use: 'Wrapped answers that are words, on every arrival',
    demo: () => <TextDemo id="shuffle" />,
  },
  texttype: {
    name: 'TextType',
    from: 'TextAnimations/TextType',
    use: 'the pairing command typing itself',
    demo: () => <TextDemo id="texttype" />,
  },
  rotatingtext: {
    name: 'RotatingText',
    from: 'TextAnimations/RotatingText',
    use: 'a short list said once, each name in its hue',
    demo: () => <TextDemo id="rotatingtext" />,
  },
  splitflaptext: {
    name: 'SplitFlapText',
    from: 'TextAnimations/SplitFlapText',
    use: 'the ETA changing state on tiles and the live bar',
    demo: () => <TextDemo id="splitflaptext" />,
  },
  shinytext: {
    name: 'ShinyText',
    from: 'TextAnimations/ShinyText',
    use: 'light crossing a label once, in three flat steps',
    demo: () => <TextDemo id="shinytext" />,
  },
  gradienttext: {
    name: 'GradientText',
    from: 'TextAnimations/GradientText',
    use: 'one hero word in flat bands of its hue',
    demo: () => <TextDemo id="gradienttext" />,
  },
  fielddither: {
    name: 'FieldDither',
    from: 'Backgrounds/Dither',
    use: 'the You hero, the creature step, the ProfileCard ground',
    demo: () => <FieldDemo id="fielddither" name="FieldDither" />,
  },
  pixelblast: {
    name: 'PixelBlast',
    from: 'Backgrounds/PixelBlast',
    use: 'the onboarding hello and the Now empty state; tap it',
    demo: () => <FieldDemo id="pixelblast" name="PixelBlast" />,
  },
  silk: {
    name: 'Silk',
    from: 'Backgrounds/Silk',
    use: 'a quiet band behind a card',
    demo: () => <FieldDemo id="silk" name="Silk" />,
  },
  grainient: {
    name: 'Grainient',
    from: 'Backgrounds/Grainient',
    use: 'a header printed in one hue',
    demo: () => <FieldDemo id="grainient" name="Grainient" />,
  },
  radar: {
    name: 'Radar',
    from: 'Backgrounds/Radar',
    use: 'pairing, and anything waiting',
    demo: () => <FieldDemo id="radar" name="Radar" />,
  },
  topography: {
    name: 'Topography',
    from: 'Backgrounds/Topography',
    use: 'the time lapse; press to raise a hill',
    demo: () => <FieldDemo id="topography" name="Topography" />,
  },
  dotgrid: {
    name: 'DotGrid',
    from: 'Backgrounds/DotGrid',
    use: 'the codebase map; tap or drag across it',
    demo: () => <FieldDemo id="dotgrid" name="DotGrid" />,
  },
};

/** The field's height in the gallery, the backgrounds gallery's own. */
const FIELD_HEIGHT = 180;

/**
 * One shader background, running (it is the only field on the page: DESIGN-V2 rule 2), with the
 * props the backgrounds gallery gives it. It pauses when the gallery screen is not focused or
 * the app is not active, which the field's own clock sees to.
 */
function FieldDemo({ id, name }: { id: BitsSection; name: BackgroundName }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const w = Math.floor(Math.min(width, 440) - layout.gutter * 2);
  const common = { width: w, height: FIELD_HEIGHT };
  const field =
    name === 'FieldDither' ? (
      <FieldDither {...common} develop interactive />
    ) : name === 'PixelBlast' ? (
      <PixelBlast {...common} density={0.8} interactive />
    ) : name === 'Silk' ? (
      <Silk {...common} />
    ) : name === 'Grainient' ? (
      <Grainient {...common} />
    ) : name === 'Radar' ? (
      <Radar {...common} />
    ) : name === 'Topography' ? (
      <Topography {...common} interactive />
    ) : (
      <DotGrid {...common} />
    );
  return (
    <View style={{ gap: space.sm, paddingHorizontal: layout.gutter }}>
      <T role="label" tone="dim">
        {name}
      </T>
      <T role="meta" tone="dim">
        {BITS[id].use}
      </T>
      <View style={[styles.fieldBox, { backgroundColor: c.card }]}>{field}</View>
    </View>
  );
}

type TextBitsSection = 'splittext' | 'blurtext' | 'shuffle' | 'texttype' | 'rotatingtext' | 'splitflaptext' | 'shinytext' | 'gradienttext';

const ETAS = ['no ETA yet', 'about 18m left', 'about 4m left'] as const;

/**
 * One text port, with a Replay. The text group's own gallery is one page with no sections, so the
 * kit draws each port here, with the props that gallery uses.
 */
function TextDemo({ id }: { id: TextBitsSection }) {
  const c = useColors();
  const [key, setKey] = useState(0);
  const replay = <Button label={id === 'splitflaptext' ? 'Change the ETA' : 'Replay'} kind="secondary" size="compact" block={false} onPress={() => setKey((k) => k + 1)} />;
  let body: ReactNode = null;
  switch (id) {
    case 'splittext':
      body = (
        <>
          <SplitText text="Hi. I'm Bit." role="display" replayKey={key} accessibilityRole="header" />
          <SplitText text="How long are your prompts?" by="words" role="row" hue={cardHue('prompt_length', null).name} replayKey={key} />
        </>
      );
      break;
    case 'blurtext':
      body = <BlurText text="Your 33 days of building" role="title" replayKey={key} />;
      break;
    case 'shuffle':
      body = <Shuffle text="Generalist" role="hero" seed={7} replayKey={key} />;
      break;
    case 'texttype':
      body = (
        <View style={[styles.well, { backgroundColor: c.raised }]}>
          <TextType text="npx builda pair 4821" replayKey={key} />
        </View>
      );
      break;
    case 'rotatingtext':
      body = (
        <RotatingText
          key={`r${key}`}
          texts={ROTATING_MARKS.map((m) => m.name)}
          colors={ROTATING_MARKS.map((m) => c.hues[harnessHue(m.id)?.name ?? 'cobalt'].text)}
          role="title"
        />
      );
      break;
    case 'splitflaptext':
      body = (
        <View style={[styles.well, { backgroundColor: c.card }]}>
          <SplitFlapText text={ETAS[key % ETAS.length]} seed={7} surface={c.card} />
        </View>
      );
      break;
    case 'shinytext':
      body = <ShinyText text="That's me" role="headline" replayKey={key} />;
      break;
    case 'gradienttext':
      body = <GradientText text="Architect" hue={archetypeHue('architect').name} role="display" replayKey={key} />;
      break;
  }
  return (
    <View style={{ gap: space.tile, paddingHorizontal: layout.gutter }}>
      <T role="label" tone="dim">
        {BITS[id].name}
      </T>
      <T role="meta" tone="dim">
        {BITS[id].use}
      </T>
      {body}
      {replay}
    </View>
  );
}

const ROTATING_MARKS = HARNESS_MARKS.slice(0, 3);

function isBitsSection(section: string | undefined): section is BitsSection {
  return section !== undefined && (BITS_SECTIONS as readonly string[]).includes(section);
}

/** Every port as a row; a tap opens its demo in place, so the whole page stays light. */
function BitsIndex() {
  const [open, setOpen] = useState<BitsSection | null>(null);
  return (
    <Block
      id="bits"
      label="bits"
      note="The react-bits ports, by David Haz, each kept to Builda's grain, hues and motion. Tap one to try it; section equal to its name opens it alone."
    >
      <Surface padding={0}>
        {BITS_SECTIONS.map((id, i) => (
          <Row
            key={id}
            title={BITS[id].name}
            meta={BITS[id].use}
            selected={open === id}
            haptic="select"
            onPress={() => setOpen((o) => (o === id ? null : id))}
            hairline={i < BITS_SECTIONS.length - 1}
            trailing={<SymbolIcon name={open === id ? 'chevron.down' : 'chevron.right'} tone="faint" />}
          />
        ))}
      </Surface>
      {open ? <BitsDemo id={open} /> : null}
    </Block>
  );
}

/** One port alone (`section="pixelswap"`). */
function BitsBlock({ id }: { id: BitsSection }) {
  return (
    <View style={{ gap: space.sm }}>
      <BitsDemo id={id} />
    </View>
  );
}

function BitsDemo({ id }: { id: BitsSection }) {
  const entry = BITS[id];
  return (
    <View testID={`kit-bits-${id}`} style={{ gap: space.sm }}>
      {/* The group galleries pad their own gutter; the kit page already has one. */}
      <View style={{ marginHorizontal: -layout.gutter }}>{entry.demo()}</View>
      <Spec>react-bits {entry.from}</Spec>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: layout.gutter, paddingBottom: space.xxl },
  page: { gap: layout.sectionGap, paddingTop: space.md },
  swatchRow: { flexDirection: 'row', gap: space.sm },
  swatch: { flex: 1, gap: space.xs },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  hueGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.tile },
  hueCell: { width: '30%', flexGrow: 1, gap: space.xs },
  hueBar: { flexDirection: 'row', height: 40, borderRadius: SHAPE.mark, borderCurve: 'continuous', overflow: 'hidden' },
  fillChip: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SHAPE.mark,
    borderCurve: 'continuous',
  },
  creatureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  well: { padding: layout.tilePad, borderRadius: SHAPE.inner, borderCurve: 'continuous' },
  fieldBox: { borderRadius: SHAPE.container, borderCurve: 'continuous', overflow: 'hidden' },
  tileRow: { flexDirection: 'row', gap: space.tile },
});
