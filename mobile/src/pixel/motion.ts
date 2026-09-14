/**
 * Motion for the pixel mascot: the timing tables, and the pure schedulers that decide
 * WHAT is on screen at a given clock time. Nothing here imports React Native, so every
 * number and every rule runs under `bun test`. `PixelSprite.tsx` is the only place that
 * turns these into `Animated` values, and it contains no timing constants of its own.
 *
 * The register is Claude's own product motion: slow, eased, restrained. Idle is the pixel
 * family's loop (rest, a breath drawn in four cells, rest, one gesture) with the rest pose
 * on screen most of the time; frames cross-fade rather than cut; a state change settles in
 * with a short ease-out rather than popping. Nothing bounces, and nothing drifts, breathes
 * on a scale or tilts in a loop: a whole-sprite transform that runs forever puts a pixel
 * glyph between device pixels for most of its life. The one-off entrance keeps its settle.
 * Every duration and easing lives in `MOTION` so the table in the review is the table in
 * the code.
 */

import { ANIMAL_FRAMES, type Animal } from './animals';
import { BODY_GLYPHS, EMPTY, EYES, GRID, eyesOpen, type Frame } from './frames';
import { SPRITES, type SpriteState } from './sprites';

/**
 * Named easings, resolved to `Easing` functions by the renderer. Kept as names so the
 * tables stay serialisable and testable without React Native.
 *
 *   linear   a cross-fade between two crisp frames; anything curved reads as a stutter
 *   inOut    the wave's wrist, the thinking dots — symmetric, no attack
 *   out      arrivals: the settle, the hammer rebound, a spark dying
 *   outBack  the celebration rise only — ease-out with a small overshoot (see `backOvershoot`)
 */
export type EasingName = 'linear' | 'inOut' | 'out' | 'outBack';

export interface Fade {
  ms: number;
  easing: EasingName;
}

export const MOTION = {
  /**
   * Idle, and the blink state that folds into it: `SPRITES.idle` is `[REST, BREATH, REST,
   * TIP]`, and each frame is held for `holds[i]` beats. The rest pose is on screen for two
   * thirds of the loop; the breath and the antenna tip are a second each. The same shape as
   * every creature's loop (`ANIMAL_MOTION`), so Bit and the pack idle in one register.
   */
  idle: { beatMs: 500, holds: [4, 2, 4, 2] },
  /** Two-frame blink: eyes shut for `closedMs`, on a uniformly random gap in [min, max]. */
  blink: { minGapMs: 3000, maxGapMs: 6000, closedMs: 120 },
  /** Frame changes within a state: layer-alpha cross-fade. 60–90 ms; 75 is the middle. */
  crossfade: { ms: 75, easing: 'linear' } as Fade,
  /** State changes: scale fromScale → 1 with opacity 0 → 1, ease-out. */
  settle: { ms: 220, fromScale: 0.94, easing: 'out' as EasingName },
  building: {
    beatMs: 380,
    /** Added to the strike beat: the hammer rests on the anvil before it lifts. */
    strikeHoldMs: 40,
    /** Index into the building frames of the strike (hammer down, sparks). */
    strikeBeat: 2,
    /** Whole-body translate on impact, in sprite pixels. Squash without stretch. */
    impactCells: 1,
    impactDownMs: 40,
    impactUpMs: 160,
    sparkFadeMs: 240,
  },
  thinking: {
    /** Each dot: 0 → 1, then 1 → low → 1 forever, ease-in-out. */
    dotLoopMs: 1200,
    dotStaggerMs: 150,
    dotLow: 0.3,
  },
  sleeping: {
    /** Each z glyph rises `riseCells` while fading, then restarts. */
    zRiseMs: 1800,
    zStaggerMs: 600,
    zRiseCells: 4,
  },
  celebrating: {
    beatMs: 320,
    /** The arms-up rise replaces the generic settle: longer, with a small overshoot. */
    riseMs: 600,
    /** `Easing.back(s)`. 1.0 overshoots by 3.7 %; the limit is 4 % (`backOvershoot`). */
    backS: 1.0,
    maxOvershoot: 0.04,
    confettiMs: 1400,
    confettiStaggerMs: 110,
    confettiFallCells: 3,
    /** Callers switch to idle after this long; documented here, enforced at the call site. */
    idleAfterMs: 3000,
  },
  waving: {
    beatMs: 260,
    wavesPerBurst: 2,
    restMs: 2000,
    /** The wrist sweep is the cross-fade, so it is longer and eased. */
    crossfade: { ms: 130, easing: 'inOut' } as Fade,
  },
  tempo: { min: 0.5, max: 2 },
} as const;

