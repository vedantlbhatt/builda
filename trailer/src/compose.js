'use strict';
/**
 * One frame of a trailer: the scene on screen, or two scenes and the transition between them.
 *
 *   cut     the next scene, on the frame the audio's hit lands
 *   fluid   the next scene's ink pours across the frame along a sweep the fluid stirs
 *           (`fluid.wipePhases`), covers it, and drains off it to leave the next scene; every cell
 *           is ink or ground or picture, never a blend
 *   morph   the container of the first grows or shrinks into the container of the second on the
 *           ISLAND spring (the opening band into the device's screen, the screen out into the end
 *           card), the first scene's words leaving by 0.28 and scaling up, the second's arriving
 *           from 0.34 (`time.morph`); the picture then develops out of the container's ink
 *
 * `prepare(t)` loads what a frame needs (a video frame is a file read), `draw(ctx, t)` is then
 * synchronous. Both are pure functions of `t`: the render workers split a trailer by frame and must
 * draw the same pixels whichever worker a frame lands on.
 */
const { createCanvas } = require('@napi-rs/canvas');
const { SURFACE, motion } = require('./house');
const { at, videoTime } = require('./timeline');
const { clamp, lerp, morph, spring, seg } = require('./time');
const { wipePhases, wipeCell } = require('./fluid');
const px = require('./pixels');
const SCENES = require('./scenes');

class Composer {
  constructor(env) {
    this.env = env;
    this.tl = env.tl;
    const { W, H } = env.lay;
    this.A = createCanvas(W, H);
    this.B = createCanvas(W, H);
    this.M = createCanvas(W, H);
    this.wipes = new Map();
  }

  async prepare(t) {
    const { from, to, p } = at(this.tl, t);
    const need = [];
    for (const s of [from, to]) {
      if (!s || s.kind !== 'screens') continue;
      const local = t - s.t0;
      const vt = videoTime(s.plan, Math.max(0, local));
      if (vt != null) need.push(vt);
    }
    this.env.picture = null;
    if (need.length && this.env.frames) this.env.picture = await this.env.frames.at(need[0]);
    else if (this.env.stills?.length) {
      // Stills: the beat's own still, held for the beat.
      const s = [from, to].find((x) => x && x.kind === 'screens');
      if (s) {
        const local = Math.max(0, t - s.t0);
        const b = s.plan.find((x) => local < x.s1) ?? s.plan[s.plan.length - 1];
        this.env.picture = this.env.stills[b?.still ?? 0] ?? null;
      }
    }
    return p;
  }

  ground(ctx) {
    ctx.fillStyle = SURFACE.bg;
    ctx.fillRect(0, 0, this.env.lay.W, this.env.lay.H);
  }

  scene(ctx, s, t, pr, opts) {
    const impl = SCENES[s.kind];
    impl.draw(ctx, this.env, s, t - s.t0, pr, opts);
  }

  draw(ctx, t) {
    const { from, to, p } = at(this.tl, t);
    this.ground(ctx);
    if (!to) {
      this.scene(ctx, from, t, SCENES.FULL, this.afterMorph(from, t));
      return;
    }
    const kind = to.into.kind;
    if (kind === 'cut') {
      this.scene(ctx, p < 0.5 ? from : to, t, SCENES.FULL);
      return;
    }
    if (kind === 'morph') return this.morph(ctx, from, to, t);
    return this.fluid(ctx, from, to, t, clamp(p));
  }

  /** After a morph into the screens, the picture develops out of the container's ink. */
  afterMorph(s, t) {
    if (s.kind !== 'screens' || !s.into || s.into.kind !== 'morph') return undefined;
    const since = t - s.into.t0;
    const settle = 0.42 / this.env.pace;
    const reveal = clamp((since - settle) / (0.5 / this.env.pace));
    return reveal >= 1 ? undefined : { developFrom: { reveal } };
  }

