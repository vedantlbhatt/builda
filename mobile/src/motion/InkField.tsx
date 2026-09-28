/**
 * Ink in a hue, moving like ink, in the app's pixels: the stage of a project that has nothing to
 * show yet, and anywhere else a surface should be alive without saying anything.
 *
 * The flow is `fluid.ts`, the same solver the trailer's wipes and plumes run: a small grid (a third
 * of the cell grid each way) stepped on the JS thread about 24 times a second. It is never drawn as
 * a gradient. Each cell reads the ink's density and prints through the band's own ordered dither
 * (`ui/dithering.bayer8`), at the band's 3 point cell, into a texture one pixel a cell that the
 * canvas scales up with nearest sampling (the `FieldSurface` texture path): the edge of the ink is
 * the app's dissolve, and deep ink is the hue's partner tone, the dither's middle tone.
 *
 * It starts as a pool across the foot with a wavy surface and a few drops above it, and the flow
 * folds them (marbling, not filling: an incompressible flow can only move ink around, so the field
 * never fills up; MEASURED the other way first, a pour from the foot, which filled the stage to one
 * flat colour within three seconds). A contrast curve maps its density to the dither, so thin ink is
 * ground and the body is solid, and the ink is carried with MacCormack advection (`fluid.ts
 * advectSharp`), which keeps it cleaner for the first second or so (MEASURED there). A finger stirs it: the
 * drag's own velocity pushed into the flow where it touches. Then it rests: after `REST_MS` without
 * a touch the solver stops and the last frame stays, so a still page costs nothing (the owner's rule
 * that idle loops rest after a few passes). It never runs while the page
 * is not focused, the app is in the background, `playing` is false, or Reduce Motion is on (then a
 * settled pool is drawn once, and fingers do nothing).
 */
import { AlphaType, Canvas, ColorType, FilterMode, Image as SkiaImage, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { bayer8 } from '../ui/dithering';
import { useAppActive, useScreenFocused } from '../ui/bits/backgrounds';
import { useReduceMotion } from '../ui/motion';
import { Fluid, rng, scalar, type Scalar } from './fluid';

/** One cell, in points: the band's (tokens.dither.cell). */
export const INK_CELL = 3;
/** Steps a second. The dither hides the rest; the JS thread has other work. */
const RATE = 24;
/** Stop after this long without a touch: the first stirring has settled in about five seconds. */
const REST_MS = 8000;
/** The pool's surface, as a share of the height from the top. */
const POOL = 0.64;
/** Density to dither: under the low end is ground, over the high end solid (a smoothstep between). */
const CURVE: readonly [number, number] = [0.2, 0.8];

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface InkFieldProps {
  width: number;
  height: number;
  /** The ink, and the deep ink (a hue's `ink` and `partner`). */
  ink: string;
  deep: string;
  /** The ground under it, drawn where there is no ink. */
  ground: string;
  /** Whether it may move at all (the row on screen, say). */
  playing: boolean;
  /** Its own stirring, so two fields never pour alike. */
  seed?: number;
  /**
   * Never rests while playing: a swirl travels across the pool, left to right, like a render's
   * playhead (`HEAD_MS` a pass). For a wait that has work happening behind it (the director's
   * "your Mac is cutting it"), so the ink moves exactly as long as the work does.
   */
  restless?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

interface Sim {
  fl: Fluid;
  dye: Scalar;
  cols: number;
  rows: number;
  t: number;
}

function makeSim(cols: number, rows: number, seed: number): Sim {
  const nx = Math.max(8, Math.round(cols / 2.5));
  const ny = Math.max(6, Math.round(rows / 2.5));
  const fl = new Fluid(nx, ny);
  const dye = scalar(fl);
  const r = rng(seed);
  const W = nx + 2;
  const drops = Array.from({ length: 3 }, () => [nx * (0.15 + 0.7 * r()), ny * (0.15 + 0.35 * r()), Math.min(nx, ny) * (0.08 + 0.08 * r())] as const);
  const phase = r() * 6;
  for (let j = 0; j <= ny + 1; j++) {
    for (let i = 0; i <= nx + 1; i++) {
      let d = j / ny > POOL + 0.04 * Math.sin((i / nx) * 9 + phase) ? 1 : 0;
      for (const [cx, cy, rr] of drops) if ((i - cx) ** 2 + (j - cy) ** 2 < rr * rr) d = 1;
      dye.field[i + W * j] = d;
    }
  }
  for (let k = 0; k < 5; k++) fl.swirl(1 + r() * nx, 1 + r() * ny, Math.min(nx, ny) * (0.18 + 0.14 * r()), (k % 2 ? -1 : 1) * (1 + r()));
  return { fl, dye, cols, rows, t: 0 };
}

/** One step of the flow, the ink carried sharp. */
function step(sim: Sim, dtMs: number): void {
  sim.fl.step(1, { vorticity: 2, damping: 0.99, carry: [sim.dye], sharp: true });
  sim.t += dtMs;
}

/** The cell texture: ground, ink at the edge, deep ink in the body. */
function paint(sim: Sim, bytes: Uint8Array, ink: [number, number, number], deep: [number, number, number], ground: [number, number, number]): void {
  const { fl, dye, cols, rows } = sim;
  const sx = fl.nx / cols, sy = fl.ny / rows;
  const [lo, hi] = CURVE;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = Math.max(0, Math.min(1, (fl.sample(dye.field, 0.5 + (i + 0.5) * sx, 0.5 + (j + 0.5) * sy) - lo) / (hi - lo)));
      const d = u * u * (3 - 2 * u);
      const c = d > bayer8(i, j) ? (d > 0.9 ? deep : ink) : ground;
      const o = (j * cols + i) * 4;
      bytes[o] = c[0];
      bytes[o + 1] = c[1];
      bytes[o + 2] = c[2];
      bytes[o + 3] = 255;
    }
  }
}

