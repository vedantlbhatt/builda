'use strict';
/**
 * A cut, laid on the clock. Pure (the tests read it).
 *
 * The cut says which scenes, in what order, with what weights, over how many seconds. This turns
 * that into seconds: each scene's span, the transition between each pair straddling their boundary,
 * and for a screens scene, which part of the demo's recording plays when, at what speed, and when a
 * tap lands (so the ring and the punch in sit on the frame the screen reacted, not a guess).
 *
 * The recording is the demo's (`capture demo`): beats of `{start, end, tap, change, label}` in its
 * own seconds. A beat plays faster when the scene is short, never over MAX_SPEED (a UI past about
 * twice its speed reads as a glitch, not as quick), and never slower than MIN_SPEED; a beat too
 * long for its share keeps the part from just before its tap to its end, because the settled
 * screen after a tap is what the viewer came to see.
 */
const { spec } = require('./house');

const MAX_SPEED = 2.2;
const MIN_SPEED = 0.8;
/** Transition lengths at pace 1, in seconds. A morph is the ISLAND spring's settle plus a beat. */
const TRANSITION = { fluid: 0.9, morph: 0.75, cut: 0 };
/** How long before the screen reacts the ring lands (the ship kit's RING_LEAD). */
const RING_LEAD = 0.18;
/** When a beat is trimmed, it keeps this much before its tap. */
const BEFORE_TAP = 0.5;

function clampNum(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * The beats a screens scene plays: the demo's timeline beats when it has a recording, else its
 * stills as still beats. `pick` is the cut's `beats` (positions), null for the first five.
 */
function beatsFor(facts, pick) {
  const demo = facts.demo ?? {};
  const all = demo.video && demo.beats?.length
    ? demo.beats.map((b, i) => ({ pos: i, kind: 'video', start: b.start, end: b.end, tap: b.tap ?? null, change: b.change ?? null, label: b.label ?? null }))
    : (demo.stills ?? []).map((s, i) => ({ pos: i, kind: 'still', still: i, label: s.label ?? null }));
  const chosen = pick && pick.length ? pick.map((p) => all[p]).filter(Boolean) : all.slice(0, 5);
  return chosen.length ? chosen : all.slice(0, 1);
}

/** Split a screens scene's `d` seconds over its beats and map each onto the recording. */
function screensPlan(beats, d) {
  if (!beats.length) return [];
  const spans = beats.map((b) => (b.kind === 'video' ? Math.max(0.3, b.end - b.start) : 1));
  const total = spans.reduce((a, b) => a + b, 0);
  let at = 0;
  return beats.map((b, i) => {
    const share = (d * spans[i]) / total;
    const s0 = at, s1 = at + share;
    at = s1;
    if (b.kind !== 'video') return { ...b, s0, s1 };
    let v0 = b.start, v1 = b.end;
    let speed = (v1 - v0) / share;
    if (speed > MAX_SPEED) {
      // Too long for its share even played fast: keep from just before the tap to the end.
      speed = MAX_SPEED;
      const keep = share * MAX_SPEED;
      const from = b.change != null ? Math.max(b.start, b.change - BEFORE_TAP) : b.start;
      v0 = from + keep <= b.end ? from : Math.max(b.start, b.end - keep);
      v1 = v0 + keep;
    } else if (speed < MIN_SPEED) {
      speed = MIN_SPEED;
    }
    const tapAt = b.tap && b.change != null && b.change >= v0 && b.change <= v1 ? s0 + (b.change - v0) / speed - RING_LEAD : null;
    return { ...b, s0, s1, v0, v1, speed, tapAt };
  });
}

/** The recording's time at scene time `t` under `plan` (holds on a beat's last frame if it ran out). */
function videoTime(plan, t) {
  const b = plan.find((p) => t < p.s1) ?? plan[plan.length - 1];
  if (!b || b.kind !== 'video') return null;
  return Math.min(b.v1, b.v0 + Math.max(0, t - b.s0) * b.speed);
}

/**
 * The whole trailer on the clock. Returns `{seconds, fps, frames, scenes, cues}` where each scene is
 * `{index, kind, t0, t1, spec, into, plan}`: `into` is the transition INTO this scene (null for the
 * first), `plan` a screens scene's beats.
 */
function timeline(cut, facts) {
  const fps = spec.fps;
  const seconds = clampNum(cut.seconds, spec.seconds.min, spec.seconds.max);
  const pace = clampNum(cut.pace, spec.pace.min, spec.pace.max);
  const scenes = cut.scenes;
  const weights = scenes.map((s) => clampNum(s.weight, spec.weight.min, spec.weight.max));
  const sum = weights.reduce((a, b) => a + b, 0);
  const tr = (TRANSITION[cut.transition] ?? TRANSITION.fluid) / pace;
  let at = 0;
  const out = scenes.map((s, i) => {
    const d = (seconds * weights[i]) / sum;
    const t0 = at, t1 = at + d;
    at = t1;
    const kindIn = i === 0 ? null : transitionBetween(scenes[i - 1].kind, s.kind, cut.transition);
    const len = kindIn ? Math.min((TRANSITION[kindIn] ?? tr) / pace, d * 0.45) : 0;
    const into = kindIn ? { kind: kindIn, t0: t0 - len / 2, t1: t0 + len / 2 } : null;
    const scene = { index: i, kind: s.kind, t0, t1, spec: s, into, plan: null };
    if (s.kind === 'screens') scene.plan = screensPlan(beatsFor(facts, s.beats), d);
    return scene;
  });
  const cues = [];
  for (const s of out) {
    cues.push({ t: s.t0, kind: `scene:${s.kind}` });
    if (s.into) cues.push({ t: (s.into.t0 + s.into.t1) / 2, kind: `into:${s.into.kind}`, len: s.into.t1 - s.into.t0 });
    for (const b of s.plan ?? []) if (b.tapAt != null) cues.push({ t: s.t0 + b.tapAt + 0.12, kind: 'tap' });
  }
  cues.push({ t: seconds, kind: 'end' });
  return { seconds, fps, frames: Math.round(seconds * fps), pace, scenes: out, cues: cues.sort((a, b) => a.t - b.t) };
}

/**
 * The transition between two scenes: the cut's choice, except that a morph needs both sides to
 * have a container to grow between (the band and the device's screen). Opening into screens and
 * screens into the end are the morph's natural places; anywhere else a morph asked for is ink.
 */
function transitionBetween(a, b, chosen) {
  if (chosen === 'cut') return 'cut';
  const morphable = (a === 'open' && b === 'screens') || (a === 'screens' && b === 'end');
  if (chosen === 'morph') return morphable ? 'morph' : 'fluid';
  return 'fluid';
}

/** Which scenes are on screen at `t`: one, or two inside a transition. */
function at(tl, t) {
  const i = tl.scenes.findIndex((s) => t < s.t1);
  const k = i < 0 ? tl.scenes.length - 1 : i;
  const cur = tl.scenes[k];
  const next = tl.scenes[k + 1];
  if (next && next.into && t >= next.into.t0) return { from: cur, to: next, p: (t - next.into.t0) / (next.into.t1 - next.into.t0) };
  if (cur.into && t < cur.into.t1 && k > 0) return { from: tl.scenes[k - 1], to: cur, p: (t - cur.into.t0) / (cur.into.t1 - cur.into.t0) };
  return { from: cur, to: null, p: 0 };
}

module.exports = { timeline, at, beatsFor, screensPlan, videoTime, transitionBetween, TRANSITION, MAX_SPEED, MIN_SPEED, RING_LEAD };
