/**
 * The session screen's states besides the session itself, in the house style: a sentence that
 * says what is true, one line under it, and the one thing to do next as a word with an arrow
 * (navigation is words, never a capsule of chrome). Left aligned. Which one shows is `load.ts`'s
 * decision, not this file's. The map and time lapse pages show the same ones.
 *
 * The skeleton is the page's shape while the first answer is on its way: the hero band flat in
 * the raised ground, the strip's floor and the lines of words. Still, no shimmer (a shimmering
 * placeholder is on the slop list, and a still one is honest about what it is).
 */
import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { GUTTER, Refusal, type, Words } from '../insights/kit';
import { GROUND } from '../insights/palette';
import { Door } from './parts';

/** The page while its first answer is on its way: the band, the strip, the words, flat. */
export function SessionSkeleton({ width }: { width: number }) {
  return (
    <View accessible accessibilityLabel="Loading this session" style={styles.skeleton}>
      <View style={[styles.band, { width }]} />
      <View style={styles.lines}>
        <Bone width="100%" height={46} />
        <View style={styles.gap} />
        {(['92%', '100%', '84%', '61%'] as const).map((w, i) => (
          <Bone key={i} width={w} height={16} />
        ))}
      </View>
    </View>
  );
}

function Bone({ width, height }: { width: DimensionValue; height: number }) {
  return <View style={{ width, height, backgroundColor: GROUND.card }} />;
}

/** A sentence, one line, and the one thing to do next. */
function StateWords({ title, text, action, onAction, color = GROUND.text }: { title: string; text: string; action: string; onAction: () => void; color?: string }) {
  return (
    <View style={styles.state}>
      <Words style={type.heading}>{title}</Words>
      <Words style={[type.dim, styles.text]}>{text}</Words>
      <Door title={action} color={color} onPress={onAction} small />
    </View>
  );
}

/** The server says there is no such session for this account. */
export function SessionMissing({ onBack }: { onBack: () => void }) {
  return <StateWords title="This session is not here." text="It may have been deleted, or its repository taken out of Builda." action="Back to sessions" onAction={onBack} />;
}

/** A session id this phone cannot read without an account. */
export function SessionSignedOut({ onSignIn }: { onSignIn: () => void }) {
  return <StateWords title="Sign in to see this session." text="Your sessions come from your Mac, and only you can read them." action="Sign in" onAction={onSignIn} />;
}

/** It failed, and nothing was saved on this phone to show instead. */
export function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Words style={type.heading}>Could not load this session.</Words>
      <View style={styles.text}>
        <Refusal>{message}</Refusal>
      </View>
      <Door title="Try again" color={GROUND.text} onPress={onRetry} small />
    </View>
  );
}

/** One quiet line at the top: this is the saved copy, and why. */
export function StaleLine({ text }: { text: string }) {
  return (
    <View accessibilityRole="alert">
      <Words style={type.meta}>{text}</Words>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: 22 },
  band: { height: 300, backgroundColor: GROUND.raised },
  lines: { paddingHorizontal: GUTTER, gap: 10 },
  gap: { height: 14 },
  state: { gap: 4, paddingTop: 8 },
  text: { marginTop: 4, marginBottom: 8 },
});
