/**
 * A project's picture on its Projects row: its trailer or its kit's video playing, its stills on its
 * band, or its ink (`rows.stageVisual` decides which). Nothing to tap to see any of it: the video
 * plays by itself while it is on screen (`LoopVideo`'s rules: a quarter in view, the page focused,
 * the app in front, never under Reduce Motion), the prints develop in through the band's own
 * pixels, and the ink pours in and can be stirred.
 *
 * The stills stage is the ship kit's 16:9 frame drawn live: the project's band across the top with
 * its dither dissolve, and the screens standing on it at their own shape, a print each, the middle
 * one forward. The prints arrive one after another (the stagger the app uses, never out), each
 * developing through the band's ink (`Print` `arrive`), so a row that lands shows its screens
 * arriving rather than popping in.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import { LoopVideo } from '../demos/LoopVideo';
import { Print } from '../demos/Print';
import type { DemoSources } from '../demos/useDemo';
import { BandPixels } from '../insights/Band';
import { type } from '../insights/kit';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { InkField } from '../motion/InkField';
import { motionFor } from '../motion/pixelMotion';
import { staggerDelay } from '../motion/spec';
import { useClockReached } from '../you/parts';
import type { GalleryEntry } from '../demos/model';
import { stageLabel, type StageVisual } from './rows';

/** A stage is the width of the row and 16:9, the shape a trailer and a kit's wide video are made at. */
export const STAGE_ASPECT = 16 / 9;
/** At most this many prints stand on a band: past four they are too narrow to read on a phone. */
const PRINTS_MAX = 4;

export interface StageProps {
  keyId: string;
  name: string;
  hue: HueName;
  width: number;
  visual: StageVisual;
  /** Playable sources by file id (`useKits`). */
  sources: Record<string, MediaSourceRef>;
  /** The demo's print sources (`useDemoPreviews`). */
  printSources: DemoSources | undefined;
  /** Whether the ink may move (the row most on screen). */
  playing: boolean;
  onOpen: () => void;
  onError?: () => void;
}

export function stageHeight(width: number): number {
  return Math.round(width / STAGE_ASPECT);
}

export function Stage({ keyId, name, hue, width, visual, sources, printSources, playing, onOpen, onError }: StageProps) {
  const height = stageHeight(width);
  const h = SPECTRUM[hue];
  const label = stageLabel(name, visual);
  if (visual.kind === 'video') {
    const entry: GalleryEntry = {
      id: visual.id,
      kind: 'video',
      label,
      source: null,
      mark: null,
      count: '',
      aspect: visual.width / visual.height,
      url: visual.url,
      posterUrl: null,
      duration: null,
      a11y: label,
    };
    return (
      <View style={{ width, height, backgroundColor: GROUND.bg }}>
        <LoopVideo
          entry={entry}
          src={sources[visual.id]}
          poster={undefined}
          width={width}
          height={height}
          held={false}
          onOpen={onOpen}
          onError={onError}
          a11yLabel={`${label}. Opens the project.`}
          // Until the first frame draws, the project's band: the frame a trailer opens on anyway.
          placeholder={<BandPixels width={width} solid={Math.round(height * 0.58)} ink={h.ink} motion={motionFor(`stage:${keyId}`)} />}
        />
      </View>
    );
  }
  if (visual.kind === 'prints') {
    return <PrintsStage keyId={keyId} hue={hue} width={width} height={height} prints={visual.prints} sources={printSources} label={label} onError={onError} />;
  }
  if (visual.kind === 'none') {
    return (
      <InkField width={width} height={height} ink={h.ink} deep={h.partner} ground={GROUND.bg} playing={playing} seed={parseInt(keyId.slice(0, 6), 16) || 7}>
        <View style={styles.inkWords} pointerEvents="none" accessible accessibilityLabel={label}>
          <Text maxFontSizeMultiplier={1.4} style={type.lead}>
            No demo yet
          </Text>
        </View>
      </InkField>
    );
  }
  return <View style={{ width, height, backgroundColor: GROUND.bg }} accessible accessibilityLabel={label} />;
}

function PrintsStage({
  keyId,
  hue,
  width,
  height,
  prints,
  sources,
  label,
  onError,
}: {
  keyId: string;
  hue: HueName;
  width: number;
  height: number;
  prints: readonly GalleryEntry[];
  sources: DemoSources | undefined;
  label: string;
  onError?: () => void;
}) {
  const h = SPECTRUM[hue];
  const shown = prints.slice(0, PRINTS_MAX);
  const ph = Math.round(height * 0.84);
  const aspect = shown[0]?.aspect ?? 9 / 19.5;
  const pw = Math.round(ph * Math.min(aspect, 0.75));
  const gap = Math.max(10, Math.round(width * 0.03));
  const total = shown.length * pw + (shown.length - 1) * gap;
  const x0 = Math.round((width - total) / 2);
  const top = Math.round((height - ph) / 2);
  const mid = (shown.length - 1) / 2;
  return (
    <View style={{ width, height, backgroundColor: GROUND.bg, overflow: 'hidden' }} accessible accessibilityRole="image" accessibilityLabel={label}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BandPixels width={width} solid={Math.round(height * 0.52)} ink={h.ink} motion={motionFor(`stage:${keyId}`)} />
      </View>
      {shown.map((p, i) => (
        <StagePrint
          key={p.id}
          entry={p}
          src={sources?.file[p.id]}
          x={x0 + i * (pw + gap)}
          // The middle print a touch forward (higher), the outer ones settling back.
          y={top + Math.round(Math.abs(i - mid) * height * 0.035)}
          width={pw}
          height={ph}
          hue={hue}
          wait={h.ink}
          delay={260 + staggerDelay(i, 90)}
          onError={onError}
        />
      ))}
    </View>
  );
}

function StagePrint({ entry, src, x, y, width, height, hue, wait, delay, onError }: { entry: GalleryEntry; src: MediaSourceRef | undefined; x: number; y: number; width: number; height: number; hue: HueName; wait: string; delay: number; onError?: () => void }) {
  const arrive = useClockReached(delay);
  return (
    <View style={[styles.print, { left: x, top: y, width, height, borderRadius: Math.round(width * 0.11) }]}>
      <Print id={entry.id} src={src} width={width} height={height} arrive={arrive} hue={hue} wait={wait} mark={entry.mark} onError={onError} />
    </View>
  );
}

const styles = StyleSheet.create({
  inkWords: { position: 'absolute', left: 20, bottom: 16 },
  print: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', borderWidth: 3, borderColor: GROUND.bg },
});
