import { makeImageFromView, type SkImage } from '@shopify/react-native-skia';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTINUE, HELLO } from '../../src/onboarding/copy';
import { coolDown, coverWith, warmWith, type DissolveGeometry } from '../../src/onboarding/dissolve';
import { loadFacts } from '../../src/onboarding/facts';
import { GUTTER, HELLO_BIT, pathFor } from '../../src/onboarding/flow';
import { HelloBit } from '../../src/onboarding/HelloBit';
import { Headline } from '../../src/onboarding/Headline';
import { Rise, Wipe } from '../../src/onboarding/Rise';
import { colors, space } from '../../src/theme';
import { Button, T } from '../../src/ui';

const c = colors('dark');

/**
 * When to take the picture of this screen: after every entrance on it has finished (the
 * headline's wipe ends at 700ms, Bit's first blink at 570ms), so the picture is the screen as
 * it stands. Taking it is slow (a full screen render to pixels), which is why it is taken here,
 * while the person reads, and not when they press Continue.
 */
const PICTURE_AFTER_MS = 900;
/** A Continue pressed while the picture is still being taken waits at most this long for it. */
const PICTURE_WAIT_MS = 250;

interface Picture {
  promise: Promise<SkImage | null>;
  image: SkImage | null;
  /** Handed to the dissolve, which disposes it; otherwise disposed here. */
  taken: boolean;
}

/** Two frames: enough for the canvas holding the picture of hello to have drawn it. */
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
    tick(n);
  });
}

function within<V>(p: Promise<V>, ms: number, fallback: V): Promise<V> {
  return Promise.race([p, new Promise<V>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Where a view is on screen, in window points: the wave's origin and the grid's anchor. */
function whereIs(view: View | null): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
  });
}

/**
 * Step 0: Bit says hello (DESIGN-DIRECTION 4). The warm black canvas, Bit centred at 128pt
 * and blinking, one headline and one line, left aligned, and Continue. Bit and Continue are
 * there from the first frame (amber never fades in: part way, it is brown); the headline
 * wipes in and the line under it rises.
 *
 * Continue lays a picture of this screen over everything, pushes the name step under it and
 * lets the picture break into pixel cells in a wave out of the button (`PixelDissolve`,
 * react-bits PixelTransition as SkSL), with the keyboard coming up under it. With no picture
 * to lay (pressed in the first second, or the picture failed), the name step simply fades in:
 * nothing waits on the effect.
 */
export default function HelloStep() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const root = useRef<View>(null);
  const bit = useRef<View>(null);
  const action = useRef<View>(null);
  const picture = useRef<Picture | null>(null);
  // A ref, not state: the button must look exactly as it does in the picture.
  const leaving = useRef(false);

  useFocusEffect(
    useCallback(() => {
      // Every run of the flow starts here: read the account afresh (a sign in or a sign out
      // since the flow last opened changes what the steps can say).
      void loadFacts(true);
      const t = setTimeout(() => {
        const entry: Picture = {
          promise: makeImageFromView(root as React.RefObject<View>).catch(() => null),
          image: null,
          taken: false,
        };
        void entry.promise.then((img) => {
          entry.image = img;
          // Draw it once through the dissolve, invisibly, while the person reads.
          if (img && picture.current === entry && !entry.taken) warmWith(img);
        });
        picture.current = entry;
      }, PICTURE_AFTER_MS);
      return () => {
        clearTimeout(t);
        const entry = picture.current;
        picture.current = null;
        if (entry && !entry.taken)
          void entry.promise.then((img) => {
            if (!img) return;
            coolDown(img);
            // After the canvas has let go of it (it unmounts on the render coolDown causes).
            setTimeout(() => img.dispose(), 1000);
          });
      };
    }, []),
  );

  const go = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    const entry = picture.current;
    const [image, button, face] = await Promise.all([
      entry ? (entry.image ?? within(entry.promise, PICTURE_WAIT_MS, null)) : Promise.resolve(null),
      whereIs(action.current),
      whereIs(bit.current),
    ]);
    if (entry && image) {
      entry.taken = true;
      const geometry: DissolveGeometry = {
        origin: button ? [button.x + button.width / 2, button.y + button.height / 2] : null,
        anchor: face ? [face.x, face.y] : null,
      };
      coverWith(image, geometry);
      await nextFrames(2);
      router.push({ pathname: pathFor('name'), params: { via: 'cells' } } as Href);
    } else {
      router.push(pathFor('name') as Href);
    }
    setTimeout(() => {
      leaving.current = false;
    }, 600);
  }, [router]);

  return (
    <View ref={root} collapsable={false} style={{ flex: 1, backgroundColor: c.bg }}>
      {/* The one centred thing on the screen is Bit: it is what is being looked at. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <View ref={bit} collapsable={false}>
          <HelloBit size={HELLO_BIT} />
        </View>
      </View>
      <View style={{ paddingHorizontal: GUTTER, gap: space.tile, paddingBottom: space.lg }}>
        <Wipe delay={180}>
          <Headline>{HELLO.headline}</Headline>
        </Wipe>
        <Rise index={0} delay={260}>
          <T role="body" tone="dim">
            {HELLO.body}
          </T>
        </Rise>
      </View>
      <View ref={action} collapsable={false} style={{ marginHorizontal: GUTTER, marginBottom: insets.bottom + space.sm }}>
        <Button label={CONTINUE} onPress={() => void go()} />
      </View>
    </View>
  );
}
