import { useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space } from '../theme';
import { nav } from './Skeleton';

/**
 * The navigation chrome's glyphs. SF Symbols only (DESIGN-DIRECTION 5: chrome is SF Symbols,
 * identity is pixel glyphs, never mixed on one element).
 */

type Symbol = SymbolViewProps['name'];

/**
 * Outline at rest, the filled variant only on the selected tab. Semibold in the bar.
 *
 * Now is a bolt, upright: `bolt.horizontal` was tried first and at tab size its thin
 * zigzag read as a squiggle beside two solid glyphs (shots/foundation, first pass).
 */
export const TAB_SYMBOLS = {
  now: { rest: 'bolt', active: 'bolt.fill' },
  sessions: { rest: 'list.bullet.rectangle', active: 'list.bullet.rectangle.fill' },
  you: { rest: 'person.crop.square', active: 'person.crop.square.fill' },
} as const satisfies Record<string, { rest: Symbol; active: Symbol }>;

export function TabIcon({
  tab,
  focused,
  color,
}: {
  tab: keyof typeof TAB_SYMBOLS;
  focused: boolean;
  color: string;
}) {
  const s = TAB_SYMBOLS[tab];
  return (
    <SymbolView
      name={focused ? s.active : s.rest}
      // Amber on the active tab only; the navigator's tint (`text` / `textDim`) is the label's.
      tintColor={focused ? nav.accent : color}
      weight="semibold"
      size={26}
      resizeMode="scaleAspectFit"
    />
  );
}

/**
 * The large title a tab root wears (DESIGN-DIRECTION 3.3: "large titles stay native, 34/700").
 *
 * The JS tab navigator's own header can only centre a 17pt title, which put a small centred
 * "Now" over a left-aligned screen: the one centred heading in the app. This is the iOS
 * large title row instead: the platform's 34pt bold with its +0.37 tracking and 41pt line,
 * left on the 16pt gutter, one accessory on the right (You's gear), the way Health and the
 * App Store put the avatar beside theirs. The same warm hairline under it as the pushed bars.
 *
 * The size is the platform's, not a kit role, so it is spelled here once rather than added
 * to the nine roles; it grows with Dynamic Type to 1.5x like `title`.
 */
export const LARGE_TITLE = { fontSize: 34, lineHeight: 41, letterSpacing: 0.37, fontWeight: '700' } as const;
/** The large title row's height on iOS. */
const LARGE_TITLE_ROW = 52;

export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[rule, { paddingTop: insets.top, paddingHorizontal: layout.gutter }]}>
      <View style={{ minHeight: LARGE_TITLE_ROW, flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.5}
          style={[LARGE_TITLE, { flex: 1, color: nav.text }]}
        >
          {title}
        </Text>
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
