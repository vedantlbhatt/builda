import { useRouter } from 'expo-router';
import { SymbolView, type AnimationSpec, type SymbolViewProps } from 'expo-symbols';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreatureMark } from '../insights/Creature';
import { hitSlopToReach, layout, space, TAP_TARGET } from '../theme';
import { useAccent } from '../theme/accent';
import { BlurText } from '../ui/bits/text/BlurText';
import { EASE, useReduceMotion } from '../ui/motion';
import { usePressFeedback } from '../ui/PressableScale';
import { SHAPE } from '../ui/shape';
import { T } from '../ui/Text';
import { shouldBounce, symbolBounceAvailable, TAB_BOUNCE, TAB_CREATURE_SIZE, TAB_SYMBOL_SIZE, tabTint } from './chromeRules';
import type { TabName } from './rules';
import { nav } from './Skeleton';

/**
 * The navigation chrome: the tab bar's glyphs, the tab roots' large title, the bar rule, the
 * gear, and the two controls that carry the accent (a primary capsule and a word link).
 *
 * THE THEME IS THE BUILDER'S CREATURE'S HUE (design-refs/HOUSE-STYLE.md). Every colour here that
 * is not a warm grey is `useAccent()`, so picking a new creature repaints the bar, the buttons
 * and the links together. Nothing in the chrome is amber (`__tests__/navChrome.test.ts` scans).
 *
 * Glyphs: SF Symbols for the chrome, and the builder's own pixel creature for You, the one tab
 * that is a person (Instagram's avatar tab, drawn in this app's pixels).
 */

type Symbol = SymbolViewProps['name'];

/**
 * Outline at rest, the filled variant only on the selected tab (Spotify, Duolingo). Semibold.
 *
 * Now is a bolt, upright: `bolt.horizontal` was tried first and at tab size its thin zigzag read
 * as a squiggle beside two solid glyphs (shots/foundation, first pass). You has no symbol: it is
 * the creature.
 */
export const TAB_SYMBOLS = {
  now: { rest: 'bolt', active: 'bolt.fill' },
  sessions: { rest: 'list.bullet.rectangle', active: 'list.bullet.rectangle.fill' },
  // A folder, the one shape every file browser gives a project; solid at tab size beside the bolt
  // and the list, outlined at rest and filled when chosen like them.
  projects: { rest: 'folder', active: 'folder.fill' },
  // Drops is a map of things somebody sent you, so it is the inbox tray, not a pin and not a
  // brain: a pin says location, which this tab's map deliberately does not mean, and every
  // "AI" product on the store is using the sparkle.
  drops: { rest: 'tray', active: 'tray.fill' },
} as const satisfies Record<Exclude<TabName, 'you'>, { rest: Symbol; active: Symbol }>;

/** iOS 17's SF Symbol bounce, where the OS has it. Read once: the OS does not change under us. */
const SYMBOL_BOUNCE = symbolBounceAvailable(Platform.OS, Platform.Version);
const BOUNCE_SPEC: AnimationSpec = { effect: { type: 'bounce' } };

/**
 * One tab's glyph. The tab bar draws every icon twice, stacked, and shows one by opacity: the
 * `active` copy (filled, in the accent) and the `rest` copy (outlined, in the grey the navigator
 * hands over). So `copy` says which of the two this is, and `selected` (from the navigator's
 * state, `isTabSelected`) says whether the tab is the one showing.
 *
 * Selecting a tab gives its glyph one small bounce (`shouldBounce`): the SF Symbol's own on iOS
 * 17 and later, attached for the length of one bounce and taken off again so a later repaint
 * (a new accent) does not replay it; the creature, and a symbol before iOS 17, on a spring
 * (Spotify's like heart: 1.15 and home, damping 0.7). No haptic, no slide: the tab still switches
 * the platform's way. Reduce Motion: no bounce, the colour says it.
 */
export function TabIcon({ tab, copy, selected, color }: { tab: TabName; copy: 'active' | 'rest'; selected: boolean; color: string }) {
  const accent = useAccent();
  const reduced = useReduceMotion();
  const active = copy === 'active';
  const native = SYMBOL_BOUNCE && tab !== 'you';
  const ink = active ? tabTint(accent).icon : color;

  const scale = useSharedValue(1);
  const [symbolBouncing, setSymbolBouncing] = useState(false);
  const was = useRef<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const before = was.current;
    was.current = selected;
    if (!active || !shouldBounce(before, selected, reduced)) return;
    if (native) {
      setSymbolBouncing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setSymbolBouncing(false);
      }, TAB_BOUNCE.symbolMs);
      return;
    }
    scale.value = withSequence(withTiming(TAB_BOUNCE.peak, { duration: TAB_BOUNCE.riseMs, easing: EASE }), withSpring(1, TAB_BOUNCE.settle));
  }, [active, selected, reduced, native, scale]);

  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={bounce}>
      {tab === 'you' ? (
        <CreatureMark animal={accent.animal} size={TAB_CREATURE_SIZE} color={ink} />
      ) : (
        <SymbolView
          name={active ? TAB_SYMBOLS[tab].active : TAB_SYMBOLS[tab].rest}
          tintColor={ink}
          weight="semibold"
          size={TAB_SYMBOL_SIZE}
          resizeMode="scaleAspectFit"
          animationSpec={symbolBouncing ? BOUNCE_SPEC : undefined}
        />
      )}
    </Animated.View>
  );
}