/** A hard cut. Used for the blink only — a 120 ms closed frame with fades on both sides reads as a smear. */
export const CUT: Fade = { ms: 0, easing: 'linear' };

// ─── tempo ───────────────────────────────────────────────────────────────────────────

/** `tempo` clamped to [0.5, 2]; anything unusable (undefined, NaN, 0) is 1. */
export function clampTempo(tempo: number | undefined): number {
  if (typeof tempo !== 'number' || !Number.isFinite(tempo) || tempo <= 0) return 1;
  return Math.min(MOTION.tempo.max, Math.max(MOTION.tempo.min, tempo));
}

// ─── beats ───────────────────────────────────────────────────────────────────────────

/** Hold frame `frame` (an index into the state's BASE frames, see `decompose`) for `ms`. */
export interface Beat {
  frame: number;
  ms: number;
}

/**
 * The looping frame timeline of a state at a given tempo. A one-beat timeline is HELD —
 * the state's motion is all overlays and transforms — and its `ms` is unused.
 *
 *   idle, blink  rest · breath · rest · tip, held 4 · 2 · 4 · 2 beats of 500 ms
 *   building     0 · 1 · 2 (+ hold) · 3 at 380 ms
 *   celebrating  0 · 1 · 2 at 320 ms
 *   waving       up · out, twice, then rest on up for 2 s
 *   everything else is held
 *
 * Tempo shortens every beat. Blink gaps are NOT tempo-scaled: they are life, not work.
 */
export function timelineFor(state: SpriteState, tempo = 1): Beat[] {
  const rate = clampTempo(tempo);
  const t = (ms: number) => Math.round(ms / rate);
  switch (state) {
    case 'idle':
    case 'blink': {
      const { beatMs, holds } = MOTION.idle;
      return decompose(state).base.map((_, i) => ({ frame: i, ms: t(beatMs * (holds[i] ?? 1)) }));
    }
    case 'building': {
      const b = MOTION.building;
      return decompose(state).base.map((_, i) => ({
        frame: i,
        ms: t(b.beatMs + (i === b.strikeBeat ? b.strikeHoldMs : 0)),
      }));
    }
    case 'celebrating':
      return decompose(state).base.map((_, i) => ({ frame: i, ms: t(MOTION.celebrating.beatMs) }));
    case 'waving': {
      const w = MOTION.waving;
      const beats: Beat[] = [];
      for (let i = 0; i < w.wavesPerBurst; i++) {
        beats.push({ frame: 0, ms: t(w.beatMs) }, { frame: 1, ms: t(w.beatMs) });
      }
      beats.push({ frame: 0, ms: t(w.restMs) });
      return beats;
    }
    default:
      return [{ frame: 0, ms: 0 }];
  }
}

export function timelineLengthMs(timeline: Beat[]): number {
  return timeline.length < 2 ? 0 : timeline.reduce((n, b) => n + b.ms, 0);
}

/** The beat playing at `tMs` into a looping timeline, and how far into it we are. */
export function beatAt(timeline: Beat[], tMs: number): { index: number; frame: number; elapsedMs: number } {
  if (timeline.length < 2) return { index: 0, frame: timeline[0]?.frame ?? 0, elapsedMs: Math.max(0, tMs) };
  const total = timelineLengthMs(timeline);
  let t = ((tMs % total) + total) % total;
  for (let i = 0; i < timeline.length; i++) {
    const b = timeline[i]!;
    if (t < b.ms) return { index: i, frame: b.frame, elapsedMs: t };
    t -= b.ms;
  }
  return { index: 0, frame: timeline[0]!.frame, elapsedMs: 0 };
}

/** The cross-fade for a frame change within `state`. Waving sweeps; everything else is 75 ms linear. */
export function crossfadeFor(state: SpriteState): Fade {
  return state === 'waving' ? MOTION.waving.crossfade : MOTION.crossfade;
}

