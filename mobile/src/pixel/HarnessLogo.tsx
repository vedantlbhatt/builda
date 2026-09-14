import React from 'react';
import { SvgXml } from 'react-native-svg';

import { HARNESS_LOGOS } from './harnessLogos';
import { HarnessGlyph } from './HarnessGlyph';

/**
 * A tool's real mark, as the owner supplied it (2026-09-13: "use these icons for each option").
 * Monochrome marks fill with currentColor, set here from `color`, so they follow the text they
 * sit beside; the colour marks (Claude, Codex, Gemini) keep their brand colours. A harness with
 * no supplied mark (Aider) falls back to its pixel glyph.
 */
export function HarnessLogo({
  harness,
  size = 24,
  color,
}: {
  harness: string;
  size?: number;
  color: string;
}) {
  const logo = HARNESS_LOGOS[harness];
  if (!logo) {
    const glyphSize = size <= 16 ? 16 : size <= 32 ? 32 : size <= 48 ? 48 : 64;
    return <HarnessGlyph harness={harness} size={glyphSize as 16 | 32 | 48 | 64} color={color} />;
  }
  return <SvgXml xml={logo.xml} width={size} height={size} color={logo.mono ? color : undefined} />;
}
