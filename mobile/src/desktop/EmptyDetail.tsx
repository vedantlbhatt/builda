/**
 * The detail pane before anything is picked: the list is on the left, this says what the right
 * side is for, once, quietly. The builder's creature, faint, and one line. No illustration, no
 * button: the list beside it is the thing to press.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { CreatureMark } from '../insights/Creature';
import { nav } from '../nav/Skeleton';
import { space } from '../theme';
import { useAccent } from '../theme/accent';
import { T } from '../ui/Text';

const LINES: Record<'sessions' | 'drops' | 'projects', string> = {
  sessions: 'Pick a session to read it here.',
  drops: 'Open a drop to see what it could become.',
  projects: 'Pick a project to see where its hours went.',
};

export function EmptyDetail({ master }: { master: 'sessions' | 'drops' | 'projects' }) {
  const accent = useAccent();
  return (
    <View style={styles.fill}>
      <CreatureMark animal={accent.animal} size={48} color={nav.border} />
      <T role="meta" align="center" style={{ color: nav.textFaint }}>
        {LINES[master]}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, backgroundColor: nav.bg },
});
