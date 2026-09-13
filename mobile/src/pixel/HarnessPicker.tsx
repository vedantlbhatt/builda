import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, typeRoles, type Scheme } from '../theme';
import { HarnessGlyph } from './HarnessGlyph';
import { useReducedMotion } from './PixelSprite';
import {
  HARNESS_MARKS,
  PICKER,
  isMarkSelected,
  sessionsFor,
  statusLine,
  tileWidthInside,
  toggleMark,
  type GlyphInk,
  type Harness,
  type HarnessMark,
} from './harness';

export interface HarnessPickerProps {
  /** The wire values chosen. Cursor's tile stands for both `cursor_ide` and `cursor_agent`. */
  selected: readonly Harness[];
  onChange: (next: Harness[]) => void;
  /**
   * Sessions the paired Mac found, per wire value. Omit it before pairing and the tiles carry
   * no status line at all; a count of 0 reads "not found" and dims the glyph (still tappable).
   */
  found?: Partial<Record<Harness, number>>;
  scheme?: Scheme;
  /** Which marks to offer, in order. Default: all seven (`HARNESS_MARKS`). */
  marks?: readonly HarnessMark[];
  /** Put it inside the screen's 16 pt gutter; the picker fills the width it is given. */
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
/** DESIGN-DIRECTION 3.5: every timing curve. */
const EASE = Easing.bezier(0.23, 1, 0.32, 1);
/** Press-in scale and its duration (3.5: presses scale 0.97 over 120 ms). */
const PRESS_SCALE = 0.97;
const PRESS_MS = 120;
/** Critically damped, settling in about 400 ms: the `SNAP` spring for a release. */
const SNAP = { stiffness: 250, damping: 2 * Math.sqrt(250), mass: 1 } as const;
/** A tile is a fixed 88 pt tall, so its two lines of text scale only this far. */
const TEXT_SCALE_MAX = 1.15;

/**
 * The one harness picker (DESIGN-DIRECTION 5): onboarding step 3, filters and settings all
 * use it. Three columns of 88 pt tiles on `raised`, radius 18 with a continuous curve; the
 * 32 pt glyph 12 pt from the top, the name (13/600) and the status line (12/400) under it,
 * all left aligned. Selected fills the tile with amber and draws the glyph and the name in
 * `onAccent`, a 120 ms cross-fade with a `selectionAsync` tick on the same frame: a solid
 * fill with dark ink, never a pale tinted chip.
 */
export function HarnessPicker({ selected, onChange, found, scheme = 'dark', marks = HARNESS_MARKS, style }: HarnessPickerProps) {
  const { width: screen } = useWindowDimensions();
  const [inner, setInner] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => setInner(e.nativeEvent.layout.width), []);
  // Floor to whole device pixels: three tiles rounded UP by a pixel each no longer fit in a
  // row, and flexWrap would quietly push the third one down.
  const scale = PixelRatio.get();
  const tileW = Math.floor(tileWidthInside(inner ?? screen - 2 * PICKER.gutter) * scale) / scale;
  const c = useMemo(() => colors(scheme), [scheme]);

  // Controlled: the next selection is computed from the one the parent passed in. The haptic
  // fires on the same frame as the change (3.6), once per tap, never on a re-render.
  const toggle = useCallback(
    (mark: HarnessMark) => {
      Haptics.selectionAsync().catch(() => {});
      onChange(toggleMark(selected, mark));
    },
    [onChange, selected],
  );

  return (
    <View onLayout={onLayout} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: PICKER.gap }, style]}>
      {marks.map((m) => (
        <HarnessTile
          key={m.id}
          mark={m}
          width={tileW}
          selected={isMarkSelected(selected, m)}
          sessions={sessionsFor(m, found)}
          c={c}
          scheme={scheme}
          onPress={toggle}
        />
      ))}
    </View>
  );
}

type Palette = ReturnType<typeof colors>;

function HarnessTile({
  mark,
  width,
  selected,
  sessions,
  c,
  scheme,
  onPress,
}: {
  mark: HarnessMark;
  width: number;
  selected: boolean;
  sessions: number | undefined;
  c: Palette;
  scheme: Scheme;
  onPress: (mark: HarnessMark) => void;
}) {
  const reduced = useReducedMotion();
  const on = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(on, { toValue: selected ? 1 : 0, duration: PICKER.fadeMs, easing: EASE, useNativeDriver: NATIVE });
    anim.start();
    return () => anim.stop();
  }, [selected, on]);

  const pressIn = useCallback(() => {
    if (reduced) return;
    Animated.timing(press, { toValue: 1, duration: PRESS_MS, easing: EASE, useNativeDriver: NATIVE }).start();
  }, [press, reduced]);
  const pressOut = useCallback(() => {
    if (reduced) return;
    Animated.spring(press, { toValue: 0, ...SNAP, useNativeDriver: NATIVE }).start();
  }, [press, reduced]);

  const status = statusLine(sessions);
  const missing = sessions === 0;
  const off = useMemo(() => on.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [on]);
  const scale = useMemo(() => press.interpolate({ inputRange: [0, 1], outputRange: [1, PRESS_SCALE] }), [press]);

  return (
    <Pressable
      onPress={() => onPress(mark)}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={status ? `${mark.name}, ${status}` : mark.name}
    >
      <Animated.View style={[styles.tile, { width, backgroundColor: c.raised, transform: [{ scale }] }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.accent, opacity: on }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: off }]}>
          <TileFace
            mark={mark}
            ink={missing ? 'missing' : 'idle'}
            name={missing ? c.textDim : c.text}
            statusColor={c.textDim}
            status={status}
            scheme={scheme}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: on }]}>
          <TileFace mark={mark} ink="selected" name={c.onAccent} statusColor={c.onAccent} status={status} scheme={scheme} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** What a tile shows in one state. Both states are always mounted and cross-faded. */
function TileFace({
  mark,
  ink,
  name,
  statusColor,
  status,
  scheme,
}: {
  mark: HarnessMark;
  ink: GlyphInk;
  name: string;
  statusColor: string;
  status: string | null;
  scheme: Scheme;
}) {
  const meta = typeRoles.meta;
  const small = typeRoles.label;
  return (
    <View style={styles.face}>
      {/* The glyph's 16x16 box has a 2-cell (4 pt) margin around its live area: pull it
          4 pt left so the drawing, not the box, lines up with the name under it. */}
      <HarnessGlyph harness={mark.harnesses[0]!} size={PICKER.glyph} ink={ink} scheme={scheme} style={styles.glyph} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={TEXT_SCALE_MAX}
        style={{ marginTop: 6, fontSize: meta.size, lineHeight: Math.round(meta.size * meta.line), fontWeight: '600', color: name }}
      >
        {mark.name}
      </Text>
      {status ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={TEXT_SCALE_MAX}
          style={{
            fontSize: small.size,
            lineHeight: Math.round(small.size * 1.3),
            fontWeight: '400',
            color: statusColor,
            fontVariant: ['tabular-nums'],
          }}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: PICKER.tileHeight,
    borderRadius: PICKER.radius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  face: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: PICKER.glyphTop,
  },
  glyph: {
    marginLeft: -4,
  },
});
