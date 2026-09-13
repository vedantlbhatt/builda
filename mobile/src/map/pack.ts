/**
 * Front chain circle packing: every circle placed tangent to two on the growing cluster's
 * outer chain, as close to the origin as it will go, in the order given.
 *
 * Ported from d3-hierarchy `src/pack/siblings.js` (packSiblingsRandom), with its enclosing
 * circle left out: the map fits the cells' bounding box, not a circle. The arithmetic is
 * +, -, *, / and sqrt only, all correctly rounded in IEEE 754, so the same input lands on the
 * same coordinates in Hermes, JavaScriptCore and Bun alike. No trig, no random.
 *
 * Copyright 2010-2023 Mike Bostock
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or
 * without fee is hereby granted, provided that the above copyright notice and this
 * permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO
 * THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT
 * SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR
 * ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE
 * USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

export interface Circle {
  r: number;
  x: number;
  y: number;
}

interface Link {
  c: Circle;
  next: Link;
  previous: Link;
}

/** Place `c` tangent to both `a` and `b`, on the side the front chain runs. */
function place(b: Circle, a: Circle, c: Circle): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2) {
    let a2 = a.r + c.r;
    a2 *= a2;
    let b2 = b.r + c.r;
    b2 *= b2;
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy;
      c.y = b.y - x * dy + y * dx;
    } else {
      const x = (d2 + a2 - b2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy;
      c.y = a.y + x * dy + y * dx;
    }
  } else {
    c.x = a.x + c.r;
    c.y = a.y;
  }
}

/** Do two circles overlap by more than a rounding error? */
function intersects(a: Circle, b: Circle): boolean {
  const dr = a.r + b.r - 1e-6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

/** How far the weighted midpoint of a link and its successor sits from the origin. */
function score(node: Link): number {
  const a = node.c;
  const b = node.next.c;
  const ab = a.r + b.r;
  const dx = (a.x * b.r + b.x * a.r) / ab;
  const dy = (a.y * b.r + b.y * a.r) / ab;
  return dx * dx + dy * dy;
}

function link(c: Circle): Link {
  const l = { c } as Link;
  l.next = l;
  l.previous = l;
  return l;
}

/**
 * Sets `x` and `y` on every circle so none overlaps another, packed around the origin in the
 * order given: the first circle sits at the centre and each later one as near it as the
 * chain allows. Mutates and returns the same array.
 */
export function packSiblings<C extends Circle>(circles: C[]): C[] {
  const n = circles.length;
  if (n === 0) return circles;

  let a0 = circles[0]!;
  a0.x = 0;
  a0.y = 0;
  if (n === 1) return circles;

  const b0 = circles[1]!;
  a0.x = -b0.r;
  b0.x = a0.r;
  b0.y = 0;
  if (n === 2) return circles;

  const c0 = circles[2]!;
  place(b0, a0, c0);

  // The front chain starts as the first three circles, a -> b -> c -> a.
  let a = link(a0);
  let b = link(b0);
  let c = link(c0);
  a.next = c.previous = b;
  b.next = a.previous = c;
  c.next = b.previous = a;

  pack: for (let i = 3; i < n; ++i) {
    const ci = circles[i]!;
    place(a.c, b.c, ci);
    c = link(ci);

    // The closest intersecting circle on the chain, by distance along the chain, if any.
    let j = b.next;
    let k = a.previous;
    let sj = b.c.r;
    let sk = a.c.r;
    do {
      if (sj <= sk) {
        if (intersects(j.c, c.c)) {
          b = j;
          a.next = b;
          b.previous = a;
          --i;
          continue pack;
        }
        sj += j.c.r;
        j = j.next;
      } else {
        if (intersects(k.c, c.c)) {
          a = k;
          a.next = b;
          b.previous = a;
          --i;
          continue pack;
        }
        sk += k.c.r;
        k = k.previous;
      }
    } while (j !== k.next);

    // It fits: insert it between a and b.
    c.previous = a;
    c.next = b;
    a.next = b.previous = b = c;

    // The pair on the chain nearest the centroid is where the next circle goes.
    let aa = score(a);
    while ((c = c.next) !== b) {
      const ca = score(c);
      if (ca < aa) {
        a = c;
        aa = ca;
      }
    }
    b = a.next;
  }

  return circles;
}
