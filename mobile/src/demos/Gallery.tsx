/**
 * A project's demo, full screen: every file of it on a track a finger drags (react-bits Carousel,
 * through its port in `src/ui/bits/components/Carousel.tsx`), the video first, each picture with
 * the state it shows under it and where it came from when it was not recorded from the running app,
 * and the count ("3 of 6") at the top. A swipe down closes it, as a photo closes on the phone; so
 * does the word Close.
 *
 * Each still PRINTS IN the first time it lands in front of you: it waits as a dark print, and the
 * cells of react-bits PixelTransition (`Print.tsx`) switch it over to the picture square by square,
 * in the project's hue. After that it is simply there, on the way back as well. The video plays
 * with sound and the player's own controls while it is the one in front, and stops when it is not;
 * under Reduce Motion it waits for a press of play, and on a build without expo-video it is its
 * poster with a sentence saying why.
 *
 * The ports keep David Haz's notice (react-bits, MIT + Commons Clause, used as part of this
 * application only).
 */
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MediaSourceRef } from '../data/api';
import { figure, type } from '../insights/kit';
import { GROUND, type HueName } from '../insights/palette';
import { Carousel } from '../ui/bits/components';
import { SNAP, useReduceMotion } from '../ui/motion';
import { SHAPE } from '../ui/shape';
import type { GalleryEntry } from './model';
import { Print } from './Print';
import type { DemoSources } from './useDemo';
import { expoVideo, type ExpoVideo } from './video';

/** A swipe down this far, or this fast, closes the gallery. */
const CLOSE_DRAG = 120;
const CLOSE_FLICK = 900;
/** Room under each picture for its label, where it came from, and its length. */
const WORDS_ROOM = 108;
const HEADER = 56;
const DOTS = 40;

export const NO_PLAYER = 'This build of Builda cannot play video yet, so here is the first frame of it. The next build plays it.';

export interface DemoGalleryProps {
  visible: boolean;
  entries: readonly GalleryEntry[];
  sources: DemoSources;
  /** The project's hue: the cells a still prints in through. */
  hue: HueName;
  /** The file it opens on; the first when absent or unknown. */
  startId?: string | null;
  /** The project's name, for VoiceOver. */
  title: string;
  onClose: () => void;
  onError?: () => void;
}

