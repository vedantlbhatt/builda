/**
 * A project's demo video playing where it stands on the page: muted, looping, starting by itself
 * (the owner: "demo videos play in the back, start playing automatically"), and never for nobody.
 * It plays only while at least a quarter of it is on screen, the page is the focused one, the app
 * is in the foreground and no gallery is open over it; anything else pauses it where it is. Under
 * Reduce Motion it never plays: the poster, the still frame every published video carries, stands
 * in its place. A tap opens the gallery on it, with sound and the player's own controls.
 *
 * On a build without expo-video (`video.ts`) it is the poster, and nothing is said about it: the
 * picture is still the demo. The poster also covers the frame until the first frame of the video
 * has drawn, so the frame is never an empty black box while it loads.
 *
 * WHETHER IT IS ON SCREEN is measured on the UI thread (`measure`, the rule `drawClock.ts` uses),
 * one look every eighth frame, and only while it could play: no scroll value leaves the page's
 * reveal clock, and eight looks a second is nothing beside a playing video. The page's bar is
 * opaque, so a frame scrolled up under it counts as gone.
 */
import { HeaderHeightContext } from '@react-navigation/elements';
import { Image } from 'expo-image';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { measure, runOnJS, useAnimatedRef, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import type { MediaSourceRef } from '../data/api';
import { GROUND } from '../insights/palette';
import { useAppActive, useScreenFocused } from '../ui/bits/backgrounds';
import { useReduceMotion } from '../ui/motion';
import type { GalleryEntry } from './model';
import { expoVideo, type ExpoVideo } from './video';

/** One look at where the frame is, every this many frames. */
const LOOK_EVERY = 8;
/** How much of the frame must be on screen for it to play. */
const SHOWN = 0.25;

export interface LoopVideoProps {
  entry: GalleryEntry;
  src: MediaSourceRef | undefined;
  poster: MediaSourceRef | undefined;
  width: number;
  height: number;
  /** A gallery is open over the page: pause. */
  held: boolean;
  onOpen: () => void;
  onError?: () => void;
}

export function LoopVideo({ entry, src, poster, width, height, held, onOpen, onError }: LoopVideoProps) {
  const mod = expoVideo();
  const reduce = useReduceMotion();
  const focused = useScreenFocused();
  const active = useAppActive();
  const canPlay = mod !== null && !reduce && src !== undefined;

  const { height: screen } = useWindowDimensions();
  // The page's own bar is opaque: a frame scrolled up under it is off screen too.
  const top = useContext(HeaderHeightContext) ?? 0;
  const box = useAnimatedRef<View>();
  const tick = useSharedValue(0);
  const seen = useSharedValue(-1);
  const [onScreen, setOnScreen] = useState(false);
  const look = useFrameCallback(() => {
    tick.value = (tick.value + 1) % LOOK_EVERY;
    if (tick.value !== 0) return;
    const m = measure(box);
    if (!m || m.height <= 0) return;
    const shown = m.pageY + m.height * SHOWN < screen && m.pageY + m.height * (1 - SHOWN) > top ? 1 : 0;
    if (shown !== seen.value) {
      seen.value = shown;
      runOnJS(setOnScreen)(shown === 1);
    }
  }, false);
  const watching = canPlay && focused && active;
  useEffect(() => {
    look.setActive(watching);
    if (!watching) {
      seen.value = -1;
      setOnScreen(false);
    }
  }, [look, watching, seen]);

  const posterPicture = poster ? (
    <Image source={{ uri: poster.uri, headers: poster.headers, cacheKey: `demo-${entry.id}-poster` }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" transition={0} />
  ) : (
    <View style={{ width, height }} />
  );

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`The demo video, ${entry.duration ?? 'its length unknown'}: ${entry.label}. Plays it with sound.`}
    >
      <Animated.View ref={box} collapsable={false} style={{ width, height, overflow: 'hidden' }}>
        {canPlay && mod ? (
          <Playing mod={mod} src={src!} width={width} height={height} play={watching && onScreen && !held} poster={posterPicture} onError={onError} />
        ) : (
          posterPicture
        )}
      </Animated.View>
    </Pressable>
  );
}

function Playing({
  mod,
  src,
  width,
  height,
  play,
  poster,
  onError,
}: {
  mod: ExpoVideo;
  src: MediaSourceRef;
  width: number;
  height: number;
  play: boolean;
  poster: React.ReactNode;
  onError?: () => void;
}) {
  const auth = src.headers?.Authorization ?? '';
  const source = useMemo(() => ({ uri: src.uri, headers: src.headers }), [src.uri, auth]); // eslint-disable-line react-hooks/exhaustive-deps
  const player = mod.useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    // A muted picture playing by itself never stops the music someone is listening to.
    p.audioMixingMode = 'mixWithOthers';
  });
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (play) player.play();
    else player.pause();
  }, [play, player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError?.();
    });
    return () => sub.remove();
  }, [player, onError]);

  return (
    <View style={{ width, height }}>
      <mod.VideoView
        player={player}
        style={{ width, height }}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setDrawn(true)}
      />
      {/* The still frame until the video has drawn its own, on the ground so the player's own
          empty state (a crossed out play glyph) never shows while the poster is still loading. */}
      {!drawn ? (
        <View style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: GROUND.bg }} pointerEvents="none">
          {poster}
        </View>
      ) : null}
    </View>
  );
}
