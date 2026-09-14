/**
 * The prints on a project's door: up to three stills of its demo fanned like prints held in a
 * hand, beside the project's words, with a tap opening the gallery at the print under the finger.
 *
 * The hand is react-bits BounceCards (through its port in `src/ui/bits/components/BounceCards.tsx`,
 * which keeps David Haz's notice): the prints start stacked and fan out with one soft overshoot
 * when the band's words arrive, and then lie still. Its five rest poses are written for a 400 point
 * stage; on a door the hand is a third of that, so the poses here are a tight hand of up to three,
 * the top print the most upright, and the spread around a finger is off (at this size it would
 * throw a print off the screen). The TOP print arrives through the band's own pixels: it waits in
 * the band's ink, invisible on it, and prints in square by square once it has loaded
 * (`Print.tsx`, react-bits PixelTransition). With no demo, one blank print says how to make one.
 */
import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { WORDS_AT } from '../insights/Band';
import { SPECTRUM, type HueName } from '../insights/palette';
import { BounceCards } from '../ui/bits/components';
import type { FanPose } from '../ui/bits/components/geometry';
import { useClockReached } from '../you/parts';
import { DoorEmptyPrint } from './EmptyPrint';
import type { GalleryEntry } from './model';
import { Print } from './Print';
import type { DemoSources } from './useDemo';

/** How long after the hand opens the top print starts to develop: the fan's spring has settled by then. */
const TOP_AFTER_MS = 320;

/** The hand's box, and one print in it (a phone's shape). */
export const DOOR_PRINTS = { width: 124, height: 184, printW: 74, printH: 160 } as const;

/** A tight hand of one to three prints, the last (on top) the most upright. */
export function doorPoses(n: number): FanPose[] {
  if (n <= 1) return [{ x: 0, rotate: -3 }];
  if (n === 2) return [{ x: -13, rotate: -8 }, { x: 11, rotate: 3 }];
  return [
    { x: -22, rotate: -9 },
    { x: -3, rotate: 5 },
    { x: 15, rotate: -2 },
  ];
}

export function DoorPrints({
  prints,
  sources,
  hue,
  label,
  onOpen,
  onError,
}: {
  prints: readonly GalleryEntry[];
  sources: DemoSources;
  hue: HueName;
  /** The project's name, for VoiceOver. */
  label: string;
  onOpen: (id: string) => void;
  onError?: () => void;
}) {
  // The hand opens as the band's words arrive, not before its pixels have printed, and the top
  // print develops a beat after, once the hand has opened under it.
  const open = useClockReached(WORDS_AT);
  const develop = useClockReached(WORDS_AT + TOP_AFTER_MS);
  const poses = useMemo(() => doorPoses(prints.length), [prints.length]);
  const ink = SPECTRUM[hue].ink;
  // The hand is tight and the top print covers most of it, so a finger anywhere on it opens the
  // print it can see (BounceCards picks the nearest pose by x, which is usually one underneath).
  const onPress = useCallback(() => {
    const p = prints[prints.length - 1];
    if (p) onOpen(p.id);
  }, [prints, onOpen]);

  if (!prints.length) {
    return (
      <View style={{ width: DOOR_PRINTS.width, height: DOOR_PRINTS.height, alignItems: 'center', justifyContent: 'center' }}>
        {open ? <DoorEmptyPrint width={DOOR_PRINTS.printW + 30} height={DOOR_PRINTS.printH} /> : null}
      </View>
    );
  }
  if (!open) return <View style={{ width: DOOR_PRINTS.width, height: DOOR_PRINTS.height }} />;
  const top = prints.length - 1;
  return (
    <BounceCards
      count={prints.length}
      containerWidth={DOOR_PRINTS.width}
      containerHeight={DOOR_PRINTS.height}
      cardWidth={DOOR_PRINTS.printW}
      cardHeight={DOOR_PRINTS.printH}
      poses={poses}
      spread={false}
      shape="mark"
      haptic="select"
      onPress={onPress}
      labelFor={(i) => `${label}, demo still ${i + 1} of ${prints.length}: ${prints[i]?.label ?? ''}. Opens the demo.`}
      renderCard={(i) => (
        <Print
          id={prints[i]!.id}
          src={sources.file[prints[i]!.id]}
          width={DOOR_PRINTS.printW}
          height={DOOR_PRINTS.printH}
          // The top print waits in the band's ink and prints in through its cells; the rest are there.
          arrive={i === top ? develop : undefined}
          hue={hue}
          wait={ink}
          onError={onError}
        />
      )}
    />
  );
}
