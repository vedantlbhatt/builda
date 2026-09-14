/**
 * The words and marks round the codebase map and the time lapse, in the analysis page's grammar
 * (design-refs/HOUSE-STYLE.md; the reference is `src/insights/**`):
 *
 *   SessionBand     the hero: a full bleed band in the session's hue that prints itself, the
 *                   repository as its title, the one big figure in dark ink counting up, the
 *                   sentence arriving a word at a time (react-bits SplitText), and the builder's
 *                   creature printing itself beside it in pixels
 *   FigureLine      "42 files, 3 hot": the numbers huge and counting from 0, the words between
 *                   them set smaller, one line fitted to the band
 *   ReplayFigure    the time lapse's figure is its own clock: it counts as the replay plays
 *   Legend          the legend in words, each swatch drawn the way the map draws it and blooming
 *                   in with its block; the colour key as the kinds of file, each in its hue
 *   HotLedger       the files changed most as lines of print: the count large in the file's
 *                   hue, what it counts beside it, one quiet line under it
 *   ReplayControls  play and pause, where the replay is, and Replay, as words and one round key
 *   WordLink        navigation as words with an arrow, never a row with a chevron
 */
import { BlurStyle, Canvas, createPicture, PaintStyle, Picture, Skia, StrokeCap } from '@shopify/react-native-skia';
import { SymbolView } from 'expo-symbols';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { runOnJS, useAnimatedProps, useAnimatedReaction, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { commas } from '../copy/numbers';
import type { PlainRole } from '../generated/live';
import { Band, BandWords } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { fitSize, numSpec } from '../insights/format';
import { figure, GUTTER, Kicker, type, Words } from '../insights/kit';
import { phase } from '../insights/motion';
import { Num } from '../insights/Num';
import { GROUND, ON_HUE, type Hue } from '../insights/palette';
import { useClock } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { radius } from '../theme';
import { SplitText } from '../ui/bits/text';
import { PRESS_SCALE } from '../ui/motionSpec';
import { fitFigure, WORD_RATIO, type FigurePart } from './figure';
import { bloomSize, CELL_MS, FAIL_INK, PATH_INK, pathWidth, roleInk } from './paint';
import { elapsedLabel, ISLANDS_NOTE, ROLES_NOTE, roleWord, type LedgerRow, type LegendItem } from './view';

// ------------------------------------------------------------------ the band

/** A band's hue as the chapter components take it, plus its name for the bits. */
export type BandHue = Hue;

/** The creature on the band: whole pixels, never wider than a third of the band. */
function creatureSize(inner: number): number {
  return Math.min(112, Math.floor((inner * 0.3) / 16) * 16);
}

/**
 * The hero band: title, figure, sentence, one quiet line, the creature. `figure` is the one big
 * thing on it (a `FigureLine` or a `ReplayFigure`), drawn full width above the sentence row.
 */
export function SessionBand({
  hue,
  animal,
  title,
  width,
  figure: big,
  sentence,
  note,
}: {
  hue: BandHue;
  animal: Animal;
  title: string;
  width: number;
  figure: (inner: number) => React.ReactNode;
  sentence: string;
  note?: string | null;
}) {
  const inner = width - 40;
  const creature = creatureSize(inner);
  return (
    <Band hue={hue} title={title}>
      <BandWords delay={260}>{big(inner)}</BandWords>
      <View style={styles.bandRow}>
        <View style={styles.bandWords}>
          <BandSentence text={sentence} delay={420} />
          {note ? (
            <BandWords delay={560}>
              <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.bandNote]}>
                {note}
              </Text>
            </BandWords>
          ) : null}
        </View>
        <CreaturePrint animal={animal} size={creature} color={ON_HUE} delay={220} />
      </View>
    </Band>
  );
}

/**
 * A sentence on a band, arriving a word at a time when the band has printed (react-bits SplitText
 * by words: 6 pt of rise, 60 ms apart, each word's ink snapping in). It waits for its block's
 * clock, so it never plays under the push or before the pixels have landed.
 */
export function BandSentence({ text, delay }: { text: string; delay: number }) {
  const clock = useClock();
  const [play, setPlay] = useState(false);
  useAnimatedReaction(
    () => clock.value >= delay,
    (on, was) => {
      if (on && !was) runOnJS(setPlay)(true);
    },
    [delay],
  );
  return <SplitText text={text} by="words" play={play} textStyle={type.bandCaption} color={ON_HUE} maxFontSizeMultiplier={1.3} />;
}

