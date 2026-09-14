import { Canvas, DashPathEffect, Group, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { COUNT_UP_MS, T, timing } from './motion';
import { useColors } from './scheme';
import { dottedTrack, ringStroke } from './shape';

export { dottedTrack, ringStroke } from './shape';

export interface RingProps {
  /**
   * Elapsed over typical, 0..1; past 1 the ring stays full (the caption says "running
   * longer than usual"). `null` is no ETA yet: a dotted track and no arc, never a fake
   * number and never a spinner.
   */
  progress: number | null;
  /** Points. 44 on the Lock Screen layout, 24 minimal. Default 44. */
  size?: number;
  /** Stroke in points. Default scales 5pt at 44. */
  stroke?: number;
  /** Centred inside: a count, a creature. */
  children?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The progress ring (Apple Fitness geometry): amber arc on a `border` track, round caps,
 * starting at 12 o'clock and running clockwise. Progress glides, never steps: the first
 * reveal draws over 800ms on `EASE`, later updates over 300ms. Reduce Motion jumps.
 */
export function Ring({ progress, size = 44, stroke, children, accessibilityLabel, style }: RingProps) {
  const c = useColors();
  const sw = stroke ?? ringStroke(size);
  const r = (size - sw) / 2;
  const target = progress === null ? 0 : Math.min(1, Math.max(0, progress));

  const circle = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(size / 2, size / 2, r);
    return p;
  }, [size, r]);

  const end = useSharedValue(0);
  const revealed = useRef(false);
  useEffect(() => {
    end.value = withTiming(target, timing(revealed.current ? T.enter : COUNT_UP_MS));
    revealed.current = true;
  }, [end, target]);

  const dots = dottedTrack(size, sw);
  const percent = Math.round(target * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? (progress === null ? 'no ETA yet' : undefined)}
      accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: percent }}
      style={[{ width: size, height: size }, style]}
    >
      <Canvas style={{ width: size, height: size }}>
        <Group transform={[{ rotate: -Math.PI / 2 }]} origin={vec(size / 2, size / 2)}>
          {progress === null ? (
            <Path path={circle} style="stroke" strokeWidth={sw} strokeCap="round" color={c.border}>
              <DashPathEffect intervals={[0.001, dots.interval - 0.001]} />
            </Path>
          ) : (
            <>
              <Path path={circle} style="stroke" strokeWidth={sw} color={c.border} />
              <Path path={circle} style="stroke" strokeWidth={sw} strokeCap="round" color={c.accent} start={0} end={end} />
            </>
          )}
        </Group>
      </Canvas>
      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
