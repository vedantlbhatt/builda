import React, { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { layout, space, TAP_TARGET } from '../theme';
import { haptics, type HapticKind } from './haptics';
import { exitMs, T as DUR, timing } from './motion';
import { Hairline } from './Hairline';
import { useColors } from './scheme';
import { SymbolIcon } from './Symbol';
import { T } from './Text';

export interface RowProps {
  title: string;
  /** How many lines the title may wrap to. Default 1; a question-length label takes 2. */
  titleLines?: number;
  /** One line of metadata under the title, `meta` in `textDim`. */
  meta?: string;
  /** How many lines the meta may wrap to before it truncates. Default 1: a row is a line. */
  metaLines?: number;
  /** A 17pt SF Symbol or a 16pt pixel glyph, never both. */
  leading?: ReactNode;
  /** A value on the right (`meta`, tabular) or any node. */
  value?: string;
  trailing?: ReactNode;
  /** The disclosure chevron: this row pushes somewhere. */
  chevron?: boolean;
  /**
   * A full-width block under the title line, aligned with the text: a session's strip, a
   * live row's status. It is part of the row, so it highlights and presses with it.
   */
  below?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Held highlighted: the chosen option in a list. The same `raised` fill as a press. */
  selected?: boolean;
  /** A separator under the row, inset to the text. Off on the last row of a group. */
  hairline?: boolean;
  /** Fired with the press. Usually `select` in a picker list, otherwise none. */
  haptic?: HapticKind;
  /** Title in `mono`: a repo name, a model id, a path. */
  monoTitle?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const LEADING_BOX = 28;

/**
 * A list row. Pressing it lifts the background to `raised` over 120ms (rows highlight,
 * they never scale) and lets go at 0.7x. Minimum height is the 44pt tap target; the
 * separator is inset to the text the way iOS insets grouped lists.
 */
export function Row({
  title,
  titleLines = 1,
  meta,
  metaLines = 1,
  leading,
  value,
  trailing,
  chevron = false,
  below,
  onPress,
  disabled = false,
  selected = false,
  hairline = false,
  haptic,
  monoTitle = false,
  testID,
  style,
}: RowProps) {
  const c = useColors();
  const press = useSharedValue(0);

  const highlight = useAnimatedStyle(() => ({ opacity: selected ? 1 : press.value }), [selected]);

  const handlePress = useCallback(() => {
    if (haptic) haptics[haptic]();
    onPress?.();
  }, [haptic, onPress]);

  const inset = layout.gutter + (leading ? LEADING_BOX + space.tile : 0);

  const body = (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.raised }, highlight]} />
      <View style={[styles.content, below ? styles.contentAbove : null]}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <View style={styles.text}>
          <T role={monoTitle ? 'mono' : 'row'} tone={disabled ? 'faint' : 'text'} numberOfLines={titleLines}>
            {title}
          </T>
          {meta ? (
            <T role="meta" tone={disabled ? 'faint' : 'dim'} numberOfLines={metaLines}>
              {meta}
            </T>
          ) : null}
        </View>
        {value ? (
          <T role="meta" tone={disabled ? 'faint' : 'dim'} numberOfLines={1}>
            {value}
          </T>
        ) : null}
        {trailing}
        {chevron ? <SymbolIcon name="chevron.right" size={13} weight="semibold" tone="faint" /> : null}
      </View>
      {below ? <View style={[styles.below, { paddingLeft: inset }]}>{below}</View> : null}
      {hairline ? <Hairline inset={inset} style={styles.hairline} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, style]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={() => {
        press.value = withTiming(1, timing(DUR.press));
      }}
      onPressOut={() => {
        press.value = withTiming(0, timing(exitMs(DUR.press)));
      }}
      style={[styles.row, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TAP_TARGET, justifyContent: 'center' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tile,
    paddingVertical: space.tile,
    paddingHorizontal: layout.gutter,
  },
  /** With a `below` block the title line keeps its top padding and hands the rest to it. */
  contentAbove: { paddingBottom: space.sm },
  below: { paddingRight: layout.gutter, paddingBottom: space.tile, gap: space.xs },
  leading: { width: LEADING_BOX, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