/** Big words on a band where a refusal stands in for a figure: "This session has finished." */
export function BandHeadline({ children }: { children: string }) {
  return (
    <BandWords delay={260}>
      <Text maxFontSizeMultiplier={1.2} style={styles.headline}>
        {children}
      </Text>
    </BandWords>
  );
}

/**
 * "42 files, 3 hot" on one line: every number counts up from 0 as its block plays (`Num`, the
 * reveal clock), one after the other; the words beside them are still.
 */
export function FigureLine({ parts, width, said, max = 92, min = 40, delay = 380 }: { parts: readonly FigurePart[]; width: number; said: string; max?: number; min?: number; delay?: number }) {
  const size = fitFigure(parts, width, max, min);
  const words = Math.round(size * WORD_RATIO);
  let nth = 0;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={said} style={styles.figureLine}>
      {parts.map((p, i) => {
        if (p.kind === 'word') {
          return (
            <Text key={i} allowFontScaling={false} style={[figure(words, ON_HUE), styles.figureWord]}>
              {p.text}
            </Text>
          );
        }
        const at = delay + nth * 180;
        nth += 1;
        return <Num key={i} spec={numSpec(Number(p.text.replace(/,/g, '')), p.text)} textStyle={figure(size, ON_HUE)} delay={at} />;
      })}
    </View>
  );
}

// `text` rides the native prop path, as in the kit's CountUp and the page's `Num`.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * The time lapse's figure: where the replay is, in session time, set as large as the band allows
 * and redrawn on the UI thread every frame with no React render. A hidden copy of the widest label
 * it will pass holds the width, so nothing on the band moves while it counts.
 */
export function ReplayFigure({
  playhead,
  at,
  widest,
  width,
  color = ON_HUE,
  max = 96,
  min = 48,
}: {
  playhead: SharedValue<number>;
  /** Where the playhead is as React last saw it (`Playback.position`): the words before a frame has run. */
  at: number;
  widest: string;
  width: number;
  color?: string;
  max?: number;
  min?: number;
}) {
  const size = fitSize(widest, width, max, min);
  const face = figure(size, color);
  const props = useAnimatedProps(() => {
    const text = elapsedLabel(playhead.value);
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text allowFontScaling={false} style={[face, styles.sizer]}>
        {widest}
      </Text>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        allowFontScaling={false}
        scrollEnabled={false}
        underlineColorAndroid="transparent"
        defaultValue={elapsedLabel(at)}
        animatedProps={props}
        style={[StyleSheet.absoluteFill, face, styles.input]}
      />
    </View>
  );
}

/** A small readout of the same clock, for the controls under the map. */
export function ReplayReadout({ playhead, at, widest }: { playhead: SharedValue<number>; at: number; widest: string }) {
  const props = useAnimatedProps(() => {
    const text = elapsedLabel(playhead.value);
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text allowFontScaling={false} style={[type.lead, styles.tabular, styles.sizer]}>
        {widest}
      </Text>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        allowFontScaling={false}
        scrollEnabled={false}
        underlineColorAndroid="transparent"
        defaultValue={elapsedLabel(at)}
        animatedProps={props}
        style={[StyleSheet.absoluteFill, type.lead, styles.tabular, styles.input]}
      />
    </View>
  );
}

// ------------------------------------------------------------------ the legend

const SWATCH = 18;
/** The path swatch's stroke: the map's own at a pitch of a swatch. */
const SWATCH_PATH = pathWidth(SWATCH);

/**
 * One legend swatch, drawn the way the map draws that mark, blooming in through the sandpile's
 * size steps as its block plays, `delay` after the block starts.
 */
function Swatch({ kind, delay, sample, stuck }: { kind: LegendItem['swatch']; delay: number; sample: string; stuck: string }) {
  const clock = useClock();
  const pw = SWATCH_PATH;
  const bg = GROUND.bg;
  const text = GROUND.text;
  const fail = FAIL_INK;
  const path = PATH_INK;
  const picture = useDerivedValue(() => {
    const a = phase(clock.value, delay, CELL_MS);
    const k = bloomSize(a);
    return createPicture(
      (canvas) => {
        if (k <= 0) return;
        const fill = Skia.Paint();
        fill.setAntiAlias(true);
        const line = Skia.Paint();
        line.setAntiAlias(true);
        line.setStyle(PaintStyle.Stroke);
        const c = SWATCH / 2;
        const s = 12 * k;
        const x = c - s / 2;
        if (kind === 'path') {
          line.setStrokeCap(StrokeCap.Round);
          line.setColor(Skia.Color(bg));
          line.setStrokeWidth(pw + 3);
          canvas.drawLine(3, SWATCH - 4, 3 + (SWATCH - 6) * k, 4, line);
          line.setColor(Skia.Color(path));
          line.setStrokeWidth(pw);
          canvas.drawLine(3, SWATCH - 4, 3 + (SWATCH - 6) * k, 4, line);
          return;
        }
        if (kind === 'hot' || kind === 'knot') {
          fill.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 3, true));
          fill.setColor(Skia.Color(kind === 'knot' ? stuck : sample));
          canvas.drawRect(Skia.XYWHRect(x - 3, x - 3, s + 6, s + 6), fill);
          fill.setMaskFilter(null);
        }
        if (kind === 'read') {
          line.setColor(Skia.Color(sample));
          line.setStrokeWidth(2);
          canvas.drawRect(Skia.XYWHRect(x + 1, x + 1, s - 2, s - 2), line);
          return;
        }
        fill.setColor(Skia.Color(kind === 'fail' ? fail : kind === 'knot' ? stuck : sample));
        canvas.drawRect(Skia.XYWHRect(x, x, s, s), fill);
        if (kind === 'cursor' && k >= 1) {
          line.setColor(Skia.Color(text));
          line.setStrokeWidth(1.5);
          canvas.drawRect(Skia.XYWHRect(x - 2.25, x - 2.25, s + 4.5, s + 4.5), line);
        }
      },
      { width: SWATCH, height: SWATCH },
    );
  }, [kind, delay, sample, stuck, pw, bg, text, fail, path]);
  return (
    <Canvas style={styles.swatch}>
      <Picture picture={picture} />
    </Canvas>
  );
}

