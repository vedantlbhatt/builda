'use strict';
/**
 * Ink that moves like ink, drawn in the app's pixels.
 *
 * `Fluid` is Stam's stable fluids ("Stable Fluids", SIGGRAPH 1999; "Real-Time Fluid Dynamics for
 * Games", GDC 2003) on a coarse grid: semi-Lagrangian advection, a Jacobi pressure projection so
 * the flow is incompressible, and vorticity confinement (Fedkiw, Stam and Jensen, "Visual
 * Simulation of Smoke", SIGGRAPH 2001) to put back the curls a coarse grid smears out. Its fields
 * are never drawn as gradients: they are read per cell and printed through the 1-bit dither
 * (`pixels.field`), so the ink moves like a liquid and still looks like the app.
 *
 * `inkWipe` is the transition between two scenes. A wipe that only follows the fluid can stall
 * short of a corner, and a transition that sometimes leaves a corner of the last scene is a bug; a
 * wipe that only follows a straight front is a page turn. So the front is a straight sweep of a
 * PHASE field (each cell's distance along the wipe's direction), and that field is carried by the
 * fluid: the front's edge curls as the ink is stirred, and every cell is still passed by the front
 * on schedule, because advection by an incompressible flow moves the phase values around without
 * making new ones. The ink is the band between the front and the back of the sweep.
 *
 * Deterministic: the stirring comes from a seeded generator, and a sequence is a pure function of
 * its arguments, so every render worker computes the same frames.
 */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