/** The entrance for a state. Celebrating rises with a small overshoot; everything else settles. */
export function settleFor(state: SpriteState): { ms: number; fromScale: number; easing: EasingName } {
  if (state === 'celebrating') {
    return { ms: MOTION.celebrating.riseMs, fromScale: MOTION.settle.fromScale, easing: 'outBack' };
  }
  return MOTION.settle;
}

/**
 * Peak overshoot of `Easing.out(Easing.back(s))` above 1, as a fraction. The curve is
 * 1 + u²((s+1)u + s) for u = t−1; its maximum is at u = −2s / 3(s+1), which gives
 * 4s³ / 27(s+1)². The default s of 1.70158 overshoots 10 %, which is cartoon; 1.0 is 3.7 %.
 */
export function backOvershoot(s: number): number {
  return (4 * s ** 3) / (27 * (s + 1) ** 2);
}

// ─── cadences ────────────────────────────────────────────────────────────────────────

type Rng = () => number;

function uniform(min: number, max: number, rng: Rng): number {
  return Math.round(min + rng() * (max - min));
}

/** Gap before the next blink. Uniform in [3, 6] s — never a metronome. */
export function blinkGapMs(rng: Rng = Math.random): number {
  return uniform(MOTION.blink.minGapMs, MOTION.blink.maxGapMs, rng);
}

/** `[0, step, 2·step, …]` for `n` items. */
export function staggered(n: number, stepMs: number): number[] {
  return Array.from({ length: n }, (_, i) => i * stepMs);
}

/** Which states blink: open eyes, and not already busy with their own face. */
export function blinks(state: SpriteState): boolean {
  return state !== 'sleeping' && state !== 'celebrating';
}

// ─── cross-fade layers ───────────────────────────────────────────────────────────────

/**
 * Two stacked frame layers. A frame change puts the new frame on the BACK layer and
 * flips `front`, so the renderer fades the new front in and the old front out; each
 * layer stays crisp because only its alpha moves. Generic over `T` so the tests can use
 * indices and the renderer can use `Frame` objects (compared by identity — derived frames
 * must be memoised or every tick looks like a change).
 */
export interface Layers<T> {
  frames: [T, T];
  front: 0 | 1;
  fade: Fade;
  /** Clock time the current fade began. */
  sinceMs: number;
}

export function initLayers<T>(frame: T, nowMs = 0): Layers<T> {
  return { frames: [frame, frame], front: 0, fade: CUT, sinceMs: nowMs };
}

/** Returns the same object when `next` is already in front, so callers can `===` for "changed". */
export function stepLayers<T>(layers: Layers<T>, next: T, fade: Fade, nowMs: number): Layers<T> {
  if (layers.frames[layers.front] === next) return layers;
  const back: 0 | 1 = layers.front === 0 ? 1 : 0;
  const frames: [T, T] = [layers.frames[0], layers.frames[1]];
  frames[back] = next;
  return { frames, front: back, fade, sinceMs: nowMs };
}

/**
 * Layer opacities at `nowMs`, linear in time — the renderer applies the easing curve;
 * this is the reference the scheduler tests check against. `[a, b]` in layer order.
 */
export function layerOpacities<T>(layers: Layers<T>, nowMs: number): [number, number] {
  const p = layers.fade.ms <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - layers.sinceMs) / layers.fade.ms));
  return layers.front === 0 ? [p, 1 - p] : [1 - p, p];
}

export interface LayerSample<T> {
  tMs: number;
  layers: Layers<T>;
  opacities: [number, number];
}

/**
 * Drive a timeline against a clock: at each sample time, the beat's frame is applied
 * with `fade`, and the layer state and opacities are recorded. What the renderer does,
 * minus the renderer.
 */
export function runCrossfade<T>(
  timeline: Beat[],
  frames: T[],
  clockMs: number[],
  fade: Fade
): LayerSample<T>[] {
  let layers = initLayers(frames[timeline[0]?.frame ?? 0]!, clockMs[0] ?? 0);
  return clockMs.map((tMs) => {
    const beat = beatAt(timeline, tMs);
    layers = stepLayers(layers, frames[beat.frame]!, fade, tMs);
    return { tMs, layers, opacities: layerOpacities(layers, tMs) };
  });
}

