/**
 * The codebase map and the time lapse of this session, as doorways (`/you/map/[id]`,
 * `/you/timelapse/[id]`): each page's name set large, what is behind it in one line with its
 * number, an arrow in the session's hue. Words, never a row with a chevron (house style rule 5).
 * A doorway exists only when its data is on the session (`links.ts`): one that opened onto
 * nothing would be a promise the page behind it cannot keep.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { GUTTER, Kicker } from '../insights/kit';
import { Block } from '../insights/reveal';
import type { SessionLink } from './links';
import { Door } from './parts';

export function SessionLinks({ links, color }: { links: readonly SessionLink[]; color: string }) {
  const router = useRouter();
  if (!links.length) return null;
  return (
    <Block style={styles.block}>
      <Kicker>go further</Kicker>
      {links.map((l, i) => (
        <Door key={l.key} title={l.title} line={l.meta} color={color} hairline={i > 0} onPress={() => router.push(l.href)} />
      ))}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
});