class Fluid {
  constructor(nx, ny) {
    this.nx = nx;
    this.ny = ny;
    const n = (nx + 2) * (ny + 2);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.div = new Float32Array(n);
    this.curl = new Float32Array(n);
  }
  IX(i, j) {
    return i + (this.nx + 2) * j;
  }
  bound(b, x) {
    const { nx, ny } = this;
    const W = nx + 2;
    for (let i = 1; i <= nx; i++) {
      x[i] = b === 2 ? -x[i + W] : x[i + W];
      x[i + W * (ny + 1)] = b === 2 ? -x[i + W * ny] : x[i + W * ny];
    }
    for (let j = 1; j <= ny; j++) {
      x[W * j] = b === 1 ? -x[1 + W * j] : x[1 + W * j];
      x[nx + 1 + W * j] = b === 1 ? -x[nx + W * j] : x[nx + W * j];
    }
    x[0] = 0.5 * (x[1] + x[W]);
    x[W * (ny + 1)] = 0.5 * (x[1 + W * (ny + 1)] + x[W * ny]);
    x[nx + 1] = 0.5 * (x[nx] + x[nx + 1 + W]);
    x[nx + 1 + W * (ny + 1)] = 0.5 * (x[nx + W * (ny + 1)] + x[nx + 1 + W * ny]);
  }
  /** Semi-Lagrangian: each cell takes the value found where its flow came from, `dt` ago. */
  advect(b, d, d0, u, v, dt) {
    const { nx, ny } = this;
    const W = nx + 2;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        let x = i - dt * u[i + W * j];
        let y = j - dt * v[i + W * j];
        x = x < 0.5 ? 0.5 : x > nx + 0.5 ? nx + 0.5 : x;
        y = y < 0.5 ? 0.5 : y > ny + 0.5 ? ny + 0.5 : y;
        const i0 = x | 0, j0 = y | 0, s1 = x - i0, t1 = y - j0, s0 = 1 - s1, t0 = 1 - t1;
        d[i + W * j] =
          s0 * (t0 * d0[i0 + W * j0] + t1 * d0[i0 + W * (j0 + 1)]) + s1 * (t0 * d0[i0 + 1 + W * j0] + t1 * d0[i0 + 1 + W * (j0 + 1)]);
      }
    }
    this.bound(b, d);
  }
  /**
   * Take the divergence out of the flow: a Gauss-Seidel solve for pressure, then subtract its
   * gradient. MEASURED (test/pure.test.js): on a collocated grid like Stam's, the central difference
   * divergence and the five point pressure solve disagree at the checkerboard frequency, so a residue
   * is left that no number of sweeps removes (0.9 to 0.7 of a stirred field at 24 sweeps and at
   * 2000). It is the grid's scale, and through a 1-bit dither it does not show; a staggered grid
   * would remove it at twice the bookkeeping, which nothing here needs.
   */
  project(iters = 24) {
    const { nx, ny, u, v, p, div } = this;
    const W = nx + 2;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = i + W * j;
        div[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + W] - v[k - W]);
        p[k] = 0;
      }
    }
    this.bound(0, div);
    this.bound(0, p);
    for (let it = 0; it < iters; it++) {
      for (let j = 1; j <= ny; j++) {
        for (let i = 1; i <= nx; i++) {
          const k = i + W * j;
          p[k] = (div[k] + p[k - 1] + p[k + 1] + p[k - W] + p[k + W]) / 4;
        }
      }
      this.bound(0, p);
    }
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = i + W * j;
        u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
        v[k] -= 0.5 * (p[k + W] - p[k - W]);
      }
    }
    this.bound(1, u);
    this.bound(2, v);
  }
  /** Push the flow along the gradient of its own curl's magnitude, which keeps a vortex a vortex. */
  confine(eps, dt) {
    const { nx, ny, u, v, curl } = this;
    const W = nx + 2;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = i + W * j;
        curl[k] = 0.5 * (v[k + 1] - v[k - 1] - (u[k + W] - u[k - W]));
      }
    }
    for (let j = 2; j < ny; j++) {
      for (let i = 2; i < nx; i++) {
        const k = i + W * j;
        const gx = 0.5 * (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]));
        const gy = 0.5 * (Math.abs(curl[k + W]) - Math.abs(curl[k - W]));
        const len = Math.hypot(gx, gy) + 1e-5;
        u[k] += eps * dt * (gy / len) * curl[k];
        v[k] -= eps * dt * (gx / len) * curl[k];
      }
    }
  }
  /** A swirl of `strength` around (cx, cy) in grid cells, falling off over `radius`. */
  swirl(cx, cy, radius, strength) {
    const { nx, ny, u, v } = this;
    const W = nx + 2;
    const r2 = radius * radius;
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const dx = i - cx, dy = j - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2 * 4) continue;
        const f = strength * Math.exp(-d2 / r2);
        u[i + W * j] += -dy * f / radius;
        v[i + W * j] += dx * f / radius;
      }
    }
  }
  /** A uniform push, as a gravity or the direction of a pour. */
  push(du, dv) {
    const { u, v } = this;
    for (let k = 0; k < u.length; k++) {
      u[k] += du;
      v[k] += dv;
    }
  }
  /** One step of the flow. Scalars ride along through `carry`. */
  step(dt, { vorticity = 2.5, damping = 0.995, carry = [] } = {}) {
    if (vorticity) this.confine(vorticity, dt);
    this.project();
    this.u0.set(this.u);
    this.v0.set(this.v);
    this.advect(1, this.u, this.u0, this.u0, this.v0, dt);
    this.advect(2, this.v, this.v0, this.u0, this.v0, dt);
    this.project();
    for (let k = 0; k < this.u.length; k++) {
      this.u[k] *= damping;
      this.v[k] *= damping;
    }
    for (const s of carry) {
      s.tmp.set(s.field);
      this.advect(0, s.field, s.tmp, this.u, this.v, dt);
    }
  }
  /** Bilinear read of a field at grid position (x, y), 1-based interior coordinates. */
  sample(field, x, y) {
    const { nx, ny } = this;
    const W = nx + 2;
    x = x < 0.5 ? 0.5 : x > nx + 0.5 ? nx + 0.5 : x;
    y = y < 0.5 ? 0.5 : y > ny + 0.5 ? ny + 0.5 : y;
    const i0 = x | 0, j0 = y | 0, s1 = x - i0, t1 = y - j0;
    return (
      (1 - s1) * ((1 - t1) * field[i0 + W * j0] + t1 * field[i0 + W * (j0 + 1)]) +
      s1 * ((1 - t1) * field[i0 + 1 + W * j0] + t1 * field[i0 + 1 + W * (j0 + 1)])
    );
  }
}

/** A scalar the flow carries, with the scratch buffer advection needs. */
function scalar(fl) {
  return { field: new Float32Array(fl.u.length), tmp: new Float32Array(fl.u.length) };
}

