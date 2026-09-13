import { useRouter } from 'expo-router';
import React, { useEffect, useState, type ReactNode } from 'react';
import { View, type DimensionValue } from 'react-native';

import { copyText } from '../onboarding/clipboard';
import { PixelBadge } from '../pixel/PixelBadge';
import { layout, space } from '../theme';
import { Button, SHAPE, Surface, T, snap, useColors } from '../ui';
import { staleLine, type Stale } from './load';

/**
 * The states every You page shares, so no page invents its own: Bit and two lines and the one
 * action for empty, the same with Try again for an error, one quiet line for stale, and a
 * skeleton shaped like the page while the first answer is on its way (the skill's law 8).
 *
 * All left aligned, Bit at 64 (the size every tab's empty state uses), one amber action.
 */

export interface PageAction {
  label: string;
  onPress: () => void;
}

/** Bit, a title, one line, and the one thing that fills the page. */
export function PageEmpty({
  title,
  text,
  action,
  state = 'sleeping',
}: {
  title: string;
  text: string;
  action?: PageAction;
  state?: 'sleeping' | 'idle' | 'thinking';
}) {
  return (
    <View style={{ gap: space.md }}>
      <PixelBadge state={state} size={64} title={title} text={text} style={{ padding: 0 }} />
      {action ? <Button label={action.label} onPress={action.onPress} size="compact" block={false} /> : null}
    </View>
  );
}

/** Signed out: the one state where the action is on this phone. */
export function PageSignedOut({ what }: { what: string }) {
  const router = useRouter();
  return (
    <PageEmpty
      state="idle"
      title={`No ${what} yet.`}
      text="Sign in, and it fills in from the sessions you finish."
      action={{ label: 'Sign in', onPress: () => router.push('/settings') }}
    />
  );
}

/** The request failed and there is nothing saved to show instead. */
export function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PageEmpty
      title="Could not load this page."
      text={message}
      action={{ label: 'Try again', onPress: onRetry }}
    />
  );
}

/** How long the copy action says "Copied" before it offers itself again. */
const COPIED_MS = 2000;

/**
 * A block the Mac sends with its report, and has not. The action copies the command that
 * sends it, because that is the one thing that fills the page and it runs on the Mac. The copy
 * is confirmed on screen as well as by the haptic (a haptic is never the only feedback).
 */
export function PageNotSent({ title, text, command }: { title: string; text: string; command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <PageEmpty
      title={title}
      text={text}
      action={{
        label: copied ? 'Copied' : 'Copy the command',
        onPress: () => {
          if (!copyText(command)) return;
          snap();
          setCopied(true);
        },
      }}
    />
  );
}

/** One line at the top of a page showing what was saved because the refresh failed. */
export function StaleNote({ stale }: { stale: Stale }) {
  return (
    <T role="meta" tone="dim" accessibilityRole="alert">
      {staleLine(stale)}
    </T>
  );
}

// ------------------------------------------------------------------------ skeletons

/**
 * One block of a skeleton: the `raised` fill, no shimmer (a shimmering placeholder is on the
 * slop list), a mark's radius for a line of text and a container's for a card.
 */
export function Bone({
  width,
  height,
  radius = SHAPE.mark,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
}) {
  const c = useColors();
  return <View style={{ width, height, borderRadius: radius, borderCurve: 'continuous', backgroundColor: c.raised }} />;
}

/** A text line's bone at a role's height. */
function Line({ width, height = 13 }: { width: DimensionValue; height?: number }) {
  return <Bone width={width} height={height} />;
}

/** A surface of `rows` list rows, each a title and a meta line, hairlines left out. */
export function RowsSkeleton({ rows, trailing = false }: { rows: number; trailing?: boolean }) {
  return (
    <Surface padding={0}>
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.tile,
            paddingHorizontal: layout.gutter,
            paddingVertical: space.tile,
            minHeight: 60,
          }}
        >
          <View style={{ flex: 1, gap: space.sm }}>
            <Line width={`${40 + ((i * 17) % 35)}%`} height={15} />
            <Line width={`${55 + ((i * 23) % 30)}%`} />
          </View>
          {trailing ? <Line width={44} /> : null}
        </View>
      ))}
    </Surface>
  );
}

/** A section label's bone and what goes under it. */
export function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Line width={96} height={12} />
      {children}
    </View>
  );
}

/** The You tab while its first answer is on its way: identity, the hero, the Wrapped card, the rows. */
export function YouSkeleton() {
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel="Loading your profile" accessible>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
        <Bone width={32} height={32} />
        <Line width={120} height={17} />
      </View>
      <View style={{ gap: space.tile }}>
        <Line width={110} height={12} />
        <Bone width="78%" height={56} radius={SHAPE.inner} />
        <Line width="92%" />
        <Line width="64%" />
        <View style={{ flexDirection: 'row', gap: space.tile, marginTop: space.sm }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flex: 1, gap: space.xs }}>
              <Line width="60%" height={17} />
              <Line width="85%" height={12} />
            </View>
          ))}
        </View>
      </View>
      <Bone width="100%" height={212} radius={SHAPE.wrapped} />
      <RowsSkeleton rows={4} />
    </View>
  );
}

/** The Dimensions page: five labelled bars, then the type. */
export function DimensionsSkeleton() {
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel="Loading your dimensions" accessible>
      <Surface style={{ gap: space.md }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Line width={`${30 + ((i * 13) % 25)}%`} height={15} />
              <Line width={28} height={15} />
            </View>
            <Bone width="100%" height={6} radius={SHAPE.action} />
          </View>
        ))}
      </Surface>
      <SectionSkeleton>
        <Line width="55%" height={22} />
        <Line width="90%" />
      </SectionSkeleton>
    </View>
  );
}

/** The Money page: the hero number, the three beside it, the rows by model. */
export function MoneySkeleton() {
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel="Loading the money view" accessible>
      <View style={{ gap: space.sm }}>
        <Line width={150} height={12} />
        <Bone width="46%" height={40} radius={SHAPE.inner} />
        <Line width="80%" />
      </View>
      <View style={{ flexDirection: 'row', gap: space.tile }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flex: 1, gap: space.xs }}>
            <Line width="70%" height={17} />
            <Line width="50%" height={12} />
          </View>
        ))}
      </View>
      <SectionSkeleton>
        <RowsSkeleton rows={3} trailing />
      </SectionSkeleton>
    </View>
  );
}

/** A list page (glossary, stack): the summary line, then grouped rows. */
export function ListSkeleton({ label }: { label: string }) {
  return (
    <View style={{ gap: layout.sectionGap }} accessibilityLabel={label} accessible>
      <Line width="70%" height={17} />
      <SectionSkeleton>
        <RowsSkeleton rows={4} trailing />
      </SectionSkeleton>
      <SectionSkeleton>
        <RowsSkeleton rows={2} trailing />
      </SectionSkeleton>
    </View>
  );
}
