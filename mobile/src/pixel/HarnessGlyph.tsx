import React, { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, space, typeRoles, type Scheme } from '../theme';
import { useScheme } from '../ui/scheme';
import { FrameSvg } from './PixelSprite';
import { HARNESS_NAMES, harnessGlyph, isGlyphSize, isHarness, snapGlyphSize, type GlyphSize, type Harness } from './harness';
import { harnessInk, type HarnessInk } from './palette';

export interface HarnessGlyphProps {
  /** A wire value (`claude_code`, `cursor_agent`, ...). One this build does not know renders nothing. */
  harness: Harness | string;
  /** 16, 32, 48 or 64 pt: whole points per cell. Anything else draws at the next size down. */
  size?: GlyphSize;
  /**
   * `hue` (default): the harness's own hue from the spectrum, for where the harness is the
   * object. `dim` where the session is the object (a mission tile, a Sessions row: the
   * session's creature already wears the row's one identity hue). `idle` `text`, `missing`
   * `textFaint`, `selected` `onAccent` on a tile filled with the hue (`palette.ts`).
   */
  ink?: HarnessInk;
  /** Default: the kit's `SchemeProvider`, which is dark unless a surface says otherwise. */
  scheme?: Scheme;
  /** A fixed colour for a surface the inks do not cover (a share card's own palette, a tile). */
  color?: string;
  /**
   * Announce the tool by name. Off by default: everywhere a glyph appears its name is printed
   * beside it, and VoiceOver reading "Claude Code, Claude Code" is noise.
   */
  labelled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One harness mark (DESIGN-DIRECTION 5, recoloured by DESIGN-V2 2.4), in one colour, at a size
 * that keeps every cell on whole device pixels. Drawn by `FrameSvg`, the same run-length renderer
 * as Bit and the creatures, so a glyph and a creature beside it have identical edges.
 *
 * The owner's 2026-09-13 override ("why are all of them the same color?") gave each harness its
 * own hue: Claude Code heather, Codex tide, Cursor brass, Gemini CLI coral, Cline iris, opencode
 * ember, Aider cobalt. Never the vendor's colour, never amber. Still one role, one ink.
 *
 *   <HarnessGlyph harness="claude_code" size={32} />             heather, the harness as the object
 *   <HarnessGlyph harness={session.harness} size={16} ink="dim" /> beside a session's creature
 */
export function HarnessGlyph({ harness, size = 16, ink = 'hue', scheme, color, labelled = false, style }: HarnessGlyphProps) {
  const contextScheme = useScheme();
  const resolved = scheme ?? contextScheme;
  const frame = harnessGlyph(harness);
  const pt = snapGlyphSize(size);
  if (__DEV__ && !isGlyphSize(size)) {
    console.warn(`[HarnessGlyph] ${size} pt puts cell edges between pixels; drawing at ${pt} pt`);
  }
  const fill = color ?? harnessInk(harness, ink, resolved);
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
 * A harness in a row: the 16 pt glyph beside its name, no tile. The glyph wears the harness's
 * hue by default, for where the harness is the row's subject (the Stack page's tools, Settings'
 * tools list); pass `ink="dim"` in a row whose subject is a session, whose creature already
 * carries that row's one identity hue. The name stays `textDim` either way: hue is a mark here,
 * and a 13 pt regular label is not where a hue goes (DESIGN-V2 1.3). An unknown wire value shows
 * the value itself and no glyph, as `RecapCard` already does.
 */
export function HarnessLabel({
  harness,
  ink = 'hue',
  scheme,
  style,
}: {
  harness: Harness | string;
  ink?: HarnessInk;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
}) {
  const contextScheme = useScheme();
  const resolved = scheme ?? contextScheme;
  const c = colors(resolved);
  const name = isHarness(harness) ? HARNESS_NAMES[harness] : harness;
  const meta = typeRoles.meta;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>
      <HarnessGlyph harness={harness} size={16} ink={ink} scheme={resolved} />
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
