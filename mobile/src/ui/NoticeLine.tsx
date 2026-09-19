/**
 * The app's passing words ("Sent to your Mac", "That did not reach your Mac"), one line near the
 * foot of the screen for as long as the notice holds.
 *
 * It replaced the in-app island (2026-09-19). The owner: the island is not for saying how a run or
 * a request is doing. What stays is only what a person needs to be told after a tap, said plainly:
 * the card surface, the text colour, the house type, nothing that glows. VoiceOver hears it too,
 * because an accessibility live region is Android's alone.
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIslandActivities } from '../island/store';
import { useColors } from './scheme';
import { space } from '../theme';
import { SHAPE } from './shape';
import { T } from './Text';

/** Above a tab bar's 49 points, with room to breathe. */
const ABOVE_TABS = 64;

export function NoticeLine() {
  const activities = useIslandActivities();
  const notice = [...activities].reverse().find((a) => a.kind === 'notice');
  const insets = useSafeAreaInsets();
  const c = useColors();
  const text = notice?.kind === 'notice' ? notice.text : null;

  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);

  if (!notice || notice.kind !== 'notice') return null;
  return (
    <Animated.View
      key={notice.id}
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(160)}
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + ABOVE_TABS }]}
    >
      <Pressable
        disabled={!notice.action}
        onPress={notice.action}
        accessibilityRole={notice.action ? 'button' : 'text'}
        style={[styles.line, { backgroundColor: c.raised }]}
      >
        <T role="meta" style={{ color: c.text }}>
          {notice.text}
        </T>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center' },
  line: { paddingHorizontal: space.md, paddingVertical: space.tile, borderRadius: SHAPE.container, borderCurve: 'continuous' },
});