// ─── what each layer draws ───────────────────────────────────────────────────────────

export interface Split {
  /** Pixels both frames draw identically. Always at full opacity. */
  shared: Frame;
  /** Pixels only the outgoing frame draws (or draws differently). Fades out. */
  outgoing: Frame;
  /** Pixels only the incoming frame draws (or draws differently). Fades in. */
  incoming: Frame;
}

const splitCache = new WeakMap<Frame, WeakMap<Frame, Split>>();

/**
 * A dissolve between two WHOLE frames dips: at the midpoint both layers are at 0.5, and a
 * pixel they both draw composites to 1 − 0.5·0.5 = 0.75, so the entire body darkens on
 * every frame change. MEASURED on the web run: in every mid-fade capture the body was
 * visibly dimmer than its neighbours. So a layer never holds a whole frame — the pixels
 * the two frames agree on are drawn once, opaque, and only the pixels that differ
 * cross-fade: the two moving arm pixels of a wave, the hammer, never the face.
 *
 * `shared ⊎ outgoing = from` and `shared ⊎ incoming = to`, exactly; memoised per pair.
 */
export function splitFrames(from: Frame, to: Frame): Split {
  let inner = splitCache.get(from);
  if (!inner) {
    inner = new WeakMap();
    splitCache.set(from, inner);
  }
  const hit = inner.get(to);
  if (hit) return hit;
  const shared: string[][] = [];
  const outgoing: string[][] = [];
  const incoming: string[][] = [];
  for (let y = 0; y < GRID; y++) {
    const s: string[] = [];
    const o: string[] = [];
    const i: string[] = [];
    for (let x = 0; x < GRID; x++) {
      const a = from[y]?.[x] ?? EMPTY;
      const b = to[y]?.[x] ?? EMPTY;
      if (a === b) {
        s.push(a);
        o.push(EMPTY);
        i.push(EMPTY);
      } else {
        s.push(EMPTY);
        o.push(a);
        i.push(b);
      }
    }
    shared.push(s);
    outgoing.push(o);
    incoming.push(i);
  }
  const split: Split = {
    shared: shared.map((r) => r.join('')),
    outgoing: outgoing.map((r) => r.join('')),
    incoming: incoming.map((r) => r.join('')),
  };
  inner.set(to, split);
  return split;
}

/**
 * What the renderer's three layers draw for a layer state: the shared pixels, then layer
 * A and layer B in layer order. The FRONT layer (fading in) carries the incoming
 * difference and the back layer (fading out) the outgoing one — so on the next step, when
 * the roles flip, each layer's new content lands on an opacity that is already its
 * correct starting value and nothing has to be reset before a paint.
 */
export function layerFrames(layers: Layers<Frame>): { shared: Frame; a: Frame; b: Frame } {
  const to = layers.frames[layers.front];
  const from = layers.frames[layers.front === 0 ? 1 : 0];
  const s = splitFrames(from, to);
  return layers.front === 0
    ? { shared: s.shared, a: s.incoming, b: s.outgoing }
    : { shared: s.shared, a: s.outgoing, b: s.incoming };
}

// ─── frame surgery ───────────────────────────────────────────────────────────────────

export interface Pixel {
  x: number;
  y: number;
  ch: string;
}

type Pred = (x: number, y: number, ch: string, frame: Frame) => boolean;

/** Every non-transparent pixel matching `pred`, row-major. */
export function pixelsOf(frame: Frame, pred: Pred): Pixel[] {
  const out: Pixel[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch !== EMPTY && pred(x, y, ch, frame)) out.push({ x, y, ch });
    }
  });
  return out;
}

/** `frame` with `pixels` made transparent. Returns the SAME object when nothing changes. */
export function without(frame: Frame, pixels: Pixel[]): Frame {
  if (pixels.length === 0) return frame;
  const rows = frame.map((r) => r.split(''));
  for (const p of pixels) rows[p.y]![p.x] = EMPTY;
  return rows.map((r) => r.join(''));
}

/** A frame containing only `pixels`, optionally re-glyphed. */
export function only(pixels: Pixel[], ch?: string): Frame {
  const rows = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => EMPTY));
  for (const p of pixels) rows[p.y]![p.x] = ch ?? p.ch;
  return rows.map((r) => r.join(''));
}