function toImage(bytes: Uint8Array, cols: number, rows: number): SkImage | null {
  return Skia.Image.MakeImage({ width: cols, height: rows, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(bytes), cols * 4);
}

/** One pass of a restless field's travelling swirl, and how often it pushes. */
const HEAD_MS = 2600;
const PUSH_MS = 420;

export function InkField({ width, height, ink, deep, ground, playing, seed = 7, restless = false, style, children }: InkFieldProps) {
  const reduce = useReduceMotion();
  const focused = useScreenFocused();
  const active = useAppActive();
  const cols = Math.max(1, Math.ceil(width / INK_CELL));
  const rows = Math.max(1, Math.ceil(height / INK_CELL));
  const colors = useMemo(() => ({ ink: rgb(ink), deep: rgb(deep), ground: rgb(ground) }), [ink, deep, ground]);
  const sim = useRef<Sim | null>(null);
  const bytes = useRef<Uint8Array>(new Uint8Array(0));
  const [image, setImage] = useState<SkImage | null>(null);
  const lastTouch = useRef(0);
  const [awake, setAwake] = useState(0);

  // A new size is a new pool. Reduce Motion: the pour is run to its settled state, once, and drawn.
  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    sim.current = makeSim(cols, rows, seed);
    bytes.current = new Uint8Array(cols * rows * 4);
    lastTouch.current = Date.now();
    if (reduce) {
      for (let k = 0; k < Math.round(REST_MS / 2 / (1000 / RATE)); k++) step(sim.current, 1000 / RATE);
    }
    paint(sim.current, bytes.current, colors.ink, colors.deep, colors.ground);
    setImage(toImage(bytes.current, cols, rows));
  }, [cols, rows, seed, reduce, colors, width, height]);

  const running = playing && focused && active && !reduce && image !== null;
  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    let pushed = 0;
    let turn = 1;
    const id = setInterval(() => {
      const s = sim.current;
      if (!s) return;
      const now = Date.now();
      if (restless && now - pushed > PUSH_MS) {
        // The playhead: where it is on its pass, a swirl there, turning the other way each push.
        const head = (now % HEAD_MS) / HEAD_MS;
        s.fl.swirl(1 + head * (s.fl.nx - 1), s.fl.ny * 0.62, Math.max(2, Math.min(s.fl.nx, s.fl.ny) * 0.45), turn * 1.6);
        turn = -turn;
        pushed = now;
      } else if (!restless && now - lastTouch.current > REST_MS) {
        clearInterval(id);
        return;
      }
      step(s, now - last);
      last = now;
      paint(s, bytes.current, colors.ink, colors.deep, colors.ground);
      setImage(toImage(bytes.current, cols, rows));
    }, 1000 / RATE);
    return () => clearInterval(id);
  }, [running, cols, rows, colors, awake, restless]);

  // A finger stirs: its drag since the last move, pushed into the flow under it, with a little ink.
  const prev = useRef<{ x: number; y: number } | null>(null);
  const stir = useCallback(
    (e: GestureResponderEvent) => {
      const s = sim.current;
      if (!s || reduce) return;
      const { locationX: x, locationY: y } = e.nativeEvent;
      const p = prev.current;
      prev.current = { x, y };
      if (!p) return;
      const fl = s.fl;
      const gi = Math.round((x / width) * fl.nx), gj = Math.round((y / height) * fl.ny);
      const W = fl.nx + 2;
      const vx = ((x - p.x) / width) * fl.nx * 0.9, vy = ((y - p.y) / height) * fl.ny * 0.9;
      for (let j = gj - 2; j <= gj + 2; j++) {
        for (let i = gi - 2; i <= gi + 2; i++) {
          if (i < 1 || j < 1 || i > fl.nx || j > fl.ny) continue;
          const k = i + W * j;
          fl.u[k] = fl.u[k]! + vx;
          fl.v[k] = fl.v[k]! + vy;
        }
      }
      if (Date.now() - lastTouch.current > REST_MS) setAwake((n) => n + 1);
      lastTouch.current = Date.now();
    },
    [width, height, reduce],
  );

  return (
    <View
      style={[{ width, height, backgroundColor: ground, overflow: 'hidden' }, style]}
      onStartShouldSetResponder={() => !reduce}
      onMoveShouldSetResponder={() => !reduce}
      onResponderGrant={(e) => {
        prev.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      }}
      onResponderMove={stir}
      onResponderRelease={() => {
        prev.current = null;
      }}
    >
      {image ? (
        <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
          <SkiaImage image={image} x={0} y={0} width={cols * INK_CELL} height={rows * INK_CELL} fit="fill" sampling={NEAREST} />
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
