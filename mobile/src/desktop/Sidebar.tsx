/**
 * The desktop's left column: what the tab bar is on the phone, turned on its side.
 *
 * The same five peers in the same order, the same glyphs (`TAB_SYMBOLS`, outlined at rest and
 * filled when chosen), the same creature for You and the same tint rule (`tabTint`: the chosen
 * row in the builder's creature's hue, the rest in the warm grey, no amber anywhere). What a
 * desktop adds: the builder's creature at the top where a Mac app puts its identity, Settings as
 * its own row at the foot (the phone reaches it through the gear on You), the shortcut printed
 * beside each row while the pointer is over it, and a fold down to the glyphs.
 *
 * On a Mac inside the desktop shell the window has no title bar (`hiddenInset`): the traffic
 * lights sit in this column's top strip, which is the window's drag handle.
 */
import { SymbolView } from 'expo-symbols';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CreatureMark } from '../insights/Creature';
import { TAB_SYMBOLS } from '../nav/chrome';
import { tabTint } from '../nav/chromeRules';
import { tabTitle } from '../nav/rules';
import { nav } from '../nav/Skeleton';
import { space } from '../theme';
import { useAccent } from '../theme/accent';
import { SHAPE } from '../ui/shape';
import { T } from '../ui/Text';
import { desktopBridge } from './bridge';
import { MAC_TITLEBAR, SECTIONS, shortcutLabel, type Place, type Section } from './rules';

const ROW_HEIGHT = 40;
const GLYPH = 20;

export function Sidebar({
  place,
  width,
  folded,
  onSection,
  onSettings,
  onToggle,
}: {
  place: Place;
  width: number;
  folded: boolean;
  onSection: (s: Section) => void;
  onSettings: () => void;
  onToggle: () => void;
}) {
  const accent = useAccent();
  const tint = tabTint(accent);
  const bridge = desktopBridge();
  const platform = bridge?.platform ?? (isMacBrowser() ? 'darwin' : 'other');
  // Only the shell's own Mac window has traffic lights to leave room for.
  const top = bridge?.platform === 'darwin' ? MAC_TITLEBAR : space.md;

  return (
    <View style={[styles.column, { width }]} accessibilityRole="menu">
      <View style={[styles.head, { height: top + 44 }]} {...dragRegion()}>
        <View style={[styles.identity, { marginTop: top, justifyContent: folded ? 'center' : 'flex-start' }]}>
          <CreatureMark animal={accent.animal} size={32} color={accent.ink} />
          {folded ? null : (
            <T role="headline" style={{ color: nav.text }} numberOfLines={1}>
              Builda
            </T>
          )}
        </View>
      </View>

      <View style={styles.rows}>
        {SECTIONS.map((s, i) => (
          <Row
            key={s}
            label={tabTitle(s)}
            folded={folded}
            selected={place.section === s}
            hint={shortcutLabel(platform, String(i + 1))}
            onPress={() => onSection(s)}
            glyph={(selected) =>
              s === 'you' ? (
                <CreatureMark animal={accent.animal} size={GLYPH + 4} color={selected ? tint.icon : tint.rest} />
              ) : (
                <SymbolView
                  name={selected ? TAB_SYMBOLS[s].active : TAB_SYMBOLS[s].rest}
                  tintColor={selected ? tint.icon : tint.rest}
                  weight="semibold"
                  size={GLYPH}
                />
              )
            }
            tint={tint}
          />
        ))}
      </View>

      <View style={styles.foot}>
        <Row
          label="Settings"
          folded={folded}
          selected={place.settings}
          hint={shortcutLabel(platform, ',')}
          onPress={onSettings}
          glyph={(selected) => <SymbolView name="gearshape" tintColor={selected ? tint.icon : tint.rest} weight="semibold" size={GLYPH} />}
          tint={tint}
        />
        <Row
          label={folded ? 'Show the sidebar' : 'Fold the sidebar'}
          folded={folded}
          selected={false}
          hint={shortcutLabel(platform, '\\')}
          onPress={onToggle}
          glyph={() => <SymbolView name="sidebar.left" tintColor={tint.rest} weight="regular" size={GLYPH} />}
          tint={tint}
          quiet
        />
      </View>
    </View>
  );
}

function Row({
  label,
  hint,
  folded,
  selected,
  onPress,
  glyph,
  tint,
  quiet = false,
}: {
  label: string;
  hint: string;
  folded: boolean;
  selected: boolean;
  onPress: () => void;
  glyph: (selected: boolean) => React.ReactNode;
  tint: ReturnType<typeof tabTint>;
  quiet?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        folded ? styles.rowFolded : null,
        { backgroundColor: selected ? nav.raised : hovered ? nav.card : 'transparent', opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.glyph}>{glyph(selected)}</View>
      {folded ? null : (
        <>
          <T role="row" numberOfLines={1} style={[styles.label, { color: selected ? tint.label : quiet ? nav.textFaint : nav.textDim }]}>
            {label}
          </T>
          {hovered ? (
            <T role="label" style={{ color: nav.textFaint }}>
              {hint}
            </T>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/** A window drag handle inside the desktop shell (`css.ts` gives `data-builda-drag` the region). */
export function dragRegion(): Record<string, unknown> {
  return { dataSet: { buildaDrag: 'true' } };
}

function isMacBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform ?? '');
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    backgroundColor: nav.bg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: nav.border,
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
  },
  head: { justifyContent: 'flex-start' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  rows: { gap: 2, flex: 1 },
  foot: { gap: 2 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tile,
    paddingHorizontal: space.sm + 2,
    borderRadius: SHAPE.inner,
    borderCurve: 'continuous',
  },
  rowFolded: { justifyContent: 'center', paddingHorizontal: 0 },
  glyph: { width: GLYPH + 4, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1 },
});