export function DemoGallery({ visible, entries, sources, hue, startId, title, onClose, onError }: DemoGalleryProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const start = Math.max(0, entries.findIndex((e) => e.id === startId));
  const [index, setIndex] = useState(start);
  const printed = useRef(new Set<string>());
  const [, bump] = useState(0);

  useEffect(() => {
    if (visible) setIndex(start);
  }, [visible, start]);

  const drag = useSharedValue(0);
  useEffect(() => {
    if (visible) drag.value = 0;
  }, [visible, drag]);
  const close = useCallback(() => onClose(), [onClose]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .failOffsetX([-16, 16])
        .onUpdate((e) => {
          drag.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          if (e.translationY > CLOSE_DRAG || e.velocityY > CLOSE_FLICK) {
            drag.value = withTiming(height, { duration: 220 }, (done) => {
              if (done) runOnJS(close)();
            });
            return;
          }
          drag.value = withSpring(0, SNAP);
        }),
    [drag, height, close],
  );
  const stage = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  const ground = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, drag.value / (height * 0.7)) }));

  const itemW = width - 48;
  const slideH = Math.max(200, height - insets.top - insets.bottom - HEADER - DOTS - 12);
  const onPrinted = useCallback((id: string) => {
    if (printed.current.has(id)) return;
    printed.current.add(id);
    bump((n) => n + 1);
  }, []);
  const current = entries[Math.min(index, entries.length - 1)];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: GROUND.bg }, ground]} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }, stage]}>
            <View style={styles.header}>
              <Text allowFontScaling={false} style={figure(26, GROUND.text)} accessibilityLabel={current ? `${title}, ${current.count}` : title}>
                {current?.count ?? ''}
              </Text>
              <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close the demo" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                  Close
                </Text>
              </Pressable>
            </View>
            {entries.length && visible ? (
              <Carousel
                key={entries.map((e) => e.id).join(',')}
                items={entries}
                width={width}
                height={slideH}
                itemWidth={itemW}
                initialIndex={start}
                onIndexChange={setIndex}
                keyOf={(e) => e.id}
                labelFor={(e) => e.a11y}
                accessibilityLabel={`${title}, the demo`}
                renderItem={(e, i, state) => (
                  <Slide
                    entry={e}
                    src={sources.file[e.id]}
                    poster={sources.poster[e.id]}
                    width={itemW}
                    height={slideH}
                    active={state.active && i === index}
                    printed={printed.current.has(e.id)}
                    onPrinted={onPrinted}
                    hue={hue}
                    reduce={reduce}
                    onError={onError}
                  />
                )}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A picture of `aspect` (width over height) fitted inside `w` by `h`. */
export function fitInside(aspect: number, w: number, h: number): { width: number; height: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return w / h > a ? { width: Math.round(h * a), height: Math.round(h) } : { width: Math.round(w), height: Math.round(w / a) };
}

function Slide({
  entry,
  src,
  poster,
  width,
  height,
  active,
  printed,
  onPrinted,
  hue,
  reduce,
  onError,
}: {
  entry: GalleryEntry;
  src: MediaSourceRef | undefined;
  poster: MediaSourceRef | undefined;
  width: number;
  height: number;
  active: boolean;
  printed: boolean;
  onPrinted: (id: string) => void;
  hue: HueName;
  reduce: boolean;
  onError?: () => void;
}) {
  const box = fitInside(entry.aspect, width, height - WORDS_ROOM);
  return (
    <View style={{ width, height, alignItems: 'center' }}>
      <View style={[styles.media, { width: box.width, height: box.height }]}>
        {entry.kind === 'video' ? (
          <GalleryVideo entry={entry} src={src} poster={poster} width={box.width} height={box.height} active={active} reduce={reduce} onError={onError} />
        ) : (
          <Print
            id={entry.id}
            src={src}
            width={box.width}
            height={box.height}
            fit="contain"
            arrive={printed ? undefined : active}
            hue={hue}
            wait={GROUND.card}
            grid={14}
            onArrived={() => onPrinted(entry.id)}
            onError={onError}
            accessibilityLabel={entry.a11y}
          />
        )}
      </View>
      <View style={[styles.words, { width: box.width }]}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={3} style={type.lead}>
          {entry.label.charAt(0).toUpperCase() + entry.label.slice(1)}
        </Text>
        {entry.duration ? (
          <Text maxFontSizeMultiplier={1.3} style={type.meta}>
            {entry.duration}
          </Text>
        ) : null}
        {entry.source ? (
          <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={type.dim}>
            {entry.source}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function GalleryVideo({
  entry,
  src,
  poster,
  width,
  height,
  active,
  reduce,
  onError,
}: {
  entry: GalleryEntry;
  src: MediaSourceRef | undefined;
  poster: MediaSourceRef | undefined;
  width: number;
  height: number;
  active: boolean;
  reduce: boolean;
  onError?: () => void;
}) {
  const mod = expoVideo();
  if (!mod || !src) {
    return (
      <View style={{ width, height }}>
        {poster ? <Image source={{ uri: poster.uri, headers: poster.headers, cacheKey: `demo-${entry.id}-poster` }} style={{ width, height }} contentFit="contain" transition={0} /> : null}
        {!mod ? (
          <View style={styles.noPlayer}>
            <Text maxFontSizeMultiplier={1.3} style={[type.dim, { color: GROUND.text }]}>
              {NO_PLAYER}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }
  const still = poster ? <Image source={{ uri: poster.uri, headers: poster.headers, cacheKey: `demo-${entry.id}-poster` }} style={{ width, height }} contentFit="contain" transition={0} /> : null;
  return <GalleryPlayer mod={mod} src={src} width={width} height={height} play={active && !reduce} active={active} poster={still} onError={onError} />;
}

function GalleryPlayer({
  mod,
  src,
  width,
  height,
  play,
  active,
  poster,
  onError,
}: {
  mod: ExpoVideo;
  src: MediaSourceRef;
  width: number;
  height: number;
  play: boolean;
  active: boolean;
  /** The still frame, over the player until its own first frame has drawn. */
  poster: React.ReactNode;
  onError?: () => void;
}) {
  const [drawn, setDrawn] = useState(false);
  const auth = src.headers?.Authorization ?? '';
  const source = useMemo(() => ({ uri: src.uri, headers: src.headers }), [src.uri, auth]); // eslint-disable-line react-hooks/exhaustive-deps
  const player = mod.useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = false;
  });
  useEffect(() => {
    if (play) player.play();
    else if (!active) player.pause();
  }, [play, active, player]);
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError?.();
    });
    return () => sub.remove();
  }, [player, onError]);
  return (
    <View style={{ width, height }}>
      <mod.VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls allowsFullscreen allowsPictureInPicture={false} onFirstFrameRender={() => setDrawn(true)} />
      {!drawn ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: GROUND.card }]} pointerEvents="none">
          {poster}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { height: HEADER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  media: { borderRadius: SHAPE.inner, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: GROUND.card },
  words: { marginTop: 14, gap: 3 },
  noPlayer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: GROUND.bg },
});
