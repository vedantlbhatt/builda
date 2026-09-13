import React from 'react';
import { View, type DimensionValue } from 'react-native';

import { PixelBadge } from '../pixel/PixelBadge';
import { layout, space } from '../theme';
import { Button, SHAPE, Surface, T, useColors } from '../ui';

/**
 * The session screen's states besides the session itself (the skill's law 8: skeletons
 * shaped like the result, empty states composed with the one thing that fills them, errors
 * inline and specific). Left aligned, Bit at 64 as every tab's empty state has him, one
 * action each. Which one shows is `load.ts`'s decision, not this file's.
 */

/**
 * One block of the skeleton: the `raised` fill and nothing else. No shimmer: a shimmering
 * placeholder is on the slop list, and a still one is honest about what it is.
 */
function Bone({ width, height, radius = SHAPE.mark }: { width: DimensionValue; height: number; radius?: number }) {
  const c = useColors();
  return <View style={{ width, height, borderRadius: radius, borderCurve: 'continuous', backgroundColor: c.raised }} />;
}

/**
 * The screen while its first answer is on its way, in the shape it will have: the 16:9 card,
 * the strip's key, the title and its paragraph, then the burn numbers in a card.
 */
export function SessionSkeleton({ width }: { width: number }) {
  return (
    <View style={{ gap: layout.sectionGap }} accessible accessibilityLabel="Loading this session">
      <View style={{ gap: space.md }}>
        <Bone width={width} height={Math.round((width * 9) / 16)} radius={SHAPE.wrapped} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {[92, 104, 78, 44].map((w) => (
            <Bone key={w} width={w} height={12} />
          ))}
        </View>
        <View style={{ gap: space.sm }}>
          <Bone width="72%" height={22} />
          {(['100%', '97%', '93%', '100%', '61%'] as const).map((w, i) => (
            <Bone key={i} width={w} height={17} />
          ))}
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <Bone width={132} height={12} />
        <Surface style={{ gap: space.md }}>
          {[0, 1].map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: space.tile }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flex: 1, gap: space.xs }}>
                  <Bone width="58%" height={17} />
                  <Bone width="84%" height={12} />
                </View>
              ))}
            </View>
          ))}
        </Surface>
      </View>
    </View>
  );
}

/** Bit, a title, one line, and the one thing to do next. */
function SessionEmptyState({
  state,
  title,
  text,
  action,
  onAction,
}: {
  state: 'sleeping' | 'idle';
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      <PixelBadge state={state} size={64} title={title} text={text} style={{ padding: 0 }} />
      <Button label={action} onPress={onAction} size="compact" block={false} />
    </View>
  );
}

/** The server says there is no such session for this account. */
export function SessionMissing({ onBack }: { onBack: () => void }) {
  return (
    <SessionEmptyState
      state="sleeping"
      title="This session is not here."
      text="It may have been deleted, or its repository taken out of Builder."
      action="Back to sessions"
      onAction={onBack}
    />
  );
}

/** A session id this phone cannot read without an account. */
export function SessionSignedOut({ onSignIn }: { onSignIn: () => void }) {
  return (
    <SessionEmptyState
      state="idle"
      title="Sign in to see this session."
      text="Your sessions come from your Mac, and only you can read them."
      action="Sign in"
      onAction={onSignIn}
    />
  );
}

/** It failed, and nothing was saved on this phone to show instead. */
export function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SessionEmptyState state="sleeping" title="Could not load this session." text={message} action="Try again" onAction={onRetry} />
  );
}

/** One quiet line at the top: this is the saved copy, and why. */
export function StaleLine({ text }: { text: string }) {
  return (
    <T role="meta" tone="dim" accessibilityRole="alert">
      {text}
    </T>
  );
}
