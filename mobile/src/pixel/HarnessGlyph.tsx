import React, { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, space, typeRoles, type Scheme } from '../theme';
import { FrameSvg } from './PixelSprite';
import {
  HARNESS_NAMES,
  glyphColor,
  harnessGlyph,
  isGlyphSize,
  isHarness,
  snapGlyphSize,
  type GlyphInk,
  type GlyphSize,
  type Harness,
} from './harness';

export interface HarnessGlyphProps {
  /** A wire value (`claude_code`, `cursor_agent`, ...). One this build does not know renders nothing. */
  harness: Harness | string;
  /** 16, 32, 48 or 64 pt: whole points per cell. Anything else draws at the next size down. */
  size?: GlyphSize;
  /** idle `text`, dim `textDim`, missing `textFaint`, selected `onAccent` (see `glyphColor`). */
  ink?: GlyphInk;
  scheme?: Scheme;
  /** A fixed colour for a surface the four inks do not cover (a share card's own palette). */
  color?: string;
  /**
   * Announce the tool by name. Off by default: everywhere a glyph appears its name is printed
   * beside it, and VoiceOver reading "Claude Code, Claude Code" is noise.
   */
  labelled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One harness mark (DESIGN-DIRECTION 5), in one colour, at a size that keeps every cell on
 * whole device pixels. Drawn by `FrameSvg`, the same run-length renderer as Bit and the
 * creatures, so a glyph and a creature beside it have identical edges.
 *
 *   <HarnessGlyph harness="claude_code" size={32} />
 *   <HarnessGlyph harness={session.harness} size={16} ink="dim" />
 */
export function HarnessGlyph({
  harness,
  size = 16,
  ink = 'idle',
  scheme = 'dark',
  color,
  labelled = false,
  style,
}: HarnessGlyphProps) {
  const frame = harnessGlyph(harness);
  const pt = snapGlyphSize(size);
  if (__DEV__ && !isGlyphSize(size)) {
    console.warn(`[HarnessGlyph] ${size} pt puts cell edges between pixels; drawing at ${pt} pt`);
  }
  const fill = color ?? glyphColor(ink, colors(scheme));
  const palette = useMemo(() => ({ b: fill }), [fill]);
  if (!frame) return null;
  return (
    <View
      style={[{ width: pt, height: pt }, style]}
      {...(labelled && isHarness(harness)
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: HARNESS_NAMES[harness] }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      <FrameSvg frame={frame} drawn={pt} palette={palette} />
    </View>
  );
}

/**
 * A harness in a row or on a card: the 16 pt glyph in `textDim` beside its name, no tile.
 * An unknown wire value shows the value itself and no glyph, as `RecapCard` already does.
 */
export function HarnessLabel({
  harness,
  scheme = 'dark',
  style,
}: {
  harness: Harness | string;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
}) {
  const c = colors(scheme);
  const name = isHarness(harness) ? HARNESS_NAMES[harness] : harness;
  const meta = typeRoles.meta;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>
      <HarnessGlyph harness={harness} size={16} ink="dim" scheme={scheme} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={meta.maxScale}
        style={{ fontSize: meta.size, lineHeight: Math.round(meta.size * meta.line), fontWeight: '400', color: c.textDim }}
      >
        {name}
      </Text>
    </View>
  );
}