/**
 * The legend in words, then the colour key: the kinds of file on this map, each word in its hue,
 * then what an island is. `sample` is the ink a swatch borrows (the map's most common kind), so
 * the key looks like the map above it; `stuck` is the stuck files' ink (`paint.stuckHue`).
 */
export function Legend({ items, roles, stuck }: { items: readonly LegendItem[]; roles: readonly PlainRole[]; stuck: string }) {
  const sample = roleInk(roles[0] ?? 'unknown').ink;
  return (
    <View style={styles.legend} accessibilityRole="summary">
      {items.map((it, i) => (
        <View key={it.swatch} style={styles.legendRow}>
          <Swatch kind={it.swatch} delay={120 + i * 90} sample={sample} stuck={stuck} />
          <Words style={[type.dim, styles.legendText]}>{it.text}</Words>
        </View>
      ))}
      {roles.length ? (
        <View style={styles.roles}>
          <Words style={type.dim}>{ROLES_NOTE}</Words>
          <View style={styles.roleWords}>
            {roles.map((r) => (
              <Text key={r} maxFontSizeMultiplier={1.4} style={[type.lead, { color: roleInk(r).ink }]}>
                {roleWord(r)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      <Words style={type.meta}>{ISLANDS_NOTE}</Words>
    </View>
  );
}

// ------------------------------------------------------------------ the ledger

/**
 * The files changed most, as lines of print. Each count counts up in its file's hue; a tap picks
 * that file on the map above, the same as tapping its square.
 */
export function HotLedger({ label, rows, picked, onPick }: { label: string; rows: readonly LedgerRow[]; picked: string | null; onPick: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <View>
      <Kicker>{label}</Kicker>
      {rows.map((r, i) => {
        const ink = roleInk(r.role).ink;
        const on = r.id === picked;
        return (
          <Pressable
            key={r.id}
            onPress={() => onPick(r.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${r.count} ${r.what}.${r.note ? ` ${r.note}` : ''}`}
            accessibilityHint="Picks this file on the map."
            style={({ pressed }) => [styles.ledgerRow, i > 0 ? styles.hairTop : null, { transform: [{ scale: pressed ? PRESS_SCALE : 1 }] }]}
          >
            <View style={styles.ledgerLine}>
              <View style={[styles.ledgerMark, { backgroundColor: ink }, on ? styles.ledgerMarkOn : null]} />
              <Num spec={numSpec(r.count, commas(r.count))} textStyle={figure(40, ink)} delay={80 + i * 180} />
              <Text maxFontSizeMultiplier={1.4} style={[type.lead, styles.ledgerLabel]}>
                {r.what}
              </Text>
            </View>
            {r.note ? <Words style={[type.dim, styles.ledgerNote]}>{r.note}</Words> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ navigation and controls

/** A way on, as words: the title, one line under it, an arrow in the accent. */
export function WordLink({ title, line, color, onPress, icon = 'arrow.right' }: { title: string; line?: string; color: string; onPress: () => void; icon?: 'arrow.right' | 'doc.on.doc' | 'arrow.clockwise' }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={line ? `${title}. ${line}` : title}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.55 : 1 }]}
    >
      <View style={styles.linkWords}>
        <Text maxFontSizeMultiplier={1.3} style={styles.linkTitle}>
          {title}
        </Text>
        {line ? <Words style={type.meta}>{line}</Words> : null}
      </View>
      <SymbolView name={icon} tintColor={color} weight="semibold" size={18} />
    </Pressable>
  );
}

/**
 * Play and pause as one round key in the accent, where the replay is beside it, and Replay as a
 * word. The key is the only filled control on the page.
 */
export function ReplayControls({
  playing,
  ended,
  onToggle,
  onReplay,
  playhead,
  at,
  widest,
  total,
  accent,
}: {
  playing: boolean;
  ended: boolean;
  onToggle: () => void;
  onReplay: () => void;
  playhead: SharedValue<number>;
  /** Where the playhead is as React last saw it: the readout's words before a frame has run. */
  at: number;
  widest: string;
  total: string;
  accent: { fill: string; onFill: string; text: string };
}) {
  return (
    <View style={styles.controls}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : ended ? 'Play from the start' : 'Play'}
        style={({ pressed }) => [styles.play, { backgroundColor: accent.fill, transform: [{ scale: pressed ? PRESS_SCALE : 1 }] }]}
      >
        <SymbolView name={playing ? 'pause.fill' : 'play.fill'} tintColor={accent.onFill} weight="semibold" size={20} />
      </Pressable>
      {/* VoiceOver reads the position off the scrubber, which can also move it; this is for eyes. */}
      <View style={styles.readout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ReplayReadout playhead={playhead} at={at} widest={widest} />
        <Text allowFontScaling={false} style={[type.dim, styles.tabular]}>{`of ${total}`}</Text>
      </View>
      <Pressable
        onPress={onReplay}
        accessibilityRole="button"
        accessibilityLabel="Replay from the start"
        hitSlop={10}
        style={({ pressed }) => [styles.replay, { opacity: pressed ? 0.55 : 1 }]}
      >
        <SymbolView name="arrow.counterclockwise" tintColor={accent.text} weight="semibold" size={16} />
        <Text maxFontSizeMultiplier={1.3} style={[type.lead, { color: accent.text }]}>
          Replay
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bandRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  bandWords: { flex: 1, paddingBottom: 4, gap: 8 },
  bandNote: { marginTop: 2 },
  headline: { fontSize: 32, lineHeight: 35, fontWeight: '800', letterSpacing: -0.9, color: ON_HUE },
  figureLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'nowrap' },
  figureWord: { letterSpacing: -0.6 },
  sizer: { opacity: 0 },
  input: { padding: 0, margin: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: 'transparent' },
  tabular: { fontVariant: ['tabular-nums'] },
  swatch: { width: SWATCH, height: SWATCH },
  legend: { gap: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  legendText: { flex: 1 },
  roles: { gap: 6, marginTop: 4 },
  roleWords: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
  ledgerRow: { paddingVertical: 12, gap: 2 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  ledgerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  ledgerMark: { width: 10, height: 10 },
  ledgerMarkOn: { borderWidth: 2, borderColor: GROUND.text },
  ledgerLabel: { flexShrink: 1 },
  ledgerNote: { marginLeft: 20 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  linkWords: { flex: 1, gap: 2 },
  linkTitle: { fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.3, color: GROUND.text },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: GUTTER },
  play: { width: 52, height: 52, borderRadius: radius.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  readout: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  replay: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
});
