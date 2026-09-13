import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { T } from '../ui';
import type { SessionTitle } from './summary';

/**
 * The session's title and its plain English paragraph, under the recap card: what happened,
 * in words, before any number in a grid (docs/approved-roadmap.md 1.4 and 1.5).
 *
 * The title is `title` (22/700), a heading for VoiceOver; the paragraph is `body` (17/400),
 * the role the design gives "the plain-English summary", left aligned and selectable, since a
 * person may want to paste it somewhere. Either may be absent; with neither, nothing renders.
 */
export function TitleLine({ title, paragraph }: { title: SessionTitle | null; paragraph: string }) {
  if (!title && !paragraph) return null;
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <T role="title" accessibilityRole="header" numberOfLines={3} selectable>
          {title.text}
        </T>
      ) : null}
      {paragraph ? (
        <T role="body" selectable>
          {paragraph}
        </T>
      ) : null}
    </View>
  );
}