/**
 * The frame blinking: both eye holes (`EYES`) filled with the body. The same four cells in
 * Bit and in every creature, so one function blinks all nine. A frame whose eyes are not
 * both open (asleep, already shut) is returned unchanged, by identity.
 */
export function closeEyes(frame: Frame): Frame {
  if (!eyesOpen(frame)) return frame;
  const rows = frame.map((r) => r.split(''));
  for (const [x, y] of EYES) rows[y]![x] = 'b';
  return rows.map((r) => r.join(''));
}

// ─── decomposition: base frames + animated overlays ──────────────────────────────────

export type OverlayKind = 'dot' | 'z' | 'spark' | 'confetti';

export interface Overlay {
  kind: OverlayKind;
  /** Only this overlay's pixels; everything else transparent. */
  frame: Frame;
  /** Position in its group, for the stagger. */
  index: number;
  /** Sparks only: the beat (base-frame index) that fires them. */
  beat?: number;
}

export interface Decomposed {
  /** What the cross-fade layers show. Consecutive duplicates collapsed. */
  base: Frame[];
  overlays: Overlay[];
}

const decomposed = new Map<SpriteState, Decomposed>();

/**
 * Split a state's drawn frames into the frames the layers cross-fade between and the
 * pixels that get their own continuous motion — thinking dots, sleeping z's, sparks and
 * confetti. The drawn frames in `sprites.ts` are untouched (they are the still frames and
 * the icons); this is a view of them. Memoised, so frame identity is stable across renders.
 */
export function decompose(state: SpriteState): Decomposed {
  // `blink` folded into idle: idle blinks on its own now, so both names share one entry.
  const key: SpriteState = state === 'blink' ? 'idle' : state;
  const hit = decomposed.get(key);
  if (hit) return hit;
  const d = build(key);
  decomposed.set(key, d);
  return d;
}

function build(state: SpriteState): Decomposed {
  const frames = SPRITES[state];
  switch (state) {
    case 'thinking': {
      // The three bubble dots, top row, right of the antenna: lit `w` and dim `z` alike.
      const dots = pixelsOf(frames[0]!, (x, y, ch) => y === 1 && x >= 11 && (ch === 'w' || ch === 'z'));
      const isDot = (x: number, y: number) => dots.some((p) => p.x === x && p.y === y);
      return {
        base: dedupe(frames.map((f) => without(f, pixelsOf(f, (x, y) => isDot(x, y))))),
        overlays: dots.map((p, index) => ({ kind: 'dot' as const, frame: only([p], 'w'), index })),
      };
    }
    case 'sleeping': {
      // Each z glyph is one connected component of the fullest frame, lowest first.
      const last = frames[frames.length - 1]!;
      const groups = components(pixelsOf(last, (_x, _y, ch) => ch === 'z')).sort(
        (a, b) => Math.max(...b.map((p) => p.y)) - Math.max(...a.map((p) => p.y))
      );
      return {
        base: dedupe(frames.map((f) => without(f, pixelsOf(f, (_x, _y, ch) => ch === 'z')))),
        overlays: groups.map((g, index) => ({ kind: 'z' as const, frame: only(g), index })),
      };
    }
    case 'building': {
      // Every `w` is a spark: Bit has no eye highlight any more.
      const sparksOf = (f: Frame) => pixelsOf(f, (_x, _y, ch) => ch === 'w');
      const overlays: Overlay[] = [];
      frames.forEach((f, beat) => {
        const s = sparksOf(f);
        if (s.length) overlays.push({ kind: 'spark', frame: only(s), index: overlays.length, beat });
      });
      return { base: frames.map((f) => without(f, sparksOf(f))), overlays };
    }
    case 'celebrating': {
      // Every `h`, `w` and `z` is confetti: the antenna is body now, and there is no glint.
      const confettiOf = (f: Frame) => pixelsOf(f, (_x, _y, ch) => ch === 'h' || ch === 'w' || ch === 'z');
      return {
        base: frames.map((f) => without(f, confettiOf(f))),
        overlays: confettiOf(frames[0]!).map((p, index) => ({ kind: 'confetti' as const, frame: only([p]), index })),
      };
    }
    default:
      return { base: [...frames], overlays: [] };
  }
}

