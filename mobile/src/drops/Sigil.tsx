/**
 * One drop's sigil, drawn. `sigil.ts` grows it; this draws it and gives it its one motion.
 *
 * THREE STATES, THREE MOTIONS, and each one is information rather than decoration:
 *
 *   growing   while the Mac is reading the link, cells appear centre outward in `cells()` order,
 *             on a loop. The sigil is literally being made, which is what is happening.
 *   still     once it is planned. A board of fifty drops that all breathe is a board nobody can
 *             read, and the mascot already owns the breath.
 *   running   while one of its moves is running, a single bright cell travels down the spine.
 *             One moving thing on the whole board, and it is the thing that is working.
 *
 * Drawn with react-native-svg rather than Skia: a sigil is at most forty rects, it appears in
 * rows and sheets as well as on the Skia board, and an SVG one composes with ordinary layout.
 * The BOARD draws its own sigils straight into its picture (`Board.tsx`) so a hundred of them
 * are one draw call; this component is for everywhere else.
 */
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

import { useReduceMotion } from '../ui/motion';
import { cells, grow, SIZE, spine, type SigilCell } from './sigil';

const ARect = Animated.createAnimatedComponent(Rect);

/** One full growth. Slow enough to read as forming, short enough to loop while you look. */
const GROW_MS = 1400;
/** One trip down the spine. */
const PULSE_MS = 1100;

export type SigilMotion = 'growing' | 'still' | 'running';

export interface SigilProps {
  /** The drop's link. The same link is always the same sigil, everywhere. */
  seed: string;
  /** Points across. The grid is 13 cells, so a multiple of 13 lands on whole pixels. */
  size: number;
  /** The kind's ink, and its dither partner. `null` ink means an unread drop: warm grey. */
  ink: string;
  partner: string;
  motion?: SigilMotion;
  style?: object;
}

export function Sigil({ seed, size, ink, partner, motion = 'still', style }: SigilProps) {
  const reduced = useReduceMotion();
  const grid = useMemo(() => grow(seed), [seed]);
  const list = useMemo(() => cells(grid), [grid]);
  const spineRows = useMemo(() => spine(grid), [grid]);
  const unit = size / SIZE;

  // One clock, 0 to 1, whatever the motion. `growing` reads it as a threshold over `at`;
  // `running` reads it as a position down the spine.
  const t = useSharedValue(motion === 'growing' ? 0 : 1);
  useEffect(() => {
    cancelAnimation(t);
    if (reduced || motion === 'still') {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, {
        duration: motion === 'growing' ? GROW_MS : PULSE_MS,
        easing: motion === 'growing' ? Easing.out(Easing.cubic) : Easing.linear,
      }),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [motion, reduced, t]);

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        {list.map((cell) => (
          <Cell
            key={`${cell.r}.${cell.c}`}
            cell={cell}
            unit={unit}
            ink={ink}
            partner={partner}
            motion={reduced ? 'still' : motion}
            clock={t}
            spineRows={spineRows}
          />
        ))}
      </Svg>
    </View>
  );
}

function Cell({
  cell,
  unit,
  ink,
  partner,
  motion,
  clock,
  spineRows,
}: {
  cell: SigilCell;
  unit: number;
  ink: string;
  partner: string;
  motion: SigilMotion;
  clock: Animated.SharedValue<number>;
  spineRows: number[];
}) {
  const mid = (SIZE - 1) / 2;
  const onSpine = cell.c === mid && spineRows.includes(cell.r);
  const spineAt = onSpine ? spineRows.indexOf(cell.r) / Math.max(1, spineRows.length - 1) : -1;
  const base = cell.tone === 1 ? ink : partner;

  const props = useAnimatedProps(() => {
    if (motion === 'growing') {
      // A cell is either there or not. Fading each one in would make the whole thing a haze;
      // pixels arrive.
      return { opacity: clock.value >= cell.at ? 1 : 0 };
    }
    if (motion === 'running' && spineAt >= 0) {
      // A narrow window travelling down the spine, so exactly one cell is lit at a time.
      const d = Math.abs(clock.value - spineAt);
      return { opacity: d < 0.14 ? 1 : 0.45 };
    }
    return { opacity: 1 };
  }, [motion, spineAt, cell.at]);

  const derivedFill = useDerivedValue(() => base, [base]);

  return (
    <ARect
      x={cell.c * unit}
      y={cell.r * unit}
      width={unit}
      height={unit}
      fill={base}
      animatedProps={props}
    />
  );
}

export { grow, SIZE } from './sigil';
