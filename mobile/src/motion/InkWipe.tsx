/**
 * The trailer's own scene change, on the phone: a band of ink that rises through a frame, the
 * advected phase field of `fluid.ts wipePhases` read through `wipeCell` and printed through the
 * band's Bayer dither at the ink cell, the hue at its leading edge and the partner tone in its body.
 * The same function the trailer draws its wipe with, so a new version arriving on the ship kit
 * screen changes the way the film itself changes scenes.
 *
 * `run` changing starts one pass (`WIPE_MS`); `onCovered` fires once, when the band covers the most
 * of the frame (MEASURED in fluid.ts: 64% to 86% of the cells under solid ink halfway through), which
 * is when the caller swaps what is underneath. Transparent where there is no ink, so the frame shows
 * through. Under Reduce Motion there is no band: `onCovered` fires at once.
 */
import { AlphaType, Canvas, ColorType, FilterMode, Image as SkiaImage, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { bayer8 } from '../ui/dithering';
import { useReduceMotion } from '../ui/motion';
import { wipeCell, wipePhases } from './fluid';
import { INK_CELL } from './InkField';

/** One pass, rise to drain. The trailer's wipes run 0.8 to 1.1 s at pace 1. */
export const WIPE_MS = 950;
/** Frames the phase field is simulated for; the pass reads between them. */
const FRAMES = 28;
const RATE = 30;
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function InkWipe({ width, height, ink, deep, run, seed = 11, onCovered }: { width: number; height: number; ink: string; deep: string; run: string | number | null; seed?: number; onCovered?: () => void }) {
  const reduce = useReduceMotion();
  const [image, setImage] = useState<SkImage | null>(null);
  const covered = useRef(onCovered);
  covered.current = onCovered;
  const cols = Math.max(1, Math.ceil(width / INK_CELL));
  const rows = Math.max(1, Math.ceil(height / INK_CELL));

  useEffect(() => {
    if (run === null || width <= 0 || height <= 0) {
      setImage(null);
      return;
    }
    if (reduce) {
      covered.current?.();
      return;
    }
    // Upward, as the pool rises in the Projects tab's ink: y is down, so the sweep runs (0, -1).
    const w = wipePhases({ cols, rows, dir: [0, -1], frames: FRAMES, seed });
    const a = rgb(ink), b = rgb(deep);
    const bytes = new Uint8Array(cols * rows * 4);
    const t0 = Date.now();
    let fired = false;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / WIPE_MS);
      const phase = w.phaseAt(Math.round(p * FRAMES));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const c = wipeCell(w.read(phase, i, j), p);
          const o = (j * cols + i) * 4;
          const on = c.ink > bayer8(i, j);
          const col = c.depth > 0.6 ? b : a;
          bytes[o] = col[0];
          bytes[o + 1] = col[1];
          bytes[o + 2] = col[2];
          bytes[o + 3] = on ? 255 : 0;
        }
      }
      setImage(Skia.Image.MakeImage({ width: cols, height: rows, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(bytes), cols * 4));
      if (!fired && p >= 0.5) {
        fired = true;
        covered.current?.();
      }
      if (p >= 1) {
        clearInterval(id);
        setImage(null);
      }
    }, 1000 / RATE);
    // FOUND ON THE WEB BUILD: the caller's own timer can end the pass a tick before the last frame
    // on a busy thread, and a frame left standing was a sliver of ink stuck at the top. Whatever
    // ends the pass, nothing of it stays.
    return () => {
      clearInterval(id);
      setImage(null);
      if (!fired) covered.current?.();
    };
  }, [run, reduce, cols, rows, ink, deep, seed, width, height]);

  if (!image) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Canvas style={{ width, height }}>
        <SkiaImage image={image} x={0} y={0} width={cols * INK_CELL} height={rows * INK_CELL} fit="fill" sampling={NEAREST} />
      </Canvas>
    </View>
  );
}
