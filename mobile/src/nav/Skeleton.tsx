import { usePathname, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../generated/tokens';
import { Button } from '../ui/Button';

/**
 * Scaffolding for routes whose real screen comes later: a title, the path the router
 * resolved and every param it carried, so whoever builds the screen (and the screenshot
 * harness driving it by deep link) can see the route is wired before anything is drawn.
 *
 * Deliberately plain and on the tokens (DESIGN-DIRECTION 3): left-aligned, warm greys, one
 * amber action, 18 containers and capsule actions with continuous corners. It is replaced,
 * not restyled, when the screen is built; nothing here is the UI kit.
 */

const s = tokens.surface;
export const nav = {
  bg: s.bg.dark,
  card: s.card.dark,
  raised: s.raised.dark,
  border: s.border.dark,
  text: s.text.dark,
  textDim: s.textDim.dark,
  textFaint: s.textFaint.dark,
  accent: s.accent.dark,
  accentPressed: s.accentPressed.dark,
  onAccent: s.text.light,
} as const;

const R = tokens.radius;
const SP = tokens.space;
const mono = { fontFamily: 'ui-monospace', fontSize: 13, fontWeight: '500' } as const;

export function RouteSkeleton({
  title,
  note,
  headerless = false,
  children,
}: {
  title: string;
  note?: string;
  /** The route has no navigation bar, so the content clears the status bar itself. */
  headerless?: boolean;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: nav.bg }}
      contentInsetAdjustmentBehavior="automatic"
      // A tap on the button while the keyboard is up presses the button; it does not just
      // dismiss the keyboard and make the person tap again.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: SP.md,
        paddingTop: headerless ? insets.top + SP.lg : SP.lg,
        paddingBottom: insets.bottom + SP.section,
        gap: SP.lg,
      }}
    >
      <View style={{ gap: SP.sm }}>
        <Text style={{ color: nav.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 }}>
          {title}
        </Text>
        {note ? (
          <Text style={{ color: nav.textDim, fontSize: 15, lineHeight: 20 }}>{note}</Text>
        ) : null}
      </View>
      <RouteParams />
      {children}
    </ScrollView>
  );
}

/** The resolved path and its params, one mono row each. */
export function RouteParams() {
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return (
    <View style={box}>
      <ParamRow label="route" value={pathname} first />
      {entries.length === 0 ? (
        <ParamRow label="params" value="none" />
      ) : (
        entries.map(([k, v]) => (
          <ParamRow key={k} label={k} value={Array.isArray(v) ? v.join(', ') : String(v)} />
        ))
      )}
    </View>
  );
}

function ParamRow({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: SP.md,
        paddingVertical: SP.tile,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: nav.border,
      }}
    >
      <Text style={{ color: nav.textDim, fontSize: 12, fontWeight: '600', letterSpacing: 0.2, width: 72 }}>
        {label}
      </Text>
      <Text
        selectable
        style={[mono, { color: nav.text, flex: 1, fontVariant: ['tabular-nums'] }]}
        numberOfLines={3}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The one amber action on a screen: the kit's primary button, "Continue" unless the step
 * says otherwise. It used to be a local Pressable that went to 40% when disabled, which on
 * the dark canvas is not a dim amber but a muddy brown, a colour the palette does not have.
 * The kit's disabled state is a `raised` capsule with faint ink.
 */
export function PrimaryButton({
  label = 'Continue',
  onPress,
  disabled = false,
}: {
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Button label={label} onPress={onPress} disabled={disabled} />;
}

/** A text action of equal prominence to nothing: "Not now", "Close". The kit's bare text button. */
export function QuietButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button kind="secondary" size="compact" block={false} label={label} onPress={onPress} />;
}

export interface NavLink {
  title: string;
  detail?: string;
  onPress: () => void;
}

/** Rows inside one container, hairlines between, a chevron at the end. Rows highlight, never scale. */
export function NavList({ links }: { links: NavLink[] }) {
  return (
    <View style={[box, { paddingHorizontal: 0 }]}>
      {links.map((l, i) => (
        <Pressable
          key={l.title}
          onPress={l.onPress}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP.tile,
            minHeight: 52,
            paddingHorizontal: SP.md,
            paddingVertical: SP.tile,
            backgroundColor: pressed ? nav.raised : 'transparent',
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: nav.border,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: nav.text, fontSize: 15, fontWeight: '600' }}>{l.title}</Text>
            {l.detail ? <Text style={{ color: nav.textDim, fontSize: 13 }}>{l.detail}</Text> : null}
          </View>
          {/* Decoration: VoiceOver already hears a button; "Forward" would be noise. */}
          <SymbolView
            name="chevron.right"
            size={13}
            weight="semibold"
            tintColor={nav.textFaint}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Pressable>
      ))}
    </View>
  );
}

const box = {
  backgroundColor: nav.card,
  borderRadius: R.md,
  borderCurve: 'continuous',
  borderWidth: 1,
  borderColor: nav.border,
  paddingHorizontal: SP.md,
  overflow: 'hidden',
} as const;