/**
 * The large title a tab root wears (DESIGN-DIRECTION 3.3: "large titles stay native, 34/700").
 *
 * The JS tab navigator's own header can only centre a 17pt title, which put a small centred
 * "Now" over a left-aligned screen: the one centred heading in the app. This is the iOS large
 * title row instead: the platform's 34pt bold with its +0.37 tracking and 41pt line, left on the
 * 16pt gutter, one accessory on the right (You's gear), the way Health and the App Store put the
 * avatar beside theirs. The same warm hairline under it as the pushed bars.
 *
 * The title comes into focus the first time its tab arrives (react-bits BlurText, through its
 * port in `src/ui/bits/text/BlurText.tsx`): the tab mounts on its first visit and stays mounted,
 * so it plays once per tab per launch and never on a tab switch after that. Reduce Motion: a
 * 150 ms fade.
 *
 * The size is the platform's, not a kit role, so it is spelled here once rather than added
 * to the nine roles; it grows with Dynamic Type to 1.5x like `title`.
 */
export const LARGE_TITLE = { fontSize: 34, lineHeight: 41, letterSpacing: 0.37, fontWeight: '700' } as const;
/** The large title row's height on iOS. */
const LARGE_TITLE_ROW = 52;
/** A beat after the tab mounts, so the title does not play under the first frames of layout. */
const TITLE_DELAY_MS = 90;

export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[rule, { paddingTop: insets.top, paddingHorizontal: layout.gutter }]}>
      <View style={styles.titleRow}>
        <BlurText
          text={title}
          textStyle={LARGE_TITLE}
          color={nav.text}
          numberOfLines={1}
          maxFontSizeMultiplier={1.5}
          accessibilityRole="header"
          delay={TITLE_DELAY_MS}
          style={styles.title}
        />
        {right}
      </View>
    </View>
  );
}

/**
 * Every bar is the canvas with one hairline in `border` under it: the tab roots' large title
 * row above, and the pushed screens' native bar, which draws this as its `headerBackground`.
 * UIKit's own bar shadow is the system separator, a cool grey the palette does not have; and
 * with no rule at all, a line of text scrolled half under the bar was cut at an edge nobody
 * could see, which reads as a rendering bug.
 */
const rule = {
  backgroundColor: nav.bg,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: nav.border,
} as const;

export function HeaderRule() {
  return <View style={[rule, { flex: 1 }]} />;
}

/** The gear in You's navigation bar. Bar buttons answer a press with opacity, not scale. */
export function SettingsButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 2 })}
    >
      <SymbolView name="gearshape" tintColor={nav.text} weight="regular" size={22} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ the accent's controls

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** 52pt with a headline label, or 44pt (the tap floor) with a row label. */
const ACTION_HEIGHT = { large: 52, compact: TAP_TARGET } as const;

/**
 * The primary action in the builder's hue: a capsule filled with the accent, dark ink on it
 * (`onFill`, 5.2:1 or better on every hue), the kit's press (0.97 over 120 ms, a spring home).
 * No darker pressed fill: the spectrum has no pressed tone, and a hue dimmed by opacity over
 * the ground reads brown. Disabled is the kit's: a `raised` capsule with faint ink.
 *
 * The kit's `Button` is the amber one and this app's chrome no longer wears amber; this is the
 * same control in the accent.
 */
export function AccentButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  busyLabel,
  size = 'compact',
  block = false,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  size?: 'large' | 'compact';
  block?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = useAccent();
  const fb = usePressFeedback();
  const height = ACTION_HEIGHT[size];
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      hitSlop={hitSlopToReach(height)}
      onPress={onPress}
      onPressIn={fb.onPressIn}
      onPressOut={fb.onPressOut}
      style={[
        styles.action,
        // The raised surface and the text colour, not the accent with dark ink (2026-09-19, the
        // owner). The accent is still how this control is chosen: its words, when it is live.
        { height, alignSelf: block ? 'stretch' : 'flex-start', backgroundColor: nav.raised },
        fb.animatedStyle,
        style,
      ]}
    >
      <T role={size === 'large' ? 'headline' : 'row'} numberOfLines={1} style={{ color: disabled ? nav.textFaint : accent.text, opacity: busy ? 0.6 : 1 }}>
        {busy ? (busyLabel ?? label) : label}
      </T>
    </AnimatedPressable>
  );
}

/**
 * A way somewhere, as words (the house style: navigation is words, never a row with a chevron):
 * the destination in the accent, an arrow after it. Opacity on press, as the analysis page's
 * links do.
 */
export function WordLink({ title, onPress, accessibilityHint }: { title: string; onPress: () => void; accessibilityHint?: string }) {
  const accent = useAccent();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
    >
      <T role="headline" style={{ color: accent.text }}>
        {title}
      </T>
      <SymbolView name="arrow.right" tintColor={accent.ink} weight="semibold" size={15} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { minHeight: LARGE_TITLE_ROW, flexDirection: 'row', alignItems: 'center', gap: space.tile },
  title: { flex: 1 },
  action: {
    paddingHorizontal: space.lg,
    borderRadius: SHAPE.action,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP_TARGET, alignSelf: 'flex-start' },
});