function dedupe(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (const f of frames) {
    const prev = out[out.length - 1];
    if (!prev || prev.join('\n') !== f.join('\n')) out.push(f);
  }
  return out;
}

/** 8-connected components, in first-seen (row-major) order. */
export function components(pixels: Pixel[]): Pixel[][] {
  const key = (x: number, y: number) => `${x},${y}`;
  const pending = new Map(pixels.map((p) => [key(p.x, p.y), p]));
  const out: Pixel[][] = [];
  for (const start of pixels) {
    if (!pending.has(key(start.x, start.y))) continue;
    const group: Pixel[] = [];
    const stack = [start];
    pending.delete(key(start.x, start.y));
    while (stack.length) {
      const p = stack.pop()!;
      group.push(p);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = pending.get(key(p.x + dx, p.y + dy));
          if (q) {
            pending.delete(key(q.x, q.y));
            stack.push(q);
          }
        }
      }
    }
    out.push(group);
  }
  return out;
}

/** Body pixel count, for the invariant that decomposition never touches the character. */
export function bodyCount(frame: Frame): number {
  return pixelsOf(frame, (_x, _y, ch) => (BODY_GLYPHS as readonly string[]).includes(ch)).length;
}

// ─── the animal pack ─────────────────────────────────────────────────────────────────

/**
 * An animal's idle loop. The frames are `ANIMAL_FRAMES[animal]`, `[REST, BREATH, REST,
 * GESTURE]` (the whale's gesture is two frames), and each is held for `holds[i]` beats.
 *
 * What an animal does NOT do any more is the point of this table. It does not drift: the
 * crab used to sidestep two cells end to end and the bee to hover two cells at 900 ms, and a
 * continuous translate or scale leaves a pixel icon off whole device pixels most of the
 * time. It does not breathe on a scale either; the breath is drawn, in four cells. It blinks
 * on Bit's cadence (`blinkGapMs`, `closeEyes`), applied by the renderer.
 */
export interface AnimalMotion {
  /** One beat, 400–600 ms. Under that the loop reads as busy; over it, as a slideshow. */
  beatMs: number;
  /** Beats each frame of the loop is held for. The rest pose holds for over half the loop. */
  holds: number[];
  /** What the loop IS, in one line, for the contact sheet and for review. */
  note: string;
}

/**
 * Beats differ a little per animal so a row of creatures does not tick in unison; the holds
 * are the same shape for all eight: rest 4, breath 2, rest 3, gesture 2.
 */
export const ANIMAL_MOTION: Record<Animal, AnimalMotion> = {
  cat: { beatMs: 550, holds: [4, 2, 3, 2], note: 'the neck fills, then the tail tip flicks out' },
  dog: { beatMs: 450, holds: [4, 2, 3, 2], note: 'the chest fills, then one ear flops out' },
  fox: { beatMs: 500, holds: [4, 2, 3, 2], note: 'the jaw fills, then one ear folds' },
  owl: { beatMs: 600, holds: [4, 2, 3, 2], note: 'the chest puffs, then the tufts flatten' },
  bee: { beatMs: 400, holds: [4, 2, 3, 2], note: 'the lowest band swells, then the antennae twitch out' },
  // The spout is two frames, rising then spraying, a beat each: the same two beats of gesture.
  // It is the whale's gesture and not its rest pose: a stalk on a round amber body is a pumpkin.
  whale: { beatMs: 450, holds: [4, 2, 3, 1, 1], note: 'the belly fills, then the spout rises and sprays' },
  octopus: { beatMs: 500, holds: [4, 2, 3, 2], note: 'the neck swells, then the two outer arm tips lift and point out' },
  crab: { beatMs: 450, holds: [4, 2, 3, 2], note: 'the shell swells, then both claws snip shut' },
};

/** The looping frame timeline of an animal at a given tempo, holds applied. */
export function animalTimeline(animal: Animal, tempo = 1): Beat[] {
  const rate = clampTempo(tempo);
  const m = ANIMAL_MOTION[animal];
  return ANIMAL_FRAMES[animal].map((_, i) => ({
    frame: i,
    ms: Math.round((m.beatMs * (m.holds[i] ?? 1)) / rate),
  }));
}
