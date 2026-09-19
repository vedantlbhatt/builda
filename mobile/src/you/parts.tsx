/**
 * The small parts the You pages share, on top of the analysis page's kit (`insights/kit.tsx`,
 * `Band`, `Num`, the charts): a dollar figure whose sign is set smaller than its digits, marks
 * that arrive with their block's clock, a doorway that is a word in its hue, the command a page
 * waits on, and the states every page ships (loading, signed out, error, stale).
 *
 * Borrowed, with the numbers kept: the dollar sign at about two thirds of the digits and top
 * aligned is Cash App's balance (design-md/finance/cash-app DESIGN.md, "$" 0.67x the digit size);
 * the doorway's 0.985 press is appllama top-paywall-screens `shared/pressable.tsx`; a word that
 * arrives rises 10 points on the page's curve (0.23 1 0.32 1), which is appllama
 * liquid-glass-screens' copy entrance exactly (520 ms, 10 pt) and this app's `RISE`.
 */
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';

import { Band, BandWords } from '../insights/Band';
import { fitSize, type NumSpec } from '../insights/format';
import { figure, GUTTER, Refusal, type, Words } from '../insights/kit';
import { ease, ENTER_MS, phase, RISE } from '../insights/motion';
import { Num } from '../insights/Num';
import { GROUND, ON_HUE, type Hue } from '../insights/palette';
import { PixelField, type PixelCell } from '../insights/Pixels';
import { Block, Section, useClock, useFieldMotion, useReducedSV } from '../insights/reveal';
import { arrivalMs } from '../motion/pixelMotion';
import { GoLink } from '../insights/sections/Reading';
import { copyText } from '../onboarding/clipboard';
import { snap } from '../ui';
import { staleLine, type Stale } from './load';
import { MASKED_DOLLARS } from './numbers';

/** The dollar sign's size against the digits (Cash App's balance sets it at 0.67). */
export const DOLLAR_SIGN = 0.62;
/** How far a doorway gives under a press. */
export const PRESSED_SCALE = 0.985;

// ------------------------------------------------------------------ figures

/**
 * A dollar amount set as a graphic: the digits huge and counting up, the sign two thirds their
 * size and hung from the top of the figures. Masked, the digits are `•••` and never count.
 */
export function DollarFigure({
  digits,
  masked,
  width,
  max = 112,
  min = 52,
  delay = 180,
  color = ON_HUE,
  label,
}: {
  digits: NumSpec;
  masked: boolean;
  width: number;
  max?: number;
  min?: number;
  delay?: number;
  color?: string;
  label: string;
}) {
  const size = fitSize(`$${digits.final}`, width, max, min);
  const sign = Math.round(size * DOLLAR_SIGN);
  const clock = useClock();
  const fade = useAnimatedStyle(() => ({ opacity: ease(phase(clock.value, Math.max(0, delay - 160), 260)) }));
  const face = figure(size, color);
  return (
    <Animated.View style={[styles.dollarRow, fade]} accessible accessibilityRole="text" accessibilityLabel={masked ? 'Dollar amount hidden' : label}>
      <Text allowFontScaling={false} style={[figure(sign, color), { marginTop: Math.round(size * 0.075) }]}>
        $
      </Text>
      {masked ? (
        <Text allowFontScaling={false} style={face}>
          {MASKED_DOLLARS.replace(/^\$/, '')}
        </Text>
      ) : (
        <Num spec={digits} textStyle={face} delay={delay} />
      )}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ arriving with the clock

/**
 * A mark that arrives with its block: it snaps in over the first third of `ENTER_MS` and rises
 * `RISE` points into place, `delay` after the block starts. Under Reduce Motion the clock is
 * already at its end, so it is simply there.
 */
export function Arrive({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const a = useAnimatedStyle(() => {
    const p = ease(phase(clock.value, delay, ENTER_MS));
    return { opacity: Math.min(1, p * 3), transform: [{ translateY: reduced.value ? 0 : (1 - p) * RISE }] };
  });
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

/** Whether this block's clock has reached `at` ms: for an effect with its own `play` switch. */
export function useClockReached(at: number): boolean {
  const clock = useClock();
  const [reached, setReached] = useState(false);
  useAnimatedReaction(
    () => clock.value >= at,
    (now, before) => {
      if (now && !before) runOnJS(setReached)(true);
    },
  );
  return reached;
}

// ------------------------------------------------------------------ the glossary's collection

/**
 * One square a catalog term: found ones in the hue, the rest as quiet outlines still to find (the
 * way Apple Fitness dims an award not yet earned). They fill in the field's own order
 * (`motion/pixelMotion`, distinct on its page) over the span the old diagonal wave took (a column
 * step a little shorter than a row step, from appllama's Braille Flipwave loader; pattern and
 * numbers only, that repo is GPL), and then stay still.
 */
export function TermSquares({ found, catalog, width, hue, delay = 40 }: { found: number; catalog: number; width: number; hue: Hue; delay?: number }) {
  const cols = catalog <= 80 ? 15 : 20;
  const gap = 4;
  const size = Math.floor((width - gap * (cols - 1)) / cols);
  const rows = Math.ceil(catalog / cols);
  const motion = useFieldMotion('term squares');
  // As long as the diagonal wave took.
  const span = (cols - 1) * WAVE_COL_MS + (rows - 1) * WAVE_ROW_MS;
  const cells: PixelCell[] = useMemo(() => {
    const out: PixelCell[] = [];
    for (let i = 0; i < catalog; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const on = i < found;
      out.push({
        x: col * (size + gap),
        y: row * (size + gap),
        w: size,
        h: size,
        color: on ? hue.ink : GROUND.border,
        outline: !on,
        delay: arrivalMs(motion, col, row, cols, rows, delay, span),
      });
    }
    return out;
  }, [found, catalog, cols, rows, size, hue.ink, delay, motion, span]);
  return (
    <PixelField
      cells={cells}
      width={cols * size + (cols - 1) * gap}
      height={rows * size + (rows - 1) * gap}
      duration={320}
      accessibilityLabel={`${found} of ${catalog} terms found`}
    />
  );
}

/** The wave's step across a column and down a row (Flipwave's 60 and 70, quickened). */
const WAVE_COL_MS = 34;
const WAVE_ROW_MS = 40;

// ------------------------------------------------------------------ doorways

/**
 * A way into a page, as a word: the page's name set large in its hue with an arrow in the same
 * ink, and what it holds under it. The whole thing is the tap target.
 */
export function WordDoor({ title, hue, href, label, children }: { title: string; hue: Hue; href: string; label: string; children?: ReactNode }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href as never)}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? PRESSED_SCALE : 1 }] })}
    >
      <View style={styles.doorHead}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.doorTitle, { color: hue.ink }]}>
          {title}
        </Text>
        <SymbolView name="arrow.right" tintColor={hue.ink} weight="bold" size={24} style={styles.doorArrow} />
      </View>
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ what a page waits on