  morph(ctx, from, to, t) {
    const env = this.env;
    const m = morph(t - to.into.t0, env.pace);
    const a = SCENES[from.kind].anchor(env);
    const b = SCENES[to.kind].anchor(env);
    const u = m.box;
    // One progress for every edge: size passes its target and comes back, radius clamps.
    const r = { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), w: Math.max(4, lerp(a.w, b.w, u)), h: Math.max(4, lerp(a.h, b.h, u)), rad: Math.max(0, lerp(a.r, b.r, clamp(u))) };
    const growing = to.kind === 'end';
    // The outgoing scene's content (not its container), leaving.
    if (from.kind === 'screens' && growing) {
      // The device stays put under the growing card, so the card reads as coming out of the screen.
      this.scene(ctx, from, t, { opacity: 1, scale: 1, rise: 0 });
    } else {
      this.scene(ctx, from, t, m.out, { container: false });
    }
    ctx.fillStyle = a.fill;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.rad, r.w / 2, r.h / 2));
    ctx.fill();
    if (growing) {
      this.scene(ctx, to, t, m.in, { container: false });
    } else {
      // Into the screens: the device's body and the rest arrive round the container, which holds
      // the ink until the box has settled and the picture develops.
      this.scene(ctx, to, t, { opacity: m.in.opacity, scale: 1, rise: 0 }, { developFrom: { reveal: 0 } });
      ctx.fillStyle = b.fill;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.rad, r.w / 2, r.h / 2));
      ctx.fill();
    }
  }

  wipeFor(to) {
    const k = to.index;
    if (!this.wipes.has(k)) {
      const { lay, fps } = { lay: this.env.lay, fps: this.env.fps };
      const cols = Math.ceil(lay.W / lay.cell), rows = Math.ceil(lay.H / lay.cell);
      const frames = Math.max(2, Math.ceil((to.into.t1 - to.into.t0) * fps));
      // The direction turns scene by scene, so no two wipes in a trailer sweep alike.
      const angle = [Math.PI * 0.5, Math.PI * 0.08, Math.PI * 0.62, Math.PI * 1.04, Math.PI * 0.3][k % 5];
      const dir = [Math.cos(angle), Math.sin(angle)];
      this.wipes.set(k, { cols, rows, frames, w: wipePhases({ cols, rows, dir, frames, seed: this.env.seed + k * 13 }) });
    }
    return this.wipes.get(k);
  }

  fluid(ctx, from, to, t, p) {
    const env = this.env;
    const { lay } = env;
    const W = lay.W, H = lay.H;
    const { cols, rows, frames, w } = this.wipeFor(to);
    // The phase field at this moment, between two simulated frames.
    const kf = p * frames;
    const k0 = Math.floor(kf), k1 = Math.min(frames, k0 + 1), fr = kf - k0;
    const P0 = w.phaseAt(k0), P1 = w.phaseAt(k1);
    const phase = (i, j) => lerp(w.read(P0, i, j), w.read(P1, i, j), fr);
    // A: the scene leaving; B: the scene arriving, each as if alone.
    const A = this.A.getContext('2d'), B = this.B.getContext('2d');
    this.ground(A);
    this.scene(A, from, t, SCENES.FULL, this.afterMorph(from, t));
    this.ground(B);
    this.scene(B, to, t, SCENES.FULL);
    // The mask of cells that show B, and the ink between.
    const cells = px.cellsFor(cols, rows, 'wipe');
    const ink = px.cellsFor(cols, rows, 'wipeInk');
    cells.clear();
    ink.clear();
    const inkRgb = px.rgb(env.hue.ink);
    const partnerRgb = px.rgb(env.hue.partner);
    const white = [255, 255, 255];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const c = wipeCell(phase(i, j), p);
        const th = px.b8(i, j);
        if (c.revealed > th) cells.set(i, j, white);
        // The edge is the hue, the body the partner, dithered between them over the pour's depth.
        else if (c.ink > th) ink.set(i, j, c.depth > 0.55 + th * 0.4 ? partnerRgb : inkRgb);
      }
    }
    ctx.drawImage(this.A, 0, 0);
    const m = this.M.getContext('2d');
    m.clearRect(0, 0, W, H);
    cells.blit(m, 0, 0, lay.cell);
    B.globalCompositeOperation = 'destination-in';
    B.drawImage(this.M, 0, 0);
    B.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.B, 0, 0);
    ink.blit(ctx, 0, 0, lay.cell);
  }
}

module.exports = { Composer };
