/**
 * The seven shader backgrounds, one block each, for the kit gallery: mount
 * `<BackgroundsGallery width={w} />` in a dev screen (it is not in the barrel, so no product
 * screen ships it). Each block names the field, its react-bits source and where Builda wears it.
 * Only one field moves at a time (DESIGN-V2 3, rule 2): tapping a block's label runs it, the
 * others hold their seed frame.
 *
 * Ported from react-bits `Backgrounds/*` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: nothing here is ported; it only shows the ports.
 */
import React, { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { radius, space } from '../../../theme';
import { useColors } from '../../scheme';
import { T } from '../../Text';
import { DotGrid } from './DotGrid';
import { FieldDither } from './FieldDither';
import { Grainient } from './Grainient';
import { PixelBlast } from './PixelBlast';
import { Radar } from './Radar';
import { Silk } from './Silk';
import { Topography } from './Topography';
import { galleryCaption } from './copy';
import type { BackgroundName } from './shaders';

const HEIGHT = 180;

function Block({ name, running, onRun, children }: { name: BackgroundName; running: boolean; onRun: () => void; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      <Pressable onPress={onRun} accessibilityRole="button" accessibilityState={{ selected: running }} hitSlop={space.sm}>
        <T role="label" tone={running ? 'text' : 'dim'}>
          {galleryCaption(name).title}
        </T>
        <T role="meta" tone="faint">
          {galleryCaption(name, running).line}
        </T>
      </Pressable>
      <View style={{ borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.card }}>{children}</View>
    </View>
  );
}

export function BackgroundsGallery({ width }: { width: number }) {
  const [running, setRunning] = useState<BackgroundName>('FieldDither');
  const w = Math.max(0, Math.floor(width));
  const paused = (n: BackgroundName) => running !== n;
  const run = (n: BackgroundName) => () => setRunning(n);
  const common = { width: w, height: HEIGHT };
  return (
    <View style={{ gap: space.lg }}>
      <Block name="FieldDither" running={!paused('FieldDither')} onRun={run('FieldDither')}>
        <FieldDither {...common} paused={paused('FieldDither')} develop interactive />
      </Block>
      <Block name="PixelBlast" running={!paused('PixelBlast')} onRun={run('PixelBlast')}>
        <PixelBlast {...common} paused={paused('PixelBlast')} density={0.8} interactive />
      </Block>
      <Block name="Silk" running={!paused('Silk')} onRun={run('Silk')}>
        <Silk {...common} paused={paused('Silk')} />
      </Block>
      <Block name="Grainient" running={!paused('Grainient')} onRun={run('Grainient')}>
        <Grainient {...common} paused={paused('Grainient')} />
      </Block>
      <Block name="Radar" running={!paused('Radar')} onRun={run('Radar')}>
        <Radar {...common} paused={paused('Radar')} />
      </Block>
      <Block name="Topography" running={!paused('Topography')} onRun={run('Topography')}>
        <Topography {...common} paused={paused('Topography')} interactive />
      </Block>
      <Block name="DotGrid" running={!paused('DotGrid')} onRun={run('DotGrid')}>
        <DotGrid {...common} paused={paused('DotGrid')} />
      </Block>
    </View>
  );
}