/** How long "Copied" stays before the action offers itself again. */
const COPIED_MS = 2000;

/**
 * The command that fills the page, in the machine's type, and the one word that copies it. The
 * copy is confirmed on screen as well as by the haptic (a haptic is never the only feedback).
 */
export function CommandLine({ command, color }: { command: string; color: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <View style={styles.command}>
      <Text selectable style={[type.mono, { color: GROUND.text }]}>
        {command}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied' : `Copy the command, ${command}`}
        hitSlop={10}
        onPress={() => {
          if (!copyText(command)) return;
          snap();
          setCopied(true);
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={[type.lead, { color }]}>{copied ? 'Copied' : 'Copy the command'}</Text>
      </Pressable>
    </View>
  );
}

/**
 * A page whose block has not arrived, or was refused: its band still prints in its hue, carrying
 * the reason as a sentence, and under it the one command that fills it when there is one.
 */
export function RefusalChapter({ hue, index, title, refusal, command }: { hue: Hue; index?: string; title: string; refusal: string; command?: string | null }) {
  return (
    <Section>
      <Band hue={hue} index={index} title={title}>
        <BandWords delay={300}>
          <Refusal onHue>{refusal}</Refusal>
        </BandWords>
      </Band>
      {command ? (
        <Block style={styles.after}>
          <Words style={type.dim}>Run this on your Mac, and this page fills in:</Words>
          <CommandLine command={command} color={hue.ink} />
        </Block>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ states

/** The page's shape while the first answer is on its way: a band and its lines, flat. No shimmer. */
export function ChapterSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading" style={styles.skeleton}>
      <View style={styles.skeletonBand} />
      {[0.7, 0.9, 0.5].map((w) => (
        <View key={w} style={[styles.skeletonLine, { width: `${w * 100}%` }]} />
      ))}
    </View>
  );
}

/** Signed out: what the page is, and the one word that fixes it. */
export function SignedOutChapter({ what }: { what: string }) {
  return (
    <View style={styles.state}>
      <Words style={type.body}>{`Sign in to see your ${what}. Your sessions live on your account, and this page reads them there.`}</Words>
      <GoLink title="Sign in" href="/settings" color={GROUND.text} />
    </View>
  );
}

/** The request failed and nothing was saved to show instead. */
export function ErrorChapter({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Refusal>{message.trim().replace(/\.?$/, '.')}</Refusal>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.6 : 1 }]}>
        <Text style={type.lead}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** One quiet line: the refresh failed, and this is what was saved, and when. */
export function StaleLine({ stale }: { stale: Stale }) {
  return (
    <Text accessibilityRole="alert" maxFontSizeMultiplier={1.6} style={type.meta}>
      {staleLine(stale)}
    </Text>
  );
}

const styles = StyleSheet.create({
  dollarRow: { flexDirection: 'row', alignItems: 'flex-start' },
  doorHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doorTitle: { flexShrink: 1, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.9 },
  doorArrow: { width: 24, height: 24 },
  command: { gap: 10, marginTop: 4 },
  skeleton: { marginTop: 8, gap: 14 },
  skeletonBand: { height: 220, backgroundColor: GROUND.raised },
  skeletonLine: { height: 14, marginLeft: GUTTER, backgroundColor: GROUND.card },
  state: { gap: 12 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10 },
  after: { paddingHorizontal: GUTTER, marginTop: 28, gap: 8 },
});
