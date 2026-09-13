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

import { layout, space, typeRoles, type Scheme } from '../theme';
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
import { SchemeProvider, useColors } from './scheme';
import { Section } from './Section';
import { SHAPE, WINDOW_DOT } from './shape';
import { StatGrid, type StatItem } from './Stat';
import { Surface } from './Surface';
import { SymbolIcon } from './Symbol';
import { T } from './Text';
import { ROLES } from './typeStyle';
import { VERDICTS, VerdictGlyph, VerdictLabel } from './VerdictGlyph';

export const GALLERY_SECTIONS = [
  'colour',
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
    <Block id="colour" label="colour" note="One accent, one warm grey family, three data hues that are never chrome.">
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

const TYPE_SAMPLES: Record<(typeof ROLES)[number], string> = {
  hero: '108 words',
  display: '$4.99',
  title: 'Your longest session',
  headline: 'Stuck on the same failing import',
  body: 'Mostly conversational. You work in dialogue with the agent.',
  row: 'builder',
  meta: 'Claude Code, 22m, 14 files',
  label: 'lines added',
  mono: 'claude-opus-5 ~/src/builder',
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
        <Row title="builder" monoTitle meta="Claude Code" value="1h 42m" onPress={() => {}} hairline
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
  { value: '16h 0m', label: 'longest session' },
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
    <Block id="verdicts" label="verdicts" note="A drawn glyph and the word. No colour.">
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
    <Block id="numbers" label="numbers" note="Live numbers roll. First reveals count up once. Decrypt is for two cards only.">
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
    <Block id="dither" label="dither" note="One texture. Ordered Bayer 8x8 or a 45 degree halftone, amber on the card.">
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
        <Dither width={inner} height={72}>
          <FractalNoise freqX={0.018} freqY={0.03} octaves={4} seed={2} />
        </Dither>
        <Spec>child shader: fractal noise</Spec>
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

function WrappedBlock({ width, data }: { width: number; data: SampleData }) {
  const small = (width - space.tile) / 2;
  return (
    // Share cards keep the dark palette in both schemes, so a screenshot looks the same.
    <SchemeProvider scheme="dark">
      <Block id="wrapped" label="wrapped card" note="Radius 28, dashed outline inset 8, window dots, amber dither on top.">
        <WrappedCard width={width} question="How long are your prompts?" answer={108} suffix=" words" sentence="Mostly conversational." strip={data.strip} />
        <View style={{ flexDirection: 'row', gap: space.tile }}>
          {[0, 1].map((i) => (
            <View key={i} style={{ transform: [{ rotate: `${TILT[i]}deg` }] }}>
              <WrappedCard
                width={small}
                compact
                question={i === 0 ? 'How many agents do you run?' : 'Your longest streak?'}
                answer={i === 0 ? 3 : 29}
                suffix={i === 0 ? ' at once' : ' days'}
                sentence={i === 0 ? 'Three at the same moment.' : 'Straight, shipping something.'}
                grid={data.grid}
              />
            </View>
          ))}
        </View>
      </Block>
    </SchemeProvider>
  );
}

function WrappedCard({
  width,
  question,
  answer,
  suffix,
  sentence,
  strip,
  grid,
  compact = false,
}: {
  width: number;
  question: string;
  answer: number;
  suffix: string;
  sentence: string;
  strip?: number[];
  grid?: number[][];
  compact?: boolean;
}) {
  const c = useColors();
  const height = Math.round((width * 4) / 3);
  const pad = compact ? layout.tilePad : space.lg;
  const art = width - pad * 2;
  // The dithered header owns the top half of the card, under the window dots.
  const header = Math.floor(height / 2 - pad - WINDOW_DOT.size - space.tile);
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
        {grid ? (
          <DitherField width={art} height={Math.min(header, squareGridHeight(art, grid))} grid={grid} cell={compact ? 1.5 : 2} />
        ) : (
          <DitherField width={art} height={header} series={strip ?? []} shape="area" cell={3} />
        )}
      </View>
      <View style={{ gap: compact ? space.xs : space.sm }}>
        <T role="row" tone="accent" numberOfLines={2}>
          {question}
        </T>
        <CountUp to={answer} suffix={suffix} role={compact ? 'title' : 'hero'} />
        <T role={compact ? 'meta' : 'body'} tone="dim" numberOfLines={2}>
          {sentence}
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
        <Row title="builder" monoTitle meta="Claude Code" value="22m" chevron onPress={() => {}} hairline
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
      <Button label="Continue" onPress={() => {}} />
      <Button label="Not now" kind="secondary" onPress={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: layout.gutter, paddingBottom: space.xxl },
  page: { gap: layout.sectionGap, paddingTop: space.md },
  swatchRow: { flexDirection: 'row', gap: space.sm },
  swatch: { flex: 1, gap: space.xs },
});
