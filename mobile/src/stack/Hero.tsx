/**
 * 01, what your work is made of: a band in the builder's creature's hue that prints itself, the
 * count of things huge in dark ink, the creature printed beside it, what the count splits into,
 * and along the band's foot the most used marks drifting past, each on a dark tile in its brand's
 * colour, like app icons on a coloured wallpaper. Under the band, on the ground, the bubbles of
 * what you build with most.
 *
 * The drift is react-bits LogoLoop (David Haz, MIT + Commons Clause; the notice is in
 * `src/ui/bits/effects/LogoLoop.tsx`), whose own demo is exactly this: a row of tech logos from
 * the Simple Icons set (react-bits `src/demo/Animations/LogoLoopDemo.jsx`, `react-icons/si`).
 * The port's speed (36 pt/s, v2's ambient share of the demo's 100) and its finger stop are kept;
 * the tiles are 56 pt with 10 pt between them where the demo sets 60 px logos 60 px apart,
 * because here each mark sits on its own tile. It is the page's one ambient motion (DESIGN-V2
 * rule 2), it stops when the band has scrolled away, and under Reduce Motion it stands still and
 * wraps (the port's own still).
 */
import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { measure, runOnJS, useAnimatedRef, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { Band, BandWords } from '../insights/Band';
import { CreaturePrint } from '../insights/Creature';
import { BandFigure, GUTTER, Kicker, type } from '../insights/kit';
import { GROUND, ON_HUE, SPECTRUM, type Hue, type HueName } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { SHAPE } from '../ui';
import { LogoLoop, type LoopItem } from '../ui/bits/effects';
import { Bubbles } from './Bubbles';
import { MarkView } from './Mark';
import { inkFor } from './marks';
import type { StackBody, StackThing } from './model';

/** The drifting tiles, and the mark on each. */
const TILE = 56;
const TILE_MARK = 30;
const TILE_GAP = 10;
/** How often the drift checks whether it is still on screen, in frames. */
const CHECK_EVERY = 12;

/**
 * Whether a view is on screen, checked every `CHECK_EVERY` frames on the UI thread: the drift is
 * paused when its band has scrolled away (the LogoLoop port asks its caller for exactly this).
 * It measures only once the view has laid out and only while the page is the focused one, so it
 * never asks Reanimated for the metrics of a view that is not there (which it warns about), and
 * a page under another one costs nothing.
 */
function useOnScreen() {
  const ref = useAnimatedRef<Animated.View>();
  const { height } = useWindowDimensions();
  const focused = useIsFocused();
  const [laid, setLaid] = useState(false);
  const [on, setOn] = useState(true);
  const seen = useSharedValue(1);
  const frames = useSharedValue(0);
  const watch = useFrameCallback(() => {
    'worklet';
    frames.value += 1;
    if (frames.value % CHECK_EVERY !== 0) return;
    const m = measure(ref);
    if (!m) return;
    const visible = m.pageY + m.height > 0 && m.pageY < height ? 1 : 0;
    if (visible !== seen.value) {
      seen.value = visible;
      runOnJS(setOn)(visible === 1);
    }
  }, false);
  useEffect(() => {
    watch.setActive(focused && laid);
  }, [focused, laid, watch]);
  const onLayout = useCallback(() => setLaid(true), []);
  return { ref, on: on && focused, onLayout };
}

function MarkTile({ thing, ink }: { thing: StackThing; ink: string }) {
  return (
    <View style={styles.tile}>
      <MarkView mark={thing.mark} size={TILE_MARK} color={ink} />
    </View>
  );
}

function MarkLoop({ things, hueOf }: { things: readonly StackThing[]; hueOf: (t: StackThing) => HueName }) {
  const { ref, on, onLayout } = useOnScreen();
  const items = useMemo<LoopItem[]>(
    () => things.map((t) => ({ key: t.id, label: t.name, node: <MarkTile thing={t} ink={inkFor(t.mark, SPECTRUM[hueOf(t)].ink)} /> })),
    [things, hueOf],
  );
  return (
    <Animated.View ref={ref} collapsable={false} onLayout={onLayout}>
      <LogoLoop items={items} height={TILE} gap={TILE_GAP} paused={!on} accessibilityLabel={`The most used: ${things.map((t) => t.name).join(', ')}.`} />
    </Animated.View>
  );
}

export function StackHero({ body, hue, animal, width, hueOf }: { body: StackBody; hue: Hue; animal: Animal; width: number; hueOf: (t: StackThing) => HueName }) {
  const inner = width - GUTTER * 2;
  const creature = Math.min(112, Math.floor((inner * 0.32) / 16) * 16);
  return (
    <Section>
      <Band hue={hue} index="01" title="What it is made of">
        <View style={styles.figureRow}>
          <View style={styles.figureWords}>
            <BandFigure spec={body.total} width={inner - creature - 16} max={136} min={64} delay={200} label={`${body.total.final} ${body.caption}`} />
            <BandWords delay={320}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {body.caption}
              </Text>
            </BandWords>
          </View>
          <CreaturePrint animal={animal} size={creature} color={ON_HUE} delay={220} />
        </View>
        <BandWords delay={420}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
            {`${body.note} ${body.basis}`}
          </Text>
        </BandWords>
        {body.loop.length ? (
          <BandWords delay={520}>
            <View style={styles.bleed}>
              <MarkLoop things={body.loop} hueOf={hueOf} />
            </View>
          </BandWords>
        ) : null}
      </Band>

      {body.top.length ? (
        // Keyed by what it draws: a refresh that brings a different top ten plays the block
        // again, rather than mounting a count into a clock that has already stopped.
        <Block key={body.top.map((t) => `${t.id}.${t.sessions}`).join(' ')} style={styles.block}>
          <Kicker>what you build with most</Kicker>
          <Bubbles things={body.top} width={inner} hueOf={hueOf} line={body.topLine ? `${body.topLine} Tap a bubble for its story.` : null} />
        </Block>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 4 },
  figureWords: { flex: 1 },
  note: { marginTop: 12 },
  // The band pads its words 20 pt; the drift runs edge to edge under them.
  bleed: { marginHorizontal: -20, marginTop: 20 },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: SHAPE.inner,
    borderCurve: 'continuous',
    backgroundColor: GROUND.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { paddingHorizontal: GUTTER, marginTop: 26 },
});