/**
 * The phase of an ink wipe at every frame of it. `cols` x `rows` is the frame's cell grid, `dir` the
 * sweep's direction (a unit vector in screen space, y down), `frames` how many frames it lasts,
 * `seed` its stirring. Returns `phaseAt(k)`: frame k's phase field on the SIMULATION grid, and
 * `read(phase, i, j)`: a cell's phase, 0 where the sweep starts and 1 where it ends.
 */
function wipePhases({ cols, rows, dir, frames, seed = 7, stir = 1 }) {
  // Half the cell grid is plenty for the flow: the dither is what makes the edge crisp.
  const nx = Math.max(8, Math.round(cols / 2));
  const ny = Math.max(8, Math.round(rows / 2));
  const fl = new Fluid(nx, ny);
  const ph = scalar(fl);
  const [dx, dy] = dir;
  // Each cell's projection on the direction, normalised so the frame spans 0 to 1.
  const corners = [
    [0, 0],
    [nx, 0],
    [0, ny],
    [nx, ny],
  ].map(([x, y]) => x * dx + y * dy);
  const lo = Math.min(...corners), hi = Math.max(...corners);
  const W = nx + 2;
  for (let j = 0; j <= ny + 1; j++) {
    for (let i = 0; i <= nx + 1; i++) {
      ph.field[i + W * j] = ((i - 0.5) * dx + (j - 0.5) * dy - lo) / (hi - lo);
    }
  }
  // Stir: a handful of seeded vortices across the frame, alternating in sense, plus a gentle push
  // along the sweep so the curls travel the way the ink does.
  const r = rng(seed);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const cx = 1 + r() * nx, cy = 1 + r() * ny;
    const rad = (0.1 + r() * 0.14) * Math.min(nx, ny);
    fl.swirl(cx, cy, rad, (k % 2 ? -1 : 1) * (0.9 + r() * 0.8) * stir);
  }
  const dt = 1.0;
  const phases = [Float32Array.from(ph.field)];
  for (let k = 1; k <= frames; k++) {
    fl.push(dx * 0.02 * stir, dy * 0.02 * stir);
    fl.step(dt, { vorticity: 1.6, damping: 0.985, carry: [ph] });
    phases.push(Float32Array.from(ph.field));
  }
  const sx = nx / cols, sy = ny / rows;
  return {
    frames,
    phaseAt: (k) => phases[Math.max(0, Math.min(frames, k))],
    read: (phase, i, j) => fl.sample(phase, 0.5 + (i + 0.5) * sx, 0.5 + (j + 0.5) * sy),
  };
}

/**
 * The ink's density in a cell at wipe progress `p` (0 to 1): full inside the band between the
 * back and the front of the sweep, dithering off over `soft` of phase at either edge. And whether
 * the cell already shows the incoming scene (the back has passed it). Pure.
 *
 * The front runs from before 0 to past 1 in the first 62% of the wipe and the back from 38% to the
 * end, so the ink is a thick band travelling across the frame (MEASURED on a 40 x 70 grid: 64% to
 * 86% of the cells under solid ink halfway through, by direction), never a flat frame of one colour,
 * and no cell is left un-passed: at p = 1 the back is at 1 + soft, past every phase a cell can hold,
 * because advection by bilinear interpolation never makes a value outside the ones it started with.
 */
function wipeCell(phase, p, soft = 0.09) {
  const front = -soft + (1 + 2 * soft) * Math.min(1, p / 0.62);
  const back = -soft + (1 + 2 * soft) * Math.max(0, (p - 0.38) / 0.62);
  const inFront = Math.max(0, Math.min(1, (front - phase) / soft));
  const pastBack = Math.max(0, Math.min(1, (back - phase) / soft));
  // How deep inside the ink a cell sits, 0 at the front's edge: the pour's leading edge is the hue,
  // the body behind it the hue's partner tone, so the curls read as depth and not as one flat blot.
  const depth = Math.max(0, Math.min(1, (front - phase) / (soft * 3.2)));
  return { ink: inFront * (1 - pastBack), revealed: pastBack, depth };
}

module.exports = { Fluid, scalar, rng, wipePhases, wipeCell };
