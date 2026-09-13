/**
 * The pieces the codebase map and the time lapse share: the legend in words, a skeleton shaped
 * like each screen, the refusal (Bit, two lines, the one action), the sample's note, and the
 * way back to the session. Built from the kit and the You pages' states, so neither screen
 * invents its own empty state.
 */
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { View } from 'react-native';

import type { SessionDetail } from '../data/api';
import { layout, space } from '../theme';
import { SHAPE, T, useColors } from '../ui';
import { Bone, PageEmpty, PageNotSent, RowsSkeleton, SectionSkeleton } from '../you/States';
import { SCRUBBER_HEIGHT } from './Scrubber';
import { ISLANDS_NOTE, LIVE_COMMAND, refusalCopy, type LegendItem, type Refusal } from './view';

/** A legend swatch: one cell, drawn as the map draws it. Square: a cell is a pixel, not a mark. */
function Swatch({ kind }: { kind: LegendItem['swatch'] }) {
  const c = useColors();
  const size = 12;
  if (kind === 'cursor') {
    return <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: c.text, backgroundColor: c.graph[3] }} />;
  }
  const fill = kind === 'read' ? c.graph[2] : kind === 'fail' ? c.data.del : c.graph[5];
  return <View style={{ width: size, height: size, backgroundColor: fill }} />;
}

/** The legend in words, one swatch each, then what an island is. */
export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <View style={{ gap: space.sm }} accessibilityRole="summary">
      {items.map((it) => (
        <View key={it.swatch} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.tile }}>
          <View style={{ paddingTop: 3 }}>
            <Swatch kind={it.swatch} />
          </View>
          <T role="meta" tone="dim" style={{ flex: 1 }}>
            {it.text}
          </T>
        </View>
      ))}
      <T role="meta" tone="dim">
        {ISLANDS_NOTE}
      </T>
    </View>
  );
}

/** The built in sample says it is one, in the voice every other line on the page uses. */
export function SampleNote() {
  return (
    <T role="meta" tone="dim">
      A sample session. Yours draw here while one runs.
    </T>
  );
}

// ------------------------------------------------------------------ skeletons

function Header() {
  return (
    <View style={{ gap: space.sm }}>
      <Bone width="82%" height={17} />
      <Bone width="56%" height={13} />
    </View>
  );
}

/** The map while its first answer is on its way: the sentence, the drawing, the legend, the list. */
export function MapSkeleton({ width }: { width: number }) {
  return (
    <View style={{ gap: layout.sectionGap }} accessible accessibilityLabel="Loading the codebase map">
      <Header />
      <Bone width={width} height={Math.round(Math.min(width * 0.8, 320))} radius={SHAPE.container} />
      <View style={{ gap: space.sm }}>
        {['64%', '28%', '52%'].map((w) => (
          <View key={w} style={{ flexDirection: 'row', gap: space.tile, alignItems: 'center' }}>
            <Bone width={12} height={12} radius={0} />
            <Bone width={w as `${number}%`} height={13} />
          </View>
        ))}
      </View>
      <SectionSkeleton>
        <RowsSkeleton rows={3} trailing />
      </SectionSkeleton>
    </View>
  );
}

/** The time lapse while its first answer is on its way: the title, the drawing, the controls, the scrubber. */
export function TimelapseSkeleton({ width }: { width: number }) {
  return (
    <View style={{ gap: layout.sectionGap }} accessible accessibilityLabel="Loading the time lapse">
      <Header />
      <Bone width={width} height={Math.round(Math.min(width * 0.8, 320))} radius={SHAPE.container} />
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.tile, alignItems: 'center' }}>
          <Bone width={44} height={44} radius={SHAPE.action} />
          <Bone width={120} height={15} />
        </View>
        <Bone width={width} height={SCRUBBER_HEIGHT - 14} radius={SHAPE.mark} />
      </View>
      <View style={{ gap: space.sm }}>
        <Bone width="92%" height={13} />
        <Bone width="70%" height={13} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ refusals

/**
 * Back to the session this screen was opened from, or onto it when the screen was opened by a
 * link: back when the session is right under this screen, else this screen is replaced by the
 * session (it had nothing to show, so there is nothing to come back to).
 */
export function useOpenSession(id: string, variant: string | undefined): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  return useCallback(() => {
    const state = navigation.getState();
    const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    if (below?.name === 'session/[id]' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: '/session/[id]', params: variant ? { id, variant } : { id } });
  }, [navigation, router, id, variant]);
}

/**
 * A refusal from the data: Bit, the title, the sentence, and the one action (open the session,
 * copy the command that sends the live state, or try again).
 */
export function MapRefusal({
  kind,
  screen,
  session,
  now,
  onSession,
  onRetry,
}: {
  kind: Refusal;
  screen: 'map' | 'timelapse';
  session: SessionDetail;
  now: number;
  onSession: () => void;
  onRetry: () => void;
}) {
  const copy = refusalCopy(kind, screen, session, now);
  if (copy.action === 'copy') return <PageNotSent title={copy.title} text={copy.text} command={LIVE_COMMAND} />;
  const bit = kind === 'finished' ? 'sleeping' : kind === 'empty' ? 'thinking' : 'idle';
  return (
    <PageEmpty
      state={bit}
      title={copy.title}
      text={copy.text}
      action={
        copy.action === 'retry' ? { label: 'Try again', onPress: onRetry } : { label: 'Open the session', onPress: onSession }
      }
    />
  );
}
