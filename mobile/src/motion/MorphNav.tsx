/**
 * The thing you touched grows into the page it opens.
 *
 * The island's rule applied to navigation (docs/motion.md): a tile or a row does not slide a new
 * screen in from the side, it BECOMES the screen. A window the tile's size and colour grows to the
 * whole phone on the island spring; when it has covered the screen the route is pushed with no
 * animation of its own, underneath it; then the window fades and the page is simply there. Back
 * is the platform's own swipe and slide, because a page you are leaving has no rectangle to
 * shrink into that is still on screen once you scroll.
 *
 * `morphOpen(ref, go, look, route)` measures `ref`, shows the window in the root overlay layer
 * (`ui/overlay.tsx`) and calls `go` at the moment it covers the screen. Under Reduce Motion, or
 * when the view cannot be measured, it just calls `go`.
 *
 * ON A DESKTOP a push opens in a pane beside the list it came from, not over the whole window, so
 * the window grows into that pane (`desktop/morphTarget`, which is null on a phone: there the
 * target is the whole screen, exactly as before).
 */
import { Image } from 'expo-image';
import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, type View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { morphTarget } from '../desktop/morphTarget';
import type { PaneRect } from '../desktop/rules';
import { overlay } from '../ui/overlay';
import { SPRING } from './springs';

export interface MorphLook {
  /** The tile's own fill, so the first frame of the window is the tile. */
  color: string;
  radius: number;
  /** The page's ground, which the window turns into as it grows. */
  ground: string;
  /**
   * A picture the thing you touched showed (a drop's poster). It stays in the window as it grows
   * instead of turning into the ground, because the page it opens starts with the same picture.
   */
  image?: string | null;
}

/** Where the window has covered enough of the screen to push the page under it. */
const COVER_AT = 0.86;

/**
 * Reduce Motion, kept current rather than asked on every tap: asking is a round trip to native,
 * and a tap that waits for it starts its morph a frame or two late, which reads as lag.
 */
let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
  reduceMotion = v;
});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reduceMotion = v;
});

/** `route` is the path `go` opens, so a desktop knows which pane the page will be drawn in. */
export function morphOpen(node: View | null, go: () => void, look: MorphLook, route?: string): void {
  if (!node || reduceMotion) {
    go();
    return;
  }
  const target = morphTarget(route);
  node.measureInWindow((x, y, w, h) => {
    if (!w || !h) {
      go();
      return;
    }
    overlay.show((hide) => <Window origin={{ x, y, w, h }} target={target} look={look} onCovered={go} onDone={hide} />);
  });
}

function Window({
  origin,
  target,
  look,
  onCovered,
  onDone,
}: {
  origin: { x: number; y: number; w: number; h: number };
  /** Where it lands; null is the whole screen. */
  target: PaneRect | null;
  look: MorphLook;
  onCovered: () => void;
  onDone: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const T = target ?? { x: 0, y: 0, w: W, h: H };
  const p = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    let pushed = false;
    const push = () => {
      if (pushed) return;
      pushed = true;
      onCovered();
      // The page mounts under the window; give it a frame or two, then let the window go.
      fade.value = withDelay(90, withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) runOnJS(onDone)();
      }));
    };
    p.value = withSpring(1, SPRING.island, () => runOnJS(push)());
    // The spring passes COVER_AT well before it settles; push then, not at the end of the bounce.
    const t = setTimeout(push, 230);
    return () => clearTimeout(t);
  }, [p, fade, onCovered, onDone]);

  const style = useAnimatedStyle(() => {
    const t = p.value;
    return {
      left: origin.x + (T.x - origin.x) * t,
      top: origin.y + (T.y - origin.y) * t,
      width: origin.w + (T.w - origin.w) * t,
      height: origin.h + (T.h - origin.h) * t,
      borderRadius: interpolate(t, [0, 1], [look.radius, 0], Extrapolation.CLAMP),
      opacity: fade.value,
    };
  });
  // The tile's colour turns into the page's ground as it grows, so the page arrives on its own
  // ground rather than on a stretched tile.
  const tint = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.2, COVER_AT], [0, 1], Extrapolation.CLAMP) }));

  return (
    <Animated.View pointerEvents="none" style={[styles.window, { backgroundColor: look.color }, style]}>
      {look.image ? (
        <Image source={{ uri: look.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: look.ground }, tint]} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', overflow: 'hidden', borderCurve: 'continuous' },
});
