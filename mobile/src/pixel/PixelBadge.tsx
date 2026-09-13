import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { space, type Scheme } from '../theme';
import { SchemeProvider, T } from '../ui';
import { PixelSprite } from './PixelSprite';
import { spriteLeftInset } from './optical';
import type { SpriteState } from './sprites';

/**
 * Mascot plus one line of caption: the unit for empty states and loading rows.
 *
 *   <PixelBadge state="thinking" text="Reading your session…" />
 *
 * Deliberately small: a 48pt sprite beside dim text. Anything larger becomes the subject
 * of the screen instead of a companion to it. An optional `title` puts one `headline` line
 * above the caption for the banners that already had a heading; the sprite stays the same
 * size either way. Left aligned, like every other block of text.
 */
export function PixelBadge({
  state,
  text,
  title,
  scheme = 'dark',
  size = 48,
  fps,
  paused = false,
  tempo,
  style,
}: {
  state: SpriteState;
  text: string;
  title?: string;
  scheme?: Scheme;
  size?: number;
  /** Compatibility only; see `PixelSprite`. */
  fps?: number;
  paused?: boolean;
  /** 0.5 to 2, see `PixelSprite`. */
  tempo?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SchemeProvider scheme={scheme}>
      <View
        style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }, style]}
        accessibilityRole="text"
        accessibilityLabel={title ? `${title}. ${text}` : text}
      >
        {/* Pulled left by its empty columns, so the drawn creature, not its transparent
            frame, sits on the edge the text around it starts on. */}
        <PixelSprite
          state={state}
          size={size}
          scheme={scheme}
          fps={fps}
          paused={paused}
          tempo={tempo}
          style={{ marginLeft: -spriteLeftInset(state, size) }}
        />
        <View style={{ flex: 1, gap: space.xs }}>
          {title ? <T role="headline">{title}</T> : null}
          <T role={title ? 'meta' : 'body'} tone="dim" numberOfLines={3}>
            {text}
          </T>
        </View>
      </View>
    </SchemeProvider>
  );
}
